/**
 * Behaviour tests for the apps/achilles IPC Zod schemas.
 *
 * Each schema is `.strict()` so unknown fields are rejected at the
 * trust boundary (mirrors the SAFE-01 precedent set by
 * packages/voice-protocol/src/ipc.ts). The test seam exists so a
 * compromised renderer cannot piggyback extra fields a future schema
 * would have used.
 */
import { describe, expect, it } from "vitest";
import {
  ACHILLES_STATES,
  IPC_ERROR,
  IPC_MIC_AMPLITUDE,
  IPC_MIC_FRAME,
  IPC_OPEN_SYSTEM_SETTINGS,
  IPC_PERMISSION_STATE,
  IPC_REGISTER_HOTKEY,
  IPC_REQUEST_STATE,
  IPC_STATE_CHANGED,
  IPC_STT_TOKEN,
  IPC_STT_TOKEN_REQUEST,
  IPC_TRANSCRIPT_COMMITTED,
  IPC_TRANSCRIPT_PARTIAL,
  IPC_TTS_AMPLITUDE,
  IPC_TTS_CHUNK,
  IPC_TTS_PLAYBACK_COMPLETE,
  IPC_UPDATE_HOTKEY_CONFIG,
  IPC_UPDATE_WINDOW_POSITION,
  IPC_UTTERANCE_COMMIT,
} from "./constants.js";
import {
  ErrorPayloadSchema,
  IPC_PAYLOAD_SCHEMAS,
  MicAmplitudePayloadSchema,
  MicFramePayloadSchema,
  OpenSystemSettingsPayloadSchema,
  PermissionStatePayloadSchema,
  RegisterHotkeyPayloadSchema,
  RequestStatePayloadSchema,
  StateChangedPayloadSchema,
  SttTokenPayloadSchema,
  SttTokenRequestPayloadSchema,
  TranscriptCommittedPayloadSchema,
  TranscriptPartialPayloadSchema,
  TtsAmplitudePayloadSchema,
  TtsChunkPayloadSchema,
  TtsPlaybackCompletePayloadSchema,
  UpdateHotkeyConfigPayloadSchema,
  UpdateWindowPositionPayloadSchema,
  UtteranceCommitPayloadSchema,
  parseEnvelope,
} from "./ipc-schemas.js";

describe("StateChangedPayloadSchema (IPC1)", () => {
  it("accepts every value in ACHILLES_STATES", () => {
    for (const s of ACHILLES_STATES) {
      expect(StateChangedPayloadSchema.parse({ state: s })).toEqual({
        state: s,
      });
    }
  });

  it("rejects 'unknown' as a state value", () => {
    expect(() =>
      StateChangedPayloadSchema.parse({ state: "unknown" }),
    ).toThrow();
  });

  it("rejects extra fields (.strict())", () => {
    expect(() =>
      StateChangedPayloadSchema.parse({ state: "idle", extra: 1 }),
    ).toThrow();
  });
});

describe("MicAmplitudePayloadSchema (IPC2)", () => {
  it("accepts rms exactly at 0 and 1", () => {
    expect(MicAmplitudePayloadSchema.parse({ rms: 0 })).toEqual({ rms: 0 });
    expect(MicAmplitudePayloadSchema.parse({ rms: 1 })).toEqual({ rms: 1 });
  });

  it("accepts a typical mid-range rms", () => {
    expect(MicAmplitudePayloadSchema.parse({ rms: 0.42 })).toEqual({
      rms: 0.42,
    });
  });

  it("rejects rms < 0", () => {
    expect(() => MicAmplitudePayloadSchema.parse({ rms: -0.01 })).toThrow();
  });

  it("rejects rms > 1", () => {
    expect(() => MicAmplitudePayloadSchema.parse({ rms: 1.01 })).toThrow();
  });

  it("TtsAmplitudePayloadSchema has identical [0,1] bounds", () => {
    expect(TtsAmplitudePayloadSchema.parse({ rms: 0.5 })).toEqual({
      rms: 0.5,
    });
    expect(() => TtsAmplitudePayloadSchema.parse({ rms: 2 })).toThrow();
  });
});

describe("UpdateWindowPositionPayloadSchema (IPC3)", () => {
  it("accepts integer x + y", () => {
    expect(
      UpdateWindowPositionPayloadSchema.parse({ x: 100, y: 200 }),
    ).toEqual({ x: 100, y: 200 });
  });

  it("rejects floating-point x", () => {
    expect(() =>
      UpdateWindowPositionPayloadSchema.parse({ x: 100.5, y: 200 }),
    ).toThrow();
  });

  it("rejects floating-point y", () => {
    expect(() =>
      UpdateWindowPositionPayloadSchema.parse({ x: 100, y: 200.5 }),
    ).toThrow();
  });

  it("accepts negative coordinates (multi-monitor)", () => {
    expect(
      UpdateWindowPositionPayloadSchema.parse({ x: -1280, y: 100 }),
    ).toEqual({ x: -1280, y: 100 });
  });
});

describe("UpdateHotkeyConfigPayloadSchema (IPC4)", () => {
  it("accepts mode-only updates", () => {
    expect(
      UpdateHotkeyConfigPayloadSchema.parse({ mode: "pushToTalk" }),
    ).toEqual({ mode: "pushToTalk" });
  });

  it("accepts key-only updates", () => {
    expect(
      UpdateHotkeyConfigPayloadSchema.parse({ key: "CommandOrControl+Alt+A" }),
    ).toEqual({ key: "CommandOrControl+Alt+A" });
  });

  it("accepts both mode and key together", () => {
    expect(
      UpdateHotkeyConfigPayloadSchema.parse({
        mode: "toggle",
        key: "CommandOrControl+Shift+A",
      }),
    ).toEqual({ mode: "toggle", key: "CommandOrControl+Shift+A" });
  });

  it("rejects the empty-fields case (refine guard)", () => {
    expect(() => UpdateHotkeyConfigPayloadSchema.parse({})).toThrow();
  });

  it("rejects an invalid HotkeyMode literal", () => {
    expect(() =>
      UpdateHotkeyConfigPayloadSchema.parse({ mode: "noTalk" }),
    ).toThrow();
  });

  it("rejects an empty key string", () => {
    expect(() =>
      UpdateHotkeyConfigPayloadSchema.parse({ key: "" }),
    ).toThrow();
  });
});

describe("OpenSystemSettingsPayloadSchema (IPC5)", () => {
  it("accepts an empty payload", () => {
    expect(OpenSystemSettingsPayloadSchema.parse({})).toEqual({});
  });

  it("rejects any extra field", () => {
    expect(() =>
      OpenSystemSettingsPayloadSchema.parse({ foo: 1 }),
    ).toThrow();
  });
});

describe("IPC_PAYLOAD_SCHEMAS + parseEnvelope (IPC6 discriminated map)", () => {
  it("is keyed by every documented IPC channel constant", () => {
    const keys = Object.keys(IPC_PAYLOAD_SCHEMAS);
    // Plan 11-01 shipped 12 channels; Plan 12-03 appended 6 (TTS chunk,
    // playback-complete, utterance commit, mic frame, STT token
    // request + response). Total = 18.
    expect(keys.length).toBe(18);
    for (const k of keys) {
      expect(k.startsWith("achilles:")).toBe(true);
    }
  });

  it("parseEnvelope accepts the matching payload for every channel", () => {
    expect(
      parseEnvelope("achilles:state-changed", { state: "listening" }),
    ).toEqual({ state: "listening" });

    expect(
      parseEnvelope("achilles:transcript-partial", { text: "hello" }),
    ).toEqual({ text: "hello" });

    expect(
      parseEnvelope("achilles:transcript-committed", {
        id: "00000000-0000-4000-8000-000000000000",
        text: "hello world",
        committedAt: 1735000000000,
      }),
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000000",
      text: "hello world",
      committedAt: 1735000000000,
    });

    expect(parseEnvelope("achilles:mic-amplitude", { rms: 0.5 })).toEqual({
      rms: 0.5,
    });
    expect(parseEnvelope("achilles:tts-amplitude", { rms: 0.5 })).toEqual({
      rms: 0.5,
    });
    expect(
      parseEnvelope("achilles:permission-state", { state: "granted" }),
    ).toEqual({ state: "granted" });
    expect(
      parseEnvelope("achilles:error", { message: "Something happened" }),
    ).toEqual({ message: "Something happened" });
    expect(
      parseEnvelope("achilles:request-state", { state: "idle" }),
    ).toEqual({ state: "idle" });
    expect(
      parseEnvelope("achilles:register-hotkey", {
        accelerator: "CommandOrControl+Shift+A",
      }),
    ).toEqual({ accelerator: "CommandOrControl+Shift+A" });
    expect(parseEnvelope("achilles:open-system-settings", {})).toEqual({});
    expect(
      parseEnvelope("achilles:update-window-position", { x: 50, y: 50 }),
    ).toEqual({ x: 50, y: 50 });
    expect(
      parseEnvelope("achilles:update-hotkey-config", { mode: "toggle" }),
    ).toEqual({ mode: "toggle" });
  });

  it("parseEnvelope throws for an unknown channel name", () => {
    expect(() =>
      parseEnvelope("achilles:nonsense", { state: "idle" }),
    ).toThrow(/nonsense/);
  });

  it("parseEnvelope throws when the payload fails its schema", () => {
    expect(() =>
      parseEnvelope("achilles:state-changed", { state: "bogus" }),
    ).toThrow();
  });
});

describe("Other per-channel happy-path schemas", () => {
  it("TranscriptPartialPayloadSchema requires a non-empty text string", () => {
    expect(
      TranscriptPartialPayloadSchema.parse({ text: "hello" }),
    ).toEqual({ text: "hello" });
    expect(() => TranscriptPartialPayloadSchema.parse({ text: "" })).toThrow();
  });

  it("TranscriptCommittedPayloadSchema rejects a malformed UUID", () => {
    expect(() =>
      TranscriptCommittedPayloadSchema.parse({
        id: "not-a-uuid",
        text: "hello",
        committedAt: 1,
      }),
    ).toThrow();
  });

  it("TranscriptCommittedPayloadSchema rejects a negative committedAt", () => {
    expect(() =>
      TranscriptCommittedPayloadSchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        text: "hello",
        committedAt: -1,
      }),
    ).toThrow();
  });

  it("PermissionStatePayloadSchema accepts every documented permission state", () => {
    for (const s of ["granted", "not-determined", "denied", "restricted"]) {
      expect(PermissionStatePayloadSchema.parse({ state: s })).toEqual({
        state: s,
      });
    }
  });

  it("ErrorPayloadSchema requires a non-empty message", () => {
    expect(ErrorPayloadSchema.parse({ message: "oh no" })).toEqual({
      message: "oh no",
    });
    expect(() => ErrorPayloadSchema.parse({ message: "" })).toThrow();
  });

  it("RequestStatePayloadSchema accepts every AchillesState", () => {
    for (const s of ACHILLES_STATES) {
      expect(RequestStatePayloadSchema.parse({ state: s })).toEqual({
        state: s,
      });
    }
  });

  it("RegisterHotkeyPayloadSchema requires a non-empty accelerator", () => {
    expect(
      RegisterHotkeyPayloadSchema.parse({ accelerator: "Cmd+A" }),
    ).toEqual({ accelerator: "Cmd+A" });
    expect(() =>
      RegisterHotkeyPayloadSchema.parse({ accelerator: "" }),
    ).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 12 — renderer audio + STT auth channels (P12.IPC1 — P12.IPC9)
// ─────────────────────────────────────────────────────────────────────

describe("Phase 12 channel constants (P12.IPC1 — channel naming)", () => {
  it("IPC_TTS_CHUNK has the expected literal value", () => {
    expect(IPC_TTS_CHUNK).toBe("achilles:tts-chunk");
  });

  it("IPC_TTS_PLAYBACK_COMPLETE has the expected literal value", () => {
    expect(IPC_TTS_PLAYBACK_COMPLETE).toBe("achilles:tts-playback-complete");
  });

  it("IPC_UTTERANCE_COMMIT has the expected literal value", () => {
    expect(IPC_UTTERANCE_COMMIT).toBe("achilles:utterance-commit");
  });

  it("IPC_MIC_FRAME has the expected literal value", () => {
    expect(IPC_MIC_FRAME).toBe("achilles:mic-frame");
  });

  it("IPC_STT_TOKEN_REQUEST has the expected literal value", () => {
    expect(IPC_STT_TOKEN_REQUEST).toBe("achilles:stt-token-request");
  });

  it("IPC_STT_TOKEN has the expected literal value", () => {
    expect(IPC_STT_TOKEN).toBe("achilles:stt-token");
  });

  it("every Phase 12 channel uses the achilles: prefix", () => {
    for (const ch of [
      IPC_TTS_CHUNK,
      IPC_TTS_PLAYBACK_COMPLETE,
      IPC_UTTERANCE_COMMIT,
      IPC_MIC_FRAME,
      IPC_STT_TOKEN_REQUEST,
      IPC_STT_TOKEN,
    ]) {
      expect(ch.startsWith("achilles:")).toBe(true);
    }
  });
});

describe("TtsChunkPayloadSchema (P12.IPC2)", () => {
  it("accepts a well-formed audio/mpeg chunk", () => {
    const bytes = new ArrayBuffer(64);
    const parsed = TtsChunkPayloadSchema.parse({
      seq: 0,
      mime: "audio/mpeg",
      bytes,
      isFinal: false,
    });
    expect(parsed.seq).toBe(0);
    expect(parsed.mime).toBe("audio/mpeg");
    expect(parsed.bytes).toBeInstanceOf(ArrayBuffer);
    expect(parsed.isFinal).toBe(false);
  });

  it("accepts an audio/pcm chunk", () => {
    const bytes = new ArrayBuffer(640);
    const parsed = TtsChunkPayloadSchema.parse({
      seq: 7,
      mime: "audio/pcm",
      bytes,
      isFinal: true,
    });
    expect(parsed.mime).toBe("audio/pcm");
    expect(parsed.isFinal).toBe(true);
  });

  it("rejects a negative seq", () => {
    expect(() =>
      TtsChunkPayloadSchema.parse({
        seq: -1,
        mime: "audio/mpeg",
        bytes: new ArrayBuffer(8),
        isFinal: false,
      }),
    ).toThrow();
  });

  it("rejects a non-integer seq", () => {
    expect(() =>
      TtsChunkPayloadSchema.parse({
        seq: 1.5,
        mime: "audio/mpeg",
        bytes: new ArrayBuffer(8),
        isFinal: false,
      }),
    ).toThrow();
  });

  it("rejects an unsupported mime type", () => {
    expect(() =>
      TtsChunkPayloadSchema.parse({
        seq: 0,
        mime: "audio/ogg",
        bytes: new ArrayBuffer(8),
        isFinal: false,
      }),
    ).toThrow();
  });

  it("rejects extra fields (.strict())", () => {
    expect(() =>
      TtsChunkPayloadSchema.parse({
        seq: 0,
        mime: "audio/mpeg",
        bytes: new ArrayBuffer(8),
        isFinal: false,
        leak: "secret",
      }),
    ).toThrow();
  });

  it("rejects a non-ArrayBuffer bytes field", () => {
    expect(() =>
      TtsChunkPayloadSchema.parse({
        seq: 0,
        mime: "audio/mpeg",
        bytes: new Uint8Array(8),
        isFinal: false,
      }),
    ).toThrow();
  });
});

describe("TtsPlaybackCompletePayloadSchema (P12.IPC3)", () => {
  it("accepts an empty object — the channel itself is the signal", () => {
    expect(TtsPlaybackCompletePayloadSchema.parse({})).toEqual({});
  });

  it("rejects any extra field (.strict())", () => {
    expect(() =>
      TtsPlaybackCompletePayloadSchema.parse({ reason: "drained" }),
    ).toThrow();
  });
});

describe("UtteranceCommitPayloadSchema (P12.IPC4)", () => {
  it("accepts a well-formed commit", () => {
    const parsed = UtteranceCommitPayloadSchema.parse({
      id: "00000000-0000-4000-8000-000000000000",
      text: "rename this file",
      committedAt: 1735000000000,
    });
    expect(parsed.text).toBe("rename this file");
  });

  it("rejects a malformed UUID", () => {
    expect(() =>
      UtteranceCommitPayloadSchema.parse({
        id: "not-a-uuid",
        text: "hi",
        committedAt: 1,
      }),
    ).toThrow();
  });

  it("rejects an empty text string", () => {
    expect(() =>
      UtteranceCommitPayloadSchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        text: "",
        committedAt: 1,
      }),
    ).toThrow();
  });

  it("rejects a negative committedAt", () => {
    expect(() =>
      UtteranceCommitPayloadSchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        text: "hi",
        committedAt: -1,
      }),
    ).toThrow();
  });

  it("rejects extra fields (.strict())", () => {
    expect(() =>
      UtteranceCommitPayloadSchema.parse({
        id: "00000000-0000-4000-8000-000000000000",
        text: "hi",
        committedAt: 1,
        sneaky: true,
      }),
    ).toThrow();
  });
});

describe("MicFramePayloadSchema (P12.IPC5 — LOOP-01 pinning)", () => {
  it("accepts the canonical 16 kHz / 320-sample frame shape", () => {
    // 320 Int16 samples × 2 bytes = 640 bytes per frame at 16 kHz / 20 ms.
    const pcm = new ArrayBuffer(640);
    const parsed = MicFramePayloadSchema.parse({
      pcm,
      sampleRate: 16000,
      samplesPerFrame: 320,
    });
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.samplesPerFrame).toBe(320);
  });

  it("rejects sampleRate !== 16000 (PITFALLS #1 pin)", () => {
    expect(() =>
      MicFramePayloadSchema.parse({
        pcm: new ArrayBuffer(640),
        sampleRate: 48000,
        samplesPerFrame: 320,
      }),
    ).toThrow();
  });

  it("rejects samplesPerFrame !== 320", () => {
    expect(() =>
      MicFramePayloadSchema.parse({
        pcm: new ArrayBuffer(640),
        sampleRate: 16000,
        samplesPerFrame: 480,
      }),
    ).toThrow();
  });

  it("rejects extra fields (.strict())", () => {
    expect(() =>
      MicFramePayloadSchema.parse({
        pcm: new ArrayBuffer(640),
        sampleRate: 16000,
        samplesPerFrame: 320,
        deviceId: "default",
      }),
    ).toThrow();
  });
});

describe("SttTokenRequestPayloadSchema (P12.IPC6)", () => {
  it("accepts an empty object", () => {
    expect(SttTokenRequestPayloadSchema.parse({})).toEqual({});
  });

  it("rejects extra fields (.strict())", () => {
    expect(() =>
      SttTokenRequestPayloadSchema.parse({ scope: "everything" }),
    ).toThrow();
  });
});

describe("SttTokenPayloadSchema (P12.IPC7)", () => {
  it("accepts a well-formed token + ISO expiry", () => {
    const parsed = SttTokenPayloadSchema.parse({
      token: "sk_live_xxxxxxxx",
      expiresAt: "2026-06-06T23:30:00.000Z",
    });
    expect(parsed.token).toBe("sk_live_xxxxxxxx");
  });

  it("rejects an empty token", () => {
    expect(() =>
      SttTokenPayloadSchema.parse({
        token: "",
        expiresAt: "2026-06-06T23:30:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects a malformed expiresAt", () => {
    expect(() =>
      SttTokenPayloadSchema.parse({
        token: "ok",
        expiresAt: "not-an-iso-date",
      }),
    ).toThrow();
  });

  it("rejects extra fields (.strict())", () => {
    expect(() =>
      SttTokenPayloadSchema.parse({
        token: "ok",
        expiresAt: "2026-06-06T23:30:00.000Z",
        rawApiKey: "sk_live_secret",
      }),
    ).toThrow();
  });
});

describe("IPC_PAYLOAD_SCHEMAS routes Phase 12 channels (P12.IPC8)", () => {
  it("contains an entry for every Phase 12 channel", () => {
    expect(IPC_PAYLOAD_SCHEMAS[IPC_TTS_CHUNK]).toBe(TtsChunkPayloadSchema);
    expect(IPC_PAYLOAD_SCHEMAS[IPC_TTS_PLAYBACK_COMPLETE]).toBe(
      TtsPlaybackCompletePayloadSchema,
    );
    expect(IPC_PAYLOAD_SCHEMAS[IPC_UTTERANCE_COMMIT]).toBe(
      UtteranceCommitPayloadSchema,
    );
    expect(IPC_PAYLOAD_SCHEMAS[IPC_MIC_FRAME]).toBe(MicFramePayloadSchema);
    expect(IPC_PAYLOAD_SCHEMAS[IPC_STT_TOKEN_REQUEST]).toBe(
      SttTokenRequestPayloadSchema,
    );
    expect(IPC_PAYLOAD_SCHEMAS[IPC_STT_TOKEN]).toBe(SttTokenPayloadSchema);
  });

  it("parseEnvelope routes each Phase 12 channel correctly", () => {
    const bytes = new ArrayBuffer(8);
    expect(
      parseEnvelope(IPC_TTS_CHUNK, {
        seq: 0,
        mime: "audio/mpeg",
        bytes,
        isFinal: false,
      }),
    ).toMatchObject({ seq: 0, mime: "audio/mpeg", isFinal: false });

    expect(parseEnvelope(IPC_TTS_PLAYBACK_COMPLETE, {})).toEqual({});

    expect(
      parseEnvelope(IPC_UTTERANCE_COMMIT, {
        id: "00000000-0000-4000-8000-000000000000",
        text: "hello",
        committedAt: 1,
      }),
    ).toEqual({
      id: "00000000-0000-4000-8000-000000000000",
      text: "hello",
      committedAt: 1,
    });

    expect(
      parseEnvelope(IPC_MIC_FRAME, {
        pcm: new ArrayBuffer(640),
        sampleRate: 16000,
        samplesPerFrame: 320,
      }),
    ).toMatchObject({ sampleRate: 16000, samplesPerFrame: 320 });

    expect(parseEnvelope(IPC_STT_TOKEN_REQUEST, {})).toEqual({});

    expect(
      parseEnvelope(IPC_STT_TOKEN, {
        token: "tok",
        expiresAt: "2026-06-06T23:30:00.000Z",
      }),
    ).toEqual({ token: "tok", expiresAt: "2026-06-06T23:30:00.000Z" });
  });
});

describe("Phase 12 channels do not collide with Plan 11-01 channels (P12.IPC9)", () => {
  it("the six new channels are disjoint from the prior twelve", () => {
    const phase11 = new Set([
      IPC_STATE_CHANGED,
      IPC_TRANSCRIPT_PARTIAL,
      IPC_TRANSCRIPT_COMMITTED,
      IPC_MIC_AMPLITUDE,
      IPC_TTS_AMPLITUDE,
      IPC_PERMISSION_STATE,
      IPC_ERROR,
      IPC_REQUEST_STATE,
      IPC_REGISTER_HOTKEY,
      IPC_OPEN_SYSTEM_SETTINGS,
      IPC_UPDATE_WINDOW_POSITION,
      IPC_UPDATE_HOTKEY_CONFIG,
    ]);
    const phase12 = [
      IPC_TTS_CHUNK,
      IPC_TTS_PLAYBACK_COMPLETE,
      IPC_UTTERANCE_COMMIT,
      IPC_MIC_FRAME,
      IPC_STT_TOKEN_REQUEST,
      IPC_STT_TOKEN,
    ];
    for (const ch of phase12) {
      expect(phase11.has(ch)).toBe(false);
    }
    // Total channel population is exactly 18.
    expect(phase11.size + phase12.length).toBe(18);
  });
});
