/**
 * Tests for the Plan 14-01 `achilles latency --report` subcommand.
 *
 * Per the plan's behaviour table LC1..LC4. The subcommand reads the
 * rolling-window JSON file written by the Electron main process and
 * prints a P50 / P95 summary block to stdout. The tests drive every
 * branch via the injected readFileImpl + stdout + stderr +
 * processExitImpl seams; no real filesystem access.
 *
 * Branches covered:
 *   - LC1 valid samples → summary block to stdout, exit 0
 *   - LC2 missing file (ENOENT) → "no samples yet" to stdout, exit 0
 *   - LC3 malformed JSON → "malformed" to stderr, exit 1
 *   - LC4 file present but {samples:[]} → "no samples yet", exit 0
 *   - Bonus: subcommand !== "--report" → "Specify --report" to stderr, exit 1
 */

import { describe, expect, it } from "vitest";
import { latencyCommand } from "./latency.js";

type WriteSeam = { write: (chunk: string) => boolean };

const makeStream = (): { seam: WriteSeam; chunks: string[] } => {
  const chunks: string[] = [];
  return {
    seam: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    },
    chunks,
  };
};

describe("latencyCommand", () => {
  it("LC1: --report with valid samples writes a P50 / P95 summary to stdout and exits 0", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;
    // Fixture: 5 samples with endToEndMs = 100, 200, 300, 400, 500.
    // R-7 percentile on this set: P50=300, P95=480.
    const fixtureJson = JSON.stringify({
      samples: [
        {
          utteranceId: "u1",
          speechEndMs: 0,
          stages: { stt_committed: 50, tts_playback_start: 100 },
          endToEndMs: 100,
        },
        {
          utteranceId: "u2",
          speechEndMs: 0,
          stages: { stt_committed: 50, tts_playback_start: 200 },
          endToEndMs: 200,
        },
        {
          utteranceId: "u3",
          speechEndMs: 0,
          stages: { stt_committed: 50, tts_playback_start: 300 },
          endToEndMs: 300,
        },
        {
          utteranceId: "u4",
          speechEndMs: 0,
          stages: { stt_committed: 50, tts_playback_start: 400 },
          endToEndMs: 400,
        },
        {
          utteranceId: "u5",
          speechEndMs: 0,
          stages: { stt_committed: 50, tts_playback_start: 500 },
          endToEndMs: 500,
        },
      ],
      updatedAt: "2026-06-06T00:00:00.000Z",
    });

    latencyCommand({
      subcommand: "--report",
      reportPath: "/tmp/test/latency-samples.json",
      readFileImpl: () => fixtureJson,
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(0);
    const combinedStdout = stdout.chunks.join("");
    expect(combinedStdout).toContain("[achilles] LOOP-06 latency report");
    expect(combinedStdout).toContain("samples:       5");
    expect(combinedStdout).toContain("P50 endToEnd:  300.00 ms");
    expect(combinedStdout).toContain("P95 endToEnd:  480.00 ms");
    expect(combinedStdout).toContain("within budget");
    expect(stderr.chunks.join("")).toBe("");
  });

  it("LC2: --report with missing file (readFileImpl throws ENOENT) writes 'no samples yet' to stdout and exits 0", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;

    latencyCommand({
      subcommand: "--report",
      reportPath: "/tmp/test/missing-file.json",
      readFileImpl: () => {
        const err = new Error(
          "ENOENT: no such file or directory, open '/tmp/test/missing-file.json'",
        );
        (err as NodeJS.ErrnoException).code = "ENOENT";
        throw err;
      },
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(0);
    const combined = stdout.chunks.join("");
    expect(combined).toContain("No latency samples recorded yet");
    expect(combined).toContain("achilles --debug");
    expect(stderr.chunks.join("")).toBe("");
  });

  it("LC3: --report with malformed JSON writes 'malformed' to stderr and exits 1", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;

    latencyCommand({
      subcommand: "--report",
      reportPath: "/tmp/test/garbage.json",
      readFileImpl: () => "this is not valid JSON {",
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(1);
    const combinedStderr = stderr.chunks.join("");
    expect(combinedStderr).toContain("malformed");
    expect(combinedStderr).toContain("/tmp/test/garbage.json");
    expect(stdout.chunks.join("")).toBe("");
  });

  it("LC4: --report with empty samples array writes 'no samples yet' to stdout and exits 0", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;

    latencyCommand({
      subcommand: "--report",
      reportPath: "/tmp/test/empty.json",
      readFileImpl: () =>
        JSON.stringify({
          samples: [],
          updatedAt: "2026-06-06T00:00:00.000Z",
        }),
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(0);
    const combined = stdout.chunks.join("");
    expect(combined).toContain("No latency samples recorded yet");
    expect(stderr.chunks.join("")).toBe("");
  });

  it("LC5 (bonus): missing --report flag writes 'Specify --report' to stderr and exits 1", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;

    latencyCommand({
      subcommand: "",
      reportPath: "/tmp/test/latency-samples.json",
      readFileImpl: () => {
        throw new Error("readFileImpl should not be called");
      },
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(1);
    const combinedStderr = stderr.chunks.join("");
    expect(combinedStderr).toContain("Specify --report");
    expect(stdout.chunks.join("")).toBe("");
  });

  it("LC6 (bonus): rejects non-object root JSON (e.g. an array at top level)", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;

    latencyCommand({
      subcommand: "--report",
      reportPath: "/tmp/test/array.json",
      readFileImpl: () => JSON.stringify([1, 2, 3]),
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr.chunks.join("")).toContain("malformed");
  });

  it("LC7 (bonus): a single 1600ms outlier in 19 sub-900ms samples reports a P95 BREACH", () => {
    const stdout = makeStream();
    const stderr = makeStream();
    let exitCode: number | null = null;
    // Construct 18 fast + 2 outliers so the R-7 percentile lands
    // above 1500 ms (same fixture shape as the LP9 probe test).
    const samples: Array<{
      utteranceId: string;
      speechEndMs: number;
      stages: Record<string, number>;
      endToEndMs: number;
    }> = [];
    for (let i = 0; i < 18; i++) {
      samples.push({
        utteranceId: `u${i}`,
        speechEndMs: 0,
        stages: { stt_committed: 50, tts_playback_start: 850 + i },
        endToEndMs: 850 + i,
      });
    }
    samples.push({
      utteranceId: "u18",
      speechEndMs: 0,
      stages: { stt_committed: 50, tts_playback_start: 1600 },
      endToEndMs: 1600,
    });
    samples.push({
      utteranceId: "u19",
      speechEndMs: 0,
      stages: { stt_committed: 50, tts_playback_start: 1700 },
      endToEndMs: 1700,
    });

    latencyCommand({
      subcommand: "--report",
      reportPath: "/tmp/test/budget-breach.json",
      readFileImpl: () => JSON.stringify({ samples }),
      stdout: stdout.seam,
      stderr: stderr.seam,
      processExitImpl: (code) => {
        exitCode = code;
      },
    });

    expect(exitCode).toBe(0);
    const combined = stdout.chunks.join("");
    expect(combined).toContain("BREACH: P95 over budget");
  });
});
