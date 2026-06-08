/**
 * Phase 18, Plan 03, Task 2 — Transcript retention module.
 *
 * Requirements:
 *   - SAFE-02: 30-day retention default — cleanupOldTranscripts deletes
 *     files older than `days` days from ~/.achilles/transcripts/ on every
 *     call (typically called by createTranscriptStore on every append,
 *     or by the caller at startup — NOT via cron or timers).
 *
 * The function is async to remain compatible with a future async fs
 * implementation; internally it uses synchronous fs APIs for simplicity.
 *
 * All filesystem operations are injectable via deps seams so tests run
 * hermetically.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import {
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Exported constants + types
// ---------------------------------------------------------------------------

/**
 * Default retention window: 30 days.
 *
 * @public
 */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Dependency injection seam for cleanupOldTranscripts. Tests inject
 * homedirImpl to point at a tmpdir; other seams are available for clock or
 * fs overrides.
 *
 * @public
 */
export interface RetentionDeps {
  homedirImpl?: () => string;
  nowImpl?: () => number;
  readdirImpl?: (path: string) => string[];
  statMtimeImpl?: (path: string) => number;
  unlinkImpl?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Delete all .jsonl files in ~/.achilles/transcripts/ whose mtime is older
 * than `days` days. Non-.jsonl files are ignored. If the directory does not
 * exist, returns { deletedCount: 0, keptCount: 0 } without throwing.
 *
 * @public
 */
export function cleanupOldTranscripts(
  days: number = DEFAULT_RETENTION_DAYS,
  deps: RetentionDeps = {},
): Promise<{ deletedCount: number; keptCount: number }> {
  const homedirImpl = deps.homedirImpl ?? homedir;
  const nowImpl = deps.nowImpl ?? Date.now;
  const readdirImpl = deps.readdirImpl ?? readdirSync;
  const statMtimeImpl =
    deps.statMtimeImpl ?? ((p: string) => statSync(p).mtimeMs);
  const unlinkImpl = deps.unlinkImpl ?? unlinkSync;

  const dir = join(homedirImpl(), ".achilles", "transcripts");
  if (!existsSync(dir)) {
    return Promise.resolve({ deletedCount: 0, keptCount: 0 });
  }

  let entries: string[];
  try {
    entries = readdirImpl(dir);
  } catch {
    return Promise.resolve({ deletedCount: 0, keptCount: 0 });
  }

  const cutoffMs = nowImpl() - days * 24 * 3600 * 1000;
  let deletedCount = 0;
  let keptCount = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const fullPath = join(dir, entry);
    let mtimeMs: number;
    try {
      mtimeMs = statMtimeImpl(fullPath);
    } catch {
      // If we can't stat, skip it
      continue;
    }
    if (mtimeMs < cutoffMs) {
      try {
        unlinkImpl(fullPath);
        deletedCount++;
      } catch {
        // best-effort — if we can't delete, count it as kept
        keptCount++;
      }
    } else {
      keptCount++;
    }
  }

  return Promise.resolve({ deletedCount, keptCount });
}
