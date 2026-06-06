/**
 * Cancellation primitive — SIGINT/SIGTERM/SIGKILL escalation state
 * machine (Plan 10-03, Task 1).
 *
 * Owner of Pitfall #10 (Re-utterance during an active Claude Code job):
 * when the user re-utters mid-job, the bridge needs to stop the
 * in-flight child promptly, surface a `failure / cancelled` outcome,
 * and free up the bridge state for a clean `--resume <sid>` continuation
 * on the next utterance.
 *
 * Escalation contract (CONTEXT.md "Cancellation" section):
 *
 *   1. SIGINT is sent SYNCHRONOUSLY on first invocation (before any
 *      await). Phase 10 success criterion 3 requires SIGINT to reach
 *      the child within 50 ms of session.cancel() being called; sending
 *      it synchronously is the simplest way to satisfy that budget
 *      regardless of microtask queue depth.
 *   2. If the child does not exit within `sigintGraceMs` (default 1000),
 *      SIGTERM is sent.
 *   3. If the child still does not exit within `sigtermGraceMs` (default
 *      2000) after SIGTERM, SIGKILL is sent. SIGKILL cannot be ignored
 *      by the child; cancellation always terminates within ~3 s upper
 *      bound from the call site.
 *   4. The primitive resolves once the child emits `"exit"`. The
 *      resolved value carries the exit code + signal so callers (and
 *      Phase 12 / Phase 14 telemetry) can log it.
 *
 * Idempotency (T-10-14 mitigation):
 *   Multiple concurrent callers MUST share a single Promise reference
 *   and a single escalation cycle. A per-child WeakMap holds the
 *   in-flight Promise; subsequent calls during the cancel window return
 *   the cached Promise. After resolution, the WeakMap entry is cleared
 *   so a new cancel() call after a fresh spawn (uncommon — the bridge
 *   spawns a new child per turn) would not see a stale Promise.
 *
 * The primitive is INTENTIONALLY pure with respect to session state.
 * It owns only the escalation timing and the per-child idempotency
 * cache. session.ts (Task 2) is what wires this into the public
 * surface, sets the `cancelled` flag the outcome derivation consumes,
 * and threads the resolved ProcessExitEvent back into the events$
 * stream via the existing child.on("exit") handler.
 *
 * Test seam (`deps`):
 *   The `setTimeout` / `clearTimeout` injection enables vitest fake
 *   timers to drive the 1 s + 2 s grace periods without sleeping in
 *   real time. Production callers omit `deps`; the primitive falls back
 *   to the global timer functions.
 */

import type { ProcessExitEvent } from "./types.js";

/** Default SIGINT-to-SIGTERM grace window (CONTEXT.md "Process control"). */
const DEFAULT_SIGINT_GRACE_MS = 1000;
/** Default SIGTERM-to-SIGKILL grace window (CONTEXT.md "Process control"). */
const DEFAULT_SIGTERM_GRACE_MS = 2000;

/**
 * Minimum ChildProcess shape the primitive operates on. The real
 * `child_process.ChildProcess` satisfies this; tests can pass a
 * hand-rolled object with these four methods to keep the unit suite
 * independent of node:child_process.
 */
export interface ChildLike {
  kill(signal: NodeJS.Signals): boolean;
  killed: boolean;
  exitCode: number | null;
  on(
    event: "exit",
    handler: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  removeListener(
    event: "exit",
    handler: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
}

/**
 * Injection seam used by the unit tests; production callers omit. The
 * timer functions default to the host globals. The two grace windows
 * default to {@link DEFAULT_SIGINT_GRACE_MS} and
 * {@link DEFAULT_SIGTERM_GRACE_MS}; tests override them to keep
 * suite-level fake-timer scenarios brief.
 *
 * @internal
 */
export interface CancelDeps {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  sigintGraceMs?: number;
  sigtermGraceMs?: number;
}

export interface CancelChildProcessArgs {
  child: ChildLike;
  deps?: CancelDeps;
}

/**
 * Per-child idempotency cache. WeakMap so a child that goes out of
 * scope does not anchor a stale Promise. Two concurrent calls on the
 * same child receive the same Promise; child.kill is invoked exactly
 * once per signal across all callers (T-10-14).
 */
const inFlight = new WeakMap<ChildLike, Promise<ProcessExitEvent>>();

/**
 * Initiate the SIGINT-then-SIGTERM-then-SIGKILL escalation for `child`
 * and resolve with the {@link ProcessExitEvent} the child emits.
 *
 * Synchronous behaviour: child.kill("SIGINT") is invoked BEFORE the
 * first await in this function — the Phase 10 success criterion 3
 * SIGINT-within-50ms budget holds even when the microtask queue is
 * deep.
 *
 * Fast paths:
 *   - If `child.exitCode !== null` OR `child.killed === true` at call
 *     time, the primitive resolves immediately with a synthesised
 *     ProcessExitEvent carrying the captured exit code. child.kill is
 *     NOT invoked.
 *   - If a Promise is already in flight for this child (a prior call
 *     is mid-escalation), the SAME Promise is returned. No additional
 *     escalation cycle is started.
 *
 * @param args.child the ChildProcess (or test stub) to terminate.
 * @param args.deps  test-seam injection; production callers omit.
 * @returns the ProcessExitEvent emitted by the child when it exits.
 */
export function cancelChildProcess(
  args: CancelChildProcessArgs,
): Promise<ProcessExitEvent> {
  const { child } = args;

  // Idempotency: return the in-flight Promise if there is one.
  const existing = inFlight.get(child);
  if (existing !== undefined) {
    return existing;
  }

  // Fast path: child is already gone. Resolve immediately without
  // sending any signal. Use the captured exitCode and signal:null
  // (we have no way to know which signal — if any — produced the
  // already-recorded exit code, so null is the safe default).
  if (child.exitCode !== null || child.killed) {
    const fastEvent: ProcessExitEvent = {
      type: "process_exit",
      exit_code: child.exitCode,
      signal: null,
    };
    const fastPromise = Promise.resolve(fastEvent);
    // Do NOT store fast-path Promises in inFlight: there is no
    // escalation in progress, so a subsequent call is also a fast path.
    return fastPromise;
  }

  // Resolve the deps.
  const setTimeoutFn = args.deps?.setTimeout ?? setTimeout;
  const clearTimeoutFn = args.deps?.clearTimeout ?? clearTimeout;
  const sigintGraceMs = args.deps?.sigintGraceMs ?? DEFAULT_SIGINT_GRACE_MS;
  const sigtermGraceMs = args.deps?.sigtermGraceMs ?? DEFAULT_SIGTERM_GRACE_MS;

  // Build the cancel Promise. The synchronous portion of the executor
  // sends the initial SIGINT before any await, guaranteeing the
  // Phase 10 success criterion 3 timing budget.
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const promise = new Promise<ProcessExitEvent>((resolve) => {
    // ─── exit listener ────────────────────────────────────────────
    const onExit = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      // Clean up the escalation timer + listener.
      if (pendingTimer !== null) {
        clearTimeoutFn(pendingTimer);
        pendingTimer = null;
      }
      child.removeListener("exit", onExit);
      // Resolve with the actual exit shape Node gave us.
      resolve({ type: "process_exit", exit_code: code, signal });
    };
    child.on("exit", onExit);

    // ─── escalation state machine ─────────────────────────────────
    // SIGINT (State A): sent synchronously below.
    // SIGTERM (State B): scheduled after sigintGraceMs.
    // SIGKILL (State C): scheduled after sigintGraceMs + sigtermGraceMs.
    // The exit listener short-circuits the entire chain.

    function scheduleSigkill(): void {
      pendingTimer = setTimeoutFn(() => {
        pendingTimer = null;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore — kill() can throw on already-exited children; the
          // exit listener will resolve when the pending exit arrives.
        }
        // No further escalation; we just wait on onExit.
      }, sigtermGraceMs);
    }

    function scheduleSigterm(): void {
      pendingTimer = setTimeoutFn(() => {
        pendingTimer = null;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore — see above.
        }
        scheduleSigkill();
      }, sigintGraceMs);
    }

    // SIGINT goes NOW (before any await). This is the critical
    // synchronous step that satisfies Phase 10 success criterion 3.
    try {
      child.kill("SIGINT");
    } catch {
      // ignore — see scheduleSigterm/scheduleSigkill rationale.
    }
    scheduleSigterm();
  });

  // Store in the WeakMap for idempotency. After the Promise settles,
  // clear the entry so a fresh cancel cycle could start on the same
  // child if it ever comes back (uncommon — the bridge spawns a new
  // child per turn). The catch is purely defensive: the cancel Promise
  // never rejects in this implementation.
  inFlight.set(child, promise);
  promise.finally(() => {
    if (inFlight.get(child) === promise) {
      inFlight.delete(child);
    }
  });

  return promise;
}
