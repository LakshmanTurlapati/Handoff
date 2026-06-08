/**
 * Phase 17, Plan 02, Task 2 — ERR-03 / ERR-06 sox/ffplay child-exit
 * watchdog with bounded respawn.
 *
 * NEW module (no v1.2 equivalent — v1.2 had Electron's powerMonitor
 * which is not available in the terminal runtime). v1.3 polls
 * subprocess exit codes via the standard node:child_process
 * EventEmitter interface and applies a CONTEXT.md-locked sliding
 * window cap.
 *
 * Behaviour (per 17-CONTEXT.md `<decisions>` row "Child-exit
 * watchdog (ERR-03, ERR-06)"):
 *
 *   - 3 respawns within a 10_000 ms sliding window are permitted
 *   - The 4th exit inside the same window trips the cap; onError
 *     fires with the locked "Audio device lost — restart Achilles"
 *     message and the watchdog STOPS respawning
 *   - Exits spaced beyond the window roll off the recentExits ring
 *     and do NOT count toward the cap
 *
 * The watchdog supports two named child types via the `label` field:
 *   - "sox"     — the mic capture child (Phase 16 createMicSox)
 *   - "ffplay"  — the TTS playback child (Plan 02 Task 1)
 *
 * Production wiring (Plan 04 session.ts) constructs ONE watchdog per
 * label and supplies a respawnFactory that closes over the existing
 * createMicSox / createTtsPlayback config. The watchdog re-attaches
 * the exit listener on every respawn so a runaway loop of crashes
 * remains bounded.
 *
 * Threat model:
 *
 *   - T-17-07 mitigation: 3-in-10s sliding window cap; cap-exceeded
 *     emits onError + stops respawning. Without the cap, a runaway
 *     sox child could re-spawn the watchdog ~hundreds of times per
 *     second and exhaust the file descriptor budget.
 *
 * The watchdog is pure: no fs, no IPC, no Electron. The only seams
 * are `nowImpl` (Date.now), `respawnFactory` (the host's spawn
 * closure), and an optional structured logger.
 *
 * No emojis (CLAUDE.md global). The em-dash U+2014 inside
 * AUDIO_DEVICE_LOST_MESSAGE is not an emoji.
 */

import type { StructuredLogger } from "./structured-logger.js";

/**
 * Locked human-readable message surfaced when the respawn cap is
 * exceeded. Matches CONTEXT.md `<decisions>` row "Child-exit
 * watchdog (ERR-03, ERR-06)" verbatim. Plan 04's session.ts maps
 * this into a SessionEvent { type:"error", payload:{ classification:
 * "mic_unavailable" | "playback_lost", message: ... } } depending on
 * which label tripped the cap.
 *
 * Em-dash U+2014 is allowed (not an emoji).
 *
 * @public
 */
export const AUDIO_DEVICE_LOST_MESSAGE = "Audio device lost — restart Achilles";

/**
 * Locked default cap: at most 3 respawns inside `windowMs`.
 *
 * @public
 */
export const RESPAWN_MAX = 3;

/**
 * Locked default sliding window: 10 seconds.
 *
 * @public
 */
export const RESPAWN_WINDOW_MS = 10_000;

/**
 * Minimal interface of the ChildProcess fields the watchdog
 * consumes. We narrow to the on("exit") edge so the test fake does
 * not need to implement the full ChildProcess type tree.
 */
export interface ChildProcessExitLike {
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

/**
 * Construction-time options for createChildExitWatchdog.
 *
 * @public
 */
export interface CreateChildExitWatchdogOptions<
  TChild extends ChildProcessExitLike,
> {
  /**
   * Identifier surfaced in log lines + (downstream) in the
   * SessionEvent classification. "sox" tripping the cap maps to
   * `mic_unavailable`; "ffplay" tripping maps to `playback_lost`.
   */
  readonly label: "sox" | "ffplay";
  /**
   * The initial ChildProcess instance from spawn(). The watchdog
   * attaches its `on("exit")` listener on construction; subsequent
   * respawns go through respawnFactory.
   */
  readonly child: TChild;
  /**
   * Factory that returns a fresh ChildProcess on respawn. The
   * watchdog calls this AFTER each non-cap-exceeding exit and
   * re-attaches the exit listener to the returned child. Plan 04's
   * session.ts closes over the same createMicSox / createTtsPlayback
   * configuration so the respawned child has the identical wiring.
   */
  readonly respawnFactory: () => TChild;
  /**
   * Called when the respawn cap is exceeded. Plan 04's session.ts
   * dispatches an INJECT_ERROR action and emits SessionEvent { type:
   * "error", payload: { classification: <label-mapped>, message:
   * AUDIO_DEVICE_LOST_MESSAGE } }.
   */
  readonly onError: (message: string) => void;
  /**
   * Override the locked max-respawns cap. Defaults to RESPAWN_MAX
   * (3). Tests may set this to validate the boundary precisely.
   */
  readonly maxRespawns?: number;
  /**
   * Override the locked window. Defaults to RESPAWN_WINDOW_MS
   * (10_000).
   */
  readonly windowMs?: number;
  /**
   * Clock seam — Date.now() default.
   */
  readonly nowImpl?: () => number;
  /**
   * Optional structured logger sink. The watchdog emits two events:
   *   - child_exit (info, fields: label, code, attempt)
   *   - respawn_cap_exceeded (error, fields: label, attempts, windowMs)
   */
  readonly logger?: StructuredLogger;
}

/**
 * Public handle returned by createChildExitWatchdog. Only one method
 * — dispose() — because the watchdog runs autonomously on the
 * EventEmitter exit edge once constructed.
 *
 * @public
 */
export interface ChildExitWatchdog {
  /**
   * Removes the attached exit listener and prevents any further
   * respawn from taking effect. Idempotent.
   */
  dispose(): void;
}

/**
 * Construct a child-exit watchdog. The watchdog is autonomous: once
 * constructed it observes the exit edge of the supplied child + each
 * respawned child until either dispose() is called OR the respawn cap
 * is exceeded.
 *
 * @public
 */
export function createChildExitWatchdog<TChild extends ChildProcessExitLike>(
  opts: CreateChildExitWatchdogOptions<TChild>,
): ChildExitWatchdog {
  const maxRespawns = opts.maxRespawns ?? RESPAWN_MAX;
  const windowMs = opts.windowMs ?? RESPAWN_WINDOW_MS;
  const now = opts.nowImpl ?? ((): number => Date.now());

  // ── mutable state ──────────────────────────────────────────────────
  let disposed = false;
  let capExceeded = false;
  // Number of times respawnFactory has been invoked successfully.
  // Used in log lines for operator visibility.
  let respawnCount = 0;
  // Sliding window of recent exit timestamps. We push on every exit
  // and evict head entries older than `now - windowMs` before
  // counting. The window cap is `length > maxRespawns` AFTER the
  // most recent exit is pushed — i.e. the (maxRespawns + 1)-th exit
  // within the window trips the cap.
  const recentExits: number[] = [];

  function evictOldEntries(timestamp: number): void {
    const cutoff = timestamp - windowMs;
    while (recentExits.length > 0 && (recentExits[0] as number) < cutoff) {
      recentExits.shift();
    }
  }

  function attachExitListener(child: TChild): void {
    child.on("exit", (code: number | null) => {
      if (disposed) return;
      if (capExceeded) return;
      const t = now();
      respawnCount += 1;
      opts.logger?.info("child_exit", {
        label: opts.label,
        code,
        attempt: respawnCount,
      });
      // Append the exit timestamp + roll the window.
      recentExits.push(t);
      evictOldEntries(t);
      // Cap check: length > maxRespawns means the (maxRespawns+1)-th
      // exit inside the window has happened, which by definition
      // exceeds the "3 respawns in 10s" allowance.
      if (recentExits.length > maxRespawns) {
        capExceeded = true;
        opts.logger?.error("respawn_cap_exceeded", {
          label: opts.label,
          attempts: recentExits.length,
          windowMs,
        });
        opts.onError(AUDIO_DEVICE_LOST_MESSAGE);
        return;
      }
      // Below the cap — respawn and re-attach the listener so the
      // fresh child is also under the watchdog's observation.
      let nextChild: TChild;
      try {
        nextChild = opts.respawnFactory();
      } catch (respawnErr) {
        // If respawnFactory itself throws (e.g., the underlying
        // spawn() failed), we treat that as cap-exceeded — there is
        // no path forward without an audio child.
        capExceeded = true;
        const message =
          respawnErr instanceof Error
            ? respawnErr.message
            : String(respawnErr);
        opts.logger?.error("respawn_factory_threw", {
          label: opts.label,
          message,
        });
        opts.onError(AUDIO_DEVICE_LOST_MESSAGE);
        return;
      }
      attachExitListener(nextChild);
    });
  }

  attachExitListener(opts.child);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Note: node:child_process does not expose a removeAllListeners
      // typed surface narrow enough to satisfy the strict
      // ChildProcessExitLike narrow above. Instead the `disposed`
      // flag short-circuits all future exit-handler invocations. A
      // pre-existing listener will fire once more (if the host
      // child is mid-exit) but its handler is a no-op once
      // `disposed === true`.
    },
  };
}
