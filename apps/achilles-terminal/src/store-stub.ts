/**
 * Settings loader stub (Phase 16, Plan 04, Task 1).
 *
 * Phase 16 stub — Phase 18 ships the real `~/.achilles/settings.json` reader
 * per CONTEXT.md `<decisions>` row:
 *
 *   "All four overridable via settings.json — Phase 18 owns the settings
 *    store; Phase 16 reads via a stub"
 *
 * The four VAD threshold knobs (voice_threshold, silence_threshold,
 * voice_hold_ms, silence_hold_ms) become user-overridable in Phase 18; Phase
 * 16 returns DEFAULT_VAD_CONFIG unconditionally.
 *
 * Each call returns a fresh structuredClone so callers that mutate the
 * returned object cannot leak that mutation to the next caller — important
 * for tests that override one knob without affecting the next test fixture.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge /
 * achilles-skill. Only the local VadConfig + DEFAULT_VAD_CONFIG from Plan 01.
 *
 * No emojis (CLAUDE.md global).
 */
import { DEFAULT_VAD_CONFIG, type VadConfig } from "./audio/vad-energy.js";

/**
 * Phase 16 settings shape — Phase 18 will expand with API-key pointer,
 * voice ID, and the four user-overridable VAD knobs.
 */
export interface AchillesSettings {
  vad: VadConfig;
}

/**
 * Phase 16 stub: always returns defaults — a fresh structuredClone so
 * mutation by one caller does not affect the next caller's snapshot.
 *
 * Phase 18 ships the real loader that reads ~/.achilles/settings.json
 * and overrides the four VAD knobs with user-set values.
 */
export function loadSettings(): AchillesSettings {
  return {
    vad: structuredClone(DEFAULT_VAD_CONFIG) as VadConfig,
  };
}
