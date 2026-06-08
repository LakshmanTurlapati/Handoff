/**
 * Phase 17, Plan 04, Task 2 — latency-probe unit tests.
 *
 * Tests the LOOP-06 7-stage probe ported from v1.2 with samplesCap
 * default bumped from 20 to 100. Covers the most-relevant 10 cases.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  createLatencyProbe,
  percentile,
  renderLatencyReport,
  type LatencySample,
} from "../src/latency-probe.js";

describe("createLatencyProbe (Phase 17 Plan 04 Task 2)", () => {
  it("T1: percentile R-7 method matches v1.2 fixtures", () => {
    expect(percentile([100, 200, 300, 400, 500], 50)).toBe(300);
    expect(percentile([100, 200, 300, 400, 500], 95)).toBe(480);
    // Empty -> NaN
    expect(Number.isNaN(percentile([], 50))).toBe(true);
    // Single -> value
    expect(percentile([42], 50)).toBe(42);
  });

  it("T2: stage-recording sequence builds a sample with the correct end-to-end", () => {
    let t = 1000;
    const probe = createLatencyProbe({
      nowImpl: () => t,
    });
    probe.markSpeechEnd(1000, "utt-1");
    t = 1100;
    probe.recordStage("stt_committed");
    t = 1250;
    probe.recordStage("claude_first_text_delta");
    t = 1400;
    probe.recordStage("claude_assistant_done");
    t = 1500;
    probe.recordStage("tts_first_chunk");
    t = 1600;
    probe.recordStage("tts_playback_start");
    probe.finalizeSample();
    const r = probe.report();
    expect(r.sampleCount).toBe(1);
    // Narrow via the non-zero check — TS cannot eliminate the
    // sampleCount=0 union branch from sampleCount=1 alone; we
    // cast to the populated branch since the assertion above
    // confirmed sampleCount > 0.
    const populated = r as Exclude<typeof r, { sampleCount: 0 }>;
    expect(populated.p50EndToEndMs).toBe(600); // 1600 - 1000
    expect(populated.perStageP50.stt_committed).toBe(100);
  });

  it("T3: samplesCap FIFO evicts the oldest sample beyond the cap", () => {
    let t = 0;
    const probe = createLatencyProbe({
      nowImpl: () => t,
      samplesCap: 3,
    });
    for (let i = 0; i < 5; i++) {
      probe.markSpeechEnd(t, `utt-${String(i)}`);
      t += 100;
      probe.recordStage("tts_playback_start");
      probe.finalizeSample();
      t += 50;
    }
    const r = probe.report();
    expect(r.sampleCount).toBe(3); // capped at 3
  });

  it("T4: report returns sampleCount=0 for an empty window", () => {
    const probe = createLatencyProbe();
    const r = probe.report();
    expect(r.sampleCount).toBe(0);
  });

  it("T5: recordStage on tts_playback_complete after finalize stamps the most recent sample", () => {
    let t = 1000;
    const probe = createLatencyProbe({
      nowImpl: () => t,
    });
    probe.markSpeechEnd(1000, "utt-x");
    t = 1500;
    probe.recordStage("tts_playback_start");
    probe.finalizeSample();
    t = 1700;
    probe.recordStage("tts_playback_complete");
    const r = probe.report();
    expect(r.sampleCount).toBeGreaterThan(0);
    const populated = r as Exclude<typeof r, { sampleCount: 0 }>;
    // The retroactive stamp on the last sample's stages map should
    // contain tts_playback_complete=700.
    expect(populated.perStageP50.tts_playback_complete).toBe(700);
  });

  it("T6: dispose drops the window and report returns sampleCount=0", () => {
    let t = 1000;
    const probe = createLatencyProbe({ nowImpl: () => t });
    probe.markSpeechEnd(1000, "utt-y");
    t = 1500;
    probe.recordStage("tts_playback_start");
    probe.finalizeSample();
    probe.dispose();
    expect(probe.report().sampleCount).toBe(0);
  });

  it("T7: debug log line carries durations + uuid, never transcript text (T-14-01)", () => {
    const logs: string[] = [];
    let t = 1000;
    const probe = createLatencyProbe({
      nowImpl: () => t,
      debugEnabled: true,
      logger: (msg) => logs.push(msg),
    });
    probe.markSpeechEnd(1000, "utt-Z-12345");
    t = 1500;
    probe.recordStage("tts_playback_start");
    probe.finalizeSample();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("utt=utt-Z-12345");
    expect(logs[0]).toContain("endToEndMs=500.00");
    // No transcript content / payload-body / accumulatedText leaked
    // into the log line. The stage name `claude_first_text_delta`
    // contains "text" so we narrow the regex to substrings that
    // would actually represent transcript-body leakage.
    expect(logs[0]).not.toMatch(/transcript|payload|accumulatedText/i);
  });

  it("T8: writeSampleFile + writeFileImpl writes a JSON payload on finalize", () => {
    const writeSpy = vi.fn();
    let t = 1000;
    const probe = createLatencyProbe({
      nowImpl: () => t,
      writeSampleFile: true,
      sampleFilePath: "/tmp/test-latency.json",
      writeFileImpl: writeSpy,
    });
    probe.markSpeechEnd(1000, "utt-w");
    t = 1500;
    probe.recordStage("tts_playback_start");
    probe.finalizeSample();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const path = writeSpy.mock.calls[0]?.[0] as string;
    const contents = writeSpy.mock.calls[0]?.[1] as string;
    expect(path).toBe("/tmp/test-latency.json");
    const parsed = JSON.parse(contents) as {
      samples: LatencySample[];
      updatedAt: string;
    };
    expect(parsed.samples).toHaveLength(1);
    expect(parsed.samples[0]?.utteranceId).toBe("utt-w");
  });

  it("T9: renderLatencyReport reads JSON files from a directory and prints P50/P95", async () => {
    const dir = mkdtempSync(join(tmpdir(), "achilles-latency-test-"));
    try {
      const samples = [
        {
          utteranceId: "utt-1",
          speechEndMs: 1000,
          stages: { tts_playback_start: 1500 },
          endToEndMs: 500,
        },
        {
          utteranceId: "utt-2",
          speechEndMs: 2000,
          stages: { tts_playback_start: 2800 },
          endToEndMs: 800,
        },
      ];
      writeFileSync(
        join(dir, "sample.json"),
        JSON.stringify({ samples, updatedAt: "2026-06-08" }),
      );
      const report = await renderLatencyReport(dir);
      expect(report).toContain("samples=2");
      expect(report).toContain("P50: ");
      expect(report).toContain("P95: ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("T10: renderLatencyReport returns 'samples=0' for a missing directory", async () => {
    const report = await renderLatencyReport("/nonexistent/path/achilles-latency");
    expect(report).toMatch(/samples=0/);
    expect(report).toMatch(/n\/a/);
  });
});
