/**
 * Phase 18, Plan 03, Task 3 — Tests for config-menu.ts.
 *
 * All tests inject homedirImpl so they never touch the real ~/.achilles/
 * settings.json. The @clack/prompts select() and text() calls are also injected
 * via deps seams. No emojis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runConfigMenu,
  CONFIGURABLE_FIELDS,
  type ConfigMenuDeps,
} from "../src/config-menu.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-menu-test-"));
}

describe("CONFIGURABLE_FIELDS", () => {
  it("contains all 4 VAD knobs + save_transcripts + debug_mode", () => {
    const keys = CONFIGURABLE_FIELDS.map((f) => f.key);
    expect(keys).toContain("vad.voiceThresholdRatio");
    expect(keys).toContain("vad.voiceHoldMs");
    expect(keys).toContain("vad.silenceHoldMs");
    expect(keys).toContain("vad.minUtteranceMs");
    expect(keys).toContain("save_transcripts");
    expect(keys).toContain("debug_mode");
  });

  it("CONFIGURABLE_FIELDS validator for voiceThresholdRatio rejects 6 (out of range)", () => {
    const field = CONFIGURABLE_FIELDS.find((f) => f.key === "vad.voiceThresholdRatio");
    expect(field).toBeDefined();
    const result = field!.validator?.(6);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("CONFIGURABLE_FIELDS validator for voiceThresholdRatio accepts 2.5", () => {
    const field = CONFIGURABLE_FIELDS.find((f) => f.key === "vad.voiceThresholdRatio");
    expect(field).toBeDefined();
    const result = field!.validator?.(2.5);
    expect(result).toBeNull();
  });
});

describe("runConfigMenu", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the supplied value to settings.json at 0o600", async () => {
    const settingsDir = path.join(tmpDir, ".achilles");
    fs.mkdirSync(settingsDir, { recursive: true });

    // Simulate: user selects voiceThresholdRatio, enters "2.5", then selects save-and-exit
    let selectCallCount = 0;
    const deps: ConfigMenuDeps = {
      homedirImpl: () => tmpDir,
      selectImpl: async () => {
        selectCallCount++;
        if (selectCallCount === 1) return "vad.voiceThresholdRatio";
        return "__save__";
      },
      textImpl: async () => "2.5",
    };

    await runConfigMenu(deps);

    const settingsPath = path.join(settingsDir, "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect((parsed as { vad?: { voiceThresholdRatio?: number } })["vad"]?.["voiceThresholdRatio"]).toBe(2.5);

    // Verify 0o600 perms
    const stat = fs.statSync(settingsPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("PRESERVES other unrelated keys in settings.json", async () => {
    const settingsDir = path.join(tmpDir, ".achilles");
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, "settings.json");

    // Pre-existing settings with an unrelated key
    const existing = {
      vad: { voiceThresholdRatio: 3, voiceHoldMs: 60, silenceHoldMs: 300, minUtteranceMs: 300 },
      some_other_key: "should be preserved",
    };
    fs.writeFileSync(settingsPath, JSON.stringify(existing));

    let selectCallCount = 0;
    const deps: ConfigMenuDeps = {
      homedirImpl: () => tmpDir,
      selectImpl: async () => {
        selectCallCount++;
        if (selectCallCount === 1) return "vad.voiceHoldMs";
        return "__save__";
      },
      textImpl: async () => "80",
    };

    await runConfigMenu(deps);

    const raw = fs.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect((parsed as { some_other_key?: string })["some_other_key"]).toBe("should be preserved");
  });

  it("with select returning 'cancel' does NOT write", async () => {
    const settingsDir = path.join(tmpDir, ".achilles");
    fs.mkdirSync(settingsDir, { recursive: true });

    const deps: ConfigMenuDeps = {
      homedirImpl: () => tmpDir,
      selectImpl: async () => "__cancel__",
      textImpl: async () => "value",
    };

    await runConfigMenu(deps);

    const settingsPath = path.join(settingsDir, "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("loads current settings as defaults", async () => {
    const settingsDir = path.join(tmpDir, ".achilles");
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, "settings.json");

    // Write existing settings with a custom value
    const existing = { save_transcripts: true };
    fs.writeFileSync(settingsPath, JSON.stringify(existing));

    const selectOptions: string[] = [];
    const deps: ConfigMenuDeps = {
      homedirImpl: () => tmpDir,
      selectImpl: async (opts) => {
        // Capture the labels to verify they show current values
        if (opts) {
          for (const opt of opts) {
            selectOptions.push(JSON.stringify(opt));
          }
        }
        return "__cancel__";
      },
      textImpl: async () => "value",
    };

    await runConfigMenu(deps);

    // The select options should show the current value of save_transcripts
    const transcriptsOpt = selectOptions.find((o) => o.includes("save_transcripts"));
    expect(transcriptsOpt).toBeDefined();
    // The label should contain the current value "true"
    expect(transcriptsOpt).toContain("true");
  });
});
