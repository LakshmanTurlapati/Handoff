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
// Phase 12 IPC channels
//
// Six new channels added by Plan 12-03 to support the renderer audio
// infrastructure (mic frame forward, TTS chunk fan-out, playback
// completion signal) and the STT auth surface (renderer-side token
// request / mint round-trip). Plan 12-04 will consume these in the
// orchestrator wiring.
//
// Direction:
//   Renderer → Main: utterance-commit, mic-frame, stt-token-request
//   Main → Renderer: tts-chunk, stt-token
//   Renderer → Main: tts-playback-complete
//
// Naming follows the established `achilles:` kebab-case convention.
// ─────────────────────────────────────────────────────────────────────

export const IPC_TTS_CHUNK = "achilles:tts-chunk";
export const IPC_TTS_PLAYBACK_COMPLETE = "achilles:tts-playback-complete";
export const IPC_UTTERANCE_COMMIT = "achilles:utterance-commit";
export const IPC_MIC_FRAME = "achilles:mic-frame";
export const IPC_STT_TOKEN_REQUEST = "achilles:stt-token-request";
export const IPC_STT_TOKEN = "achilles:stt-token";

/**
 * Locked v1.2 default ElevenLabs voice id. Honoured when
 * `process.env.ELEVENLABS_VOICE_ID` is unset (per REQUIREMENTS.md
 * locked decisions — "One fixed default voice (env var override
 * allowed)"). The string `21m00Tcm4TlvDq8ikWAM` is the public
 * ElevenLabs voice id for "Rachel", documented as the demo voice on
 * the Flash v2.5 model card.
 */
export const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

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

// ─────────────────────────────────────────────────────────────────────
// CR-02 fix: error-kind to UI-SPEC §8 banner copy map.
//
// The four error kinds used by the state machine and the renderer's
// ErrorBanner share a single source of truth for the surfaced message.
// `ipc-bridge.ts` resolves the copy via this map when the renderer's
// __test_inject_error or any internal INJECT_ERROR dispatch fires, so
// the renderer's ErrorBanner receives `error.message` populated
// alongside the `state-changed: error` broadcast.
// ─────────────────────────────────────────────────────────────────────

export type AchillesErrorKind =
  | "mic_unavailable"
  | "hotkey_collision"
  | "persistence_failure"
  | "unknown";

export const ERROR_COPY: Record<AchillesErrorKind, string> = {
  mic_unavailable:
    "Microphone not available. Check your input device.",
  hotkey_collision:
    "Hotkey is in use by another app. Change it in Settings.",
  persistence_failure:
    "Could not save window position. Settings may not persist.",
  unknown: "Something went wrong. Try again in a moment.",
};

/**
 * Tick rate for the mocked amplitude stream. UI-SPEC.md section 1
 * calls for RMS sampled at 20 fps (every 50 ms) so the renderer can
 * interpolate to 60 fps without jitter.
 */
export const AMPLITUDE_TICK_MS = 50;

// ─────────────────────────────────────────────────────────────────────
// Init wizard (DIST-04)
//
// Plan 13-03 ships the first-run wizard surface. The CLI's `achilles
// init` command spawns the Electron binary with ACHILLES_MODE=init in
// the env; main/index.ts routes on the literal `ACHILLES_MODE_INIT`
// constant to instantiate the InitWizard window instead of the floating
// shell. The eight IPC channel constants follow the established
// `achilles:` prefix convention; the validation + canned-phrase +
// timeout constants are referenced by both the main-side session
// orchestrator (init-wizard.ts) and the renderer-side InitWizard.tsx
// component so a change is a single-edit propagation.
// ─────────────────────────────────────────────────────────────────────

/**
 * Locked value of the `ACHILLES_MODE` env var that routes
 * main/index.ts's bootstrap to the InitWizard window. Read by the CLI
 * (apps/achilles-cli/src/commands/init.ts) when composing the child
 * env, and by the Electron main process when branching the bootstrap.
 */
export const ACHILLES_MODE_INIT = "init";

/**
 * Main → Renderer. Broadcasts the current init-wizard step lifecycle
 * (which step is in-progress + its sub-state). Carries the discriminated
 * step name and a state ∈ {pending, in-progress, success, error}.
 */
export const IPC_INIT_WIZARD_STEP = "achilles:init-wizard-step";

/**
 * Renderer → Main. Carries the user-typed ElevenLabs API key from
 * Step 1 of the wizard. The payload's key field never round-trips
 * back through the API key result channel (T-13-13 mitigation).
 */
export const IPC_INIT_API_KEY_SUBMIT = "achilles:init-api-key-submit";

/**
 * Main → Renderer. Acknowledges the API key submission with the
 * shape `{ accepted: boolean; reason?: string; warning?: string }`.
 * Crucially does NOT echo the submitted key bytes.
 */
export const IPC_INIT_API_KEY_RESULT = "achilles:init-api-key-result";

/**
 * Renderer → Main. Empty signal — the user clicked the "Request
 * microphone access" button in Step 2. Main responds by invoking
 * the Plan 11-03 probePermission helper inside the Electron host
 * (Pitfall #3 mitigation: the prompt is attributed to Achilles, not
 * to the launching terminal).
 */
export const IPC_INIT_MIC_PERMISSION_REQUEST =
  "achilles:init-mic-permission-request";

/**
 * Main → Renderer. Carries the resolved PermissionState from the
 * probePermission call. The renderer surfaces remediation copy on
 * 'denied' and advances on 'granted'.
 */
export const IPC_INIT_MIC_PERMISSION_RESULT =
  "achilles:init-mic-permission-result";

/**
 * Renderer → Main. Empty signal — the user clicked "Start smoke
 * test" in Step 3. Main runs the smoke round-trip (mocked when
 * MOCK_LOOP=1, real ElevenLabs/Claude otherwise).
 */
export const IPC_INIT_SMOKE_START = "achilles:init-smoke-start";

/**
 * Main → Renderer. Carries the smoke-test outcome. Status is one of
 * 'ok' | 'timed-out' | 'error'; on 'ok' the spokenPhrase field carries
 * the locked SMOKE_TEST_CANNED_PHRASE the user just heard.
 */
export const IPC_INIT_SMOKE_RESULT = "achilles:init-smoke-result";

/**
 * Renderer → Main. Empty signal — the user clicked "Exit wizard".
 * Main responds by calling app.quit() with exit code 0.
 */
export const IPC_INIT_WIZARD_DONE = "achilles:init-wizard-done";

/**
 * Minimum acceptable length for an ElevenLabs API key per the Phase 09
 * MIN_KEY_LENGTH contract referenced from CONTEXT.md. The wizard's
 * Step 1 validates against this before persisting.
 */
export const MIN_ELEVENLABS_KEY_LENGTH = 32;

/**
 * Informational prefix for an ElevenLabs API key — keys lacking this
 * prefix are STILL accepted (the validation is non-blocking), but the
 * wizard surfaces a warning banner so the user can sanity-check that
 * they pasted the right value.
 */
export const ELEVENLABS_KEY_PREFIX = "sk_";

/**
 * Locked canned phrase the smoke round-trip plays back. The phrase is
 * mirrored in the Claude system prompt so the LLM's <spoken-summary>
 * body matches the user's expectation; a drift between the constant
 * and the prompt would show up as the smoke test "succeeding" with a
 * different sentence.
 */
export const SMOKE_TEST_CANNED_PHRASE =
  "Hello from Achilles, I am ready to help.";

/**
 * Locked Step 3 budget. The wizard races the createSmokeRoundTrip
 * promise against this timer; on timeout the renderer offers a "Skip"
 * exit path so the wizard never blocks the user indefinitely.
 */
export const SMOKE_TEST_TIMEOUT_MS = 60000;

// ─────────────────────────────────────────────────────────────────────
// Phase 14-02 — Transcript persistence (SAFE-02)
//
// One Main → Renderer broadcast channel signals whether transcript
// persistence is currently active. The renderer subscribes once at App
// composition root mount; when the boolean flips to true, the
// RecordingIndicator (pulsing red dot + label) mounts in the floating
// shell so the user cannot forget that their utterances are being
// written to disk. When the boolean is false, the indicator is absent
// (renders null).
//
// Production wiring: main/index.ts reads
// `process.env.ACHILLES_SAVE_TRANSCRIPTS === "1"` at bootstrap and
// broadcasts the resolved boolean on the BrowserWindow's
// did-finish-load handler. The CLI's `--save-transcripts` flag sets
// the env var via the launch overrides.
// ─────────────────────────────────────────────────────────────────────

/**
 * Main → Renderer. Broadcasts the current SAFE-02 transcript
 * persistence flag. Payload shape: `{ enabled: boolean }`.
 *
 * When `enabled === true`, the floating UI renders the locked
 * 'Recording transcripts' affordance (a pulsing red dot + label) per
 * the SAFE-02 visibility invariant. When `enabled === false`, no
 * indicator is shown.
 */
export const IPC_TRANSCRIPT_PERSISTENCE_STATE =
  "achilles:transcript-persistence-state";

// ─────────────────────────────────────────────────────────────────────
// Phase 14-03 — Incident detection (SAFE-05)
//
// Four IPC channels paired with the SAFE-05 graceful-degradation
// substrate. The two STT / TTS failure broadcasts carry the
// classified failure kind so the renderer can surface the right
// affordance (TypedFallback overlay for STT, visible-text routing
// for TTS). The status broadcast composes the two circuit-breaker
// states into a single health snapshot so the renderer's
// IncidentStatus dot reflects current voice-service health. The
// typed-fallback-submit channel is the renderer's only path for
// continuing the conversation when STT is down — the typed text
// flows through session.handleTypedPrompt(text) and re-uses the
// existing sandwich-defence + bridge.send pipeline.
//
// Direction:
//   Main → Renderer: incident-stt-fail, incident-tts-fail,
//                    incident-status
//   Renderer → Main: typed-fallback-submit
// ─────────────────────────────────────────────────────────────────────

/**
 * Main → Renderer. Broadcasts when the STT circuit-breaker opens.
 * Payload shape:
 *
 *   { kind: 'auth'|'rate_limit'|'server'|'network'|'unknown',
 *     attemptCount: number }
 *
 * The renderer's App.tsx subscribes once at composition root mount;
 * when the channel fires, the App sets `typedFallbackActive=true`
 * which mounts the TypedFallback overlay. The user types a prompt,
 * presses Enter, and the renderer forwards the text via
 * IPC_TYPED_FALLBACK_SUBMIT. The orchestrator returns to voice
 * mode after the typed prompt completes (the next hotkey press
 * re-attempts STT through the half-open probe path).
 */
export const IPC_INCIDENT_STT_FAIL = "achilles:incident-stt-fail";

/**
 * Main → Renderer. Broadcasts when the TTS circuit-breaker opens.
 * Payload shape:
 *
 *   { kind: 'auth'|'rate_limit'|'server'|'network'|'unknown',
 *     summaryText: string,
 *     attemptCount: number }
 *
 * `summaryText` is the spoken summary the user did NOT hear — the
 * renderer surfaces it visibly in TranscriptOverlay AND the main
 * process prints it to the launching terminal's stderr (handled in
 * index.ts via the sendIpc tap). Both surfaces ensure the
 * completion summary is not lost even when ElevenLabs TTS is down.
 */
export const IPC_INCIDENT_TTS_FAIL = "achilles:incident-tts-fail";

/**
 * Main → Renderer. Broadcasts whenever the composed STT + TTS
 * circuit health changes. Payload shape:
 *
 *   { sttHealth: 'ok'|'degraded'|'failed',
 *     ttsHealth: 'ok'|'degraded'|'failed' }
 *
 * The renderer's App.tsx subscribes once at composition root mount
 * and forwards the latest snapshot to the IncidentStatus dot. The
 * dot renders green when both surfaces are 'ok', yellow when one
 * is degraded (or one failed with the other ok), and red when
 * both have failed (or any failed with the other degraded). The
 * truth source is the main-side circuit-breaker state; the dot is
 * informational.
 */
export const IPC_INCIDENT_STATUS = "achilles:incident-status";

/**
 * Renderer → Main. Carries the user-typed fallback prompt when
 * STT is unavailable. Payload shape:
 *
 *   { text: string }   // min length 1
 *
 * Main routes the payload through session.handleTypedPrompt(text)
 * which applies detectManipulationTokens + wrapTranscript
 * IDENTICALLY to a spoken utterance — no separate code path. The
 * sandwich-defence + bridge.send pipeline is reused so the typed
 * prompt is indistinguishable to the LLM from a voice utterance.
 */
export const IPC_TYPED_FALLBACK_SUBMIT = "achilles:typed-fallback-submit";

// ─────────────────────────────────────────────────────────────────────
// Phase 14-04 — SAFE-06 stuck-thinking watchdog announcement
//
// One Main → Renderer broadcast channel signals that the stuck-thinking
// watchdog timer has fired because Claude has emitted no progress
// events (assistant_text_delta / tool_use / tool_result) for the
// configured timeout window (default 60 s). The orchestrator also
// audibly announces the stall via the existing TTS stream so the user
// hears "Claude is still working — I'll let you know when it's done."
// The renderer's TranscriptOverlay subscribes to this channel and
// surfaces the same text visibly so a user with TTS disabled (or a
// failed TTS surface) still sees the affordance.
//
// Direction:
//   Main → Renderer: stuck-thinking-announce
// ─────────────────────────────────────────────────────────────────────

/**
 * Main → Renderer. Broadcasts the locked STUCK_THINKING_ANNOUNCEMENT
 * text + the elapsed waitedMs window when the watchdog timer fires.
 * Payload shape:
 *
 *   { text: string, waitedMs: number }
 *
 * `text` is always the locked STUCK_THINKING_ANNOUNCEMENT constant
 * from stuck-thinking-watchdog.ts — never a user transcript fragment.
 * `waitedMs` is the configured timeout (default 60_000). The
 * renderer surfaces the text in TranscriptOverlay as a passive
 * affordance; the user can still cancel via the existing hotkey or
 * onCancel path. SAFE-06 invariant.
 */
export const IPC_STUCK_THINKING_ANNOUNCE = "achilles:stuck-thinking-announce";

/**
 * Renderer → Main. CR-02 fix: end-to-end wiring for SAFE-06 device
 * change. The renderer's mic-capture module subscribes to
 * `navigator.mediaDevices.ondevicechange` and forwards the event over
 * this channel. The main-process ipc-bridge handler routes it into
 * `session.onDeviceChange(payload)` which triggers the soft re-acquire
 * (pauseFrameDelivery + setTimeout(resumeFrameDelivery, 0)) when the
 * orchestrator is mid-listening. Without this channel the renderer's
 * onDeviceChange callback had no path into main and the SAFE-06
 * "USB/Bluetooth device change without restart" requirement was not
 * satisfied by the shipped binary.
 *
 * Payload shape:
 *
 *   { kind: 'device-switch' | 'hfp-downgrade', deviceId?: string }
 *
 * `deviceId` is the optional device label the renderer reports; the
 * renderer omits it when the OS does not surface one. The main-side
 * handler treats both 'device-switch' and 'hfp-downgrade' uniformly
 * (the latter is informational — log a warning but the response is
 * a soft re-acquire identical to 'device-switch').
 */
export const IPC_DEVICE_CHANGE = "achilles:device-change";
