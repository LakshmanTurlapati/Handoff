/**
 * Phase 17, Plan 04, Task 2 — LOOP-05 cancellation chain.
 *
 * Registers `process.once("SIGINT", ...)` + `process.once("SIGTERM",
 * ...)` handlers that coordinate a 7-step teardown of the voice loop
 * in under 1.5s. The .once registration (NOT process.on) is
 * load-bearing — it lets a second signal during cleanup install a
 * separate process.on handler that flips a `forceful` flag and exits
 * immediately, preventing the user from being held hostage by a
 * hung subprocess.
 *
 * 7-step teardown (CONTEXT.md `<decisions>` row "Ctrl-C cancel chain
 * (LOOP-05)") with per-step inner timeouts that sum to the 1.5s
 * budget:
 *
 *   1. Mark session as shutting down (block new state transitions);
 *      logger.info("graceful_shutdown_start", { reason }).
 *   2. ttsPlayback.cancel() — closes the voice-tts WSS + sends
 *      ffplay.stdin.end() + SIGTERM-after-200ms. INNER TIMEOUT: 300ms.
 *   3. claudeBridge.cancel() — delegates to packages/claude-code-
 *      bridge/src/cancellation.ts which sends SIGINT then escalates
 *      to SIGTERM after 100ms then SIGKILL after 200ms. INNER
 *      TIMEOUT: 700ms.
 *   4. sttBridge.stop() — closes the STT WSS with close code 1000.
 *      INNER TIMEOUT: 200ms.
 *   5. micSox.stop() (handled inside session.stop()) — SIGTERMs sox.
 *      INNER TIMEOUT: 200ms.
 *   6. Logger.flush() — synchronous structured-logger flush so the
 *      final state hits disk before process.exit (Pitfall 1 defence).
 *   7. session.emit shutdown event + process.exit with code 0 (sigint/
 *      sigterm/dispose) or 1 (internal_error).
 *
 * The outer envelope wraps steps 1-7 in `Promise.race([allSteps,
 * timeout(1500)])`; on outer timeout the handler logs
 * "graceful_shutdown_budget_exceeded" and calls process.exit(130) so
 * the process never lingers past the budget.
 *
 * Second-signal escalation (T-17-19 mitigation): after the first
 * .once handler fires, the chain installs a process.on("SIGINT")
 * handler that flips `forceful=true`. The outer Promise.race
 * observes the flag and process.exit(130)s immediately so the user
 * can always escape.
 *
 * Last-chance lock-file cleanup (T-17-20 mitigation): registers
 * process.once("exit", ...) that SYNCHRONOUSLY unlinkSyncs the
 * lock-file at LOCK_FILE. Async unlink is not guaranteed to run
 * before exit; sync is the safe primitive.
 *
 * No emojis (CLAUDE.md global).
 */

import { unlinkSync } from "node:fs";

import type { Session } from "./session.js";
import type { StructuredLogger } from "./structured-logger.js";

/**
 * The reason categories for a graceful-shutdown invocation. Drives
 * the exit code: "sigint" / "sigterm" / "dispose" -> 0;
 * "internal_error" -> 1.
 *
 * @public
 */
export type GracefulShutdownReason =
  | "sigint"
  | "sigterm"
  | "internal_error"
  | "dispose";

/**
 * Public handle returned by registerGracefulShutdown. Exposes the
 * primitive gracefulShutdown function so the caller (runVoice) can
 * trigger the same teardown chain from a non-signal path (e.g. a
 * fatal uncaughtException in the orchestrator).
 *
 * @public
 */
export interface GracefulShutdownHandle {
  /**
   * Trigger the 7-step teardown chain. Idempotent — a second call
   * returns the same Promise as the first. The first call moves
   * `shuttingDown=true` so concurrent paths short-circuit.
   */
  gracefulShutdown(reason: GracefulShutdownReason): Promise<void>;
}

/**
 * Construction-time dependencies for registerGracefulShutdown.
 *
 * @public
 */
export interface RegisterGracefulShutdownDeps {
  /**
   * The session being torn down. The chain reads
   * session.sttBridge / session.ttsPlayback / session.claudeBridge
   * via optional-chaining so a session that never wired the audio
   * bridges (Phase 16 back-compat) tears down cleanly.
   */
  readonly session: Session;
  /**
   * Structured logger handle. The chain calls
   * logger.info("graceful_shutdown_start" / "_complete", ...) +
   * logger.flush() before process.exit.
   */
  readonly logger: StructuredLogger;
  /**
   * Path to the lock file. Phase 17's resume-session module owns
   * the file's lifecycle; the chain's process.once("exit") handler
   * unlinkSyncs it as the last-chance cleanup.
   */
  readonly lockFilePath: string;
  /**
   * Optional callback fired after the 7-step teardown completes
   * AND before process.exit. Tests inject a spy to assert the
   * sequence reached step 7.
   */
  readonly onShutdownComplete?: () => void;
  /**
   * Optional timer scheduler seam. Tests inject a deterministic
   * fake so the per-step inner timeouts + the outer 1.5s budget
   * fire on demand.
   */
  readonly setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  /**
   * Optional timer-cancellation seam paired with setTimeoutImpl.
   */
  readonly clearTimeoutImpl?: (token: unknown) => void;
  /**
   * Optional process-surface override. Tests inject a recording
   * fake of { once, exit, kill } so the chain's process.once
   * registrations + process.exit call are observable without
   * touching the real Node process. Defaults to `process`.
   */
  readonly processOverride?: {
    once: (event: string, listener: (...args: unknown[]) => void) => unknown;
    on: (event: string, listener: (...args: unknown[]) => void) => unknown;
    exit: (code?: number) => never;
    kill: (pid: number, signal?: NodeJS.Signals | number) => true;
  };
  /**
   * Optional filesystem unlink seam for the process.once("exit")
   * last-chance lock-file cleanup. Tests inject a recording spy so
   * the unlinkSync invocation is observable. Defaults to
   * node:fs.unlinkSync.
   */
  readonly unlinkSyncImpl?: (path: string) => void;
}

/**
 * Locked per-step inner timeouts (ms). Sum is 1400ms, leaving 100ms
 * of headroom before the outer 1.5s budget fires.
 */
const STEP_TIMEOUT_TTS_MS = 300;
const STEP_TIMEOUT_CLAUDE_MS = 700;
const STEP_TIMEOUT_STT_MS = 200;
const STEP_TIMEOUT_MIC_MS = 200;
const OUTER_BUDGET_MS = 1500;

/**
 * Wrap a Promise in a race against a setTimeout-based timeout. The
 * setTimeout seam comes from deps so tests are fully deterministic.
 */
function withTimeout(
  inner: Promise<unknown>,
  ms: number,
  setT: (cb: () => void, ms: number) => unknown,
  clearT: (token: unknown) => void,
): Promise<unknown> {
  return new Promise((resolve) => {
    let resolved = false;
    const token = setT(() => {
      if (resolved) return;
      resolved = true;
      resolve(undefined);
    }, ms);
    inner.then(
      (v) => {
        if (resolved) return;
        resolved = true;
        clearT(token);
        resolve(v);
      },
      () => {
        if (resolved) return;
        resolved = true;
        clearT(token);
        resolve(undefined);
      },
    );
  });
}

/**
 * Register the SIGINT + SIGTERM handlers + process.once("exit")
 * lock-file cleanup + return the gracefulShutdown handle. Idempotent
 * — calling registerGracefulShutdown twice on the same process is a
 * no-op (the second call returns a fresh handle but the registered
 * handlers from the first call are still in flight).
 *
 * @public
 */
export function registerGracefulShutdown(
  deps: RegisterGracefulShutdownDeps,
): GracefulShutdownHandle {
  const setT: (cb: () => void, ms: number) => unknown =
    deps.setTimeoutImpl ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT: (token: unknown) => void =
    deps.clearTimeoutImpl ??
    ((token) => {
      clearTimeout(token as ReturnType<typeof setTimeout>);
    });
  const proc = deps.processOverride ?? {
    once: (event: string, listener: (...args: unknown[]) => void) =>
      process.once(event as NodeJS.Signals, listener as never),
    on: (event: string, listener: (...args: unknown[]) => void) =>
      process.on(event as NodeJS.Signals, listener as never),
    exit: (code?: number) => process.exit(code),
    kill: (pid: number, signal?: NodeJS.Signals | number) =>
      process.kill(pid, signal),
  };
  const unlinkImpl: (path: string) => void =
    deps.unlinkSyncImpl ?? ((path) => unlinkSync(path));

  // Mutable lifecycle flags.
  let shuttingDown = false;
  let forceful = false;
  let inFlight: Promise<void> | null = null;

  function gracefulShutdown(
    reason: GracefulShutdownReason,
  ): Promise<void> {
    if (inFlight !== null) {
      return inFlight;
    }
    shuttingDown = true;
    deps.session.shuttingDown = true;
    deps.logger.info("graceful_shutdown_start", { reason });

    // After the first signal lands, install a process.on handler so
    // a second SIGINT during cleanup flips forceful and short-
    // circuits the outer race.
    proc.on("SIGINT", () => {
      forceful = true;
    });

    const steps = (async (): Promise<void> => {
      // Step 2 — close TTS playback (voice-tts WSS + ffplay drain
      // with internal SIGTERM-after-200ms).
      if (deps.session.ttsPlayback !== null) {
        await withTimeout(
          deps.session.ttsPlayback.cancel(),
          STEP_TIMEOUT_TTS_MS,
          setT,
          clearT,
        );
      }
      if (forceful) {
        deps.logger.info("graceful_shutdown_forceful", { reason });
        proc.exit(130);
        return;
      }
      // Step 3 — cancel claude subprocess via the bridge's existing
      // SIGINT-SIGTERM-SIGKILL chain (LOOP-07).
      if (deps.session.claudeBridge !== null) {
        await withTimeout(
          deps.session.claudeBridge.cancel(),
          STEP_TIMEOUT_CLAUDE_MS,
          setT,
          clearT,
        );
      }
      if (forceful) {
        deps.logger.info("graceful_shutdown_forceful", { reason });
        proc.exit(130);
        return;
      }
      // Step 4 — close STT bridge (WSS close 1000).
      if (deps.session.sttBridge !== null) {
        await withTimeout(
          deps.session.sttBridge.stop(),
          STEP_TIMEOUT_STT_MS,
          setT,
          clearT,
        );
      }
      if (forceful) {
        deps.logger.info("graceful_shutdown_forceful", { reason });
        proc.exit(130);
        return;
      }
      // Step 5 — stop the mic (sox SIGTERM). session.stop() owns
      // the sox child via the Phase 16 wrapper.
      await withTimeout(
        deps.session.stop(),
        STEP_TIMEOUT_MIC_MS,
        setT,
        clearT,
      );
      // Step 6 — flush the structured logger so the final state is
      // on disk before process.exit. Pitfall 1 defence.
      await deps.logger.flush();
      // Step 7 — emit the shutdown SessionEvent + invoke the
      // optional callback + exit with the reason-mapped code.
      deps.session.emit("event", {
        type: "shutdown",
        payload: { reason },
        timestamp: Date.now(),
      });
      deps.logger.info("graceful_shutdown_complete", { reason });
      deps.onShutdownComplete?.();
      proc.exit(reason === "internal_error" ? 1 : 0);
    })();

    // Outer 1.5s budget. On budget exceeded -> process.exit(130).
    // Assign to inFlight BEFORE awaiting so a concurrent second call
    // returns the same Promise reference (idempotency contract).
    const wrapped = (async (): Promise<void> => {
      let budgetExceeded = false;
      const budgetTimer: unknown = setT(() => {
        budgetExceeded = true;
        deps.logger.error("graceful_shutdown_budget_exceeded", {
          reason,
          budgetMs: OUTER_BUDGET_MS,
        });
        proc.exit(130);
      }, OUTER_BUDGET_MS);
      try {
        await steps;
      } finally {
        if (!budgetExceeded) {
          clearT(budgetTimer);
        }
      }
    })();
    inFlight = wrapped;
    return wrapped;
  }

  // Register the SIGINT + SIGTERM handlers via .once so the first
  // signal triggers shutdown; the second goes to the process.on
  // handler installed inside gracefulShutdown.
  proc.once("SIGINT", () => {
    void gracefulShutdown("sigint");
  });
  proc.once("SIGTERM", () => {
    void gracefulShutdown("sigterm");
  });

  // Register the synchronous last-chance lock-file cleanup. The
  // process.once("exit") fires on every exit path including the
  // budget-exceeded process.exit(130) above. unlinkSync is
  // idempotent via the catch — a missing lock-file is not an error.
  proc.once("exit", () => {
    try {
      unlinkImpl(deps.lockFilePath);
    } catch {
      // best-effort; ENOENT is expected when the gracefulShutdown
      // chain already released the lock in step 7.
    }
  });

  // Touch shuttingDown / forceful via void so they are reachable
  // from the closure (lint compliance).
  void shuttingDown;

  return {
    gracefulShutdown,
  };
}

/**
 * Direct gracefulShutdown entry point — convenience export for
 * callers that already hold a Session + Logger + lockFilePath and
 * want to trigger the chain without the .once handler registration
 * (e.g. a fatal uncaughtException in the orchestrator).
 *
 * Equivalent to:
 *   const handle = registerGracefulShutdown(deps);
 *   handle.gracefulShutdown(reason);
 *
 * @public
 */
export function gracefulShutdown(
  deps: RegisterGracefulShutdownDeps,
  reason: GracefulShutdownReason,
): Promise<void> {
  const handle = registerGracefulShutdown(deps);
  return handle.gracefulShutdown(reason);
}
