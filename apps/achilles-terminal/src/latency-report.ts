/**
 * Phase 18, Plan 03, Task 3 — Latency report CLI wrapper module.
 *
 * Requirements:
 *   - ERR-07: achilles latency --report prints rolling-window P50/P95 computed
 *     from the JSON files written by Phase 17's latency-probe.ts.
 *
 * This module is the thin CLI-side wrapper that Plan 04's cli.ts dynamic-imports
 * and calls. Phase 17 already shipped renderLatencyReport() in latency-probe.ts;
 * this wrapper exists so Plan 04's cli.ts doesn't need to know the internal path
 * of Phase 17's latency-probe.ts. The wrapper is intentionally small — all
 * computation stays in Phase 17's code.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import { renderLatencyReport, LATENCY_DIR } from "./latency-probe.js";

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Dependency injection seam for runLatencyReport.
 *
 * @public
 */
export interface LatencyReportDeps {
  /**
   * Override the default LATENCY_DIR (~/.achilles/latency/).
   * Tests inject a tmpdir to avoid touching the real home directory.
   */
  dirOverride?: string;
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Render the latency report by delegating to Phase 17's renderLatencyReport().
 * Returns a formatted multi-line string the CLI's `latency --report` branch
 * writes to stdout.
 *
 * @public
 */
export async function runLatencyReport(
  deps: LatencyReportDeps = {},
): Promise<string> {
  const dir = deps.dirOverride ?? LATENCY_DIR;
  return renderLatencyReport(dir);
}
