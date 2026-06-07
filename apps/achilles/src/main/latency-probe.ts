/**
 * Plan 14-01 — Latency probe (LOOP-06 observability layer).
 *
 * A thin observability layer over the session.ts state machine. The
 * probe is a pure module with no dependency on Electron, ElevenLabs,
 * or the renderer surface; it records timestamps at seven named
 * voice-loop stages and computes per-stage durations plus the
 * end-to-end speech-end → first-audible-byte latency.
 *
 * LOOP-06 budget invariant (REQUIREMENTS.md):
 *
 *   P50 < 1.0 s, P95 < 1.5 s
 *
 * The probe records each stage timestamp, finalises a sample on the
 * first audible TTS byte (the LOOP-06 metric anchor), maintains a
 * rolling FIFO window of the most recent N utterance samples, and
 * exposes P50 / P95 over the end-to-end duration plus per-stage
 * statistics.
 *
 * Two surfaces consume the probe at runtime:
 *
 *   1. The `[achilles-latency]` console log line emitted per utterance
 *      when `debugEnabled=true`. Contains stage durations + utterance
 *      id only; never transcript text, never accumulatedText, never
 *      payload.text, never the ElevenLabs API key. The T-14-01 grep
 *      guard in the verify command asserts this invariant.
 *
 *   2. An on-disk JSON file written under app.getPath('userData') so
 *      the offline `achilles latency --report` CLI subcommand can read
 *      the rolling window without an Electron IPC round-trip. The file
 *      content is timing numbers + utterance UUIDs only.
 *
 * Both surfaces are gated behind explicit opt-in (debugEnabled +
 * writeSampleFile) so a user who runs `achilles` without `--debug`
 * never produces a log line or a sample file. This matches the
 * CONTEXT.md "no off-host telemetry" decision.
 *
 * Threat model (PLAN.md):
 *   - T-14-01 mitigate — log line carries durations + uuid only.
 *   - T-14-02 mitigate — sample file carries durations + uuid only.
 *   - T-14-03 accept   — a tampered file produces a bogus P50 only.
 *   - T-14-04 mitigate — fixed-capacity FIFO + O(N) finalisation.
 *   - T-14-05 accept   — debug log is an opt-in diagnostic surface.
 */

/**
 * The seven named voice-loop stages the probe records. The list is a
 * literal union so a typo at a call site is a compile-time error.
 *
 * Stage ordering (CONTEXT.md):
 *
 *   - stt_committed          — STT WebSocket commits the utterance
 *   - claude_first_text_delta — bridge emits the first assistant_text_delta
 *   - claude_assistant_done   — bridge emits process_exit
 *   - tts_first_chunk         — TTS client open() resolves; the stream
 *                                is ready to accept appendText calls
 *   - tts_playback_start      — first IPC_TTS_CHUNK leaves main; this
 *                                is the LOOP-06 metric anchor for
 *                                "first audible byte"
 *   - tts_playback_complete   — renderer signals the playback queue
 *                                drained the last (isFinal:true) chunk
 *
 * `speech_end` is an implicit anchor set by markSpeechEnd; it is not a
 * recorded stage in the user-facing union but is included in the
 * report's per-stage results so report consumers can see the
 * speech_end → next-stage duration uniformly.
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
 * Full list of stages including the implicit speech_end anchor. Used
 * internally by the report builder so per-stage P50 / P95 maps cover
 * every stage uniformly even when no stage was recorded for a sample
 * (the report uses NaN for missing entries — callers filter as needed).
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
 * One completed utterance sample. `endToEndMs` is the speech_end →
 * tts_playback_start duration in milliseconds — the LOOP-06 metric.
 * `stages` maps each recorded stage to its absolute timestamp (the
 * value returned by nowImpl when the stage was recorded). Per-stage
 * durations are recomputed at report time from the stage map; we keep
 * absolute timestamps in the sample so future analyses can recover
 * any pairwise delta without re-running the probe.
 *
 * @public
 */
export interface LatencySample {
  /**
   * Utterance identifier — usually the UUID assigned at the renderer's
   * STT commit. The probe does not validate the format; it only treats
   * the field as an opaque string. Logging code may include this in
   * `[achilles-latency]` log lines as a correlation anchor; transcript
   * text is NEVER included.
   */
  readonly utteranceId: string;
  /**
   * Speech-end anchor — set by markSpeechEnd, usually the payload's
   * `committedAt` epoch ms forwarded from the renderer's STT client.
   * The end-to-end metric is computed as
   * `stages.tts_playback_start - speechEndMs`.
   */
  readonly speechEndMs: number;
  /**
   * Per-stage absolute timestamps as reported by nowImpl. A missing
   * key indicates the stage was never recorded for this sample (e.g.
   * a defective TTS stream that exited before the first chunk).
   */
  readonly stages: Partial<Record<LatencyStage, number>>;
  /**
   * Speech-end → first-audible-byte duration in milliseconds. This is
   * the LOOP-06 metric. When tts_playback_start is missing, the value
   * is NaN — report.p50EndToEndMs / report.p95EndToEndMs filter NaN
   * samples before percentile computation.
   */
  readonly endToEndMs: number;
}

/**
 * Rolling-window summary surfaced by `report()`. When the window is
 * empty the returned shape collapses to `{sampleCount: 0}` only —
 * percentile fields are absent so callers cannot accidentally treat a
 * fresh process as a "P50=0 / P95=0" sample.
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
 * File-system seam for the optional rolling-window export. Production
 * binds to `node:fs.writeFileSync`; tests inject a spy. Synchronous
 * because finalizeSample runs in the main process's event-loop turn
 * after the first TTS chunk leaves IPC — the write is bounded
 * (`maxWindow` samples × ~200 bytes each = ~4 KB), so the latency
 * cost of a sync write is negligible and we avoid the open-fd
 * lifetime management an async pipeline would require.
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
  /**
   * Clock seam. Production defaults to `() => performance.now()` when
   * undefined. Tests inject a deterministic fake so percentile
   * fixtures produce known values regardless of wall-clock drift.
   */
  readonly nowImpl?: () => number;
  /**
   * When true, the probe emits one `[achilles-latency]` console log
   * line per finalised sample. The line contains the utterance id and
   * per-stage durations in milliseconds; it NEVER contains transcript
   * text, accumulatedText, payload.text, or the API key. Defaults to
   * false.
   */
  readonly debugEnabled?: boolean;
  /**
   * Logger sink — defaults to console.log. The default sink is the
   * only place this module touches console.* directly; production
   * wiring may inject a structured logger.
   */
  readonly logger?: (msg: string) => void;
  /**
   * When true AND `sampleFilePath` is set, finalizeSample writes the
   * current rolling window to that path as JSON. Defaults to false.
   */
  readonly writeSampleFile?: boolean;
  /**
   * Absolute path to the rolling-window JSON file. Required when
   * `writeSampleFile` is true; ignored otherwise.
   */
  readonly sampleFilePath?: string;
  /**
   * Write-file seam. Defaults to `node:fs.writeFileSync` when the
   * file-write surface is active. Tests inject a spy.
   */
  readonly writeFileImpl?: LatencyWriteFileImpl;
  /**
   * Rolling-window capacity. Defaults to 20 (CONTEXT.md decision).
   * The window is a fixed-capacity FIFO; samples beyond the capacity
   * evict the oldest sample.
   */
  readonly maxWindow?: number;
}

/**
 * Public probe handle returned by createLatencyProbe.
 *
 * @public
 */
export interface LatencyProbe {
  /**
   * Set the speech-end anchor for the next utterance sample. Resets
   * any in-flight per-stage map. Typically called from session.ts's
   * onUtteranceCommit handler with the renderer's `committedAt` epoch
   * (the STT WebSocket's commit timestamp).
   */
  markSpeechEnd(epochMs: number, utteranceId: string): void;
  /**
   * Record a stage timestamp for the in-flight sample. When the probe
   * has not yet seen a markSpeechEnd call (e.g. a stray stage event
   * from a previous cancelled utterance), the call is silently
   * ignored — the absent anchor would otherwise corrupt the next
   * sample's end-to-end computation.
   */
  recordStage(stage: LatencyStage, t?: number): void;
  /**
   * Push the in-flight sample into the rolling window AND, when
   * debugEnabled, emit the `[achilles-latency]` log line. When
   * writeSampleFile + sampleFilePath are set, also writes the current
   * rolling window to disk as JSON. Resets the in-flight slot.
   *
   * Called on the first audible TTS byte — the LOOP-06 metric anchor.
   * The sample is complete the moment the first byte is fanned out;
   * subsequent stages (playback_complete) are recorded for diagnostic
   * purposes but do not block the report from publishing.
   */
  finalizeSample(): void;
  /**
   * Return the rolling-window summary. When the window is empty the
   * return shape collapses to `{sampleCount: 0}` only.
   */
  report(): LatencyReport;
  /**
   * Tear-down. Clears the rolling window and drops the writeFileImpl
   * reference. Subsequent recordStage / finalizeSample / report calls
   * are no-ops; `report()` returns `{sampleCount: 0}`.
   */
  dispose(): void;
}

/**
 * Compute the percentile of an array of numbers using the R-7 method
 * (linear interpolation between the two nearest ranks; the same method
 * used by Excel and numpy's default).
 *
 * Pure function; exported so the offline CLI report subcommand can
 * reuse the math without coupling to the probe lifecycle.
 *
 * Behaviour:
 *
 *   - Empty input → NaN
 *   - Single value → that value (any percentile)
 *   - `p` outside [0, 100] is clamped
 *
 * Algorithm (R-7):
 *
 *   sorted = ascending copy
 *   n = sorted.length
 *   idx = (p / 100) * (n - 1)
 *   lo = floor(idx)
 *   hi = ceil(idx)
 *   if lo === hi: return sorted[lo]
 *   return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])
 *
 * Verified against the LP6 fixture: [100, 200, 300, 400, 500] → P50=300, P95=480.
 *
 * @public
 */
export function percentile(values: ReadonlyArray<number>, p: number): number {
  // Filter out NaN entries — a missing stage timestamp manifests as
  // NaN in the per-stage duration map; we treat absent measurements
  // as "not part of the sample" rather than as zero.
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
 * In-flight sample slot — mutable scratch space the probe stamps as
 * stages are recorded. Promoted to a frozen LatencySample by
 * finalizeSample and pushed into the rolling window.
 */
interface InFlightSample {
  utteranceId: string;
  speechEndMs: number;
  stages: Partial<Record<LatencyStage, number>>;
}

/**
 * Construct a LatencyProbe.
 *
 * @public
 */
export function createLatencyProbe(deps: LatencyProbeDeps = {}): LatencyProbe {
  const nowImpl =
    deps.nowImpl ??
    ((): number => {
      // performance.now() is available in Node 16+; fall back to
      // Date.now() if the runtime predates that for any reason.
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
  const maxWindow = Math.max(1, deps.maxWindow ?? 20);

  /**
   * Rolling FIFO of completed samples. We use a plain Array because
   * `maxWindow` is small (20 by default) and the eviction step is
   * O(maxWindow) only when finalizeSample fires — bounded constant.
   */
  let window: LatencySample[] = [];
  let inFlight: InFlightSample | null = null;
  let disposed = false;

  function markSpeechEnd(epochMs: number, utteranceId: string): void {
    if (disposed) return;
    // Reset any prior in-flight slot — a previous utterance that
    // never reached finalizeSample (e.g. cancelled mid-flight) does
    // NOT contaminate the new sample.
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
      // WR-03 fix: tts_playback_complete fires AFTER finalizeSample
      // (the sample finalises on the first audible byte at
      // tts_playback_start; the playback-complete signal arrives once
      // the renderer has drained the last chunk, which is after the
      // first-chunk anchor). Previously the inFlight===null guard
      // silently dropped the call, leaving tts_playback_complete as
      // dead data in the public LatencyStage taxonomy.
      //
      // Retroactively stamp the most recently finalized sample's
      // stages map so report.perStageP50.tts_playback_complete carries
      // observed data. LatencySample is shallow-frozen via Object.freeze
      // but the inner `stages` object is not, so the property write is
      // legal. Only tts_playback_complete is allowed through this
      // post-finalize path — other stages either fired during the
      // sample window or are genuinely missing.
      if (stage !== "tts_playback_complete") return;
      if (window.length === 0) return;
      const lastSample = window[window.length - 1]!;
      if (lastSample.stages.tts_playback_complete !== undefined) return;
      lastSample.stages.tts_playback_complete = ts;
      return;
    }
    // Only record the first observation of each stage per sample —
    // the probe semantics are "first time the stage fired", not "most
    // recent fire". This matches the LOOP-06 metric definition where
    // the first audible byte is the anchor.
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
    // Compose a per-stage duration string. Each duration is the
    // delta from speechEnd to the stage timestamp; absent stages
    // appear as "missing". The line includes the utterance id and
    // the LOOP-06 end-to-end metric.
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
      // Best-effort. A write failure must NOT crash the orchestrator;
      // the rolling window in memory is still authoritative for the
      // current process. The error message is logged WITHOUT the
      // payload body so a path-leak from the OS error message does
      // not surface in operator logs.
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
    while (window.length > maxWindow) {
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
    // Drop the writeFileImpl reference so the GC can collect any
    // closure the production wiring captured.
    writeFileImpl = undefined;
  }

  return {
    markSpeechEnd,
    recordStage,
    finalizeSample,
    report,
    dispose,
  };
}

/**
 * Format a numeric duration for the debug log line. Returns "missing"
 * for NaN entries so the operator can see at a glance which stages
 * never fired for an utterance. Two decimal places are sufficient for
 * the LOOP-06 budget (1000 ms / 1500 ms tolerances).
 */
function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "missing";
  return n.toFixed(2);
}
