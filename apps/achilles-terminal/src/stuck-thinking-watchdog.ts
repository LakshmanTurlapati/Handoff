/**
 * Phase 17, Plan 02, Task 2 — ERR-05 stuck-thinking watchdog port.
 *
 * Verbatim port of apps/achilles/src/main/stuck-thinking-watchdog.ts
 * (the v1.2 SAFE-06 substrate; 301 LOC). v1.2 already had zero
 * Electron / IPC / fs imports — verified by
 * `grep -E "^import" apps/achilles/src/main/stuck-thinking-watchdog.ts`
 * returning 0 lines — so the port is a literal copy with the path
 * remapped to the terminal-only tree under apps/achilles-terminal/.
 *
 * Public surface preserved BYTE-FOR-BYTE:
 *
 *   - STUCK_THINKING_DEFAULT_TIMEOUT_MS (60_000)
 *   - STUCK_THINKING_ANNOUNCEMENT ("Claude is still working — I'll let
 *     you know when it's done.") — em-dash U+2014 retained, not an
 *     emoji (emojis live in U+1F000-U+1FFFF and U+2600-U+27FF).
 *   - StuckThinkingTimeoutEvent
 *   - StuckThinkingWatchdogOptions
 *   - StuckThinkingWatchdog
 *   - createStuckThinkingWatchdog
 *
 * Plan 04's session.ts will wire onTimeout into:
 *   (a) Phase 17 TTS appendText path for the locked announcement
 *   (b) Session emitter `error` variant (or a future stuck event)
 *
 * The watchdog itself is pure: no fs, no IPC, no Electron, no TTS
 * dependency. The only side effect is the optional logger seam.
 *
 * Threat model:
 *
 *   - T-14-19 (v1.2 carry-forward) accept — a slow but valid Claude
 *     run will hit the 60 s watchdog. The announcement is the
 *     affordance per CONTEXT.md ("intentionally generous"); we do
 *     NOT force-cancel.
 *   - T-14-20 (v1.2 carry-forward) mitigate — the announcement is a
 *     fixed module-scope constant; the logger emits waitedMs only,
 *     NEVER transcript fragments or API key bytes. The SW5/SW7
 *     logger discipline test pins this at the runtime line.
 *   - T-17-08 (Phase 17 STRIDE register) mitigate — Plan 02's
 *     threat model for stuck-thinking. The single log line carries
 *     waitedMs only.
 *
 * No emojis (CLAUDE.md global). The em-dash U+2014 inside
 * STUCK_THINKING_ANNOUNCEMENT is not an emoji.
 */

/**
 * Locked default timeout for the stuck-thinking watchdog. 60 seconds
 * matches the SAFE-06 contract + PITFALLS #19 example. The CONTEXT.md
 * decision calls this "intentionally generous" because Claude can
 * take minutes on hard tasks; the announcement is the affordance,
 * not a forced cancel.
 *
 * @public
 */
export const STUCK_THINKING_DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Locked announcement text the orchestrator routes through the TTS
 * stream when the watchdog timer fires. The phrasing matches
 * PITFALLS #19 verbatim; the SW1 test pins the string-level
 * invariant.
 *
 * Em-dash U+2014 is allowed (not an emoji). No U+1F000-U+1FFFF or
 * U+2600-U+27FF codepoints anywhere in the string.
 *
 * @public
 */
export const STUCK_THINKING_ANNOUNCEMENT =
  "Claude is still working — I'll let you know when it's done.";

/**
 * The shape of the on-timeout callback invoked when the watchdog
 * timer fires. The orchestrator wires this to TTS appendText (locked
 * announcement) AND the session emitter status row. The payload
 * carries the elapsed waitedMs for the renderer's affordance.
 *
 * @public
 */
export type StuckThinkingTimeoutEvent = {
  /**
   * The configured timeoutMs that elapsed before the watchdog fired.
   * Always equals the `timeoutMs` field passed to
   * createStuckThinkingWatchdog (default 60_000).
   */
  readonly waitedMs: number;
};

/**
 * Construction-time options for the watchdog factory.
 *
 * @public
 */
export interface StuckThinkingWatchdogOptions {
  /**
   * Required callback invoked when the watchdog timer fires. The
   * orchestrator routes this into TTS appendText + the session
   * emitter. The watchdog itself does NOT touch TTS, IPC, or fs.
   */
  onTimeout: (event: StuckThinkingTimeoutEvent) => void;

  /**
   * Configurable timeout. Defaults to STUCK_THINKING_DEFAULT_TIMEOUT_MS
   * (60 seconds). Production wiring reads
   * `process.env.ACHILLES_STUCK_TIMEOUT_MS` if set; tests pass small
   * values (or rely on the injected setTimeoutImpl seam for synchronous
   * firing).
   */
  timeoutMs?: number;

  /**
   * Timer scheduler seam. Tests inject a recording fake so the
   * watchdog is fully deterministic without vi.useFakeTimers.
   * Defaults to the host setTimeout.
   */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;

  /**
   * Timer-cancellation seam paired with setTimeoutImpl. Tests
   * inject a recording fake. Defaults to the host clearTimeout.
   */
  clearTimeoutImpl?: (token: unknown) => void;

  /**
   * Clock seam. Reserved for future arithmetic (e.g., a
   * waited-since-arm reading). Plan 14-04 / Plan 17-02 do NOT
   * consume this field directly — the SW1..SW7 contract is
   * satisfied with setTimeoutImpl + clearTimeoutImpl alone — but the
   * seam is in the surface so a future hardening pass does not have
   * to widen the deps.
   */
  nowImpl?: () => number;

  /**
   * Optional logger sink. Defaults to console.error with the
   * [achilles] prefix. The logger MUST NOT receive transcript
   * fragments, API key bytes, or TTS audio bytes — the watchdog
   * itself never has access to any of those, so this is a
   * defence-in-depth contract on the implementation.
   */
  logger?: (msg: string) => void;
}

/**
 * Public handle returned by createStuckThinkingWatchdog. Each method
 * is documented with its lifecycle role; the methods are idempotent
 * and safe to call after dispose() (they all collapse to no-ops once
 * the watchdog is disposed).
 *
 * @public
 */
export interface StuckThinkingWatchdog {
  /**
   * Schedule the timeout for the current utterance. Called by the
   * orchestrator at the start of consumeClaudeEvents (after
   * bridge.send completes). Idempotent re-arm: calling armForTurn
   * while a timer is already in flight cancels the prior token and
   * schedules a fresh one.
   */
  armForTurn(): void;

  /**
   * Per-progress-event heartbeat. The orchestrator calls this on
   * every Claude progress event (assistant_text_delta / tool_use /
   * tool_result / session_init). The watchdog clears the current
   * timer and re-schedules a fresh one so a steady stream of
   * progress events keeps the watchdog silent.
   */
  observeProgress(): void;

  /**
   * Cancel the in-flight timer WITHOUT firing onTimeout. Called by
   * the orchestrator on process_exit so a turn that already
   * completed does not trigger a spurious stuck-thinking
   * announcement.
   */
  clearForTurn(): void;

  /**
   * Final tear-down. Cancels any in-flight timer AND zeroes the
   * onTimeout callback so even a stale host scheduler that fires
   * the captured cb after dispose is a no-op. Idempotent — calling
   * dispose twice is a no-op.
   */
  dispose(): void;
}

/**
 * Construct a stuck-thinking watchdog.
 *
 * The returned handle is reusable across many utterances within an
 * Achilles run — armForTurn at every utterance commit; observeProgress
 * per Claude progress event; clearForTurn at process_exit; dispose at
 * app teardown. Calling the lifecycle methods in any order is safe;
 * the watchdog reduces to a single token-tracked timer state machine
 * and idempotency is preserved at every method.
 *
 * @public
 */
export function createStuckThinkingWatchdog(
  opts: StuckThinkingWatchdogOptions,
): StuckThinkingWatchdog {
  const timeoutMs = opts.timeoutMs ?? STUCK_THINKING_DEFAULT_TIMEOUT_MS;
  const setT =
    opts.setTimeoutImpl ??
    ((cb: () => void, ms: number): unknown => setTimeout(cb, ms));
  const clearT =
    opts.clearTimeoutImpl ??
    ((token: unknown): void => {
      clearTimeout(token as ReturnType<typeof setTimeout>);
    });
  const log =
    opts.logger ??
    ((msg: string): void => {
      console.error(msg);
    });
  // nowImpl is reserved for future arithmetic; touched once via void
  // to satisfy noUnusedParameters without changing the construction
  // surface.
  void opts.nowImpl;

  // Internal mutable state. The watchdog reduces to a single token
  // slot (the in-flight setTimeout token) + a disposed flag + a
  // mutable onTimeout reference so dispose can zero it (SW6 invariant).
  // Use `unknown` as the token type — the seam accepts ANY scheduler
  // token (the host setTimeout returns Timeout; tests return numbers).
  let token: unknown = null;
  let disposed = false;
  // Hold the onTimeout callback in a mutable cell so dispose() can
  // zero it. This guarantees that even a non-cooperative host
  // scheduler that fires the captured timer callback AFTER dispose()
  // is a no-op (SW6 invariant). The orchestrator's onTimeout never
  // throws on null because we guard with `disposed` before invoking.
  let onTimeoutRef: ((event: StuckThinkingTimeoutEvent) => void) | null =
    opts.onTimeout;

  function cancelPendingTimer(): void {
    if (token !== null) {
      clearT(token);
      token = null;
    }
  }

  function scheduleTimer(): void {
    cancelPendingTimer();
    token = setT(() => {
      // Clear the token slot BEFORE invoking onTimeout so a
      // synchronous re-entry (e.g., the orchestrator calls
      // armForTurn from inside its onTimeout handler) does not see a
      // stale token.
      token = null;
      if (disposed) return;
      const cb = onTimeoutRef;
      if (cb === null) return;
      // T-14-20 / T-17-08 mitigation: the log line carries waitedMs
      // ONLY. No transcript content, no API key bytes. The grep
      // guard in the verify command enforces this at the source
      // level.
      log(`[achilles] stuck-thinking timer fired: waitedMs=${timeoutMs}`);
      cb({ waitedMs: timeoutMs });
    }, timeoutMs);
  }

  function armForTurn(): void {
    if (disposed) return;
    scheduleTimer();
  }

  function observeProgress(): void {
    if (disposed) return;
    // Heartbeat: only re-arm if a timer is currently in flight. If no
    // timer is armed (the orchestrator never called armForTurn, or
    // clearForTurn was called first), observeProgress is a no-op.
    // This guards against an orchestrator that emits progress events
    // outside a turn (e.g., a stale event from a cancelled prior turn).
    if (token === null) return;
    scheduleTimer();
  }

  function clearForTurn(): void {
    if (disposed) return;
    cancelPendingTimer();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelPendingTimer();
    // SW6: zero the onTimeout reference so even a non-cooperative
    // host scheduler that fires the captured timer callback AFTER
    // dispose() (because clearT was a no-op or because the host kept
    // the cb in a queue) is a no-op. The scheduled callback above
    // guards on `cb === null` AND `disposed` so both layers of
    // defence apply.
    onTimeoutRef = null;
  }

  return {
    armForTurn,
    observeProgress,
    clearForTurn,
    dispose,
  };
}
