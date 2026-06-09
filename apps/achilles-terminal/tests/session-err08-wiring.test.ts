/**
 * Phase 19, Plan 02, Task 2 — ERR-08 unconditional logger fan-out tests.
 *
 * Source-shape regression guard: asserts that runVoice() in session.ts
 *
 *   (a) calls `logger.info("run_voice_start", ...)` BEFORE any other
 *       side-effecting operation (the apiKey resolve / mic startup);
 *   (b) the structured logger is constructed unconditionally — Phase 17
 *       wired this into the Session constructor at line ~352 so the
 *       constructor itself contains `createStructuredLogger`;
 *   (c) the graceful-shutdown chain awaits `logger.flush()` then calls
 *       `logger.dispose()`;
 *   (d) fan-out via `logger.child(scope)` reaches at least 4 audio-
 *       pipeline scopes (mic-sox / tts / stt / claude / sox-watchdog /
 *       ffplay-watchdog — at least 4 of these 6 expected scopes).
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_SRC = resolve(__dirname, "..", "src", "session.ts");

describe("ERR-08 logger fan-out in session.ts (Phase 19 Plan 02 Task 2)", () => {
  const source = readFileSync(SESSION_SRC, "utf8");

  it("(a) runVoice() logs run_voice_start via logger.info BEFORE apiKey resolve", () => {
    // Locate runVoice fn opening.
    const runVoiceIdx = source.indexOf("export async function runVoice(");
    expect(runVoiceIdx).toBeGreaterThan(0);
    // Find the run_voice_start log line and the apiKey resolve line.
    const startLogIdx = source.indexOf('"run_voice_start"', runVoiceIdx);
    const apiKeyIdx = source.indexOf("ELEVENLABS_API_KEY", runVoiceIdx);
    expect(startLogIdx).toBeGreaterThan(0);
    expect(apiKeyIdx).toBeGreaterThan(0);
    expect(startLogIdx).toBeLessThan(apiKeyIdx);
  });

  it("(b) createStructuredLogger is constructed unconditionally in the Session constructor (Phase 17 substrate, line ~352)", () => {
    // The Session constructor must contain the createStructuredLogger
    // call so every Session — production OR mock — gets a logger.
    expect(source).toMatch(/this\.logger\s*=\s*[^;]*createStructuredLogger/);
  });

  it("(c) graceful-shutdown chain awaits logger.flush() then calls logger.dispose()", () => {
    // The flush + dispose pair lives either inside runVoice() or in the
    // registerGracefulShutdown call site. Accept both the literal
    // `logger.flush()` form and the `<some>Logger.flush()` form
    // (e.g. `runVoiceLogger.flush()`).
    expect(source).toMatch(/[lL]ogger\.flush\(\)/);
    expect(source).toMatch(/[lL]ogger\.dispose\(\)/);
    // Order: flush BEFORE dispose.
    const flushMatch = /[lL]ogger\.flush\(\)/.exec(source);
    const disposeMatch = /[lL]ogger\.dispose\(\)/.exec(source);
    expect(flushMatch).not.toBeNull();
    expect(disposeMatch).not.toBeNull();
    expect(flushMatch!.index).toBeLessThan(disposeMatch!.index);
  });

  it("(d) logger fan-out reaches at least 4 named scopes via logger.child(scope)", () => {
    const expectedScopes = [
      "mic-sox",
      "tts",
      "stt",
      "claude",
      "sox-watchdog",
      "ffplay-watchdog",
    ];
    let foundCount = 0;
    for (const scope of expectedScopes) {
      const regex = new RegExp(
        `logger\\.child\\(\\s*["']${scope.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}["']`,
      );
      if (regex.test(source)) {
        foundCount += 1;
      }
    }
    expect(foundCount).toBeGreaterThanOrEqual(4);
  });

  it("run_voice_start log line includes pid + argv + nodeVersion fields per RESEARCH Code Example 5", () => {
    // Extract the run_voice_start invocation block and check field names.
    const startBlock = source
      .slice(source.indexOf('"run_voice_start"'))
      .slice(0, 400);
    expect(startBlock).toContain("pid");
    expect(startBlock).toContain("argv");
    expect(startBlock).toContain("nodeVersion");
  });
});
