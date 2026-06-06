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
import { ACHILLES_STATES } from "./constants.js";
import {
  ErrorPayloadSchema,
  IPC_PAYLOAD_SCHEMAS,
  MicAmplitudePayloadSchema,
  OpenSystemSettingsPayloadSchema,
  PermissionStatePayloadSchema,
  RegisterHotkeyPayloadSchema,
  RequestStatePayloadSchema,
  StateChangedPayloadSchema,
  TranscriptCommittedPayloadSchema,
  TranscriptPartialPayloadSchema,
  TtsAmplitudePayloadSchema,
  UpdateHotkeyConfigPayloadSchema,
  UpdateWindowPositionPayloadSchema,
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
    expect(keys.length).toBe(12);
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
