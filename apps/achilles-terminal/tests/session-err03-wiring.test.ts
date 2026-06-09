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

  it("(d) the two watchdog constructions sit AFTER the wireAudioBridges() declaration (in wireAudioBridges itself or its helper companions)", () => {
    const wireFnIdx = source.indexOf("private wireAudioBridges(");
    expect(wireFnIdx).toBeGreaterThan(0);
    // Filter for the CALL form (createChildExitWatchdog followed by an
    // open paren / brace) so the import line at the top of the file is
    // excluded. We expect at least 2 call-form occurrences (sox + ffplay)
    // and every one of them must appear AFTER the wireAudioBridges()
    // declaration so the wiring lives in the audio-bridges path. Plan 19
    // permits the ffplay watchdog to live in a small helper companion
    // (e.g. wireFfplayWatchdog) that's invoked from wireAudioBridges.
    const callForm = /createChildExitWatchdog\s*\(/g;
    const occurrences: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = callForm.exec(source)) !== null) {
      occurrences.push(match.index);
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
    // The onError callbacks for both watchdogs must NOT contain an
    // actual process.exit() CALL (parenthesised form). Comments and
    // docstrings that mention "process.exit" textually are allowed —
    // they document the contract. We strip line-comments and block
    // comments from the search window before regex-matching, then
    // require the CALL form (process.exit followed by '(' optionally
    // with arguments) to be absent.
    const callForm = /createChildExitWatchdog\s*\(/g;
    const occurrences: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = callForm.exec(source)) !== null) {
      occurrences.push(match.index);
    }
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    for (const idx of occurrences) {
      const rawBlock = source.slice(idx, idx + 2_000);
      // Strip block + line comments so docstring mentions of process.exit
      // do not trip the assertion.
      const noBlockComments = rawBlock.replace(/\/\*[\s\S]*?\*\//g, "");
      const noLineComments = noBlockComments.replace(/\/\/[^\n]*/g, "");
      expect(noLineComments).not.toMatch(/process\.exit\s*\(/);
    }
  });
});
