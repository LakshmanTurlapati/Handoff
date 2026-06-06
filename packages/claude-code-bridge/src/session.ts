/**
 * createClaudeSession — the runtime spine of @achilles/claude-code-bridge
 * (Plan 10-02, Task 3).
 *
 * Composes:
 *   - constants.LOCKED_FLAGS (Plan 10-01) — the immutable argv recipe
 *   - line-parser (Task 1) — LDJSON line buffer with MAX_LINE_BYTES
 *     watchdog
 *   - wire-mapper (Task 2) — wire-format -> ClaudeStreamEvent conversion
 *   - version-check (Task 2) — synchronous `claude --version` gate
 *   - outcome (Task 2) — authoritative success/failure derivation
 *
 * Public surface (ClaudeSession):
 *
 *   - sessionId: string | null
 *       Populated from the first session_init event. null before that.
 *   - lastTurnText: string
 *       Accumulated assistant text. Deltas are appended; the
 *       assistant_text_done full_text replaces the buffer (the done
 *       event carries the authoritative accumulated string).
 *   - outcome: ClaudeOutcome | null
 *       null until the child exits; then computed via deriveOutcome.
 *   - events$: AsyncIterable<ClaudeBridgeEvent>
 *       Single-consumer event stream. Terminates after ProcessExit is
 *       yielded. Subsequent iterators return done:true immediately.
 *   - send(text: string): void
 *       Writes `text + "\n"` to child.stdin then calls stdin.end().
 *       Idempotent: subsequent calls are no-ops.
 *   - close(): Promise<void>
 *       Graceful shutdown. Resolves once the child has exited. If the
 *       child is still running, sends SIGTERM and waits. Cancellation
 *       with SIGINT-then-SIGTERM-then-SIGKILL escalation is Plan 10-03's
 *       cancel() primitive — close() is the graceful counterpart.
 *
 * Pitfall ties:
 *   - #7  non-interactive `-p` + pipes (NOT a PTY). stdio is
 *         ["pipe","pipe","pipe"] — see CONTEXT.md "Process control".
 *   - #8  LDJSON watchdog — owned by ./line-parser.ts; this file pipes
 *         child.stdout through it.
 *   - #17 authoritative outcome — outcome.kind is computed from exit
 *         code + tool_result.is_error flags, never from LLM narration.
 *   - #24 version check — runVersionCheck runs synchronously BEFORE the
 *         streaming spawn; ClaudeVersionError aborts construction so the
 *         streaming child is never started against a too-old CLI.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { LOCKED_FLAGS } from "./constants.js";
import { createLineParser } from "./line-parser.js";
import type { ParseErrorPayload } from "./line-parser.js";
import { mapWireEvents } from "./wire-mapper.js";
import { runVersionCheck } from "./version-check.js";
import { deriveOutcome } from "./outcome.js";
import { cancelChildProcess } from "./cancellation.js";
import type {
  ClaudeBridgeEvent,
  ClaudeOutcome,
  CreateClaudeSessionOptions,
  ProcessExitEvent,
} from "./types.js";

/**
 * Internal test-injection seam. Production callers pass `undefined`; the
 * deps default to the real `spawn` and `runVersionCheck`. Unit tests
 * inject vi.fn() stubs to drive every code path deterministically.
 *
 * @internal
 */
export interface SessionDeps {
  /** Override for {@link import("node:child_process").spawn}. */
  spawnImpl?: typeof spawn;
  /** Override for the version probe. The plan's outcome derivation
   * depends on this being synchronous so the streaming spawn never
   * starts when the version is too low. */
  runVersionCheck?: typeof runVersionCheck;
}

/**
 * Public surface returned by {@link createClaudeSession}. See file-level
 * JSDoc for field semantics.
 */
export interface ClaudeSession {
  /** Set after the first session_init event; null before. */
  readonly sessionId: string | null;
  /** Accumulated assistant text. Replaced on assistant_text_done. */
  readonly lastTurnText: string;
  /** Computed lazily once the child has exited. null before. */
  readonly outcome: ClaudeOutcome | null;
  /** Single-consumer event stream. Terminates after ProcessExit. */
  readonly events$: AsyncIterable<ClaudeBridgeEvent>;
  /** Write the prompt body to child.stdin then close stdin. Idempotent. */
  send(text: string): void;
  /** Graceful shutdown. SIGTERM if still running. Resolves on exit. */
  close(): Promise<void>;
  /**
   * Forceful cancellation (Plan 10-03). Sends SIGINT to the child
   * SYNCHRONOUSLY (Phase 10 success criterion 3: within 50 ms of the
   * call), escalates to SIGTERM after 1 s and SIGKILL after a further
   * 2 s if the child does not exit. Idempotent: a second call returns
   * the same Promise. Drain-aware: stdout chunks that arrive between
   * the cancel call and the actual exit are still parsed and emitted on
   * events$. After resolution, session.outcome === failure / cancelled
   * (Pitfall #10 attribution).
   *
   * @returns the {@link ProcessExitEvent} the child emitted on exit.
   */
  cancel(): Promise<ProcessExitEvent>;
  /**
   * Internal hook surface for tests and Plan 10-03's cancel() primitive.
   * Not part of the public API; may change without a version bump.
   * @internal
   */
  readonly _internal: {
    readonly childPid: number | null;
    readonly argv: readonly string[];
  };
}

/**
 * Spawn the `claude` CLI as a child process and wire up the bridge
 * surface. See file-level JSDoc for the lifecycle contract.
 *
 * @throws ClaudeVersionError when the installed CLI is older than
 *         MIN_CLAUDE_VERSION (and the skip env var is unset).
 */
export function createClaudeSession(
  opts: CreateClaudeSessionOptions,
  deps?: SessionDeps,
): ClaudeSession {
  // 1. Resolve effective env (caller overrides win).
  const effectiveEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.env ?? {}),
  };

  // 2. Run the synchronous version check BEFORE the streaming spawn.
  //    A throw here aborts construction; the streaming child is never
  //    started against a too-old CLI. The injection seam lets tests
  //    stub this to a no-op { skipped: true }.
  const versionImpl = deps?.runVersionCheck ?? runVersionCheck;
  versionImpl({ env: effectiveEnv });

  // 3. Build argv from LOCKED_FLAGS. The flag NAMES are immutable; the
  //    caller-provided systemPromptFile value is inserted after the
  //    --append-system-prompt-file entry, and --resume is either removed
  //    (when no sid) or has the sid appended after it.
  const argv = buildArgv(opts.systemPromptFile, opts.resumeSessionId);

  // 4. Spawn the child. stdio is ["pipe","pipe","pipe"] — NOT a PTY.
  //    Pitfall #7: the -p flag is non-interactive so pipes are correct.
  const spawnImpl = deps?.spawnImpl ?? spawn;
  const child: ChildProcess = spawnImpl("claude", argv, {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: opts.cwd ?? process.cwd(),
    env: effectiveEnv,
  });

  // 5. Wire up the event-pump state machine.
  const state = createSessionState(child, argv);

  // 6. Return the public surface. Use getters for fields that change
  //    over the lifetime so callers always read the latest value.
  return {
    get sessionId(): string | null {
      return state.sessionId;
    },
    get lastTurnText(): string {
      return state.lastTurnText;
    },
    get outcome(): ClaudeOutcome | null {
      return state.outcome;
    },
    events$: state.events$,
    send(text: string): void {
      state.send(text);
    },
    close(): Promise<void> {
      return state.close();
    },
    cancel(): Promise<ProcessExitEvent> {
      return state.cancel();
    },
    _internal: {
      get childPid(): number | null {
        return state.childPid;
      },
      get argv(): readonly string[] {
        return state.argv;
      },
    },
  };
}

/**
 * Build the argv array from {@link LOCKED_FLAGS} plus caller-provided
 * values. The plan acceptance criterion 1 + 2 asserts the exact shape;
 * keep this function pure so the assertion is over the function's
 * return, not over a side-effect of construction.
 */
function buildArgv(
  systemPromptFile: string,
  resumeSessionId: string | undefined,
): readonly string[] {
  // Mutable copy of the locked recipe. LOCKED_FLAGS = [
  //   "-p", "--output-format", "stream-json",
  //   "--include-partial-messages", "--append-system-prompt-file",
  //   "--resume"
  // ].
  const recipe: string[] = [...LOCKED_FLAGS];
  // Insert the systemPromptFile value immediately after
  // --append-system-prompt-file. The flag is at index 4 in the recipe;
  // we insert at index 5.
  const appendFlagIdx = recipe.indexOf("--append-system-prompt-file");
  recipe.splice(appendFlagIdx + 1, 0, systemPromptFile);
  // After the insert, --resume is the last entry. If resumeSessionId is
  // set, append the sid. Otherwise remove --resume entirely.
  if (resumeSessionId !== undefined) {
    recipe.push(resumeSessionId);
  } else {
    const resumeIdx = recipe.indexOf("--resume");
    if (resumeIdx >= 0) {
      recipe.splice(resumeIdx, 1);
    }
  }
  return Object.freeze(recipe);
}

/**
 * Internal state machine for the session. Owns the line parser, the
 * event queue, the tool-error list, the lifecycle flags, and the close
 * waiters. Exposed only through the public ClaudeSession surface above.
 */
function createSessionState(
  child: ChildProcess,
  argv: readonly string[],
): {
  sessionId: string | null;
  lastTurnText: string;
  outcome: ClaudeOutcome | null;
  childPid: number | null;
  readonly argv: readonly string[];
  readonly events$: AsyncIterable<ClaudeBridgeEvent>;
  send(text: string): void;
  close(): Promise<void>;
  cancel(): Promise<ProcessExitEvent>;
} {
  // ─── lifecycle state ───────────────────────────────────────────────
  let sessionId: string | null = null;
  let lastTurnText = "";
  let outcome: ClaudeOutcome | null = null;
  const toolErrors: string[] = [];
  let exited = false;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let sendCalled = false;
  // ─── Plan 10-03 cancel() plumbing ──────────────────────────────────
  // `cancelled` biases the outcome derivation: when cancel() initiates
  // the exit, the outcome MUST be { failure, cancelled } overriding both
  // exit_code and tool_error. The flag is only set when cancel() runs
  // BEFORE the natural exit — calling cancel() after a natural exit is
  // a no-op (Test 9) so we do not retroactively flip the outcome.
  let cancelled = false;
  // Session-level idempotency cache: two concurrent cancel() callers
  // share this Promise. Composes with cancelChildProcess's per-child
  // WeakMap (which gives the same guarantee at the primitive layer).
  let cancelPromise: Promise<ProcessExitEvent> | null = null;
  // Captured exit shape — once exited, future cancel() calls resolve
  // with this synthesised event without invoking child.kill.
  let capturedExitEvent: ProcessExitEvent | null = null;

  // ─── events$ FIFO + waiter queue ───────────────────────────────────
  const fifo: ClaudeBridgeEvent[] = [];
  const waiters: Array<
    (result: IteratorResult<ClaudeBridgeEvent>) => void
  > = [];
  let streamEnded = false;

  function pushEvent(ev: ClaudeBridgeEvent): void {
    // Update derived state BEFORE handing the event out so a consumer
    // that reads session.sessionId immediately after consuming
    // session_init sees the latest value.
    if (ev.type === "session_init" && sessionId === null) {
      sessionId = ev.session_id;
    } else if (ev.type === "assistant_text_delta") {
      lastTurnText += ev.text;
    } else if (ev.type === "assistant_text_done") {
      lastTurnText = ev.full_text;
    } else if (ev.type === "tool_result" && ev.is_error === true) {
      toolErrors.push(ev.tool_use_id);
    }

    // Push to FIFO or to a waiter.
    if (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: ev, done: false });
        return;
      }
    }
    fifo.push(ev);
  }

  function endStream(): void {
    if (streamEnded) return;
    streamEnded = true;
    // Resolve any pending waiters with done:true. Subsequent .next()
    // calls return done:true immediately.
    while (waiters.length > 0) {
      const next = waiters.shift();
      if (next !== undefined) {
        next({ value: undefined, done: true });
      }
    }
  }

  // ─── line parser pipeline ──────────────────────────────────────────
  // CR-fix WR-01: route through mapWireEvents (not mapWireEvent) so
  // multi-block assistant messages (e.g. a "thinking aloud" text block
  // followed by a tool_use block in the same wire line) emit one event
  // per block in document order. The legacy mapWireEvent helper only
  // returned the first block.
  const parser = createLineParser();
  parser.on("json", (obj: unknown) => {
    for (const event of mapWireEvents(obj)) {
      pushEvent(event);
    }
  });
  parser.on("parse_error", (err: ParseErrorPayload) => {
    const payload: ClaudeBridgeEvent = {
      type: "parse_error",
      error: err.error,
    };
    if (err.raw_line !== undefined) {
      payload.raw_line = err.raw_line;
    }
    pushEvent(payload);
  });

  // ─── exit waiters (declared before listeners so error + exit paths
  //     can both resolve close() callers) ──────────────────────────────
  const exitWaiters: Array<() => void> = [];

  // ─── child.stdout plumbing ─────────────────────────────────────────
  if (child.stdout !== null) {
    child.stdout.on("data", (chunk: Buffer) => {
      parser.write(chunk);
    });
    child.stdout.on("end", () => {
      parser.flush();
    });
  }

  // ─── child.stderr plumbing (CR-fix CR-03) ──────────────────────────
  // Drain stderr silently. With stdio[2] === "pipe" but no listener,
  // the OS pipe buffer eventually fills (~64 KiB on macOS/Linux) and
  // the child's stderr write blocks — which correlates with stdout
  // writev() blocking on some platforms, producing an apparent
  // pipe-deadlock that defeats the cancellation/outcome story. We
  // attach a no-op listener so Node continuously reads and discards
  // the bytes. Per CONTEXT.md "Logging": do NOT log content — stderr
  // can contain prompt fragments or path names, which we MUST NOT
  // surface to the host's stderr unconditionally.
  if (child.stderr !== null) {
    child.stderr.on("data", () => {
      // Drain only. Content is intentionally discarded.
    });
    child.stderr.on("error", () => {
      // Defensive: swallow EPIPE on stderr too. We never write to
      // stderr so this is purely a safety net for unusual platform
      // behaviour.
    });
  }

  // ─── child.stdin error guard (CR-fix CR-02) ────────────────────────
  // Attach a stdin error listener at construction (NOT inside send()):
  // EPIPE can fire if the child exits between spawn and send(), and
  // the asynchronous 'error' emission has no listener by default,
  // which Node escalates to 'uncaughtException' and crashes the host.
  // Treat EPIPE as a normal close of the input channel — the exit
  // listener below resolves outcome correctly; we surface other
  // errors as parse_error for observability without crashing.
  if (child.stdin !== null) {
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EPIPE") {
        // Expected when the child closes stdin before we finish
        // writing. The exit listener will resolve outcome cleanly.
        return;
      }
      pushEvent({
        type: "parse_error",
        error: `stdin_error: ${err.message}`,
      });
    });
  }

  // ─── child error handling (CR-fix CR-01) ───────────────────────────
  // Node emits 'error' on the ChildProcess for ENOENT (binary not on
  // PATH), EACCES, EAGAIN/ulimit nproc, and other post-construction
  // spawn failures. Without a listener, Node escalates to
  // 'uncaughtException' which crashes the host process — defeating
  // the bridge's "child failures surface as outcome.failure" contract.
  // Synthesise a process_exit and route it through the same code path
  // as a natural exit so callers see the failure on events$ and
  // session.outcome resolves to failure / exit_code.
  child.on("error", (err: Error) => {
    if (exited) return;
    exited = true;
    exitCode = null;
    exitSignal = null;
    // Surface the spawn-error message via parse_error for observability.
    // We do NOT include cwd, argv, env or other potentially sensitive
    // host state — only the OS error message Node gave us.
    pushEvent({
      type: "parse_error",
      error: `spawn_error: ${err.message}`,
    });
    // Best-effort flush of any trailing partial (no-op if the child
    // never produced stdout).
    parser.flush();
    const exitEvent: ProcessExitEvent = {
      type: "process_exit",
      exit_code: null,
      signal: null,
    };
    capturedExitEvent = exitEvent;
    pushEvent(exitEvent);
    outcome = deriveOutcome({ exitCode, toolErrors, cancelled });
    endStream();
    while (exitWaiters.length > 0) {
      const next = exitWaiters.shift();
      if (next !== undefined) next();
    }
  });

  // ─── child.exit handling ───────────────────────────────────────────
  child.on("exit", (code, signal) => {
    if (exited) return;
    exited = true;
    exitCode = code;
    exitSignal = signal;
    // Best-effort final parse of any trailing partial line. Defensive:
    // child.stdout may have already emitted "end" but we run flush()
    // again to make sure the trailing-partial parse_error path is hit
    // in scenarios where stdout never ended (e.g. signal kills).
    parser.flush();
    // Synthesise the ProcessExit event and emit it as the FINAL event.
    const exitEvent: ProcessExitEvent = {
      type: "process_exit",
      exit_code: code,
      signal,
    };
    capturedExitEvent = exitEvent;
    pushEvent(exitEvent);
    // Compute outcome from authoritative signals (exit code + tool
    // errors + cancellation). Phase 12 reads session.outcome to choose
    // between the standard and the honest spoken completion. The
    // `cancelled` flag overrides exit_code and tool_error (Plan 10-03,
    // CONTEXT.md "Cancellation" attribution).
    outcome = deriveOutcome({ exitCode, toolErrors, cancelled });
    endStream();
    // Resolve any close() waiters.
    while (exitWaiters.length > 0) {
      const next = exitWaiters.shift();
      if (next !== undefined) next();
    }
    // Suppress the implicit unused warning on exitSignal: it is set for
    // potential future telemetry and to make the exit-trace debuggable
    // via the closure scope.
    void exitSignal;
  });

  // ─── events$ AsyncIterable ─────────────────────────────────────────
  const events$: AsyncIterable<ClaudeBridgeEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<ClaudeBridgeEvent> {
      return {
        next(): Promise<IteratorResult<ClaudeBridgeEvent>> {
          if (fifo.length > 0) {
            const value = fifo.shift() as ClaudeBridgeEvent;
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
          // Manually break out of the iterator: drop any pending events.
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };

  // ─── send(text) ────────────────────────────────────────────────────
  // CR-fix CR-02: guard against writing to a stdin that has already
  // been destroyed or ended (the stdin "error" listener above keeps
  // EPIPE non-fatal, but checking writableEnded / destroyed first
  // avoids a noisy parse_error in the common "child already exited"
  // case). The try/catch is belt-and-braces around the synchronous
  // throw path that some Writable implementations exercise.
  function send(text: string): void {
    if (sendCalled) return;
    sendCalled = true;
    const stdin = child.stdin;
    if (stdin === null || stdin.destroyed || stdin.writableEnded) return;
    try {
      stdin.write(`${text}\n`);
      stdin.end();
    } catch {
      // Synchronous throw path — the stdin 'error' listener above
      // handles asynchronous EPIPE; this catch covers the rare
      // synchronous-throw shape from a writable that has gone bad
      // between the destroyed/writableEnded check and the write.
    }
  }

  // ─── close() ───────────────────────────────────────────────────────
  function close(): Promise<void> {
    if (exited) {
      return Promise.resolve();
    }
    if (typeof child.kill === "function") {
      // SIGTERM only — Plan 10-03 owns the SIGINT-then-SIGTERM-then-
      // SIGKILL escalation as the cancel() primitive.
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore — kill() can throw on already-exited children; the
        // exit listener above will resolve the close() waiters once the
        // pending exit event lands.
      }
    }
    return new Promise<void>((resolve) => {
      if (exited) {
        resolve();
        return;
      }
      exitWaiters.push(resolve);
    });
  }

  // ─── cancel() — Plan 10-03 ─────────────────────────────────────────
  // Forceful interruption with SIGINT-then-SIGTERM-then-SIGKILL
  // escalation. Delegates to cancelChildProcess for the timing state
  // machine and the per-child idempotency cache; sets the `cancelled`
  // flag so the outcome derivation (above) attributes the failure to
  // user intent rather than to exit_code or tool_error.
  function cancel(): Promise<ProcessExitEvent> {
    // Session-level idempotency: a second call returns the same Promise
    // the first one returned. (cancelChildProcess also dedupes at the
    // per-child layer; this guard is the surface-level dedupe that
    // matches the plan's Test 6 spec.)
    if (cancelPromise !== null) {
      return cancelPromise;
    }
    // Test 9 boundary: cancel AFTER a natural exit must NOT flip the
    // outcome to cancelled. The fast path resolves with the captured
    // exit event WITHOUT touching the `cancelled` flag.
    if (exited) {
      const fastEvent: ProcessExitEvent =
        capturedExitEvent !== null
          ? capturedExitEvent
          : { type: "process_exit", exit_code: exitCode, signal: exitSignal };
      cancelPromise = Promise.resolve(fastEvent);
      return cancelPromise;
    }
    // Normal cancel: set the `cancelled` flag so the exit listener
    // attributes the outcome to user intent. The flag MUST be set
    // before we await cancelChildProcess so the exit listener (which
    // may fire synchronously in the test scaffold) sees `cancelled =
    // true` when it computes outcome.
    cancelled = true;
    cancelPromise = cancelChildProcess({ child });
    return cancelPromise;
  }

  return {
    get sessionId() {
      return sessionId;
    },
    get lastTurnText() {
      return lastTurnText;
    },
    get outcome() {
      return outcome;
    },
    get childPid() {
      return child.pid ?? null;
    },
    argv,
    events$,
    send,
    close,
    cancel,
  };
}
