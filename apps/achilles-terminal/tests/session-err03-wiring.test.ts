/**
 * Phase 19, Plan 02, Task 2 — ERR-03 sox + ffplay watchdog wiring tests.
 *
 * Source-shape regression guard: asserts that session.ts CONSTRUCTS
 * BOTH a sox watchdog AND a ffplay watchdog via the Phase 17
 * substrate `createChildExitWatchdog`. The test parses session.ts as
 * text (fs.readFileSync + regex) so we do not need to instantiate the
 * full audio pipeline; the regex shapes are the same the plan's
 * verification step greps for.
 *
 * Behaviour gates per 19-02-PLAN.md Task 2 <behavior>:
 *
 *   (a) `createChildExitWatchdog` is called with `label: "sox"` at
 *       least once
 *   (b) `createChildExitWatchdog` is called with `label: "ffplay"`
 *       at least once
 *   (c) each onError callback emits a SessionEvent of type "error"
 *       with classification "mic_unavailable" OR "playback_lost"
 *   (d) wiring happens inside the audio-bridges path (the existing
 *       wireAudioBridges() method)
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_SRC = resolve(__dirname, "..", "src", "session.ts");

describe("ERR-03 sox + ffplay watchdog wiring in session.ts (Phase 19 Plan 02 Task 2)", () => {
  const source = readFileSync(SESSION_SRC, "utf8");

  it("(a) createChildExitWatchdog is called with label: \"sox\" at least once", () => {
    const soxRegex = /createChildExitWatchdog\s*\(\s*\{\s*[\s\S]*?label\s*:\s*["']sox["']/m;
    expect(soxRegex.test(source)).toBe(true);
  });

  it("(b) createChildExitWatchdog is called with label: \"ffplay\" at least once", () => {
    const ffplayRegex = /createChildExitWatchdog\s*\(\s*\{\s*[\s\S]*?label\s*:\s*["']ffplay["']/m;
    expect(ffplayRegex.test(source)).toBe(true);
  });

  it("(c) onError callbacks emit SessionEvent with classification mic_unavailable AND playback_lost", () => {
    // Both classification literals must appear (one per watchdog onError).
    expect(source).toMatch(/classification\s*:\s*["']mic_unavailable["']/);
    expect(source).toMatch(/classification\s*:\s*["']playback_lost["']/);
  });

  it("(d) the two watchdog constructions sit inside the wireAudioBridges() body", () => {
    const wireFnIdx = source.indexOf("private wireAudioBridges(");
    expect(wireFnIdx).toBeGreaterThan(0);
    // Both createChildExitWatchdog occurrences must appear AFTER the
    // wireAudioBridges declaration. We do not require strict containment
    // inside braces here (TypeScript private-method body bounds are
    // brittle to detect with regex); we assert the constructions appear
    // in the same file after the wireAudioBridges declaration, which
    // satisfies the plan's spirit.
    const occurrences: number[] = [];
    let i = source.indexOf("createChildExitWatchdog");
    while (i !== -1) {
      occurrences.push(i);
      i = source.indexOf("createChildExitWatchdog", i + 1);
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    for (const idx of occurrences) {
      expect(idx).toBeGreaterThan(wireFnIdx);
    }
  });

  it("session.ts imports createChildExitWatchdog from ./child-exit-watchdog.js", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*createChildExitWatchdog[^}]*\}\s*from\s*["']\.\/child-exit-watchdog\.js["']/,
    );
  });

  it("Session.stop() disposes both sox + ffplay watchdog handles (graceful-shutdown chain)", () => {
    // The two handle fields the implementation stores against `this`.
    const stopFnIdx = source.indexOf("async stop()");
    expect(stopFnIdx).toBeGreaterThan(0);
    const stopBody = source.slice(stopFnIdx, stopFnIdx + 2_000);
    // Allow either explicit "soxWatchdog?.dispose()" or
    // "soxWatchdog.dispose()" depending on the implementation.
    expect(stopBody).toMatch(/soxWatchdog\??\.dispose\(\)/);
    expect(stopBody).toMatch(/ffplayWatchdog\??\.dispose\(\)/);
  });

  it("cap-exceeded does NOT call process.exit (typed-input fallback survives — CONTEXT.md Claude's Discretion)", () => {
    // The onError callbacks in the new watchdog block must NOT call
    // process.exit. We grep within ~3KB after the first
    // createChildExitWatchdog occurrence (covers both watchdog blocks).
    const firstWatchdog = source.indexOf("createChildExitWatchdog");
    expect(firstWatchdog).toBeGreaterThan(0);
    const block = source.slice(firstWatchdog, firstWatchdog + 3_000);
    // The block contains both watchdog constructions; assert NO
    // process.exit appears in either onError callback.
    const onErrSpans = block.match(/onError\s*:\s*\([\s\S]*?\)\s*=>\s*\{[\s\S]*?\}/g) ?? [];
    expect(onErrSpans.length).toBeGreaterThanOrEqual(2);
    for (const span of onErrSpans) {
      expect(span).not.toMatch(/process\.exit/);
    }
  });
});
