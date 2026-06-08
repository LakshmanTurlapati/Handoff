/**
 * Phase 18, Plan 03, Task 2 — Transcripts CLI subcommand handlers.
 *
 * Requirements:
 *   - SAFE-02: achilles transcripts list / purge subcommands.
 *
 * This module is the body that Plan 04's `await import("./transcripts/cli.js")`
 * invokes. It is NOT wired to cli.ts in Plan 03; Plan 04 handles that.
 *
 * transcriptsList():
 *   - Reads ~/.achilles/transcripts/
 *   - If absent -> prints "No transcripts on disk."
 *   - For each .jsonl: prints filename + first user-line preview (truncated to 80 chars)
 *   - If no user line in a file: prints "(no user transcripts)"
 *
 * transcriptsPurge():
 *   - Shows @clack/prompts.select with options: Delete all, Delete older than 30 days,
 *     Delete older than 7 days, Cancel
 *   - Handles the selection and invokes cleanupOldTranscripts or bulk delete
 *   - On cancel/isCancel prints "Cancelled."
 *
 * All operations are injectable via deps seams so tests run hermetically.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cleanupOldTranscripts } from "./retention.js";

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Injection seam for transcriptsList and transcriptsPurge. Tests inject all
 * fields to run hermetically without touching the real filesystem or stdin.
 *
 * @public
 */
export interface TranscriptsCliDeps {
  homedirImpl?: () => string;
  writeLineImpl?: (line: string) => void;
  /** selectImpl: async function taking no args returning the selected value string */
  selectImpl?: () => Promise<string | symbol>;
  isCancelImpl?: (v: unknown) => boolean;
  /**
   * Override for cleanupOldTranscripts — injected by tests asserting the call
   * and its arguments. If omitted, the real cleanupOldTranscripts is used.
   */
  cleanupImpl?: (
    days: number,
  ) => Promise<{ deletedCount: number; keptCount: number }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getTranscriptsDir(deps: TranscriptsCliDeps): string {
  const homedirImpl = deps.homedirImpl ?? homedir;
  return join(homedirImpl(), ".achilles", "transcripts");
}

function writeLine(deps: TranscriptsCliDeps, line: string): void {
  if (deps.writeLineImpl) {
    deps.writeLineImpl(line);
  } else {
    process.stdout.write(line + "\n");
  }
}

/**
 * Extract the first user-line text from a JSONL file, truncated to 80 chars.
 * Returns undefined when no user line is found.
 */
function extractFirstUserLine(filePath: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed["type"] === "user" && typeof parsed["text"] === "string") {
        const text = parsed["text"];
        return text.length > 80 ? text.slice(0, 80) : text;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

/**
 * List all transcripts in ~/.achilles/transcripts/.
 *
 * @public
 */
export function transcriptsList(
  deps: TranscriptsCliDeps = {},
): Promise<void> {
  const dir = getTranscriptsDir(deps);

  if (!existsSync(dir)) {
    writeLine(deps, "No transcripts on disk.");
    return Promise.resolve();
  }

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    writeLine(deps, "No transcripts on disk.");
    return Promise.resolve();
  }

  const jsonlFiles = entries.filter((e) => e.endsWith(".jsonl"));

  if (jsonlFiles.length === 0) {
    writeLine(deps, "No transcripts on disk.");
    return Promise.resolve();
  }

  for (const filename of jsonlFiles) {
    const filePath = join(dir, filename);
    const preview = extractFirstUserLine(filePath);
    if (preview !== undefined) {
      writeLine(deps, `${filename}: ${preview}`);
    } else {
      writeLine(deps, `${filename}: (no user transcripts)`);
    }
  }
  return Promise.resolve();
}

/**
 * Interactive purge handler for ~/.achilles/transcripts/.
 *
 * @public
 */
export async function transcriptsPurge(
  deps: TranscriptsCliDeps = {},
): Promise<void> {
  const dir = getTranscriptsDir(deps);

  // Resolve the select function (lazy-import @clack/prompts in production)
  let selection: string | symbol;
  if (deps.selectImpl !== undefined) {
    selection = await deps.selectImpl();
  } else {
    const clack = await import("@clack/prompts");
    const clackResult = await clack.select({
      message: "Purge transcripts?",
      options: [
        { value: "all", label: "Delete all" },
        { value: "30d", label: "Delete older than 30 days" },
        { value: "7d", label: "Delete older than 7 days" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    selection = clackResult as unknown as string | symbol;
  }

  // Check for cancel
  const isCancelImpl = deps.isCancelImpl;
  const isCancel =
    isCancelImpl !== undefined
      ? isCancelImpl(selection)
      : ((): boolean => {
          // Production: use @clack/prompts.isCancel lazily
          // In production path we already imported clack above; here we do
          // synchronous check via the internal cancel symbol heuristic
          return typeof selection === "symbol";
        })();

  if (isCancel || selection === "cancel") {
    writeLine(deps, "Cancelled.");
    return;
  }

  if (selection === "all") {
    if (!existsSync(dir)) {
      writeLine(deps, "No transcripts found.");
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      writeLine(deps, "No transcripts found.");
      return;
    }
    const jsonlFiles = entries.filter((e) => e.endsWith(".jsonl"));
    for (const filename of jsonlFiles) {
      try {
        unlinkSync(join(dir, filename));
      } catch {
        // best-effort
      }
    }
    writeLine(deps, `Deleted ${String(jsonlFiles.length)} transcript file(s).`);
    return;
  }

  const cleanupFn = deps.cleanupImpl ?? cleanupOldTranscripts;

  if (selection === "30d") {
    const result = await cleanupFn(30);
    writeLine(
      deps,
      `Deleted ${String(result.deletedCount)} file(s); kept ${String(result.keptCount)}.`,
    );
    return;
  }

  if (selection === "7d") {
    const result = await cleanupFn(7);
    writeLine(
      deps,
      `Deleted ${String(result.deletedCount)} file(s); kept ${String(result.keptCount)}.`,
    );
    return;
  }
}
