/**
 * Phase 19, Plan 02, Task 1 — ERR-01 error-classifier mapping module.
 *
 * Pure transform from `SessionErrorClassification` (Phase 17 substrate
 * at session-events.ts lines 44-52, the SOURCE-OF-TRUTH union) to a
 * presentation-tier ClassifiedBanner payload. The Banner component
 * (apps/achilles-terminal/src/ui/Banner.tsx) consumes the result;
 * useErrorBanner in useAchillesState.ts wires the session event
 * stream through this classifier.
 *
 * Design:
 *
 *   - Pure function, no side effects, no clock, no fs, no logger.
 *   - The mapping is a `Record<SessionErrorClassification,
 *     ClassifiedBanner>` so TypeScript's exhaustiveness checker
 *     forces every union member to have an entry at compile time.
 *   - The strings are LOCKED to 19-RESEARCH.md Section Code Example 3
 *     lines 715-748. Wording changes belong in a new phase.
 *
 * What this is:
 *
 *   - The single mapping site between the typed error union and the
 *     user-visible banner copy. Plan 19-02 introduces this; future
 *     phases extend the union AND add entries here in lockstep.
 *
 * What this isn't:
 *
 *   - NOT a Banner component (rendering lives in ./ui/Banner.tsx).
 *   - NOT a session subscriber (subscription lives in
 *     ./ui/useAchillesState.ts via useErrorBanner).
 *   - NOT a structured-logger adapter (the structured logger receives
 *     raw error events; this classifier owns the UI presentation
 *     copy only).
 *
 * Threat model:
 *
 *   - T-19-10 (Information Disclosure): the raw exception text never
 *     reaches the banner. Every UI render path goes through this table,
 *     so a stray secret in a fetch() rejection message stays in
 *     ~/.achilles/achilles.log (where DEFAULT_REDACT_PATTERNS redacts
 *     it) and the banner shows only the canned suggestedAction string.
 *
 * No emojis (CLAUDE.md global). The double-hyphen "--" is intentional
 * ASCII and matches the AUDIO_DEVICE_LOST_MESSAGE shape elsewhere in
 * the codebase; the em-dash U+2014 used in child-exit-watchdog.ts is
 * documented as "not an emoji" in that file's header.
 */

import type { SessionErrorClassification } from "./session-events.js";

/**
 * Presentation-tier payload consumed by the Banner component.
 *
 * @public
 */
export interface ClassifiedBanner {
  /**
   * Short user-visible class tag rendered as the prefix of the banner
   * line (e.g. "sox", "ffplay", "network"). NOT the union member name
   * — the rate_limit union member maps to "rate-limit" (with hyphen).
   */
  readonly class: string;
  /**
   * Single-line remediation copy rendered after the "--" separator.
   * MUST NOT contain emojis (CLAUDE.md global). MUST NOT contain
   * secrets or stack traces (T-19-10 mitigation).
   */
  readonly suggestedAction: string;
}

/**
 * Locked mapping table from SessionErrorClassification -> ClassifiedBanner.
 *
 * The 8 entries are sourced verbatim from 19-RESEARCH.md Section
 * Code Example 3 lines 715-748. Every SessionErrorClassification union
 * member appears here; TypeScript's exhaustiveness checker enforces
 * this at compile time.
 */
const TABLE: Record<SessionErrorClassification, ClassifiedBanner> = {
  network: {
    class: "network",
    suggestedAction: "retrying...",
  },
  auth: {
    class: "auth",
    suggestedAction: "check ELEVENLABS_API_KEY",
  },
  rate_limit: {
    class: "rate-limit",
    suggestedAction: "ElevenLabs rate limit -- retrying in 30s",
  },
  server: {
    class: "server",
    suggestedAction: "ElevenLabs 5xx -- retrying with backoff",
  },
  mic_unavailable: {
    class: "sox",
    suggestedAction: "Audio device lost -- restart Achilles",
  },
  playback_lost: {
    class: "ffplay",
    suggestedAction: "Audio output lost -- restart Achilles",
  },
  claude_failed: {
    class: "claude",
    suggestedAction: "claude subprocess failed -- Ctrl-C and retry",
  },
  unknown: {
    class: "unknown",
    suggestedAction: "see ~/.achilles/achilles.log",
  },
};

/**
 * Map a SessionErrorClassification to its ClassifiedBanner payload.
 *
 * @public
 */
export function classifyForBanner(
  classification: SessionErrorClassification,
): ClassifiedBanner {
  return TABLE[classification];
}
