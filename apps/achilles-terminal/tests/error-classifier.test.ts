/**
 * Phase 19, Plan 02, Task 1 — error-classifier mapping tests.
 *
 * Asserts the pure `classifyForBanner` transform returns the locked
 * ClassifiedBanner shape for every SessionErrorClassification union
 * member (8 total). The 8 entries are sourced verbatim from
 * 19-RESEARCH.md §Code Example 3 lines 715-748:
 *
 *   network         -> network    / "retrying..."
 *   auth            -> auth       / "check ELEVENLABS_API_KEY"
 *   rate_limit      -> rate-limit / "ElevenLabs rate limit -- retrying in 30s"
 *   server          -> server     / "ElevenLabs 5xx -- retrying with backoff"
 *   mic_unavailable -> sox        / "Audio device lost -- restart Achilles"
 *   playback_lost   -> ffplay     / "Audio output lost -- restart Achilles"
 *   claude_failed   -> claude     / "claude subprocess failed -- Ctrl-C and retry"
 *   unknown         -> unknown    / "see ~/.achilles/achilles.log"
 *
 * The ASCII double-hyphen "--" is intentional and matches the locked
 * AUDIO_DEVICE_LOST_MESSAGE shape elsewhere in the codebase. The
 * em-dash U+2014 is documented as "not an emoji" in
 * child-exit-watchdog.ts header; both forms are valid ASCII
 * substitutes per CLAUDE.md global no-emojis rule.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";

import {
  classifyForBanner,
  type ClassifiedBanner,
} from "../src/error-classifier.js";
import type { SessionErrorClassification } from "../src/session-events.js";

describe("classifyForBanner — 8-classification mapping table", () => {
  it("network -> network / retrying...", () => {
    const result: ClassifiedBanner = classifyForBanner("network");
    expect(result.class).toBe("network");
    expect(result.suggestedAction).toBe("retrying...");
  });

  it("auth -> auth / check ELEVENLABS_API_KEY", () => {
    const result = classifyForBanner("auth");
    expect(result.class).toBe("auth");
    expect(result.suggestedAction).toBe("check ELEVENLABS_API_KEY");
  });

  it("rate_limit -> rate-limit / ElevenLabs rate limit -- retrying in 30s", () => {
    const result = classifyForBanner("rate_limit");
    expect(result.class).toBe("rate-limit");
    expect(result.suggestedAction).toBe(
      "ElevenLabs rate limit -- retrying in 30s",
    );
  });

  it("server -> server / ElevenLabs 5xx -- retrying with backoff", () => {
    const result = classifyForBanner("server");
    expect(result.class).toBe("server");
    expect(result.suggestedAction).toBe(
      "ElevenLabs 5xx -- retrying with backoff",
    );
  });

  it("mic_unavailable -> sox / Audio device lost -- restart Achilles", () => {
    const result = classifyForBanner("mic_unavailable");
    expect(result.class).toBe("sox");
    expect(result.suggestedAction).toBe("Audio device lost -- restart Achilles");
  });

  it("playback_lost -> ffplay / Audio output lost -- restart Achilles", () => {
    const result = classifyForBanner("playback_lost");
    expect(result.class).toBe("ffplay");
    expect(result.suggestedAction).toBe(
      "Audio output lost -- restart Achilles",
    );
  });

  it("claude_failed -> claude / claude subprocess failed -- Ctrl-C and retry", () => {
    const result = classifyForBanner("claude_failed");
    expect(result.class).toBe("claude");
    expect(result.suggestedAction).toBe(
      "claude subprocess failed -- Ctrl-C and retry",
    );
  });

  it("unknown -> unknown / see ~/.achilles/achilles.log", () => {
    const result = classifyForBanner("unknown");
    expect(result.class).toBe("unknown");
    expect(result.suggestedAction).toBe("see ~/.achilles/achilles.log");
  });

  it("every SessionErrorClassification union member resolves to a non-empty ClassifiedBanner", () => {
    const all: SessionErrorClassification[] = [
      "network",
      "auth",
      "rate_limit",
      "server",
      "unknown",
      "mic_unavailable",
      "playback_lost",
      "claude_failed",
    ];
    for (const c of all) {
      const result = classifyForBanner(c);
      expect(result.class.length).toBeGreaterThan(0);
      expect(result.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it("the returned ClassifiedBanner has readonly class + suggestedAction string fields", () => {
    const result = classifyForBanner("network");
    // Type-level readonly is asserted at compile time; here we assert the
    // structural shape (two string-valued keys present).
    expect(typeof result.class).toBe("string");
    expect(typeof result.suggestedAction).toBe("string");
  });

  it("output strings contain zero Extended_Pictographic codepoints (CLAUDE.md no-emoji invariant)", () => {
    const all: SessionErrorClassification[] = [
      "network",
      "auth",
      "rate_limit",
      "server",
      "unknown",
      "mic_unavailable",
      "playback_lost",
      "claude_failed",
    ];
    for (const c of all) {
      const result = classifyForBanner(c);
      expect(/\p{Extended_Pictographic}/u.test(result.class)).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(result.suggestedAction)).toBe(
        false,
      );
    }
  });
});
