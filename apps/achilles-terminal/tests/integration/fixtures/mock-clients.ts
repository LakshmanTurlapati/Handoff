/**
 * Phase 17, Plan 05, Task 1 — reusable mock-client fixtures for the
 * MOCK_LOOP=1 in-process integration test.
 *
 * Four factory builders, each returning the production-shape factory
 * Plan 04's Session composition root consumes via its DI seams
 * (`sttFactory`, `ttsFactory`, `claudeBridgeFactory`, `spawnImpl`)
 * PLUS a side-channel `.controls` object exposing helpers that let the
 * integration test drive the mocks deterministically without sleeping.
 *
 * The fixtures are pure JavaScript (well — TypeScript) — no network,
 * no real subprocesses, no clock dependence beyond a single
 * setTimeout-and-emit per pre-configured event. Every chunk's bytes
 * are derived from a deterministic fixture so a binary comparison
 * across runs is stable.
 *
 * Design rules:
 *
 *   - All factories return objects with the SAME readonly surface as
 *     the real clients (RealtimeSttClient, TtsStreamClient,
 *     ClaudeBridgeHandle, child_process.spawn).
 *   - `events$` is a single-consumer AsyncIterable, mirroring the real
 *     WR-03 contract.
 *   - The mock claude bridge synthesises the exact ack +
 *     `<spoken-summary>` shape Phase 17 claude-bridge.ts emits via its
 *     deps.emit callback (claude_ack -> claude_summary -> claude_done
 *     OR claude_failed depending on exitCode).
 *   - The mock TTS factory emits a chunk async-iterable that drives
 *     the tts-playback consumer loop; ffplay drains via the mock
 *     spawn's stdin.end handler.
 *   - The mock spawn impl distinguishes by cmd (ffplay vs other);
 *     ffplay's stdin records bytes + exits on stdin.end().
 *
 * LOOP-02 invariant: zero modifications to packages/voice-*,
 * packages/claude-code-bridge/, packages/achilles-skill/skill/prompts/
 * companion.md. The fixtures IMPORT type-only from those packages but
 * never touch their source.
 *
 * No emojis (CLAUDE.md global). No application launches.
 */

import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import type {
  CreateRealtimeSttClientOptions,
  RealtimeSttClient,
  SttEvent,
} from "@achilles/voice-stt";
import type { TtsEvent, TtsStreamClient } from "@achilles/voice-tts";
import type {
  ProcessExitEvent,
} from "@achilles/claude-code-bridge";
import type {
  ClaudeBridgeFactory,
  SttFactory,
  TtsFactory,
} from "../../../src/session.js";
import type {
  ClaudeBridgeHandle,
  CreateClaudeBridgeDeps,
} from "../../../src/audio/claude-bridge.js";
import type { SessionEvent } from "../../../src/session-events.js";

// ─────────────────────────────────────────────────────────────────────
// Mock STT factory — synthesises a committed transcript after a
// configurable delay. The factory accepts the bridge's narrow option
// shape (getToken + webSocketCtor) and returns a RealtimeSttClient
// whose start() resolves immediately, write(frame) is a no-op (the
// test does NOT exercise frame forwarding), and events$ yields a
// committed event after commitDelayMs.
// ─────────────────────────────────────────────────────────────────────

/**
 * Construction options for the mock STT factory.
 *
 * @public
 */
export interface MockSttOptions {
  /**
   * Delay before the committed event fires after start() resolves.
   * Defaults to 200ms. The test asserts state machine cycle completes
   * within 2000ms so the default leaves comfortable headroom.
   */
  readonly commitDelayMs?: number;
  /**
   * Pre-configured committed transcript text. Defaults to
   * "hello achilles". The integration test asserts the bridge fans
   * the text into a stt_committed SessionEvent that drives the claude
   * subprocess send path.
   */
  readonly transcript?: string;
}

/**
 * Side-channel controls exposed by the mock STT factory. Lets the
 * integration test force a commit at a deterministic instant without
 * waiting for the commitDelayMs setTimeout.
 *
 * @public
 */
export interface MockSttControls {
  /**
   * Force the committed event to fire NOW with the given text (or the
   * configured transcript if omitted). Used by the integration test
   * to drive the chain without sleeping. Idempotent — subsequent calls
   * are no-ops after the events$ iterator completes.
   */
  forceCommit(text?: string): void;
  /**
   * Mutable counter incremented on every write(frame) call. The
   * integration test asserts the bridge forwarded frames during the
   * listening window (currently 0 because the mock STT bridge does
   * not exercise the frame path in the default cycle).
   */
  readonly writeCount: number;
  /**
   * Whether stop() has been called at least once. The integration
   * test asserts cleanup invokes stop() exactly once.
   */
  readonly stopped: boolean;
  /**
   * Whether start() has been called at least once.
   */
  readonly started: boolean;
}

/**
 * Construct a mock STT factory builder. Returns a tuple of (factory,
 * controls) so the integration test can both inject the factory into
 * Session AND drive the events$ stream deterministically.
 *
 * @public
 */
export function createMockSttFactory(
  opts: MockSttOptions = {},
): {
  factory: SttFactory;
  controls: MockSttControls;
} {
  const transcriptText = opts.transcript ?? "hello achilles";
  const commitDelayMs = opts.commitDelayMs ?? 200;
  // Queue-and-resolver pattern matching the v1.2 mock-loop-clients.ts
  // shape — single-consumer async iterable, the producer pushes events,
  // the consumer awaits.
  const queue: SttEvent[] = [];
  const waiters: Array<(r: IteratorResult<SttEvent>) => void> = [];
  let closed = false;
  let writeCount = 0;
  let stopped = false;
  let started = false;
  let commitScheduled = false;
  let commitFired = false;

  function push(ev: SttEvent): void {
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

  function fireCommit(text: string): void {
    if (commitFired) return;
    commitFired = true;
    push({
      type: "committed",
      text,
      durationMs: 1200,
    });
    // End the stream after the committed event so the for-await loop
    // exits cleanly. The Session-level orchestrator does not depend
    // on additional events after committed.
    endStream();
  }

  const events$: AsyncIterable<SttEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<SttEvent> {
      return {
        next(): Promise<IteratorResult<SttEvent>> {
          if (queue.length > 0) {
            const value = queue.shift();
            if (value === undefined) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<SttEvent>> {
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  const factory: SttFactory = (
    factoryOpts: Pick<
      CreateRealtimeSttClientOptions,
      "getToken" | "webSocketCtor"
    >,
  ): RealtimeSttClient => {
    // The factoryOpts.getToken closure is exercised inside the bridge's
    // start() path via the circuit-breaker-wrapped getToken closure.
    // The mock factory itself does NOT call getToken — the wrapper
    // touches the dep for type-system purposes.
    void factoryOpts;
    const client: RealtimeSttClient = {
      events$,
      start(): Promise<void> {
        started = true;
        // Schedule the commit fire after commitDelayMs. Idempotent —
        // forceCommit() can run earlier; this setTimeout becomes a
        // no-op once commitFired = true.
        if (!commitScheduled) {
          commitScheduled = true;
          setTimeout(() => {
            fireCommit(transcriptText);
          }, commitDelayMs);
        }
        return Promise.resolve();
      },
      stop(): Promise<void> {
        stopped = true;
        endStream();
        return Promise.resolve();
      },
      write(frame: Int16Array): void {
        void frame;
        writeCount += 1;
      },
    };
    return client;
  };

  const controls: MockSttControls = {
    forceCommit(text?: string): void {
      fireCommit(text ?? transcriptText);
    },
    get writeCount(): number {
      return writeCount;
    },
    get stopped(): boolean {
      return stopped;
    },
    get started(): boolean {
      return started;
    },
  };

  return { factory, controls };
}

// ─────────────────────────────────────────────────────────────────────
// Mock TTS factory — emits a fixed number of chunks per appendText
// invocation, followed by a complete event on flush. The chunks
// carry a deterministic byte fingerprint (a fake MP3 header by
// default) so ffplay stdin can be byte-checked.
// ─────────────────────────────────────────────────────────────────────

/**
 * Construction options for the mock TTS factory.
 *
 * @public
 */
export interface MockTtsOptions {
  /**
   * Number of chunk events emitted per appendText call. Defaults
   * to 3.
   */
  readonly chunkCount?: number;
  /**
   * Deterministic bytes carried by every chunk. Defaults to a 4-byte
   * fake MP3 header (`ID3` v4 — bytes `0x49 0x44 0x33 0x04`). The
   * integration test asserts these bytes reached the mock ffplay
   * stdin.
   */
  readonly chunkBytes?: Uint8Array;
}

/**
 * Side-channel controls exposed by the mock TTS factory.
 *
 * @public
 */
export interface MockTtsControls {
  /**
   * Snapshot of texts passed to appendText() in call order. The
   * integration test asserts the second entry begins with the
   * spoken-summary body (or, on the failure-override path, with
   * "I ran into a problem").
   */
  readonly appendedText: readonly string[];
  /**
   * Snapshot of chunks emitted on the events$ stream. The chunks
   * are the ones the tts-playback consumer loop iterates over and
   * forwards to ffplay.stdin. Length == chunkCount * appendedText.length
   * after flush.
   */
  readonly emittedChunks: readonly Uint8Array[];
  /**
   * Whether close() has been called.
   */
  readonly closed: boolean;
  /**
   * Whether flush() has been called.
   */
  readonly flushed: boolean;
}

/**
 * Construct a mock TTS factory builder.
 *
 * @public
 */
export function createMockTtsFactory(
  opts: MockTtsOptions = {},
): {
  factory: TtsFactory;
  controls: MockTtsControls;
} {
  const chunkCount = opts.chunkCount ?? 3;
  const chunkBytes = opts.chunkBytes ?? new Uint8Array([0x49, 0x44, 0x33, 0x04]);

  const queue: TtsEvent[] = [];
  const waiters: Array<(r: IteratorResult<TtsEvent>) => void> = [];
  let ended = false;
  const appendedText: string[] = [];
  const emittedChunks: Uint8Array[] = [];
  let closed = false;
  let flushed = false;
  let nextSeq = 0;

  function push(ev: TtsEvent): void {
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
    if (ended) return;
    ended = true;
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: undefined, done: true });
      }
    }
  }

  const events$: AsyncIterable<TtsEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<TtsEvent> {
      return {
        next(): Promise<IteratorResult<TtsEvent>> {
          if (queue.length > 0) {
            const value = queue.shift();
            if (value === undefined) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return Promise.resolve({ value, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
      };
    },
  };

  const factory: TtsFactory = (_factoryOpts: { voiceId: string }): TtsStreamClient => {
    void _factoryOpts;
    const client: TtsStreamClient = {
      events$,
      appendText(text: string): void {
        appendedText.push(text);
        for (let i = 0; i < chunkCount; i++) {
          const audio = new Uint8Array(chunkBytes);
          emittedChunks.push(audio);
          // TtsChunk.audio is Uint8Array<ArrayBuffer> per the
          // protocol schema; `new Uint8Array(chunkBytes)` is already
          // backed by an ArrayBuffer at runtime so no cast is
          // needed under TS 5.7's narrowed typed-array generic.
          push({
            type: "chunk",
            sequence: nextSeq,
            audio,
            mimeType: "audio/mpeg",
          });
          nextSeq += 1;
        }
      },
      flush(): void {
        flushed = true;
        // Push a `complete` event so the playback iterator's
        // `for await` loop sees the terminal edge and calls
        // stdin.end() on the mock ffplay child.
        push({
          type: "complete",
          totalChunks: nextSeq,
          durationMs: 100,
        });
        endStream();
      },
      close(): Promise<void> {
        closed = true;
        endStream();
        return Promise.resolve();
      },
    };
    return client;
  };

  const controls: MockTtsControls = {
    get appendedText(): readonly string[] {
      return appendedText;
    },
    get emittedChunks(): readonly Uint8Array[] {
      return emittedChunks;
    },
    get closed(): boolean {
      return closed;
    },
    get flushed(): boolean {
      return flushed;
    },
  };

  return { factory, controls };
}

// ─────────────────────────────────────────────────────────────────────
// Mock claude bridge factory — synthesises the exact session emission
// sequence the production claude-bridge.ts wrapper produces: a single
// claude_ack on the first sentence, then claude_summary + claude_done
// (or claude_failed + claude_summary) on process_exit.
// ─────────────────────────────────────────────────────────────────────

/**
 * Construction options for the mock claude bridge factory.
 *
 * @public
 */
export interface MockClaudeOptions {
  /**
   * Ack region text. Defaults to "Working on that." — extractAck
   * captures up to the first sentence terminator so the period
   * matters.
   */
  readonly ackText?: string;
  /**
   * Spoken-summary body text. Defaults to "All clean, ready when
   * you are." — extracted via the `<spoken-summary>` markers.
   */
  readonly summaryText?: string;
  /**
   * Process exit code. Defaults to 0 (success). Non-zero triggers
   * the LOOP-04 failure-override path: claude_failed fires + the
   * summary text is the FAILURE_OVERRIDE_PHRASE prefix.
   */
  readonly exitCode?: number;
  /**
   * Delay before the consume() loop fires its events. Defaults to
   * 0 (synchronous fan-out). Tests that want to assert intermediate
   * state can use this to space the events.
   */
  readonly processDelayMs?: number;
}

/**
 * Side-channel controls exposed by the mock claude bridge factory.
 *
 * @public
 */
export interface MockClaudeControls {
  /**
   * Sequence of SessionEvent types emitted via deps.emit() during
   * consume(). Allows the integration test to assert the exact
   * event log: ["claude_ack", "claude_summary", "claude_done"] on
   * success; ["claude_failed", "claude_summary", "claude_done"] on
   * failure-override.
   */
  readonly eventLog: readonly string[];
  /**
   * Sequence of texts passed to send() — the sandwich-wrap envelope
   * around the user transcript. The integration test asserts the
   * mock claude bridge received the wrapped form.
   */
  readonly sentTexts: readonly string[];
  /**
   * Whether cancel() has been called.
   */
  readonly cancelled: boolean;
  /**
   * Whether dispose() has been called.
   */
  readonly disposed: boolean;
}

const FAILURE_OVERRIDE_PHRASE = "I ran into a problem";

/**
 * Construct a mock claude bridge factory builder. The returned factory
 * matches the ClaudeBridgeFactory signature so Plan 04's
 * `session.opts.claudeBridgeFactory` slot accepts it directly.
 *
 * @public
 */
export function createMockClaudeFactory(
  opts: MockClaudeOptions = {},
): {
  factory: ClaudeBridgeFactory;
  controls: MockClaudeControls;
} {
  const ackText = opts.ackText ?? "Working on that.";
  const summaryText = opts.summaryText ?? "All clean, ready when you are.";
  const exitCode = opts.exitCode ?? 0;
  const processDelayMs = opts.processDelayMs ?? 0;

  const eventLog: string[] = [];
  const sentTexts: string[] = [];
  let cancelled = false;
  let disposed = false;

  const factory: ClaudeBridgeFactory = (
    deps: CreateClaudeBridgeDeps,
  ): ClaudeBridgeHandle => {
    const handle: ClaudeBridgeHandle = {
      send(text: string): Promise<void> {
        sentTexts.push(text);
        return Promise.resolve();
      },
      consume(): Promise<void> {
        return new Promise<void>((resolve) => {
          const fire = (): void => {
            const now = Date.now();
            // ALWAYS emit claude_ack first — the LLM narration
            // happens regardless of subprocess success / failure.
            // The production claude-bridge.ts consume() loop extracts
            // the ack from assistant_text_delta events that arrive
            // BEFORE the process_exit synthetic event; on the
            // failure path the bridge then overrides the summary
            // body via buildFailureSummary but the ack still fans
            // out. Mirrors the v1.2 mock-loop-clients.ts shape.
            const ackEv: SessionEvent = {
              type: "claude_ack",
              payload: { text: ackText },
              timestamp: now,
            };
            deps.emit(ackEv);
            eventLog.push("claude_ack");

            if (exitCode === 0) {
              // Success path: emit claude_summary then claude_done.
              const summaryEv: SessionEvent = {
                type: "claude_summary",
                payload: { text: summaryText },
                timestamp: now,
              };
              deps.emit(summaryEv);
              eventLog.push("claude_summary");

              const doneEv: SessionEvent = {
                type: "claude_done",
                payload: {
                  outcome: { kind: "success" },
                },
                timestamp: now,
              };
              deps.emit(doneEv);
              eventLog.push("claude_done");
            } else {
              // Failure-override path: claude_failed fires
              // authoritatively from exitCode != 0, then
              // claude_summary carries the FAILURE_OVERRIDE_PHRASE
              // prefix.
              const failedEv: SessionEvent = {
                type: "claude_failed",
                payload: { reason: "exit_code" },
                timestamp: now,
              };
              deps.emit(failedEv);
              eventLog.push("claude_failed");

              const summaryEv: SessionEvent = {
                type: "claude_summary",
                payload: {
                  text: `${FAILURE_OVERRIDE_PHRASE}. exit_code: ${String(exitCode)}`,
                },
                timestamp: now,
              };
              deps.emit(summaryEv);
              eventLog.push("claude_summary");

              const doneEv: SessionEvent = {
                type: "claude_done",
                payload: {
                  outcome: {
                    kind: "failure",
                    reason: "exit_code",
                    exitCode,
                  },
                },
                timestamp: now,
              };
              deps.emit(doneEv);
              eventLog.push("claude_done");
            }
            // Log "process_exit" in the eventLog so the test's
            // assertion on the bridge's exit-code outcome can match
            // the v1.2 mock-loop-clients.ts shape — the integration
            // test grep'd for "process_exit" against the bridge
            // event stream in v1.2.
            eventLog.push(`process_exit:${String(exitCode)}`);
            resolve();
          };
          if (processDelayMs > 0) {
            setTimeout(fire, processDelayMs);
          } else {
            // Defer one microtask so the caller has a chance to set
            // up listeners before the synchronous burst fires. The
            // void operator marks the promise chain as intentionally
            // unawaited — the fire() callback resolves the outer
            // consume() Promise itself.
            void Promise.resolve().then(fire);
          }
        });
      },
      cancel(): Promise<ProcessExitEvent> {
        cancelled = true;
        return Promise.resolve({
          type: "process_exit",
          exit_code: null,
          signal: "SIGINT",
        });
      },
      dispose(): Promise<void> {
        disposed = true;
        return Promise.resolve();
      },
    };
    return handle;
  };

  const controls: MockClaudeControls = {
    get eventLog(): readonly string[] {
      return eventLog;
    },
    get sentTexts(): readonly string[] {
      return sentTexts;
    },
    get cancelled(): boolean {
      return cancelled;
    },
    get disposed(): boolean {
      return disposed;
    },
  };

  return { factory, controls };
}

// ─────────────────────────────────────────────────────────────────────
// Mock spawn impl — distinguishes by cmd. For `cmd === "ffplay"`,
// returns a fake ChildProcess with a Writable-like stdin that records
// every byte and emits exit on stdin.end(). For any other cmd
// (defensive — accidental sox spawns), returns a generic fake child
// that exits immediately.
// ─────────────────────────────────────────────────────────────────────

/**
 * Construction options for the mock spawn impl.
 *
 * @public
 */
export interface MockSpawnOptions {
  /**
   * Callback fired on every spawn() invocation. Lets the test inspect
   * argv + options without re-reading the captured list.
   */
  readonly onSpawn?: (
    cmd: string,
    args: readonly string[],
    options: unknown,
  ) => void;
  /**
   * Delay between stdin.end() and the ffplay child's exit event.
   * Defaults to 50ms. Mimics ffplay's real drain time without making
   * the test slow.
   */
  readonly ffplayDrainMs?: number;
}

/**
 * Snapshot of a single spawned child for the side-channel controls.
 *
 * @public
 */
export interface MockSpawnedChild {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly options: unknown;
  /**
   * Bytes recorded via stdin.write across the child's lifetime.
   */
  readonly stdinBytes: readonly Uint8Array[];
  /**
   * Whether the child has emitted its exit event yet.
   */
  readonly exited: boolean;
  /**
   * The exit code emitted (or null if not exited yet / signal exit).
   */
  readonly exitCode: number | null;
}

/**
 * Side-channel controls exposed by the mock spawn impl.
 *
 * @public
 */
export interface MockSpawnControls {
  /**
   * Snapshot of every child the test spawned. Lets the integration
   * test assert (a) ffplay was spawned with the locked FFPLAY_ARGS,
   * (b) all children eventually exited (no orphans).
   */
  readonly spawned: readonly MockSpawnedChild[];
  /**
   * Convenience: the ffplay child specifically. null if ffplay was
   * never spawned.
   */
  readonly ffplay: MockSpawnedChild | null;
}

/**
 * Internal mutable fake child state.
 */
interface FakeChildState {
  cmd: string;
  args: readonly string[];
  options: unknown;
  stdinBytes: Uint8Array[];
  exited: boolean;
  exitCode: number | null;
}

/**
 * Build a mock spawn impl. Returns the spawn function (matching
 * `typeof import("node:child_process").spawn`) PLUS the controls
 * snapshot.
 *
 * @public
 */
export function createMockSpawnImpl(
  opts: MockSpawnOptions = {},
): {
  spawn: typeof import("node:child_process").spawn;
  controls: MockSpawnControls;
} {
  const ffplayDrainMs = opts.ffplayDrainMs ?? 50;
  const onSpawn = opts.onSpawn;
  const spawnedStates: FakeChildState[] = [];
  // Index for the ffplay child (if any). Updated when spawn("ffplay", ...)
  // is invoked the first time.
  let ffplayIndex = -1;

  function makeFfplayChild(state: FakeChildState): EventEmitter & {
    stdin: {
      write(chunk: Buffer, callback: (err?: Error | null) => void): boolean;
      end(): void;
    };
    stderr: NodeJS.ReadableStream | null;
    stdout: NodeJS.ReadableStream | null;
    kill(signal?: NodeJS.Signals | number): boolean;
    pid: number;
  } {
    const child = new EventEmitter() as EventEmitter & {
      stdin: {
        write(chunk: Buffer, callback: (err?: Error | null) => void): boolean;
        end(): void;
      };
      stderr: NodeJS.ReadableStream | null;
      stdout: NodeJS.ReadableStream | null;
      kill(signal?: NodeJS.Signals | number): boolean;
      pid: number;
    };
    child.stdin = {
      write(chunk: Buffer, callback: (err?: Error | null) => void): boolean {
        // Record a copy so the snapshot is stable even if the caller
        // reuses the buffer. Node Buffer is a Uint8Array subclass so
        // copying into a fresh Uint8Array yields the canonical bytes.
        const copy = new Uint8Array(chunk.byteLength);
        copy.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        state.stdinBytes.push(copy);
        // Resolve the write callback synchronously so the consumer
        // loop in tts-playback.ts continues without an extra event
        // loop tick.
        callback(null);
        return true;
      },
      end(): void {
        // ffplay's real-world behaviour: drains the buffered audio
        // and exits. We emulate by scheduling the exit event after
        // ffplayDrainMs. Idempotent — repeated end() calls are
        // tolerated by the real ffplay too.
        if (state.exited) return;
        setTimeout(() => {
          if (state.exited) return;
          state.exited = true;
          state.exitCode = 0;
          (child as EventEmitter).emit("exit", 0, null);
        }, ffplayDrainMs);
      },
    };
    child.stderr = null;
    child.stdout = null;
    child.pid = 30000 + spawnedStates.length;
    child.kill = (signal?: NodeJS.Signals | number): boolean => {
      void signal;
      // Forced termination: emit exit immediately.
      if (state.exited) return true;
      state.exited = true;
      state.exitCode = null;
      (child as EventEmitter).emit("exit", null, "SIGTERM");
      return true;
    };
    return child;
  }

  function makeGenericChild(state: FakeChildState): EventEmitter & {
    stdin: NodeJS.WritableStream | null;
    stderr: NodeJS.ReadableStream | null;
    stdout: NodeJS.ReadableStream | null;
    kill(): boolean;
    pid: number;
  } {
    const child = new EventEmitter() as EventEmitter & {
      stdin: NodeJS.WritableStream | null;
      stderr: NodeJS.ReadableStream | null;
      stdout: NodeJS.ReadableStream | null;
      kill(): boolean;
      pid: number;
    };
    child.stdin = null;
    child.stderr = null;
    child.stdout = null;
    child.pid = 31000 + spawnedStates.length;
    child.kill = (): boolean => {
      if (state.exited) return true;
      state.exited = true;
      state.exitCode = null;
      (child as EventEmitter).emit("exit", null, "SIGTERM");
      return true;
    };
    // Schedule an immediate exit so the test's "no orphans" assertion
    // never sees a stuck generic child. Defensive — production wiring
    // for Phase 17 only spawns ffplay; sox lives behind a separate
    // spawnImpl pathway via mic-sox.ts.
    setTimeout(() => {
      if (state.exited) return;
      state.exited = true;
      state.exitCode = 0;
      (child as EventEmitter).emit("exit", 0, null);
    }, 1);
    return child;
  }

  const spawn: typeof import("node:child_process").spawn = ((
    cmd: string,
    args?: readonly string[],
    options?: unknown,
  ): unknown => {
    const argsResolved = args ?? [];
    if (onSpawn !== undefined) {
      try {
        onSpawn(cmd, argsResolved, options);
      } catch {
        // Best-effort — the test callback must not throw into the
        // mock spawn pathway.
      }
    }
    const state: FakeChildState = {
      cmd,
      args: argsResolved,
      options,
      stdinBytes: [],
      exited: false,
      exitCode: null,
    };
    spawnedStates.push(state);
    if (cmd === "ffplay") {
      if (ffplayIndex === -1) ffplayIndex = spawnedStates.length - 1;
      return makeFfplayChild(state);
    }
    return makeGenericChild(state);
  }) as typeof import("node:child_process").spawn;

  const controls: MockSpawnControls = {
    get spawned(): readonly MockSpawnedChild[] {
      return spawnedStates.map((s): MockSpawnedChild => ({
        cmd: s.cmd,
        args: s.args,
        options: s.options,
        stdinBytes: s.stdinBytes,
        exited: s.exited,
        exitCode: s.exitCode,
      }));
    },
    get ffplay(): MockSpawnedChild | null {
      if (ffplayIndex === -1) return null;
      const s = spawnedStates[ffplayIndex];
      if (s === undefined) return null;
      return {
        cmd: s.cmd,
        args: s.args,
        options: s.options,
        stdinBytes: s.stdinBytes,
        exited: s.exited,
        exitCode: s.exitCode,
      };
    },
  };

  return { spawn, controls };
}
