/**
 * v1.3 state-machine substrate constants.
 *
 * Subset of v1.2 apps/achilles/src/shared/constants.ts — only the
 * symbols the new terminal architecture consumes are ported. The
 * Electron-only constants (window dimensions, inter-process channel
 * names, init-wizard channels, default hotkey accelerator, error copy
 * map) are intentionally left behind because the v1.3 architecture
 * has no renderer process, no inter-process bridge, and a different
 * onboarding model (Phase 18 owns config + wizard).
 *
 * SPEAKING_DEBOUNCE_MS is surfaced here from its v1.2 home at
 * apps/achilles/src/main/session.ts:112 so Phase 17's session.ts
 * port has a canonical import site for the half-duplex tail
 * constant.
 *
 * This file is self-contained — no imports. The v1.2 constants.ts
 * file at apps/achilles/src/shared/constants.ts is NOT modified by
 * this port (LOOP-02 invariant).
 *
 * No emojis (CLAUDE.md global).
 */

// ---------------------------------------------------------------------
// 6-state tuple — Option A from 16-RESEARCH.md Open Question #1
//
// The 6th state `muted` is a substate of idle: VAD is gated off but the
// sox child stays running so unmute is instant per CONTEXT.md
// <decisions> Mute control row. The state machine reducer holds the
// muted substate (CONTEXT.md <domain> row "state machine transitions
// to muted substate"), not an orchestrator-level boolean flag.
//
// Order is LOCKED: idle / listening / processing / speaking / error /
// muted. AchillesState is derived via `(typeof TUPLE)[number]` so adding
// a new state in the tuple propagates to the reducer's exhaustiveness
// check in a single edit.
// ---------------------------------------------------------------------

/**
 * Locked 6-state tuple.
 *
 * idle       — rest state; mic input is being captured but VAD is below threshold.
 * listening  — VAD energy crossed threshold; sox frames are flowing to STT.
 * processing — STT committed an utterance; claude -p is running.
 * speaking   — claude returned; TTS playback is active (ffplay sink draining).
 * error      — surfaceable failure (mic_unavailable / hotkey_collision / persistence / unknown).
 * muted      — VAD gate is off, sox still running so unmute is instant (CONTEXT.md Mute control row).
 */
export const ACHILLES_STATES = [
  "idle",
  "listening",
  "processing",
  "speaking",
  "error",
  "muted",
] as const;

export type AchillesState = (typeof ACHILLES_STATES)[number];

// ---------------------------------------------------------------------
// HotkeyMode tuple
//
// v1.3 does NOT use a hotkey (CAP-02 — PTT/toggle hotkey removed per
// CONTEXT.md), but the pure reducer still carries the HotkeyMode
// parameter to preserve the v1.2 transition() function signature
// byte-for-byte. Production callers in v1.3 always pass "toggle". The
// pushToTalk branch in the reducer is unreachable at runtime in v1.3
// but kept so the port is verbatim and so any v1.2 fixture can be
// replayed unchanged for regression coverage.
// ---------------------------------------------------------------------

export const HOTKEY_MODES = ["toggle", "pushToTalk"] as const;

export type HotkeyMode = (typeof HOTKEY_MODES)[number];

// ---------------------------------------------------------------------
// PermissionState tuple
//
// v1.3 reads OS mic permission via the sox EPERM path (PITFALLS.md
// section 3 — macOS TCC). Phase 18 owns the init wizard prompt; Phase
// 16 only emits a remediation hint to stderr at sox-spawn time when
// EPERM surfaces. The type is exported here so the existing
// PERMISSION_CHANGED event tag in state-machine.ts compiles unchanged
// from the v1.2 port.
// ---------------------------------------------------------------------

export const PERMISSION_STATES = [
  "granted",
  "not-determined",
  "denied",
  "restricted",
] as const;

export type PermissionState = (typeof PERMISSION_STATES)[number];

// ---------------------------------------------------------------------
// Timing constants (verbatim port from v1.2 shared/constants.ts)
//
// These drive createMockStateController's deterministic fixture
// timeline — the four states (listening, processing, speaking, error)
// each schedule the next transition after the corresponding delay so
// the v1.2 Playwright suite and the v1.3 state-machine vitest tests
// can drive listening to idle without launching a real voice loop.
//
// Plan 04's mock-amplitude generator is a separate concern from these
// timers (per 16-RESEARCH.md Open Question #2): these constants stay
// for createMockStateController back-compat; the mock-amplitude
// generator at Plan 04 ships its own generator. Both can coexist.
// ---------------------------------------------------------------------

/**
 * Delay before createMockStateController auto-advances listening to
 * processing via a MOCK_VAD_COMMIT dispatch. Mirrors v1.2 value.
 */
export const LISTENING_VAD_DELAY_MS = 1200;

/**
 * Delay before createMockStateController auto-advances processing to
 * speaking via a MOCK_PROCESSING_COMPLETE dispatch. Mirrors v1.2 value.
 */
export const PROCESSING_DELAY_MS = 800;

/**
 * Delay before createMockStateController auto-advances speaking to idle
 * via a MOCK_PLAYBACK_DONE dispatch. Mirrors v1.2 value.
 */
export const SPEAKING_DELAY_MS = 2000;

/**
 * Delay before createMockStateController auto-dismisses the error
 * state via an ERROR_DISMISS dispatch. Mirrors v1.2 value.
 */
export const ERROR_AUTO_DISMISS_MS = 8000;

// ---------------------------------------------------------------------
// SPEAKING_DEBOUNCE_MS — half-duplex tail constant
//
// Surfaced from v1.2 apps/achilles/src/main/session.ts:112. The v1.2
// site stays untouched (LOOP-02 — Phase 16 must not modify
// apps/achilles/), and Phase 17's session.ts port will import from
// this new canonical site instead of re-deriving the value.
//
// Behavior: when TTS playback drains, the orchestrator waits
// SPEAKING_DEBOUNCE_MS before transitioning back to listening (or to
// idle, depending on VAD arm state). This 300 ms tail prevents the
// speaking-then-immediately-pickup-trail loop where the very tail of
// TTS reverberation in the room would otherwise re-trigger VAD.
// ---------------------------------------------------------------------

export const SPEAKING_DEBOUNCE_MS = 300;
