/**
 * `achilles latency --report` — Plan 14-01 offline LOOP-06 report.
 *
 * Reads the rolling-window JSON sample file written by the Electron
 * main process (when ACHILLES_DEBUG=1) and prints a human-readable
 * P50 / P95 summary to stdout. The CLI process is offline-only — it
 * does NOT spawn the Electron app, mint an STT token, or touch the
 * ElevenLabs/Claude surface. The sample file IS the inter-process
 * channel.
 *
 * Surface contract:
 *
 *   - `achilles latency --report`  → read file, print P50 / P95, exit 0
 *   - `achilles latency`           → "Specify --report" stderr, exit 1
 *   - file missing                  → "no samples yet" stdout, exit 0
 *   - file malformed (bad JSON)     → "sample file is malformed" stderr, exit 1
 *   - file present but {samples:[]} → "no samples yet" stdout, exit 0
 *
 * The module imports nothing from `node:fs` directly — all I/O routes
 * through the injected `readFileImpl` seam. This mirrors the Plan
 * 13-01 transcripts.ts stub pattern and lets tests drive every branch
 * (LC1..LC4) without touching the real filesystem.
 *
 * Percentile math is duplicated locally (one small R-7 helper) rather
 * than imported from `@achilles/app/main/latency-probe.ts`. The
 * cross-package import would require adding `@achilles/app` as a
 * bundledDependency of the achilles npm package, which is not viable
 * (apps/achilles is the Electron app, not a publishable library; its
 * cross-package types would not resolve in the dist build). The math
 * is small enough that duplication has a lower maintenance cost than
 * the cross-package coupling.
 *
 * Threat model: T-14-03 (tampering) — a malicious local process could
 * overwrite the sample file with bogus numbers; the worst case is a
 * bogus P50/P95 in the offline report. The subcommand never executes
 * arbitrary code from the file content; we use JSON.parse only.
 *
 * @public
 */

/**
 * Subset of `node:stream` Writable used by latencyCommand. Mirrors
 * `WritableSeam` in the sibling commands so the cli.ts production
 * wiring can pass `process.stdout` / `process.stderr` directly.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Per the LP module, a completed utterance sample carries the
 * utterance UUID + the speech-end anchor + per-stage timestamps + the
 * LOOP-06 end-to-end duration. The latency.ts surface only consumes
 * `endToEndMs` from each sample; the other fields are tolerated but
 * not required.
 *
 * @public
 */
export interface LatencySample {
  readonly utteranceId: string;
  readonly speechEndMs: number;
  readonly stages: Readonly<Record<string, number>>;
  readonly endToEndMs: number;
}

/**
 * Expected JSON shape on disk. The file is written by main's
 * LatencyProbe.writeRollingWindow() and re-read here. Fields beyond
 * `samples` are tolerated (forward-compat) but not used.
 *
 * @public
 */
export interface LatencySampleFile {
  readonly samples: ReadonlyArray<LatencySample>;
  readonly updatedAt?: string;
}

/**
 * Injected dependencies for latencyCommand.
 *
 * @public
 */
export interface LatencyCommandDeps {
  /**
   * Verbatim subcommand string captured from commander's option helper.
   * Currently the only supported value is "--report"; any other value
   * (including empty) triggers the "Specify --report" error path.
   */
  readonly subcommand: string;
  /**
   * Absolute filesystem path to the rolling-window JSON file written
   * by main. Production wiring uses
   * `path.join(os.homedir(), ".achilles", "latency-samples.json")`;
   * tests inject a fixture path.
   */
  readonly reportPath: string;
  /**
   * Synchronous read seam. Production binds to
   * `(p) => fs.readFileSync(p, "utf8")`; tests inject a spy that
   * returns canned JSON or throws ENOENT.
   *
   * The seam throws on missing files (matching node:fs's ENOENT
   * behaviour). The handler treats any throw as "no samples yet"
   * unless the file was found AND parsed but the content is not the
   * expected JSON shape — in which case the handler exits 1 with a
   * "malformed" message.
   */
  readonly readFileImpl: (path: string) => string;
  /**
   * Stdout sink — the "no samples yet" and report summary lines are
   * written here.
   */
  readonly stdout: WritableSeam;
  /**
   * Stderr sink — the "Specify --report" and "malformed file" error
   * lines are written here.
   */
  readonly stderr: WritableSeam;
  /**
   * Process-exit seam. Production binds to `(code) => process.exit(code)`;
   * tests inject a spy. The handler NEVER calls `process.exit` directly.
   */
  readonly processExitImpl: (code: number) => void;
}

/**
 * Compute the percentile of an array using the R-7 method (linear
 * interpolation between the two nearest ranks). Pure function;
 * duplicated locally for the achilles-cli surface — see file-level
 * docstring for the rationale.
 */
function percentile(values: ReadonlyArray<number>, p: number): number {
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
 * Type guard for the rolling-window file shape. Tolerates extra
 * fields and missing optional fields; rejects non-object roots and
 * non-array `samples`.
 */
function isLatencySampleFile(value: unknown): value is LatencySampleFile {
  if (value === null || typeof value !== "object") return false;
  const obj = value as { samples?: unknown };
  return Array.isArray(obj.samples);
}

/**
 * Format the human-readable summary block written to stdout.
 *
 * Layout (locked — tests assert content):
 *
 *   [achilles] LOOP-06 latency report
 *     samples:       N
 *     P50 endToEnd:  X.XX ms
 *     P95 endToEnd:  Y.YY ms
 *
 * No emojis, no transcript fragments, no API key fragments — the file
 * content is timing numbers + utterance UUIDs only by construction.
 */
function formatReport(samples: ReadonlyArray<LatencySample>): string {
  const endToEnds = samples.map((s) => s.endToEndMs);
  const p50 = percentile(endToEnds, 50);
  const p95 = percentile(endToEnds, 95);
  const lines: string[] = [];
  lines.push("[achilles] LOOP-06 latency report");
  lines.push(`  samples:       ${samples.length}`);
  lines.push(`  P50 endToEnd:  ${formatMs(p50)}`);
  lines.push(`  P95 endToEnd:  ${formatMs(p95)}`);
  lines.push(`  budget:        P50 < 1000 ms, P95 < 1500 ms`);
  lines.push(`  status:        ${budgetStatus(p50, p95)}`);
  return lines.join("\n") + "\n";
}

function formatMs(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  return `${n.toFixed(2)} ms`;
}

function budgetStatus(p50: number, p95: number): string {
  if (!Number.isFinite(p50) || !Number.isFinite(p95)) return "insufficient samples";
  const p50Ok = p50 < 1000;
  const p95Ok = p95 < 1500;
  if (p50Ok && p95Ok) return "within budget";
  if (!p50Ok && !p95Ok) return "BREACH: P50 AND P95 over budget";
  if (!p50Ok) return "BREACH: P50 over budget";
  return "BREACH: P95 over budget";
}

const NO_SAMPLES_MESSAGE =
  "[achilles] No latency samples recorded yet. Run achilles --debug and complete an utterance first.\n";

/**
 * Run the offline report. See file-level contract for behaviour.
 *
 * @public
 */
export function latencyCommand(deps: LatencyCommandDeps): void {
  const { subcommand, reportPath, readFileImpl, stdout, stderr, processExitImpl } =
    deps;
  if (subcommand !== "--report") {
    stderr.write(
      "[achilles] Specify --report to print the rolling-window summary.\n",
    );
    processExitImpl(1);
    return;
  }
  let raw: string;
  try {
    raw = readFileImpl(reportPath);
  } catch {
    // Missing file — the user has not yet run `achilles --debug` so
    // the rolling window has no entries. This is informational, not
    // an error: exit 0 so a shell loop calling `achilles latency
    // --report` repeatedly does not pollute the CI exit-code surface.
    stdout.write(NO_SAMPLES_MESSAGE);
    processExitImpl(0);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    stderr.write(
      `[achilles] Latency sample file is malformed: ${reportPath}\n`,
    );
    processExitImpl(1);
    return;
  }
  if (!isLatencySampleFile(parsed)) {
    stderr.write(
      `[achilles] Latency sample file is malformed: ${reportPath}\n`,
    );
    processExitImpl(1);
    return;
  }
  if (parsed.samples.length === 0) {
    stdout.write(NO_SAMPLES_MESSAGE);
    processExitImpl(0);
    return;
  }
  stdout.write(formatReport(parsed.samples));
  processExitImpl(0);
}
