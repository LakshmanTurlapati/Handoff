/**
 * Behaviour tests for the Plan 14-01 latency probe (LOOP-06).
 *
 * The probe is a pure module — no Electron, no live ElevenLabs, no
 * timer side effects beyond the injected nowImpl. The tests use a
 * deterministic fake clock so every percentile fixture produces a
 * known value.
 *
 * Tests are organised LP1..LP9 mapping the plan's behaviour table:
 *   - LP1  factory + handle surface
 *   - LP2  stage taxonomy + LatencyStage union literal
 *   - LP3  markSpeechEnd + recordStage + finalizeSample + log line
 *   - LP4  rolling-window FIFO with capacity eviction
 *   - LP5  report() shape: empty vs populated window
 *   - LP6  percentile() R-7 fixture verification
 *   - LP7  writeSampleFile + writeFileImpl seam
 *   - LP8  dispose() clears state + drops writeFileImpl
 *   - LP9  LOOP-06 budget invariant (P50 < 1000, P95 < 1500)
 */

import { describe, expect, it, vi } from "vitest";
import {
  createLatencyProbe,
  percentile,
  type LatencyProbe,
  type LatencyStage,
} from "./latency-probe.js";

/**
 * Build a deterministic clock that returns values from a queue. The
 * test pushes a sequence of timestamps; each nowImpl call shifts the
 * head. When the queue empties, the clock locks at the last value so
 * tail assertions read predictable timestamps without throwing.
 */
function makeClock(initial: ReadonlyArray<number> = []): {
  now: () => number;
  push: (...t: number[]) => void;
  remaining: () => number;
} {
  const queue: number[] = [...initial];
  let last = 0;
  return {
    now: () => {
      if (queue.length > 0) {
        last = queue.shift() as number;
      }
      return last;
    },
    push: (...t: number[]) => {
      queue.push(...t);
    },
    remaining: () => queue.length,
  };
}

/**
 * Helper: record the full happy-path stage sequence for one utterance.
 * Caller supplies absolute timestamps; this function fans them out
 * via the probe's recordStage(name, t) signature so the test does not
 * rely on the implicit nowImpl clock for the synthetic sequence.
 */
function recordHappyPath(
  probe: LatencyProbe,
  speechEndMs: number,
  utteranceId: string,
  offsets: {
    stt: number;
    claudeDelta: number;
    claudeDone: number;
    ttsFirst: number;
    playbackStart: number;
    playbackComplete: number;
  },
): void {
  probe.markSpeechEnd(speechEndMs, utteranceId);
  probe.recordStage("stt_committed", speechEndMs + offsets.stt);
  probe.recordStage(
    "claude_first_text_delta",
    speechEndMs + offsets.claudeDelta,
  );
  probe.recordStage(
    "claude_assistant_done",
    speechEndMs + offsets.claudeDone,
  );
  probe.recordStage("tts_first_chunk", speechEndMs + offsets.ttsFirst);
  probe.recordStage(
    "tts_playback_start",
    speechEndMs + offsets.playbackStart,
  );
  probe.finalizeSample();
  // playback_complete arrives after finalizeSample on the real
  // pipeline — recording it here is a diagnostic side effect that
  // does not affect the rolling-window stats.
  probe.recordStage(
    "tts_playback_complete",
    speechEndMs + offsets.playbackComplete,
  );
}

// ─────────────────────────────────────────────────────────────────────
// LP1: factory + handle surface
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP1 factory + handle surface", () => {
  it("returns a probe with markSpeechEnd / recordStage / finalizeSample / report / dispose", () => {
    const clock = makeClock();
    const probe = createLatencyProbe({ nowImpl: clock.now });
    expect(typeof probe.markSpeechEnd).toBe("function");
    expect(typeof probe.recordStage).toBe("function");
    expect(typeof probe.finalizeSample).toBe("function");
    expect(typeof probe.report).toBe("function");
    expect(typeof probe.dispose).toBe("function");
  });

  it("defaults nowImpl to a working clock when omitted", () => {
    const probe = createLatencyProbe();
    probe.markSpeechEnd(0, "u1");
    // Should not throw — exercises the default nowImpl path.
    probe.recordStage("stt_committed");
    // No assertion on the value; we only assert no exception was
    // thrown by the default clock path.
    expect(probe.report()).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP2: stage taxonomy + LatencyStage union literal
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP2 stage taxonomy", () => {
  it("recordStage accepts all six named LatencyStage values", () => {
    const clock = makeClock();
    const probe = createLatencyProbe({ nowImpl: clock.now });
    probe.markSpeechEnd(0, "u1");
    const stages: ReadonlyArray<LatencyStage> = [
      "stt_committed",
      "claude_first_text_delta",
      "claude_assistant_done",
      "tts_first_chunk",
      "tts_playback_start",
      "tts_playback_complete",
    ];
    for (let i = 0; i < stages.length; i++) {
      probe.recordStage(stages[i]!, (i + 1) * 100);
    }
    probe.finalizeSample();
    const r = probe.report();
    expect(r.sampleCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP3: markSpeechEnd + recordStage + finalizeSample + log line
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP3 markSpeechEnd + recordStage + finalize + log", () => {
  it("emits one [achilles-latency] line per finalize when debugEnabled=true and never includes the API key or transcript-shaped strings", () => {
    const logs: string[] = [];
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      debugEnabled: true,
      logger: (msg) => logs.push(msg),
    });
    recordHappyPath(probe, 0, "11111111-1111-4111-8111-111111111111", {
      stt: 100,
      claudeDelta: 400,
      claudeDone: 700,
      ttsFirst: 750,
      playbackStart: 850,
      playbackComplete: 2000,
    });
    expect(logs.length).toBe(1);
    const line = logs[0]!;
    expect(line.startsWith("[achilles-latency]")).toBe(true);
    expect(line).toContain("utt=11111111-1111-4111-8111-111111111111");
    expect(line).toContain("endToEndMs=850.00");
    expect(line).toContain("stt_committed=100.00");
    expect(line).toContain("tts_playback_start=850.00");
    // Privacy guards: log line must NEVER contain transcript text or
    // API key fragments.
    expect(line).not.toContain("xi-mock-api-key");
    expect(line).not.toContain("xi_api_key");
    expect(line).not.toContain("refactor");
    expect(line).not.toContain("hello world");
  });

  it("does NOT emit a log line when debugEnabled=false", () => {
    const logs: string[] = [];
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      debugEnabled: false,
      logger: (msg) => logs.push(msg),
    });
    recordHappyPath(probe, 0, "u1", {
      stt: 100,
      claudeDelta: 200,
      claudeDone: 300,
      ttsFirst: 400,
      playbackStart: 500,
      playbackComplete: 600,
    });
    expect(logs.length).toBe(0);
  });

  it("silently ignores recordStage when no markSpeechEnd has fired (defensive — stale stage event from cancelled utterance)", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    // No markSpeechEnd call here.
    probe.recordStage("stt_committed", 10);
    probe.finalizeSample();
    expect(probe.report()).toEqual({ sampleCount: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP4: rolling-window FIFO with capacity eviction
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP4 rolling-window FIFO capacity", () => {
  it("evicts the oldest sample when the window exceeds maxWindow", () => {
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      maxWindow: 3,
    });
    for (let i = 0; i < 5; i++) {
      const base = i * 1000;
      recordHappyPath(probe, base, `utt-${i}`, {
        stt: 50,
        claudeDelta: 100,
        claudeDone: 200,
        ttsFirst: 250,
        playbackStart: 300 + i, // distinct endToEndMs per utterance
        playbackComplete: 1000,
      });
    }
    const r = probe.report();
    expect(r.sampleCount).toBe(3);
    if (r.sampleCount > 0) {
      // The last three samples (utt-2, utt-3, utt-4) survive with
      // endToEndMs values 302, 303, 304. Their P50 is the middle
      // value 303.
      expect(r.p50EndToEndMs).toBe(303);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP5: report() shape
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP5 report() shape", () => {
  it("returns {sampleCount: 0} when the window is empty", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    expect(probe.report()).toEqual({ sampleCount: 0 });
  });

  it("returns p50EndToEndMs + p95EndToEndMs + perStageP50/P95 when populated", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    // Build a sample inline so we can record tts_playback_complete
    // BEFORE finalizeSample (the recordHappyPath helper records
    // playback_complete AFTER finalize; the WR-03 fix now retroactively
    // stamps the most recent finalized sample so post-finalize calls
    // are no longer dropped, but the pre-finalize path remains the
    // canonical record-it-during-the-sample-window flow).
    probe.markSpeechEnd(0, "u1");
    probe.recordStage("stt_committed", 50);
    probe.recordStage("claude_first_text_delta", 200);
    probe.recordStage("claude_assistant_done", 400);
    probe.recordStage("tts_first_chunk", 450);
    probe.recordStage("tts_playback_start", 500);
    probe.recordStage("tts_playback_complete", 1500);
    probe.finalizeSample();
    const r = probe.report();
    expect(r.sampleCount).toBe(1);
    if (r.sampleCount > 0) {
      expect(r.p50EndToEndMs).toBe(500);
      expect(r.p95EndToEndMs).toBe(500);
      expect(r.perStageP50.stt_committed).toBe(50);
      expect(r.perStageP50.tts_playback_start).toBe(500);
      expect(r.perStageP50.tts_playback_complete).toBe(1500);
    }
  });
});

describe("createLatencyProbe — WR-03 tts_playback_complete after finalize is retroactively stamped", () => {
  // WR-03 regression. The orchestrator calls recordStage('tts_playback_complete')
  // from session.onTtsPlaybackComplete — which runs AFTER finalizeSample
  // (the sample is finalized at first-chunk fanout via the consumer loop).
  // Previously the inFlight===null guard silently dropped the call, leaving
  // tts_playback_complete as dead data in the public LatencyStage taxonomy
  // even though report.perStageP50 exposed it. After WR-03 the call is
  // retroactively stamped on the most recently finalized sample so the
  // metric reflects observed data.

  it("recordStage('tts_playback_complete') AFTER finalizeSample stamps the most recent sample", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    probe.markSpeechEnd(0, "u1");
    probe.recordStage("stt_committed", 50);
    probe.recordStage("tts_first_chunk", 450);
    probe.recordStage("tts_playback_start", 500);
    probe.finalizeSample();
    // Post-finalize tts_playback_complete now retroactively updates the
    // sample's stages map (pre-WR-03 this was silently dropped).
    probe.recordStage("tts_playback_complete", 1500);
    const r = probe.report();
    expect(r.sampleCount).toBe(1);
    if (r.sampleCount > 0) {
      expect(r.perStageP50.tts_playback_complete).toBe(1500);
    }
  });

  it("post-finalize recordStage for a non-tts_playback_complete stage is still dropped (unchanged behaviour)", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    probe.markSpeechEnd(0, "u1");
    probe.recordStage("stt_committed", 50);
    probe.recordStage("tts_first_chunk", 450);
    probe.recordStage("tts_playback_start", 500);
    probe.finalizeSample();
    // Other stages remain dropped — only tts_playback_complete has the
    // post-finalize retroactive path, because the others are anchors
    // that legitimately fire during the sample window.
    probe.recordStage("claude_first_text_delta", 9999);
    const r = probe.report();
    expect(r.sampleCount).toBe(1);
    if (r.sampleCount > 0) {
      // claude_first_text_delta is NaN because no record-during-sample
      // happened; the stale post-finalize call did NOT silently update it.
      expect(Number.isNaN(r.perStageP50.claude_first_text_delta)).toBe(true);
    }
  });

  it("post-finalize recordStage('tts_playback_complete') with empty window is a no-op", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    // No markSpeechEnd / finalizeSample — empty window. The fix's
    // window.length === 0 guard returns early without throwing.
    probe.recordStage("tts_playback_complete", 1500);
    expect(probe.report()).toEqual({ sampleCount: 0 });
  });

  it("post-finalize recordStage('tts_playback_complete') is idempotent (does not overwrite an existing value)", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    probe.markSpeechEnd(0, "u1");
    probe.recordStage("tts_playback_start", 500);
    probe.recordStage("tts_playback_complete", 1000);
    probe.finalizeSample();
    // A second post-finalize call must not overwrite the previously
    // recorded value (matches the in-flight first-fire semantics).
    probe.recordStage("tts_playback_complete", 2000);
    const r = probe.report();
    expect(r.sampleCount).toBe(1);
    if (r.sampleCount > 0) {
      expect(r.perStageP50.tts_playback_complete).toBe(1000);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP6: percentile() R-7 fixture verification
// ─────────────────────────────────────────────────────────────────────

describe("percentile — LP6 R-7 linear interpolation fixture", () => {
  it("the locked fixture [100, 200, 300, 400, 500] produces P50=300, P95=480", () => {
    const samples = [100, 200, 300, 400, 500];
    expect(percentile(samples, 50)).toBe(300);
    expect(percentile(samples, 95)).toBe(480);
  });

  it("empty input returns NaN", () => {
    expect(percentile([], 50)).toBeNaN();
  });

  it("single value returns that value for any percentile", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([42], 0)).toBe(42);
  });

  it("p outside [0, 100] is clamped to the endpoints", () => {
    const samples = [10, 20, 30];
    expect(percentile(samples, -10)).toBe(10);
    expect(percentile(samples, 110)).toBe(30);
  });

  it("filters out NaN entries so a missing stage does not skew the percentile", () => {
    const samples = [100, NaN, 200, 300];
    // Cleaned: [100, 200, 300] → P50 = 200
    expect(percentile(samples, 50)).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP7: writeSampleFile + writeFileImpl seam
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP7 writeSampleFile JSON export", () => {
  it("writes the rolling window as JSON via the injected writeFileImpl on each finalize", () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      writeSampleFile: true,
      sampleFilePath: "/tmp/test/latency-samples.json",
      writeFileImpl: (path, contents) => {
        writes.push({ path, contents });
      },
    });
    recordHappyPath(probe, 1000, "u1", {
      stt: 50,
      claudeDelta: 100,
      claudeDone: 200,
      ttsFirst: 250,
      playbackStart: 300,
      playbackComplete: 1100,
    });
    expect(writes.length).toBe(1);
    expect(writes[0]!.path).toBe("/tmp/test/latency-samples.json");
    const payload = JSON.parse(writes[0]!.contents);
    expect(payload.samples).toBeInstanceOf(Array);
    expect(payload.samples.length).toBe(1);
    expect(payload.samples[0].utteranceId).toBe("u1");
    expect(payload.samples[0].endToEndMs).toBe(300);
    expect(typeof payload.updatedAt).toBe("string");
    // The payload contains timing numbers + utterance UUID only (T-14-02).
    expect(writes[0]!.contents).not.toContain("xi-mock-api-key");
    expect(writes[0]!.contents).not.toContain("transcript");
    expect(writes[0]!.contents).not.toContain("hello world");
  });

  it("does NOT write when writeSampleFile=false even if sampleFilePath is set", () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      writeSampleFile: false,
      sampleFilePath: "/tmp/test/latency-samples.json",
      writeFileImpl: (path, contents) => {
        writes.push({ path, contents });
      },
    });
    recordHappyPath(probe, 0, "u1", {
      stt: 50,
      claudeDelta: 100,
      claudeDone: 200,
      ttsFirst: 250,
      playbackStart: 300,
      playbackComplete: 1100,
    });
    expect(writes.length).toBe(0);
  });

  it("swallows a write-impl exception without crashing the probe", () => {
    const logs: string[] = [];
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      writeSampleFile: true,
      sampleFilePath: "/tmp/test/latency-samples.json",
      writeFileImpl: () => {
        throw new Error("ENOSPC: simulated disk-full");
      },
      logger: (msg) => logs.push(msg),
    });
    expect(() => {
      recordHappyPath(probe, 0, "u1", {
        stt: 50,
        claudeDelta: 100,
        claudeDone: 200,
        ttsFirst: 250,
        playbackStart: 300,
        playbackComplete: 1100,
      });
    }).not.toThrow();
    // The probe logs the failure WITHOUT including payload bodies.
    const writeErrorLines = logs.filter((l) =>
      l.includes("sample write failed"),
    );
    expect(writeErrorLines.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP8: dispose() clears state + drops writeFileImpl
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP8 dispose() clears state", () => {
  it("after dispose(), recordStage / finalizeSample are no-ops and report returns {sampleCount: 0}", () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const writeSpy = vi.fn(
      (path: string, contents: string): void => {
        writes.push({ path, contents });
      },
    );
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      writeSampleFile: true,
      sampleFilePath: "/tmp/test/latency-samples.json",
      writeFileImpl: writeSpy,
    });
    // Pre-dispose: one sample lands.
    recordHappyPath(probe, 0, "u1", {
      stt: 50,
      claudeDelta: 100,
      claudeDone: 200,
      ttsFirst: 250,
      playbackStart: 300,
      playbackComplete: 1100,
    });
    expect(writes.length).toBe(1);
    expect(probe.report().sampleCount).toBe(1);
    probe.dispose();
    expect(probe.report()).toEqual({ sampleCount: 0 });
    // Subsequent stage activity is silently swallowed.
    probe.markSpeechEnd(100, "u2");
    probe.recordStage("stt_committed", 200);
    probe.finalizeSample();
    expect(probe.report()).toEqual({ sampleCount: 0 });
    // The write seam saw the pre-dispose sample only — disposed
    // calls do not touch it.
    expect(writes.length).toBe(1);
  });

  it("dispose() is idempotent — calling twice does not throw", () => {
    const probe = createLatencyProbe({ nowImpl: () => 0 });
    expect(() => {
      probe.dispose();
      probe.dispose();
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// LP9: LOOP-06 budget invariant
// ─────────────────────────────────────────────────────────────────────

describe("createLatencyProbe — LP9 LOOP-06 budget invariant", () => {
  it("20 utterances all under 1000 ms yield P50 < 1000 AND P95 < 1500", () => {
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      maxWindow: 20,
    });
    // Synthetic fixture: 20 samples ranging 800..950 ms.
    const endToEndValues: number[] = [];
    for (let i = 0; i < 20; i++) {
      const v = 800 + i * 5; // 800, 805, 810, ..., 895
      endToEndValues.push(v);
      probe.markSpeechEnd(0, `u${i}`);
      probe.recordStage("stt_committed", 50);
      probe.recordStage("claude_first_text_delta", v - 200);
      probe.recordStage("claude_assistant_done", v - 100);
      probe.recordStage("tts_first_chunk", v - 50);
      probe.recordStage("tts_playback_start", v);
      probe.finalizeSample();
    }
    const r = probe.report();
    expect(r.sampleCount).toBe(20);
    if (r.sampleCount > 0) {
      expect(r.p50EndToEndMs).toBeLessThan(1000);
      expect(r.p95EndToEndMs).toBeLessThan(1500);
    }
  });

  it("two 1600+ ms outliers mixed into 18 sub-900 ms samples keep P50 < 1000 but breach P95 > 1500", () => {
    const probe = createLatencyProbe({
      nowImpl: () => 0,
      maxWindow: 20,
    });
    // 18 fast samples + 2 outliers. R-7 percentile on 20 values picks
    // idx = 0.95 * 19 = 18.05; the two outliers at sorted indices
    // 18, 19 drag the result above 1500.
    const series: number[] = [];
    for (let i = 0; i < 18; i++) {
      series.push(850 + i);
    }
    series.push(1600);
    series.push(1700);
    for (let i = 0; i < series.length; i++) {
      const v = series[i]!;
      probe.markSpeechEnd(0, `u${i}`);
      probe.recordStage("stt_committed", 50);
      probe.recordStage("tts_playback_start", v);
      probe.finalizeSample();
    }
    const r = probe.report();
    expect(r.sampleCount).toBe(20);
    if (r.sampleCount > 0) {
      expect(r.p50EndToEndMs).toBeLessThan(1000);
      expect(r.p95EndToEndMs).toBeGreaterThan(1500);
    }
  });
});
