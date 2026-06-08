/**
 * Phase 18, Plan 03, Task 3 — Tests for latency-report.ts.
 *
 * Uses a tmpdir for the dirOverride so tests never touch the real
 * ~/.achilles/latency/ directory. No emojis.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLatencyReport } from "../src/latency-report.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "latency-report-test-"));
}

// Build a minimal latency sample JSON file matching the Phase 17 format
function writeSampleFile(dir: string, name: string, samples: object[]): void {
  fs.writeFileSync(
    path.join(dir, name),
    JSON.stringify({ samples, updatedAt: new Date().toISOString() }),
  );
}

describe("runLatencyReport", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 'samples=0' formatted string when LATENCY_DIR is empty", async () => {
    // tmpDir exists but has no .json files
    const result = await runLatencyReport({ dirOverride: tmpDir });
    expect(result).toContain("samples=0");
  });

  it("returns a string containing 'P50' and 'P95' when sample files exist", async () => {
    const now = Date.now();
    const samples = [
      {
        utteranceId: "utt-001",
        speechEndMs: now,
        stages: { tts_playback_start: now + 1200 },
        endToEndMs: 1200,
      },
      {
        utteranceId: "utt-002",
        speechEndMs: now,
        stages: { tts_playback_start: now + 1500 },
        endToEndMs: 1500,
      },
    ];
    writeSampleFile(tmpDir, "session-001.json", samples);

    const result = await runLatencyReport({ dirOverride: tmpDir });
    expect(result).toContain("P50");
    expect(result).toContain("P95");
    expect(result).toContain("samples=2");
  });

  it("accepts a dirOverride and reads from there instead of LATENCY_DIR", async () => {
    // A different tmp dir with no files
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-latency-"));
    try {
      const result = await runLatencyReport({ dirOverride: emptyDir });
      expect(result).toContain("samples=0");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
