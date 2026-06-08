/**
 * Phase 17, Plan 04, Task 2 — LOOP-06 latency probe port.
 *
 * Port of apps/achilles/src/main/latency-probe.ts (588 LOC) with:
 *
 *   - 7-stage LOOP-06 taxonomy ported verbatim (stt_committed,
 *     claude_first_text_delta, claude_assistant_done,
 *     tts_first_chunk, tts_playback_start, tts_playback_complete
 *     + speech_end implicit anchor)
 *   - Fixed-capacity FIFO rolling-window (samplesCap=100; v1.2
 *     defaulted to 20, Phase 17 widens to 100 to give the
 *     `achilles latency --report` subcommand more samples to work
 *     with by default)
 *   - markSpeechEnd / recordStage / finalizeSample / report public
 *     surface preserved
 *   - The on-disk JSON write path lives at ~/.achilles/latency/
 *     and is owned by Phase 18's hardening pass (Phase 17 ships
 *     the writer seam + the report reader)
 *   - renderLatencyReport reads every JSON file under
 *     ~/.achilles/latency/ at the SAMPLES_DIR path; computes P50 +
 *     P95 over the loaded samples; returns a formatted string the
 *     CLI's `latency --report` branch writes to stdout
 *
 * The probe is PURE in the sense that matters for the test surface:
 *   - No fs.* imports inside the probe itself (writeFileImpl is the
 *     seam; renderLatencyReport owns the read path)
 *   - No process.env reads
 *   - No clock reads outside the injected nowImpl
 *
 * Threat model (carry-forward from v1.2):
 *   - T-14-01 mitigate — debug log carries durations + uuid only,
 *     never transcript text, accumulatedText, or API key bytes.
 *   - T-14-02 mitigate — sample file carries durations + uuid only.
 *   - T-14-04 mitigate — fixed-capacity FIFO + O(N) finalisation.
 *
 * No emojis (CLAUDE.md global).
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The 7 named voice-loop stages. Ported verbatim from v1.2.
 *
 * @public
 */
export type LatencyStage =
  | "stt_committed"
  | "claude_first_text_delta"
  | "claude_assistant_done"
  | "tts_first_chunk"
  | "tts_playback_start"
  | "tts_playback_complete";

/**
 * All stages including the implicit speech_end anchor — used
 * internally by the report builder.
 */
const ALL_STAGES_WITH_ANCHOR: ReadonlyArray<LatencyStage | "speech_end"> = [
  "speech_end",
  "stt_committed",
  "claude_first_text_delta",
  "claude_assistant_done",
  "tts_first_chunk",
  "tts_playback_start",
  "tts_playback_complete",
];

/**
 * One completed utterance sample. Ported verbatim from v1.2.
 *
 * @public
 */
export interface LatencySample {
  readonly utteranceId: string;
  readonly speechEndMs: number;
  readonly stages: Partial<Record<LatencyStage, number>>;
  readonly endToEndMs: number;
}

/**
 * Rolling-window summary surfaced by `report()`. Ported verbatim.
 *
 * @public
 */
export type LatencyReport =
  | { readonly sampleCount: 0 }
  | {
      readonly sampleCount: number;
      readonly p50EndToEndMs: number;
      readonly p95EndToEndMs: number;
      readonly perStageP50: Record<LatencyStage | "speech_end", number>;
      readonly perStageP95: Record<LatencyStage | "speech_end", number>;
    };

/**
 * File-system seam for the optional rolling-window export.
 *
 * @public
 */
export type LatencyWriteFileImpl = (path: string, contents: string) => void;

/**
 * Construction-time dependencies for createLatencyProbe.
 *
 * @public
 */
export interface LatencyProbeDeps {
  readonly nowImpl?: () => number;
  readonly debugEnabled?: boolean;
  readonly logger?: (msg: string) => void;
  readonly writeSampleFile?: boolean;
  readonly sampleFilePath?: string;
  readonly writeFileImpl?: LatencyWriteFileImpl;
  /** Rolling-window capacity. Phase 17 default 100. */
  readonly samplesCap?: number;
}

/**
 * Public probe handle returned by createLatencyProbe.
 *
 * @public
 */
export interface LatencyProbe {
  markSpeechEnd(epochMs: number, utteranceId: string): void;
  recordStage(stage: LatencyStage, t?: number): void;
  finalizeSample(): void;
  report(): LatencyReport;
  snapshot(): LatencyReport;
  dispose(): void;
}

/**
 * R-7 percentile method. Ported verbatim from v1.2.
 *
 * @public
 */
export function percentile(values: ReadonlyArray<number>, p: number): number {
  const cleaned: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      cleaned.push(v);
    }
  }
  if (cleaned.length === 0) return NaN;
  if (cleaned.length === 1) return cleaned[0]!;
  const clamped = Math.max(0, Math.min(100, p));
  const sorted = [...cleaned].sort((a, b) => a - b);
  const n = sorted.length;
  const idx = (clamped / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

/**
 * In-flight sample slot.
 */
interface InFlightSample {
  utteranceId: string;
  speechEndMs: number;
  stages: Partial<Record<LatencyStage, number>>;
}

/**
 * Construct a LatencyProbe. Ported from v1.2 with samplesCap default
 * bumped to 100.
 *
 * @public
 */
export function createLatencyProbe(deps: LatencyProbeDeps = {}): LatencyProbe {
  const nowImpl =
    deps.nowImpl ??
    ((): number => {
      const perf = (
        globalThis as { performance?: { now(): number } }
      ).performance;
      if (perf !== undefined && typeof perf.now === "function") {
        return perf.now();
      }
      return Date.now();
    });
  const debugEnabled = deps.debugEnabled ?? false;
  const logger =
    deps.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.log(msg);
    });
  const writeSampleFile = deps.writeSampleFile ?? false;
  const sampleFilePath = deps.sampleFilePath;
  let writeFileImpl = deps.writeFileImpl;
  const samplesCap = Math.max(1, deps.samplesCap ?? 100);

  let window: LatencySample[] = [];
  let inFlight: InFlightSample | null = null;
  let disposed = false;

  function markSpeechEnd(epochMs: number, utteranceId: string): void {
    if (disposed) return;
    inFlight = {
      utteranceId,
      speechEndMs: epochMs,
      stages: {},
    };
  }

  function recordStage(stage: LatencyStage, t?: number): void {
    if (disposed) return;
    const ts = typeof t === "number" ? t : nowImpl();
    if (inFlight === null) {
      if (stage !== "tts_playback_complete") return;
      if (window.length === 0) return;
      const lastSample = window[window.length - 1]!;
      if (lastSample.stages.tts_playback_complete !== undefined) return;
      lastSample.stages.tts_playback_complete = ts;
      return;
    }
    if (inFlight.stages[stage] === undefined) {
      inFlight.stages[stage] = ts;
    }
  }

  function buildSample(slot: InFlightSample): LatencySample {
    const playbackStart = slot.stages.tts_playback_start;
    const endToEnd =
      typeof playbackStart === "number"
        ? playbackStart - slot.speechEndMs
        : NaN;
    return Object.freeze({
      utteranceId: slot.utteranceId,
      speechEndMs: slot.speechEndMs,
      stages: { ...slot.stages },
      endToEndMs: endToEnd,
    });
  }

  function emitDebugLine(sample: LatencySample): void {
    const parts: string[] = [];
    parts.push(`utt=${sample.utteranceId}`);
    parts.push(`endToEndMs=${formatNumber(sample.endToEndMs)}`);
    for (const stage of ALL_STAGES_WITH_ANCHOR) {
      if (stage === "speech_end") continue;
      const ts = sample.stages[stage];
      const delta =
        typeof ts === "number" ? ts - sample.speechEndMs : NaN;
      parts.push(`${stage}=${formatNumber(delta)}`);
    }
    logger(`[achilles-latency] ${parts.join(" ")}`);
  }

  function writeRollingWindow(): void {
    if (!writeSampleFile) return;
    if (sampleFilePath === undefined || sampleFilePath.length === 0) return;
    if (writeFileImpl === undefined) return;
    const payload = {
      samples: window,
      updatedAt: new Date().toISOString(),
    };
    try {
      writeFileImpl(sampleFilePath, JSON.stringify(payload));
    } catch (err) {
      logger(
        `[achilles-latency] sample write failed: ${
          (err as Error).message
        }`,
      );
    }
  }

  function finalizeSample(): void {
    if (disposed) return;
    if (inFlight === null) return;
    const sample = buildSample(inFlight);
    window.push(sample);
    while (window.length > samplesCap) {
      window.shift();
    }
    if (debugEnabled) {
      emitDebugLine(sample);
    }
    writeRollingWindow();
    inFlight = null;
  }

  function report(): LatencyReport {
    if (disposed || window.length === 0) {
      return { sampleCount: 0 };
    }
    const endToEnds = window.map((s) => s.endToEndMs);
    const p50EndToEndMs = percentile(endToEnds, 50);
    const p95EndToEndMs = percentile(endToEnds, 95);
    const perStageP50: Record<LatencyStage | "speech_end", number> = {
      speech_end: 0,
      stt_committed: NaN,
      claude_first_text_delta: NaN,
      claude_assistant_done: NaN,
      tts_first_chunk: NaN,
      tts_playback_start: NaN,
      tts_playback_complete: NaN,
    };
    const perStageP95: Record<LatencyStage | "speech_end", number> = {
      speech_end: 0,
      stt_committed: NaN,
      claude_first_text_delta: NaN,
      claude_assistant_done: NaN,
      tts_first_chunk: NaN,
      tts_playback_start: NaN,
      tts_playback_complete: NaN,
    };
    for (const stage of ALL_STAGES_WITH_ANCHOR) {
      if (stage === "speech_end") continue;
      const stageDurations: number[] = [];
      for (const s of window) {
        const ts = s.stages[stage];
        if (typeof ts === "number") {
          stageDurations.push(ts - s.speechEndMs);
        }
      }
      perStageP50[stage] = percentile(stageDurations, 50);
      perStageP95[stage] = percentile(stageDurations, 95);
    }
    return {
      sampleCount: window.length,
      p50EndToEndMs,
      p95EndToEndMs,
      perStageP50,
      perStageP95,
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window = [];
    inFlight = null;
    writeFileImpl = undefined;
  }

  return {
    markSpeechEnd,
    recordStage,
    finalizeSample,
    report,
    snapshot: report,
    dispose,
  };
}

/**
 * Format a numeric duration for the debug log line.
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "missing";
  return n.toFixed(2);
}

/**
 * Locked path for the latency sample files. Phase 17 ships the
 * directory + the reader; Phase 18 owns the per-sample writer.
 *
 * @public
 */
export const LATENCY_DIR = join(homedir(), ".achilles", "latency");

/**
 * Render the latency report by reading every JSON file under
 * ~/.achilles/latency/, parsing the samples, computing P50 + P95
 * over the loaded set, and returning a formatted string the CLI's
 * `latency --report` branch writes to stdout.
 *
 * The function is async because it touches the filesystem. When the
 * directory does not exist OR contains no readable samples, the
 * returned string is "samples=0\nP50: n/a\nP95: n/a\n".
 *
 * The optional argument overrides the default LATENCY_DIR — tests
 * inject a tmpdir to avoid touching the user's home directory.
 *
 * @public
 */
export async function renderLatencyReport(
  dir: string = LATENCY_DIR,
): Promise<string> {
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return formatEmpty();
  }
  const samples: LatencySample[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = await readFile(join(dir, entry), "utf8");
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object") continue;
      const root = parsed as { samples?: unknown };
      if (!Array.isArray(root.samples)) continue;
      for (const s of root.samples) {
        if (typeof s !== "object" || s === null) continue;
        const sample = s as Partial<LatencySample>;
        if (
          typeof sample.utteranceId !== "string" ||
          typeof sample.speechEndMs !== "number" ||
          typeof sample.endToEndMs !== "number" ||
          typeof sample.stages !== "object" ||
          sample.stages === null
        ) {
          continue;
        }
        samples.push({
          utteranceId: sample.utteranceId,
          speechEndMs: sample.speechEndMs,
          stages: sample.stages,
          endToEndMs: sample.endToEndMs,
        });
      }
    } catch {
      // skip malformed JSON
    }
  }
  if (samples.length === 0) {
    return formatEmpty();
  }
  const endToEnds = samples.map((s) => s.endToEndMs);
  const p50 = percentile(endToEnds, 50);
  const p95 = percentile(endToEnds, 95);
  const lines: string[] = [];
  lines.push(`samples=${String(samples.length)}`);
  lines.push(`P50: ${formatMs(p50)}`);
  lines.push(`P95: ${formatMs(p95)}`);
  // Per-stage P50 over speech_end -> stage durations.
  for (const stage of ALL_STAGES_WITH_ANCHOR) {
    if (stage === "speech_end") continue;
    const stageDurations: number[] = [];
    for (const s of samples) {
      const ts = s.stages[stage];
      if (typeof ts === "number") {
        stageDurations.push(ts - s.speechEndMs);
      }
    }
    const stageP50 = percentile(stageDurations, 50);
    lines.push(`${stage}: P50=${formatMs(stageP50)}`);
  }
  return lines.join("\n") + "\n";
}

function formatEmpty(): string {
  return "samples=0\nP50: n/a\nP95: n/a\n";
}

function formatMs(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)}ms`;
}
