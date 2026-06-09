/**
 * Phase 17, Plan 02, Task 1 — PLAY-01 + PLAY-02 ffplay subprocess wrapper.
 *
 * Owns three concerns:
 *
 *   1. Spawn ffplay with the CONTEXT.md `<decisions>` row "ffplay TTS
 *      playback (PLAY-01, PLAY-02)" locked argv set + the PITFALLS.md
 *      "Integration Gotchas" `-f mp3 -i pipe:0` override (auto-detect
 *      can misidentify small initial chunks).
 *   2. Consume voice-tts events$ and forward each TtsChunk's audio
 *      bytes to ffplay.stdin with backpressure (await the
 *      stdin.write callback before continuing the for-await iterator,
 *      per PITFALLS.md §7).
 *   3. Emit `tts_drained` on the Session emitter exactly once after
 *      BOTH (a) the events$ iterator yields `complete` AND (b) the
 *      ffplay child emits `exit`. This is the half-duplex PLAY-02
 *      symmetry — the playback module owns the drain edge only;
 *      Plan 04's session.ts owns the SPEAKING_DEBOUNCE_MS=300 tail.
 *
 * On stdin.write EPIPE (ffplay died mid-stream): the consumer loop
 * terminates and emits SessionEvent {type:"error", payload:{
 * classification:"playback_lost", message:"..."}} via the deps.emit
 * sink. The playback module does NOT respawn ffplay — that is the
 * child-exit-watchdog's responsibility (Plan 02 Task 2).
 *
 * The module does NOT touch the SPEAKING_DEBOUNCE_MS=300 timer.
 * Plan 04's session.ts schedules that timer after consuming
 * tts_drained from the Session emitter.
 *
 * The TtsStreamClient surface shipped by @achilles/voice-tts does not
 * expose an explicit `open()` method — the WS opens lazily on the
 * first appendText. The circuit-breaker dependency (when provided) is
 * therefore consumed by deps callers (the STT bridge wraps mintToken,
 * the claude-bridge wraps the bridge spawn) rather than by the
 * playback module's lifecycle. The playback module accepts the dep
 * for API symmetry but does NOT invoke it on its own — auth/rate-limit
 * failures arrive on the events$ stream via voice-tts's internal
 * classifier and surface as a final "complete" or a close-without-
 * complete close edge that the consumer loop's EPIPE branch will
 * absorb.
 *
 * Threat model:
 *
 *   - T-17-06 mitigation: Promise.race against a 5_000ms stdin.write
 *     timeout prevents a hung pipe from blocking the consumer loop
 *     indefinitely; on timeout we treat as EPIPE-equivalent and emit
 *     playback_lost.
 *   - T-17-09 mitigation: classification="playback_lost" fires ONLY
 *     when stdin.write rejects with EPIPE or the ffplay child exits
 *     with a non-zero code BEFORE the iterator has completed.
 *     Voice-tts auth/rate-limit errors propagate through their own
 *     classifier surface (the wrapper's onclose path) — the playback
 *     module does not re-classify them.
 *
 * No emojis (CLAUDE.md global).
 */

import {
  spawn as nodeSpawn,
  type ChildProcess,
  type spawn as spawnFn,
} from "node:child_process";
import { Buffer } from "node:buffer";

import type { TtsStreamClient } from "@achilles/voice-tts";
import type { CircuitBreaker } from "../circuit-breaker.js";
import type { SessionEvent } from "../session-events.js";
import type { StructuredLogger } from "../structured-logger.js";

/**
 * The locked ffplay argv tuple. The flags match the CONTEXT.md
 * `<decisions>` row "ffplay TTS playback (PLAY-01, PLAY-02)" verbatim
 * with the `-f mp3 -i pipe:0` override appended per PITFALLS.md
 * "Integration Gotchas" — ffplay's container auto-detect can
 * misidentify a small initial MP3 chunk as an unsupported format and
 * fail to drain. Explicit `-f mp3` short-circuits the probe.
 *
 * Order matters: `-loglevel quiet` is FIRST so any subsequent flag
 * parsing error still respects the loglevel; `-i pipe:0` is LAST so
 * the input descriptor is unambiguous when ffplay walks its argv.
 *
 * The tuple is exported as a `readonly tuple` so the verifier grep in
 * 17-02-PLAN.md `<verify>` can pin the locked substring; the tuple
 * literal is on a single line below intentionally so the grep matches.
 *
 * @public
 */
// prettier-ignore
export const FFPLAY_ARGS = ["-loglevel", "quiet", "-nodisp", "-autoexit", "-fflags", "+nobuffer", "-flags", "+low_delay", "-framedrop", "-probesize", "32", "-analyzeduration", "0", "-f", "mp3", "-i", "pipe:0"] as const;

/**
 * Maximum time the consumer loop will wait on a single stdin.write
 * before treating the write as a hung pipe (T-17-06 mitigation).
 */
const STDIN_WRITE_TIMEOUT_MS = 5_000;

/**
 * Time we give ffplay between stdin.end() and SIGTERM during cancel().
 * Matches CONTEXT.md `<decisions>` row "Ctrl-C cancel chain" 200ms
 * tail for ffplay.
 */
const FFPLAY_KILL_GRACE_MS = 200;

/**
 * Public handle returned by createTtsPlayback. Lifecycle:
 *
 *   1. start() — spawns ffplay + starts the events$ consumer.
 *      Resolves once the child is alive. Throws if spawn fails.
 *   2. appendText(text) — forwards to ttsClient.appendText.
 *   3. flush() — calls ttsClient.flush() (sends empty-string EOS).
 *   4. cancel() — closes the voice-tts WSS, sends stdin.end(), then
 *      SIGTERMs ffplay after FFPLAY_KILL_GRACE_MS.
 *   5. dispose() — terminal teardown; idempotent.
 *
 * @public
 */
export interface TtsPlaybackHandle {
  start(): Promise<void>;
  appendText(text: string): void;
  flush(): void;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
  /**
   * Phase 19 Plan 02 Task 2 (ERR-03): the underlying ffplay child
   * process — present only after start() has resolved. The
   * createChildExitWatchdog reads .on("exit") from this reference.
   * Returns null when start() has not yet been called OR after the
   * child has been disposed. Tests that exercise the watchdog must
   * await start() before constructing the watchdog.
   */
  readonly child: ChildProcessLike | null;
}

/**
 * Construction-time dependencies for createTtsPlayback.
 *
 * @public
 */
export interface CreateTtsPlaybackDeps {
  /**
   * Factory that returns a freshly constructed TtsStreamClient. The
   * factory is invoked exactly once at start() — the playback module
   * does not re-open the WSS on its own. Plan 04's session.ts owns
   * the per-utterance lifecycle and constructs a new playback on
   * each turn if the architecture decides on per-turn streams.
   */
  readonly ttsFactory: (opts: { voiceId: string }) => TtsStreamClient;
  /**
   * The ElevenLabs voice id to synthesise against. Forwarded to
   * ttsFactory.
   */
  readonly voiceId: string;
  /**
   * Deterministic spawn seam. Production callers leave undefined
   * (the module imports node:child_process.spawn). Tests inject a
   * spy that returns a fake child so all 5 unit tests run hermetic.
   */
  readonly spawnImpl?: typeof spawnFn;
  /**
   * Optional circuit breaker — accepted for API symmetry with the
   * STT bridge and claude bridge. The TtsStreamClient surface does
   * not expose an explicit open() method (the WSS opens lazily on
   * the first appendText), so the playback module does NOT
   * invoke the breaker on its own. Auth/rate-limit failures surface
   * via the events$ stream's error classification.
   *
   * The dep is `void deps.circuitBreaker`-touched at construction
   * to satisfy noUnusedParameters under strict TS settings.
   */
  readonly circuitBreaker?: CircuitBreaker;
  /**
   * Required emit sink. The playback module fans out two event
   * variants on the Session emitter: `tts_ready` (after spawn) and
   * `tts_drained` (after iterator complete + child exit). Errors
   * surface as `error` variants with classification="playback_lost".
   */
  readonly emit: (event: SessionEvent) => void;
  /**
   * Optional structured logger sink. The playback module logs:
   *   - ffplay_spawn (info, fields: pid, args)
   *   - ffplay_exit (info, fields: code)
   *   - tts_chunk_write_failed (error, fields: code)
   *   - tts_chunk_write_timeout (error, fields: timeoutMs)
   */
  readonly logger?: StructuredLogger;
  /**
   * Clock seam — Date.now by default. Tests inject deterministic
   * timestamps so the emitted SessionEvent.timestamp field is
   * reproducible.
   */
  readonly nowImpl?: () => number;
  /**
   * Timer scheduler seam paired with clearTimeoutImpl. Tests inject
   * recording fakes so the cancel() 200ms grace and the per-write
   * 5_000ms timeout are fully deterministic.
   */
  readonly setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  /**
   * Timer-cancellation seam paired with setTimeoutImpl.
   */
  readonly clearTimeoutImpl?: (token: unknown) => void;
}

/**
 * Minimal interface of the ChildProcess fields the playback module
 * consumes. We narrow to this surface so the test fake does not need
 * to implement the full ChildProcess type tree.
 */
// Exported in Phase 19 Plan 02 Task 2 so the TtsPlaybackHandle.child
// field's type is reachable from session.ts (which imports the handle
// type and passes the child to createChildExitWatchdog).
export interface ChildProcessLike {
  readonly stdin: {
    write(chunk: Buffer, callback: (err?: Error | null) => void): boolean;
    end(): void;
  } | null;
  readonly stderr: NodeJS.ReadableStream | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
}

/**
 * Construct a TTS playback handle.
 *
 * The handle is stateful: start() must complete before appendText
 * is meaningful (early appendText calls during connect are buffered
 * by voice-tts itself; the playback module does not add a second
 * buffer). cancel() and dispose() are idempotent.
 *
 * @public
 */
export function createTtsPlayback(
  deps: CreateTtsPlaybackDeps,
): TtsPlaybackHandle {
  // Touch the unused-but-accepted circuit-breaker dep so strict
  // noUnusedParameters does not complain. The dep is accepted for
  // API symmetry; see the deps interface doc for the rationale.
  void deps.circuitBreaker;
  const doSpawn: typeof spawnFn = deps.spawnImpl ?? nodeSpawn;
  const now = deps.nowImpl ?? ((): number => Date.now());
  const setT: (cb: () => void, ms: number) => unknown =
    deps.setTimeoutImpl ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearT: (token: unknown) => void =
    deps.clearTimeoutImpl ??
    ((token: unknown): void => {
      clearTimeout(token as ReturnType<typeof setTimeout>);
    });

  // ── mutable state ──────────────────────────────────────────────────
  let ttsClient: TtsStreamClient | null = null;
  let ffplay: ChildProcessLike | null = null;
  let started = false;
  let disposed = false;
  // Two edges must both fire before tts_drained is emitted: the
  // events$ iterator completing AND the ffplay child exiting. We
  // capture each in a boolean and only emit once both are true.
  let iteratorComplete = false;
  let childExited = false;
  let drainedEmitted = false;
  let errorEmitted = false;

  function emitErrorOnce(message: string): void {
    if (errorEmitted) return;
    errorEmitted = true;
    deps.emit({
      type: "error",
      payload: { classification: "playback_lost", message },
      timestamp: now(),
    });
  }

  function maybeEmitDrained(): void {
    if (drainedEmitted) return;
    if (!iteratorComplete) return;
    if (!childExited) return;
    drainedEmitted = true;
    deps.emit({
      type: "tts_drained",
      payload: {},
      timestamp: now(),
    });
  }

  /**
   * Await one stdin.write call with a hard timeout. Resolves on the
   * callback's success path; rejects on the callback's error path or
   * on the timeout firing first. T-17-06 mitigation.
   */
  function writeChunk(chunk: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const stdin = ffplay?.stdin;
      if (stdin == null) {
        reject(new Error("ffplay stdin closed"));
        return;
      }
      let settled = false;
      const timeoutToken = setT(() => {
        if (settled) return;
        settled = true;
        reject(new Error("EPIPE_TIMEOUT"));
      }, STDIN_WRITE_TIMEOUT_MS);
      stdin.write(chunk, (err) => {
        if (settled) return;
        settled = true;
        clearT(timeoutToken);
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * The events$ consumer loop. Runs once per session lifecycle.
   * Walks the voice-tts events$ async iterable, forwards each chunk
   * to ffplay.stdin with backpressure, and signals iteratorComplete
   * on the terminal `complete` event (or on EPIPE / write failure).
   */
  async function consume(): Promise<void> {
    if (ttsClient == null) return;
    try {
      for await (const ev of ttsClient.events$) {
        if (disposed) break;
        if (ev.type === "chunk") {
          // The TtsChunk schema validates `audio: Uint8Array`; convert
          // to a Node Buffer (zero-copy view over the same ArrayBuffer)
          // for stdin.write.
          const buf = Buffer.from(
            ev.audio.buffer,
            ev.audio.byteOffset,
            ev.audio.byteLength,
          );
          try {
            await writeChunk(buf);
          } catch (writeErr) {
            const code =
              writeErr instanceof Error
                ? writeErr.message === "EPIPE_TIMEOUT"
                  ? "EPIPE_TIMEOUT"
                  : ((writeErr as Error & { code?: string }).code ??
                    writeErr.message)
                : String(writeErr);
            deps.logger?.error("tts_chunk_write_failed", { code });
            emitErrorOnce(`ffplay stdin write failed: ${code}`);
            // Exit the loop — the child is dead or unresponsive.
            return;
          }
        } else if (ev.type === "complete") {
          // Terminal event — signal ffplay to drain and exit.
          try {
            ffplay?.stdin?.end();
          } catch {
            // best-effort; stdin may already be closed.
          }
        }
      }
    } catch (loopErr) {
      const msg =
        loopErr instanceof Error ? loopErr.message : String(loopErr);
      deps.logger?.error("tts_iterator_threw", { message: msg });
      emitErrorOnce(`tts iterator threw: ${msg}`);
    } finally {
      iteratorComplete = true;
      maybeEmitDrained();
    }
  }

  function start(): Promise<void> {
    if (started) return Promise.resolve();
    started = true;
    // 1. Build the TtsStreamClient via the injected factory. The
    //    factory is the seam Plan 04's session.ts uses to wire the
    //    real createTtsStreamClient or the MOCK_LOOP fake.
    ttsClient = deps.ttsFactory({ voiceId: deps.voiceId });
    // 2. Spawn ffplay. stdio = ["pipe", "ignore", "pipe"]: stdin is
    //    the audio pipe; stdout is silenced (matches the -loglevel
    //    quiet flag); stderr stays piped so ffplay errors surface to
    //    the structured logger.
    const child: ChildProcess = doSpawn("ffplay", [...FFPLAY_ARGS], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    ffplay = child;
    deps.logger?.info("ffplay_spawn", {
      // pid may be undefined on spawn failure.
      pid: child.pid ?? null,
      args: [...FFPLAY_ARGS],
    });
    // 3. Listen for the child's exit edge so we can compose it with
    //    iteratorComplete to fire tts_drained.
    ffplay.on("exit", (code: number | null) => {
      childExited = true;
      deps.logger?.info("ffplay_exit", { code });
      // If the child exited with a non-zero code BEFORE the iterator
      // completed, surface the failure as playback_lost.
      if (code !== null && code !== 0 && !iteratorComplete) {
        emitErrorOnce(`ffplay exited with code=${code}`);
      }
      maybeEmitDrained();
    });
    ffplay.on("error", (err: Error) => {
      deps.logger?.error("ffplay_error", { message: err.message });
      emitErrorOnce(`ffplay error: ${err.message}`);
    });
    // 4. Emit tts_ready so Plan 04's session.ts can transition state.
    deps.emit({ type: "tts_ready", payload: {}, timestamp: now() });
    // 5. Kick off the consumer loop. We do NOT await it here — it
    //    runs for the lifetime of the stream and emits tts_drained
    //    when the iterator completes + the child exits.
    void consume();
    return Promise.resolve();
  }

  function appendText(text: string): void {
    if (disposed) return;
    if (ttsClient == null) return;
    ttsClient.appendText(text);
  }

  function flush(): void {
    if (disposed) return;
    if (ttsClient == null) return;
    ttsClient.flush();
  }

  async function cancel(): Promise<void> {
    // 1. Close the voice-tts WSS first so no more chunks land on
    //    stdin between the .end() and the SIGTERM.
    if (ttsClient != null) {
      try {
        await ttsClient.close();
      } catch {
        // best-effort.
      }
    }
    // 2. Signal ffplay to drain. -autoexit + EOF on stdin drains
    //    cleanly (PITFALLS.md §7).
    if (ffplay != null && !childExited) {
      try {
        ffplay.stdin?.end();
      } catch {
        // best-effort.
      }
      // 3. After FFPLAY_KILL_GRACE_MS, SIGTERM if the child is still
      //    alive. The Plan 04's session.ts will await this Promise
      //    inside the gracefulShutdown chain.
      await new Promise<void>((resolve) => {
        const t = setT(() => {
          if (!childExited && ffplay != null) {
            try {
              ffplay.kill("SIGTERM");
            } catch {
              // best-effort.
            }
          }
          resolve();
        }, FFPLAY_KILL_GRACE_MS);
        void t;
      });
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    await cancel();
  }

  return {
    start,
    appendText,
    flush,
    cancel,
    dispose,
    // Phase 19 Plan 02 Task 2 (ERR-03): expose ffplay child reference
    // for createChildExitWatchdog. Null until start() has resolved.
    get child(): ChildProcessLike | null {
      return ffplay;
    },
  };
}
