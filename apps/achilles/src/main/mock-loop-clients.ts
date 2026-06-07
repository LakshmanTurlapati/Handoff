/**
 * Deterministic in-process fakes for the voice loop's three external
 * dependencies (STT, Claude bridge, TTS), used by:
 *
 *   - apps/achilles/src/main/session.test.ts — unit tests that inject
 *     these factories via session.ts's AchillesSessionDeps seam.
 *   - apps/achilles/test/integration/end-to-end-loop.test.ts — the
 *     MOCK_LOOP=1 integration suite that drives a full mic → Claude →
 *     TTS round trip without ElevenLabs and without Claude Code.
 *
 * The factories produce event streams identical in SHAPE to the real
 * ClaudeSession / TtsStreamClient / RealtimeSttClient surfaces, but the
 * generators are pure JS — no network, no clock dependence, no actual
 * I/O. Every chunk's bytes are derived from a deterministic seed so a
 * binary comparison across runs is bitwise stable.
 *
 * Design rules:
 *
 *   - All factories are SYNC constructors that return objects with the
 *     same readonly surface as the real clients.
 *   - `events$` is a single-consumer AsyncIterable, mirroring the real
 *     clients' WR-03 contract.
 *   - The mock Claude session synthesises the same wire-format events
 *     the real bridge emits (session_init → assistant_text_delta(ack) →
 *     assistant_text_delta(<spoken-summary> chunks) → assistant_text_done
 *     → optional tool_result(is_error:true) → process_exit), then
 *     populates `outcome` via deriveOutcome at exit so the orchestrator
 *     reads the same shape.
 *   - The mock TTS client emits TtsChunk events with monotonically
 *     increasing `seq`. An optional `outOfOrderProbability` knob
 *     scrambles the seq order inside a segment for testing the
 *     orchestrator's ordering invariants downstream.
 *
 * NO emojis. NO live network. NO real subprocess.
 */
import { deriveOutcome } from "@achilles/claude-code-bridge";
import type {
  ClaudeBridgeEvent,
  ClaudeOutcome,
  ProcessExitEvent,
} from "@achilles/claude-code-bridge";

// ─────────────────────────────────────────────────────────────────────
// Mock STT — emits committed-transcript events on demand. The
// `emitFrame` / `commit` calls do NOT round-trip through a network; the
// `commit` call simply pops the next pre-configured committed transcript
// from the fixture and pushes it onto the events$ stream.
// ─────────────────────────────────────────────────────────────────────

export interface MockSttCommittedEvent {
  type: "committed";
  id: string;
  text: string;
  committedAt: number;
}

export interface MockSttPartialEvent {
  type: "partial";
  text: string;
}

export type MockSttEvent = MockSttCommittedEvent | MockSttPartialEvent;

export interface MockSttFixture {
  /**
   * Pre-configured committed transcripts. `commit()` pops one entry
   * from the head of this array each time it is called and pushes a
   * matching `committed` event onto events$.
   */
  committedTranscripts: Array<{ id: string; text: string; committedAt: number }>;
  /**
   * When true the fixture also emits a `partial` event before the
   * `committed` event for each transcript — used to verify partial
   * handling. Defaults to false.
   */
  emitPartials?: boolean;
}

export interface MockSttHandle {
  emitFrame(frame: Int16Array): void;
  commit(): void;
  close(): void;
  readonly events$: AsyncIterable<MockSttEvent>;
  readonly frameCount: number;
}

export function createMockStt(fixture: MockSttFixture): MockSttHandle {
  const queue: MockSttEvent[] = [];
  const waiters: Array<(r: IteratorResult<MockSttEvent>) => void> = [];
  const transcripts = [...fixture.committedTranscripts];
  let closed = false;
  let frames = 0;

  function push(ev: MockSttEvent): void {
    if (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: ev, done: false });
        return;
      }
    }
    queue.push(ev);
  }

  function endStream(): void {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: undefined, done: true });
      }
    }
  }

  const events$: AsyncIterable<MockSttEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<MockSttEvent> {
      return {
        next(): Promise<IteratorResult<MockSttEvent>> {
          if (queue.length > 0) {
            const value = queue.shift() as MockSttEvent;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<MockSttEvent>> {
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  return {
    emitFrame(_frame: Int16Array): void {
      // Mock — frames are counted, not transmitted. The frameCount
      // accessor exists so the integration test can assert "the
      // session forwarded N frames through STT before commit".
      frames += 1;
    },
    commit(): void {
      const next = transcripts.shift();
      if (next === undefined) return;
      if (fixture.emitPartials === true) {
        push({ type: "partial", text: next.text });
      }
      push({
        type: "committed",
        id: next.id,
        text: next.text,
        committedAt: next.committedAt,
      });
    },
    close(): void {
      endStream();
    },
    events$,
    get frameCount(): number {
      return frames;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mock Claude session — mirrors the @achilles/claude-code-bridge
// ClaudeSession surface for the orchestrator's send(text) flow. The
// fixture configures the exact ack + spoken-summary body, exit code,
// and tool error count so the orchestrator's success / failure paths
// can be driven deterministically.
// ─────────────────────────────────────────────────────────────────────

export interface MockClaudeFixture {
  /**
   * The first sentence (terminated by a `.`, `?`, or `!`) the mock
   * emits as an assistant_text_delta. extractAck() returns this string
   * — the orchestrator routes it as the spoken acknowledgement.
   */
  ackText: string;
  /**
   * Contents to wrap inside `<spoken-summary>...</spoken-summary>` in
   * subsequent assistant_text_delta events. extractSpokenSummary() is
   * the canonical reader for this — the orchestrator normalises and
   * routes the result to TTS on the success path. On failure the
   * orchestrator IGNORES this body and emits the PROMPT-05 override.
   */
  spokenSummaryBody: string;
  /**
   * Process exit code synthesised at end-of-stream. exitCode !== 0
   * forces deriveOutcome to return a failure with reason 'exit_code'.
   */
  exitCode: number;
  /**
   * Number of tool_result events emitted with is_error:true. >0 forces
   * deriveOutcome to return failure with reason 'tool_error'.
   */
  toolErrors?: number;
  /**
   * Optional pre-generated session id surfaced via session_init. The
   * orchestrator captures this for the next utterance's resumeSessionId
   * so context accumulates across turns.
   */
  sessionId?: string;
  /**
   * Approximate chunk size for the assistant_text_delta events. Default
   * 30 chars. The mock chops the body into fragments of this size to
   * exercise the orchestrator's accumulator + extractor pipeline.
   */
  deltaChunkSize?: number;
}

export interface MockClaudeHandle {
  send(text: string): void;
  cancel(): Promise<ProcessExitEvent>;
  close(): Promise<void>;
  readonly events$: AsyncIterable<ClaudeBridgeEvent>;
  readonly outcome: ClaudeOutcome | null;
  readonly sessionId: string | null;
  readonly lastTurnText: string;
  /**
   * Test seam — exposes what was passed to send() so the orchestrator's
   * sandwich-defence wiring can be asserted (the literal wrapped form
   * must reach send(), NOT the raw transcript).
   */
  readonly capturedSends: readonly string[];
}

export function createMockClaude(fixture: MockClaudeFixture): MockClaudeHandle {
  const queue: ClaudeBridgeEvent[] = [];
  const waiters: Array<(r: IteratorResult<ClaudeBridgeEvent>) => void> = [];
  let streamEnded = false;
  let outcome: ClaudeOutcome | null = null;
  let sessionId: string | null = null;
  let lastTurnText = "";
  const captured: string[] = [];
  let cancelled = false;
  let cancelPromise: Promise<ProcessExitEvent> | null = null;

  function push(ev: ClaudeBridgeEvent): void {
    if (ev.type === "session_init" && sessionId === null) {
      sessionId = ev.session_id;
    } else if (ev.type === "assistant_text_delta") {
      lastTurnText += ev.text;
    } else if (ev.type === "assistant_text_done") {
      lastTurnText = ev.full_text;
    }
    if (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: ev, done: false });
        return;
      }
    }
    queue.push(ev);
  }

  function endStream(): void {
    if (streamEnded) return;
    streamEnded = true;
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: undefined, done: true });
      }
    }
  }

  const events$: AsyncIterable<ClaudeBridgeEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<ClaudeBridgeEvent> {
      return {
        next(): Promise<IteratorResult<ClaudeBridgeEvent>> {
          if (queue.length > 0) {
            const value = queue.shift() as ClaudeBridgeEvent;
            return Promise.resolve({ value, done: false });
          }
          if (streamEnded) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<ClaudeBridgeEvent>> {
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  function send(text: string): void {
    captured.push(text);
    // 1. session_init
    const sid = fixture.sessionId ?? "mock-session-0001";
    push({
      type: "session_init",
      session_id: sid,
      model: "mock-claude-code",
      claude_code_version: "9.9.9",
    });

    // 2. ack delta (one event carrying the entire ack so extractAck
    // returns on the very first delta — keeps the test predictable).
    push({ type: "assistant_text_delta", text: fixture.ackText });

    // 3. spoken-summary deltas chopped to deltaChunkSize chars.
    const summary = `<spoken-summary>${fixture.spokenSummaryBody}</spoken-summary>`;
    const chunkSize = Math.max(1, fixture.deltaChunkSize ?? 30);
    for (let i = 0; i < summary.length; i += chunkSize) {
      const slice = summary.slice(i, i + chunkSize);
      push({ type: "assistant_text_delta", text: slice });
    }

    // 4. assistant_text_done with the full accumulated text.
    push({
      type: "assistant_text_done",
      full_text: lastTurnText,
    });

    // 5. tool_result events (is_error:true) when fixture.toolErrors > 0.
    const toolErrors = fixture.toolErrors ?? 0;
    const toolErrorIds: string[] = [];
    for (let i = 0; i < toolErrors; i++) {
      const toolUseId = `mock-tool-use-${i}`;
      toolErrorIds.push(toolUseId);
      push({
        type: "tool_result",
        tool_use_id: toolUseId,
        content: "tool failure",
        is_error: true,
      });
    }

    // 6. process_exit synthesised + outcome computed.
    const exitEvent: ProcessExitEvent = {
      type: "process_exit",
      exit_code: cancelled ? null : fixture.exitCode,
      signal: cancelled ? "SIGINT" : null,
    };
    outcome = deriveOutcome({
      exitCode: cancelled ? null : fixture.exitCode,
      toolErrors: toolErrorIds,
      cancelled,
    });
    push(exitEvent);
    endStream();
  }

  function cancel(): Promise<ProcessExitEvent> {
    if (cancelPromise !== null) return cancelPromise;
    cancelled = true;
    const exitEvent: ProcessExitEvent = {
      type: "process_exit",
      exit_code: null,
      signal: "SIGINT",
    };
    outcome = deriveOutcome({
      exitCode: null,
      toolErrors: [],
      cancelled: true,
    });
    if (!streamEnded) {
      push(exitEvent);
      endStream();
    }
    cancelPromise = Promise.resolve(exitEvent);
    return cancelPromise;
  }

  async function close(): Promise<void> {
    endStream();
  }

  return {
    send,
    cancel,
    close,
    events$,
    get outcome(): ClaudeOutcome | null {
      return outcome;
    },
    get sessionId(): string | null {
      return sessionId;
    },
    get lastTurnText(): string {
      return lastTurnText;
    },
    capturedSends: captured,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Mock TTS stream client — emits a deterministic sequence of TtsChunk
// payloads per appendText call. The shape mirrors the renderer-facing
// TtsChunkPayload (seq, mime, bytes, isFinal) so the orchestrator's
// IPC_TTS_CHUNK fan-out can be asserted against the same payload.
// ─────────────────────────────────────────────────────────────────────

/**
 * The mock TTS chunk shape — identical to the IPC payload the
 * orchestrator broadcasts via IPC_TTS_CHUNK. The renderer-side
 * playback-queue accepts this shape verbatim.
 */
export interface MockTtsChunk {
  seq: number;
  mime: "audio/mpeg" | "audio/pcm";
  bytes: ArrayBuffer;
  isFinal: boolean;
}

export type MockTtsEvent =
  | { type: "chunk"; chunk: MockTtsChunk }
  | { type: "complete" };

export interface MockTtsFixture {
  /**
   * Number of TtsChunk events emitted per appendText call. Default 5.
   * The chunks are derived from a deterministic generator
   * (`Buffer.from(`mock-tts-chunk-${seq}`)`).
   */
  chunksPerSegment?: number;
  /**
   * When >0 the emitted seq numbers within a segment are scrambled
   * with the supplied probability (0..1). The orchestrator does NOT
   * reorder chunks itself (it fan-outs verbatim via IPC), but the
   * renderer-side playback-queue does — so this knob exists for the
   * integration test to verify the property end-to-end.
   * Default 0 (in-order).
   */
  outOfOrderProbability?: number;
}

export interface MockTtsHandle {
  open(): Promise<void>;
  appendText(text: string): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  readonly events$: AsyncIterable<MockTtsEvent>;
  /**
   * Test seam — the strings passed to appendText() in call order.
   */
  readonly appendedTexts: readonly string[];
}

export function createMockTts(fixture: MockTtsFixture): MockTtsHandle {
  const chunksPerSegment = Math.max(1, fixture.chunksPerSegment ?? 5);
  const outOfOrderProb = Math.max(0, Math.min(1, fixture.outOfOrderProbability ?? 0));
  const queue: MockTtsEvent[] = [];
  const waiters: Array<(r: IteratorResult<MockTtsEvent>) => void> = [];
  let nextSeq = 0;
  let opened = false;
  let closed = false;
  const appendedTexts: string[] = [];
  // Deterministic pseudo-random source for the out-of-order scramble.
  // Linear congruential generator with a fixed seed so the scramble
  // pattern is byte-stable across runs.
  let rngState = 0x1234567;
  function nextRand(): number {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  }

  function push(ev: MockTtsEvent): void {
    if (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: ev, done: false });
        return;
      }
    }
    queue.push(ev);
  }

  function endStream(): void {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: undefined, done: true });
      }
    }
  }

  const events$: AsyncIterable<MockTtsEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<MockTtsEvent> {
      return {
        next(): Promise<IteratorResult<MockTtsEvent>> {
          if (queue.length > 0) {
            const value = queue.shift() as MockTtsEvent;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<MockTtsEvent>> {
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  async function open(): Promise<void> {
    opened = true;
  }

  function appendText(text: string): void {
    appendedTexts.push(text);
    if (!opened) {
      opened = true;
    }
    // Build chunk seq sequence for this segment.
    const seqs: number[] = [];
    for (let i = 0; i < chunksPerSegment; i++) {
      seqs.push(nextSeq + i);
    }
    if (outOfOrderProb > 0 && seqs.length >= 2 && nextRand() < outOfOrderProb) {
      // Swap two adjacent seq numbers to introduce reordering.
      const swapAt = Math.min(
        seqs.length - 2,
        Math.floor(nextRand() * (seqs.length - 1)),
      );
      const tmp = seqs[swapAt]!;
      seqs[swapAt] = seqs[swapAt + 1]!;
      seqs[swapAt + 1] = tmp;
    }
    nextSeq += chunksPerSegment;
    // WR-08: assign isFinal based on the HIGHEST seq in the segment,
    // not the array index. The previous code marked isFinal=true on
    // whichever chunk landed at i === seqs.length - 1 AFTER the swap
    // — which could be the seq=N-1 chunk rather than the seq=N chunk.
    // The renderer-side playback-queue keys completion off finalSeq
    // (the seq with isFinal:true), so a misplaced flag silently broke
    // completion detection when outOfOrderProbability > 0: the
    // post-final chunk's onended fired but `seq === finalSeq` returned
    // false, onPlaybackComplete never fired, and the 300 ms debounce
    // timer never scheduled. Tests using outOfOrderProbability > 0
    // were masking real ordering bugs.
    const maxSeq = Math.max(...seqs);
    for (let i = 0; i < seqs.length; i++) {
      const seq = seqs[i]!;
      // Build a deterministic byte fingerprint: encode the seed string
      // as UTF-8 into a fresh standalone ArrayBuffer. We allocate via
      // new ArrayBuffer(...) so the view is NOT shared with Node's
      // Buffer pool — every chunk owns its bytes outright. The string
      // 'mock-tts-chunk-N' encodes to 16+ bytes for any seq, so the
      // backing buffer always carries the recognisable payload.
      const seed = `mock-tts-chunk-${seq}`;
      const encoded = new TextEncoder().encode(seed);
      const bytes = new ArrayBuffer(encoded.length);
      new Uint8Array(bytes).set(encoded);
      const isFinal = seq === maxSeq;
      push({
        type: "chunk",
        chunk: {
          seq,
          mime: "audio/mpeg",
          bytes,
          isFinal,
        },
      });
    }
  }

  async function flush(): Promise<void> {
    push({ type: "complete" });
    endStream();
  }

  async function close(): Promise<void> {
    endStream();
  }

  return {
    open,
    appendText,
    flush,
    close,
    events$,
    appendedTexts,
  };
}
