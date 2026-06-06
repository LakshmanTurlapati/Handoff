/**
 * Achilles shared constants — the Wave-1 substrate that Plans 11-02 and
 * 11-03 compose against without inventing parallel literals.
 *
 * Source of truth for:
 *
 *   - Window contract (UI-01)         — 260x260, 24 px default margin,
 *                                       30 px drag handle strip.
 *   - Default hotkey (UI-06)          — CommandOrControl+Shift+A.
 *   - IPC channel names               — every channel is prefixed
 *                                       "achilles:" so a renderer-side
 *                                       grep cannot miss the boundary.
 *   - State / hotkey-mode / permission
 *     `as const` tuples               — used by both the pure state
 *                                       machine reducer and the Zod
 *                                       schemas as the single membership
 *                                       source.
 *
 * No emojis anywhere (CLAUDE.md global). No environment variables read
 * here — store keys live in store.ts; this module is fully static.
 */

// ─────────────────────────────────────────────────────────────────────
// Window + token constants (UI-01 + UI-SPEC s2 Layout Grid)
// ─────────────────────────────────────────────────────────────────────

/**
 * Locked BrowserWindow width per UI-01 + CONTEXT.md. The full UI lays
 * out inside this fixed square; see UI-SPEC.md section 2 for the
 * pixel-exact regions.
 */
export const WINDOW_WIDTH = 260;

/**
 * Locked BrowserWindow height per UI-01 + CONTEXT.md.
 */
export const WINDOW_HEIGHT = 260;

/**
 * Default inset (in pixels) used for the first-launch top-right
 * positioning of the floating window relative to the primary display's
 * `workArea`. UI-SPEC.md section 2 calls this out as the lg spacing
 * token.
 */
export const DEFAULT_MARGIN_PX = 24;

/**
 * Vertical height of the invisible drag handle strip at the top of the
 * window. UI-SPEC.md section 2 marks the 0..30 px band as the
 * `-webkit-app-region: drag` zone.
 */
export const DRAG_HANDLE_HEIGHT_PX = 30;

/**
 * Default Electron accelerator for the global hotkey. UI-06 requires
 * this to be persisted in electron-store under `hotkeyKey` so the user
 * can rebind via the settings popover (Plan 11-03 wires the settings
 * UI; Plan 11-01 ships only the persistence + registration substrate).
 */
export const DEFAULT_HOTKEY_ACCELERATOR = "CommandOrControl+Shift+A";

// ─────────────────────────────────────────────────────────────────────
// IPC channel names
//
// Convention: every channel begins with the `achilles:` prefix so a
// single grep for `achilles:` across the renderer reveals every IPC
// boundary the renderer reaches into. Channel values are kebab-case
// after the prefix to match the wider monorepo convention.
//
// Direction:
//   Main → Renderer: state-changed, transcript-*, *-amplitude,
//                    permission-state, error
//   Renderer → Main: request-state, register-hotkey,
//                    open-system-settings, update-window-position,
//                    update-hotkey-config
// ─────────────────────────────────────────────────────────────────────

export const IPC_STATE_CHANGED = "achilles:state-changed";
export const IPC_TRANSCRIPT_PARTIAL = "achilles:transcript-partial";
export const IPC_TRANSCRIPT_COMMITTED = "achilles:transcript-committed";
export const IPC_MIC_AMPLITUDE = "achilles:mic-amplitude";
export const IPC_TTS_AMPLITUDE = "achilles:tts-amplitude";
export const IPC_PERMISSION_STATE = "achilles:permission-state";
export const IPC_ERROR = "achilles:error";

export const IPC_REQUEST_STATE = "achilles:request-state";
export const IPC_REGISTER_HOTKEY = "achilles:register-hotkey";
export const IPC_OPEN_SYSTEM_SETTINGS = "achilles:open-system-settings";
export const IPC_UPDATE_WINDOW_POSITION = "achilles:update-window-position";
export const IPC_UPDATE_HOTKEY_CONFIG = "achilles:update-hotkey-config";

// ─────────────────────────────────────────────────────────────────────
// `as const` tuples — the single membership source for both the pure
// state machine reducer and the Zod schemas.
//
// AchillesState / HotkeyMode / PermissionState types are derived via
// `(typeof TUPLE)[number]` so adding a new state in the tuple is a
// single edit that propagates to both the reducer's exhaustiveness
// check and the Zod schema's `z.enum(TUPLE)` membership.
// ─────────────────────────────────────────────────────────────────────

export const ACHILLES_STATES = [
  "idle",
  "listening",
  "processing",
  "speaking",
  "error",
] as const;

export type AchillesState = (typeof ACHILLES_STATES)[number];

export const HOTKEY_MODES = ["toggle", "pushToTalk"] as const;

export type HotkeyMode = (typeof HOTKEY_MODES)[number];

export const PERMISSION_STATES = [
  "granted",
  "not-determined",
  "denied",
  "restricted",
] as const;

export type PermissionState = (typeof PERMISSION_STATES)[number];

// ─────────────────────────────────────────────────────────────────────
// Locked timer durations driven by the mocked state controller. These
// values exist in Phase 11 so the e2e tests can drive listening →
// processing → speaking → idle deterministically; Phase 12 replaces the
// timers with real voice-loop transitions but keeps the names stable.
// See UI-SPEC.md section 8 (Error States).
// ─────────────────────────────────────────────────────────────────────

export const LISTENING_VAD_DELAY_MS = 1200;
export const PROCESSING_DELAY_MS = 800;
export const SPEAKING_DELAY_MS = 2000;
export const ERROR_AUTO_DISMISS_MS = 8000;

/**
 * Tick rate for the mocked amplitude stream. UI-SPEC.md section 1
 * calls for RMS sampled at 20 fps (every 50 ms) so the renderer can
 * interpolate to 60 fps without jitter.
 */
export const AMPLITUDE_TICK_MS = 50;
