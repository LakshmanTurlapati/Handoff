/**
 * Plan 14-04 — SAFE-06 suspend / resume handler (PITFALLS #25).
 *
 * Wires Electron's `powerMonitor` events (`suspend`, `resume`,
 * `lock-screen`, `unlock-screen`) to caller-supplied callbacks. The
 * module is pure: no fs, no IPC, no clock side effects. The only
 * external surface is the injected powerMonitorRef (Electron's
 * powerMonitor in production; a hand-rolled tiny EventEmitter fake in
 * tests).
 *
 * Contract (per CONTEXT.md + PITFALLS #25):
 *
 *   onSuspend       — fires BEFORE OS suspend. Production wiring:
 *                     session.onSuspend() — pause mic, cancel bridge,
 *                     close TTS, drive UI back to idle.
 *   onResume        — fires AFTER OS resume. Production wiring:
 *                     session.onResume() — log + UI returns to idle.
 *                     The next hotkey press starts a fresh utterance
 *                     with the next --resume sid.
 *   onLockScreen    — OPTIONAL. The user locked the screen. Production
 *                     v1.2 does not act on this event but we expose the
 *                     seam so a future hardening pass can without
 *                     touching the module surface.
 *   onUnlockScreen  — OPTIONAL. Paired with onLockScreen.
 *
 * Threat model (Plan 14-04):
 *
 *   - T-14-21 accept — the powerMonitor is the Electron-provided
 *                      surface; if an attacker has code execution in
 *                      main they already own the process.
 *
 * The module tracks the {event, listener} pairs it registers so
 * dispose() can call powerMonitorRef.removeListener with the original
 * callback reference. Tests verify this round-trip by emitting on the
 * fake and asserting the listener invocation count drops to zero
 * after dispose.
 *
 * No emojis (CLAUDE.md global). No direct `electron.powerMonitor`
 * access — all reads go through the injected powerMonitorRef seam,
 * verified by the grep guard in 14-04-PLAN.md verify command.
 */

/**
 * Minimal powerMonitor surface the handler depends on. Mirrors a
 * subset of Electron's PowerMonitor; tests inject a hand-rolled fake
 * matching this shape.
 *
 * @public
 */
export interface PowerMonitorLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Construction-time options for the suspend-resume handler.
 *
 * @public
 */
export interface WireSuspendResumeOptions {
  /**
   * The powerMonitor reference. In production: `electron.powerMonitor`.
   * In tests: a hand-rolled tiny EventEmitter fake matching the
   * `PowerMonitorLike` shape.
   */
  powerMonitorRef: PowerMonitorLike;
  /**
   * Required. Fires BEFORE OS suspend. Production wiring routes here
   * to `session.onSuspend()` which pauses mic capture, cancels the in-
   * flight bridge, closes the TTS client, and drives the UI back to
   * idle.
   */
  onSuspend: () => void;
  /**
   * Required. Fires AFTER OS resume. Production wiring routes here to
   * `session.onResume()` which logs that the UI is ready for the next
   * utterance. No state machine transition fires beyond what onSuspend
   * already did.
   */
  onResume: () => void;
  /**
   * Optional. Fires when the user locks the screen. v1.2 does not act
   * on this event; the seam exists so a future hardening pass does
   * not have to widen the module surface.
   */
  onLockScreen?: () => void;
  /**
   * Optional. Paired with `onLockScreen`. v1.2 does not act on this
   * event.
   */
  onUnlockScreen?: () => void;
  /**
   * Optional logger sink. Defaults to console.error with the
   * `[achilles]` prefix. Emits one line per powerMonitor event so
   * post-mortem debugging can correlate UI behaviour with OS power
   * transitions.
   */
  logger?: (msg: string) => void;
}

/**
 * Public handle returned by `wireSuspendResume`. The only public
 * method is `dispose()`, which removes all registered listeners.
 *
 * @public
 */
export interface SuspendResumeHandle {
  /**
   * Remove every listener registered by `wireSuspendResume`. Idempotent
   * — calling dispose twice does not throw and leaves the
   * powerMonitorRef in a fully unregistered state.
   */
  dispose(): void;
}

/**
 * The four powerMonitor events the handler subscribes to in
 * lock-screen / unlock-screen presence order. Keeping the names as a
 * `readonly` tuple lets the dispose loop iterate uniformly without
 * branching on which callback was supplied.
 */
const POWER_EVENTS = [
  "suspend",
  "resume",
  "lock-screen",
  "unlock-screen",
] as const;
type PowerEvent = (typeof POWER_EVENTS)[number];

/**
 * Wire the powerMonitor events to the supplied callbacks. Returns a
 * dispose handle that removes every registered listener.
 *
 * @public
 */
export function wireSuspendResume(
  opts: WireSuspendResumeOptions,
): SuspendResumeHandle {
  const log =
    opts.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.error(msg);
    });

  // Track the {event, listener} pairs we register so dispose() can
  // call powerMonitorRef.removeListener with the original callback
  // reference. The Map iteration order is the registration order
  // (POWER_EVENTS) so dispose tears down deterministically.
  const registered = new Map<PowerEvent, (...args: unknown[]) => void>();

  /**
   * Wrap each caller-supplied callback in a tiny adapter that emits
   * the [achilles] log line BEFORE invoking the callback. Logging
   * first means a misbehaving callback that throws still leaves a
   * trace in the log for post-mortem; the wrapper does NOT swallow
   * the throw because the handler is meant to surface power-event
   * misbehaviour, not paper over it.
   */
  function makeWrapper(
    event: PowerEvent,
    cb: () => void,
  ): (...args: unknown[]) => void {
    return (..._args: unknown[]): void => {
      log(`[achilles] powerMonitor event: ${event}`);
      cb();
    };
  }

  // suspend + resume are required; register unconditionally.
  const suspendWrapper = makeWrapper("suspend", opts.onSuspend);
  opts.powerMonitorRef.on("suspend", suspendWrapper);
  registered.set("suspend", suspendWrapper);

  const resumeWrapper = makeWrapper("resume", opts.onResume);
  opts.powerMonitorRef.on("resume", resumeWrapper);
  registered.set("resume", resumeWrapper);

  // lock-screen + unlock-screen are optional. We only register
  // listeners when the caller supplied the callback (SR2 invariant).
  if (opts.onLockScreen !== undefined) {
    const wrapper = makeWrapper("lock-screen", opts.onLockScreen);
    opts.powerMonitorRef.on("lock-screen", wrapper);
    registered.set("lock-screen", wrapper);
  }
  if (opts.onUnlockScreen !== undefined) {
    const wrapper = makeWrapper("unlock-screen", opts.onUnlockScreen);
    opts.powerMonitorRef.on("unlock-screen", wrapper);
    registered.set("unlock-screen", wrapper);
  }

  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const [event, wrapper] of registered.entries()) {
      opts.powerMonitorRef.removeListener(event, wrapper);
    }
    registered.clear();
  }

  return { dispose };
}
