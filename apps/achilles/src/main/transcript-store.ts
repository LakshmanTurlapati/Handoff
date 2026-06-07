/**
 * Plan 14-02 — Opt-in transcript persistence (SAFE-02).
 *
 * The TranscriptStore manages an append-only JSONL log on disk at the
 * user's documented data directory (production wiring uses
 * `~/.achilles/transcripts/`). Persistence is OFF by default — the
 * SAFE-02 invariant is structural, not behavioural: when
 * `enabled === false` the store's appendTurn is a synchronous no-op
 * that never touches any filesystem seam (verified by TS2 + TS10).
 *
 * Per-day filename rotation (`YYYY-MM-DD.jsonl` in UTC) caps file size
 * in practice. Each line is a strict shape:
 *
 *   { ts: ISO-8601, role: 'user' | 'assistant', text: string }
 *
 * Retention sweep at construction time deletes JSONL files older than
 * `retentionDays` (default 30; configurable via
 * `ACHILLES_TRANSCRIPT_RETENTION_DAYS` env at the production wiring
 * site). Per-session purge / list operator surfaces are exposed via the
 * `achilles transcripts purge` and `achilles transcripts list` CLI
 * subcommands which route through the same regex + readDir + statFile
 * helper shapes documented here.
 *
 * Privacy invariants (Threat T-14-06, T-14-07):
 *
 *   - When enabled=false, ZERO filesystem ops. The writeFileImpl spy
 *     MUST never be invoked under any code path (TS2, TS10).
 *   - The logger seam NEVER receives transcript text. Log lines carry
 *     filenames, byte counts, and line counts only. Verified by TS9 +
 *     a grep guard in the Task 1 verify command.
 *   - The on-screen RecordingIndicator (rendered by App.tsx when
 *     ACHILLES_SAVE_TRANSCRIPTS=1 broadcasts through
 *     IPC_TRANSCRIPT_PERSISTENCE_STATE) is the user's visible
 *     affordance that persistence is active.
 *
 * Threat model (PLAN.md):
 *
 *   - T-14-06 mitigate — default OFF structurally enforced; persisted
 *     files live under per-user OS perms.
 *   - T-14-07 mitigate — log lines carry filenames + counts only.
 *   - T-14-08 accept   — purge is intentional destructive op.
 *   - T-14-09 accept   — external rogue write under transcripts dir is
 *                         out of scope (attacker already owns home dir).
 *   - T-14-10 mitigate — retention sweep + per-day filename rotation.
 *   - T-14-11 accept   — user opted in via `--save-transcripts`.
 *   - T-14-12 mitigate — Plan 14-02 ships text-only; no audio bytes.
 */

/**
 * Locked default retention window. Files matching the JSONL regex
 * older than this many days (computed from the parsed `YYYY-MM-DD`
 * filename in UTC) are deleted during applyRetention. The production
 * index.ts wiring overrides via `ACHILLES_TRANSCRIPT_RETENTION_DAYS`
 * when set; tests pass an explicit value.
 *
 * @public
 */
export const DEFAULT_RETENTION_DAYS = 30;

/**
 * Filename regex used by every helper that walks the transcripts
 * directory. Pinned here so cli/commands/transcripts.ts and the
 * store's own list / purge / retention sweep all agree on what counts
 * as a transcript file. A file like `notes.txt` or a stray
 * `2025-12-31.jsonl.tmp` is NOT matched and never purged.
 *
 * The pattern requires exactly `YYYY-MM-DD.jsonl` with the four/two/two
 * digit blocks per the ISO date prefix.
 *
 * @public
 */
export const TRANSCRIPT_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/**
 * One persisted turn. Captured by appendTurn from session.ts at the
 * two utterance boundaries:
 *
 *   - user      — payload.text from IPC_UTTERANCE_COMMIT (NOT the
 *                  sandwich-wrapped form — we persist what the user
 *                  actually said, not the bridge envelope)
 *   - assistant — the post-normalisation, post-PROMPT-05-override
 *                  summary body (i.e., what the user heard via TTS)
 *
 * @public
 */
export interface TranscriptTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

/**
 * One persisted line on disk. The `ts` field is the ISO-8601 string
 * recorded at append time from `nowImpl()`. The on-disk shape is bit-
 * for-bit `JSON.stringify({ts, role, text}) + '\n'`.
 *
 * @public
 */
export interface PersistedLine {
  readonly ts: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

/**
 * One entry returned by list() — never includes file content.
 *
 * @public
 */
export interface TranscriptListEntry {
  readonly filename: string;
  readonly lineCount: number;
  readonly bytes: number;
}

/**
 * Summary returned by purge() — operator surface.
 *
 * @public
 */
export interface TranscriptPurgeResult {
  readonly fileCount: number;
  readonly totalBytes: number;
}

/**
 * Summary returned by applyRetention() — diagnostic surface.
 *
 * @public
 */
export interface TranscriptRetentionResult {
  readonly deleted: number;
  readonly retained: number;
}

/**
 * Public store handle returned by createTranscriptStore.
 *
 * @public
 */
export interface TranscriptStore {
  /**
   * Append one user/assistant turn to today's JSONL file. SYNC no-op
   * when `enabled === false` — TS2 / TS10 SAFE-02 invariant.
   *
   * When enabled, computes the UTC-day filename from nowImpl, ensures
   * the directory exists via mkdirImpl (recursive), and writes one
   * JSON line followed by '\n' via writeFileImpl in append mode.
   * Filesystem errors are logged via the injected logger (no
   * transcript content surfaces) and otherwise swallowed — a failed
   * write must NOT crash the orchestrator.
   */
  appendTurn(turn: TranscriptTurn): void;
  /**
   * Operator-driven full purge. Walks the transcripts directory,
   * statFile-then-delete on every file matching the JSONL pattern,
   * and returns the file count + byte total. NOT gated on enabled —
   * an operator running `achilles transcripts purge` after a session
   * still wants to clean up files written by a prior `--save-transcripts`
   * launch.
   */
  purge(): TranscriptPurgeResult;
  /**
   * Operator-driven listing. Walks the transcripts directory, computes
   * line count per file via readFileImpl + '\n' count, returns
   * {filename, lineCount, bytes} per matching file. The off-by-one
   * note: a file that does NOT end with a trailing newline counts as
   * N-1 lines (one less than the number of records present). The
   * append path always writes a trailing '\n' so this only manifests
   * for externally-edited files.
   */
  list(): TranscriptListEntry[];
  /**
   * Retention sweep. Reads readDirImpl(dirPath), parses each filename
   * matching the JSONL regex, computes age in days from nowImpl, and
   * deletes any file with `ageDays > retentionDays`. Filesystem
   * errors during the read or per-file delete are logged and skipped
   * — applyRetention is best-effort and never throws.
   */
  applyRetention(): TranscriptRetentionResult;
  /**
   * Returns the construction-time enabled flag. Used by index.ts to
   * decide whether to broadcast `enabled:true` to the renderer for
   * the RecordingIndicator.
   */
  isEnabled(): boolean;
  /**
   * Tear-down. Drops the logger / fs seam references. Subsequent
   * appendTurn / purge / list / applyRetention calls remain safe (the
   * store retains a frozen copy of the seam shapes captured at
   * construction); dispose() is a hint that the operator is finished.
   */
  dispose(): void;
}

/**
 * Subset of the TranscriptStore surface that session.ts depends on.
 * The orchestrator never calls purge / list / applyRetention; the
 * narrower type prevents a misuse from creeping in.
 *
 * @public
 */
export interface TranscriptStoreLike {
  appendTurn(turn: TranscriptTurn): void;
}

/**
 * File-write seam — production binds to `fs.appendFileSync` (append
 * mode). The flag argument is intentionally narrow ("a" only) so a
 * future binding cannot accidentally truncate.
 *
 * @public
 */
export type TranscriptWriteFileImpl = (
  path: string,
  data: string,
  options: { readonly flag: "a" },
) => void;

/**
 * Directory-read seam — production binds to `fs.readdirSync`. The
 * return type is a readonly array of plain strings (basenames, not
 * absolute paths). Tests inject a spy returning a fixed array.
 *
 * @public
 */
export type TranscriptReadDirImpl = (path: string) => readonly string[];

/**
 * Per-file stat seam — production binds to `fs.statSync` with the
 * narrow fields the store consumes (size + mtime). Tests inject a spy
 * with deterministic fixtures.
 *
 * @public
 */
export type TranscriptStatFileImpl = (path: string) => {
  readonly size: number;
  readonly mtime: Date;
};

/**
 * Per-file delete seam — production binds to `fs.unlinkSync`. Tests
 * inject a spy that records calls.
 *
 * @public
 */
export type TranscriptDeleteFileImpl = (path: string) => void;

/**
 * Directory-create seam — production binds to `fs.mkdirSync` with the
 * recursive option. Tests inject a spy that records calls.
 *
 * @public
 */
export type TranscriptMkdirImpl = (
  path: string,
  options: { readonly recursive: true },
) => void;

/**
 * File-read seam — production binds to `fs.readFileSync` (utf8). Used
 * only by list() so the line count is computed without re-implementing
 * line scanning logic. Tests inject a spy returning canned strings.
 *
 * @public
 */
export type TranscriptReadFileImpl = (
  path: string,
  encoding: "utf8",
) => string;

/**
 * Construction-time dependencies for createTranscriptStore. Every
 * external surface is behind a callable so tests can substitute
 * deterministic fakes without monkey-patching imports.
 *
 * @public
 */
export interface CreateTranscriptStoreDeps {
  /**
   * Master enable flag. When false, every appendTurn call is a SYNC
   * no-op and NO filesystem seam is invoked — the SAFE-02 default-off
   * structural invariant.
   *
   * Production wiring reads `process.env.ACHILLES_SAVE_TRANSCRIPTS === "1"`
   * at bootstrap; tests pass true or false explicitly.
   */
  readonly enabled: boolean;
  /**
   * Absolute path to the transcripts directory. Production uses
   * `path.join(os.homedir(), ".achilles", "transcripts")`; tests pass a
   * fixture path.
   */
  readonly dirPath: string;
  /**
   * Rolling retention window in days. Defaults to
   * DEFAULT_RETENTION_DAYS (30) when undefined; production reads
   * `ACHILLES_TRANSCRIPT_RETENTION_DAYS` env when set.
   */
  readonly retentionDays?: number;
  /**
   * File-append seam. Required when enabled=true. When enabled=false
   * the seam is NEVER invoked (TS2 / TS10 invariant); tests still
   * pass a spy so the test can assert call count === 0.
   */
  readonly writeFileImpl: TranscriptWriteFileImpl;
  /**
   * Directory-read seam. Used by list / purge / applyRetention.
   */
  readonly readDirImpl: TranscriptReadDirImpl;
  /**
   * Per-file stat seam. Used by purge / list / applyRetention.
   */
  readonly statFileImpl: TranscriptStatFileImpl;
  /**
   * Per-file delete seam. Used by purge / applyRetention.
   */
  readonly deleteFileImpl: TranscriptDeleteFileImpl;
  /**
   * Directory-create seam. Used by appendTurn (recursive:true).
   * When enabled=false the seam is NEVER invoked (TS2 invariant).
   */
  readonly mkdirImpl: TranscriptMkdirImpl;
  /**
   * File-read seam. Used by list() only.
   */
  readonly readFileImpl: TranscriptReadFileImpl;
  /**
   * Clock seam. Returns the current Date. Tests inject a frozen / fake
   * clock for filename rotation + retention age determinism.
   */
  readonly nowImpl: () => Date;
  /**
   * Logger seam — defaults to a no-op when undefined so production can
   * pass a `[achilles]`-prefixed logger binding without worrying about
   * retro-fitting a logger across the codebase. The seam MUST NOT
   * receive any transcript text — the log line in append / purge /
   * list carries only filenames, byte counts, and line counts. TS9
   * asserts.
   */
  readonly logger?: (msg: string) => void;
}

/**
 * Compute today's UTC-day filename. The store always writes to the
 * UTC day boundary so a session that crosses midnight produces two
 * files cleanly (no race; the next appendTurn reads the new date and
 * writes to the new file).
 */
function dailyFilename(now: Date): string {
  return `${now.toISOString().slice(0, 10)}.jsonl`;
}

/**
 * Parse a `YYYY-MM-DD.jsonl` basename into a Date at UTC midnight.
 * Returns null when the basename does NOT match the regex.
 */
function parseFilenameDate(basename: string): Date | null {
  if (!TRANSCRIPT_FILENAME_REGEX.test(basename)) return null;
  const dayPart = basename.slice(0, 10);
  // Append the UTC midnight suffix so the Date is built deterministic-
  // ally regardless of the host's timezone. Date constructor for an
  // ISO-8601 string with `Z` returns the same epoch on every machine.
  const parsed = new Date(`${dayPart}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * Count '\n' occurrences in the supplied string. We do not use
 * `split` because a file ending without a trailing newline would yield
 * N entries (one more than the line count we want). Counting '\n' is
 * the documented N-1 semantic.
 */
function countNewlines(content: string): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 0x0a /* \n */) count++;
  }
  return count;
}

/**
 * Joins a directory path and a basename with a platform-appropriate
 * separator. We avoid pulling in node:path so the file is trivially
 * portable to a future Deno / browser build target; the only
 * separator we need is the OS-native one and we infer it from the
 * incoming dirPath.
 */
function joinPath(dirPath: string, basename: string): string {
  if (dirPath.length === 0) return basename;
  const last = dirPath.charAt(dirPath.length - 1);
  if (last === "/" || last === "\\") {
    return `${dirPath}${basename}`;
  }
  // Default to '/' — matches macOS + Linux + the documented dirPath
  // shape (`~/.achilles/transcripts/`). Windows paths still use '/' in
  // most node APIs; appendFileSync accepts forward slashes there too.
  return `${dirPath}/${basename}`;
}

/**
 * Construct a TranscriptStore. When `enabled === true`, runs the
 * retention sweep once at construction time so older files are
 * cleaned up on each app launch.
 *
 * @public
 */
export function createTranscriptStore(
  deps: CreateTranscriptStoreDeps,
): TranscriptStore {
  const enabled = deps.enabled;
  const dirPath = deps.dirPath;
  const retentionDays = deps.retentionDays ?? DEFAULT_RETENTION_DAYS;
  let writeFileImpl: TranscriptWriteFileImpl | null = deps.writeFileImpl;
  let readDirImpl: TranscriptReadDirImpl | null = deps.readDirImpl;
  let statFileImpl: TranscriptStatFileImpl | null = deps.statFileImpl;
  let deleteFileImpl: TranscriptDeleteFileImpl | null = deps.deleteFileImpl;
  let mkdirImpl: TranscriptMkdirImpl | null = deps.mkdirImpl;
  let readFileImpl: TranscriptReadFileImpl | null = deps.readFileImpl;
  const nowImpl = deps.nowImpl;
  const logger = deps.logger ?? ((_msg: string): void => undefined);
  let disposed = false;

  function appendTurn(turn: TranscriptTurn): void {
    // TS2 / TS10 SAFE-02 invariant: when disabled, EVERY seam is
    // bypassed. No mkdirImpl, no writeFileImpl, no statFileImpl —
    // nothing. The function returns synchronously without touching
    // the filesystem.
    if (!enabled) return;
    if (disposed) return;
    if (writeFileImpl === null || mkdirImpl === null) return;
    const now = nowImpl();
    const filename = dailyFilename(now);
    const filePath = joinPath(dirPath, filename);
    // Ensure the directory exists. recursive:true is idempotent so
    // calling on every append is cheap (an in-kernel mkdir-EEXIST is
    // ~microseconds); a file-system error here propagates to the
    // catch below.
    try {
      mkdirImpl(dirPath, { recursive: true });
    } catch (err) {
      logger(
        `[achilles] transcript-store mkdir failed: ${(err as Error).message}`,
      );
      return;
    }
    const line: PersistedLine = {
      ts: now.toISOString(),
      role: turn.role,
      text: turn.text,
    };
    const serialised = `${JSON.stringify(line)}\n`;
    try {
      writeFileImpl(filePath, serialised, { flag: "a" });
    } catch (err) {
      // Best-effort. We log filename + error message but NEVER the
      // turn.text content. T-14-07 mitigation.
      logger(
        `[achilles] transcript-store append failed: file=${filename} err=${(err as Error).message}`,
      );
      return;
    }
    logger(
      `[achilles] transcript-store append: file=${filename} role=${turn.role} bytes=${serialised.length}`,
    );
  }

  function purge(): TranscriptPurgeResult {
    if (disposed) return { fileCount: 0, totalBytes: 0 };
    if (
      readDirImpl === null ||
      statFileImpl === null ||
      deleteFileImpl === null
    ) {
      return { fileCount: 0, totalBytes: 0 };
    }
    let entries: readonly string[];
    try {
      entries = readDirImpl(dirPath);
    } catch (err) {
      logger(
        `[achilles] transcript-store purge readdir failed: ${(err as Error).message}`,
      );
      return { fileCount: 0, totalBytes: 0 };
    }
    let totalBytes = 0;
    let fileCount = 0;
    for (const basename of entries) {
      if (!TRANSCRIPT_FILENAME_REGEX.test(basename)) continue;
      const filePath = joinPath(dirPath, basename);
      let size = 0;
      try {
        const st = statFileImpl(filePath);
        size = st.size;
      } catch (err) {
        logger(
          `[achilles] transcript-store purge stat failed: file=${basename} err=${(err as Error).message}`,
        );
        continue;
      }
      try {
        deleteFileImpl(filePath);
      } catch (err) {
        logger(
          `[achilles] transcript-store purge delete failed: file=${basename} err=${(err as Error).message}`,
        );
        continue;
      }
      totalBytes += size;
      fileCount += 1;
    }
    logger(
      `[achilles] transcript-store purge: files=${fileCount} bytes=${totalBytes}`,
    );
    return { fileCount, totalBytes };
  }

  function list(): TranscriptListEntry[] {
    if (disposed) return [];
    if (
      readDirImpl === null ||
      statFileImpl === null ||
      readFileImpl === null
    ) {
      return [];
    }
    let entries: readonly string[];
    try {
      entries = readDirImpl(dirPath);
    } catch (err) {
      logger(
        `[achilles] transcript-store list readdir failed: ${(err as Error).message}`,
      );
      return [];
    }
    const out: TranscriptListEntry[] = [];
    for (const basename of entries) {
      if (!TRANSCRIPT_FILENAME_REGEX.test(basename)) continue;
      const filePath = joinPath(dirPath, basename);
      let size = 0;
      try {
        const st = statFileImpl(filePath);
        size = st.size;
      } catch (err) {
        logger(
          `[achilles] transcript-store list stat failed: file=${basename} err=${(err as Error).message}`,
        );
        continue;
      }
      let lineCount = 0;
      try {
        const content = readFileImpl(filePath, "utf8");
        lineCount = countNewlines(content);
      } catch (err) {
        logger(
          `[achilles] transcript-store list readfile failed: file=${basename} err=${(err as Error).message}`,
        );
        continue;
      }
      out.push({ filename: basename, lineCount, bytes: size });
    }
    // Stable sort by filename so the output is deterministic across
    // OSes that vary readdir ordering.
    out.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
    logger(
      `[achilles] transcript-store list: files=${out.length}`,
    );
    return out;
  }

  function applyRetention(): TranscriptRetentionResult {
    if (disposed) return { deleted: 0, retained: 0 };
    if (readDirImpl === null || deleteFileImpl === null) {
      return { deleted: 0, retained: 0 };
    }
    let entries: readonly string[];
    try {
      entries = readDirImpl(dirPath);
    } catch (err) {
      logger(
        `[achilles] transcript-store retention readdir failed: ${(err as Error).message}`,
      );
      return { deleted: 0, retained: 0 };
    }
    let deleted = 0;
    let retained = 0;
    const now = nowImpl().getTime();
    for (const basename of entries) {
      const parsed = parseFilenameDate(basename);
      if (parsed === null) continue;
      const ageDays = (now - parsed.getTime()) / 86_400_000;
      if (ageDays > retentionDays) {
        const filePath = joinPath(dirPath, basename);
        try {
          deleteFileImpl(filePath);
          deleted += 1;
        } catch (err) {
          logger(
            `[achilles] transcript-store retention delete failed: file=${basename} err=${(err as Error).message}`,
          );
        }
      } else {
        retained += 1;
      }
    }
    logger(
      `[achilles] transcript-store retention sweep: deleted=${deleted} retained=${retained} retentionDays=${retentionDays}`,
    );
    return { deleted, retained };
  }

  function isEnabled(): boolean {
    return enabled;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    writeFileImpl = null;
    readDirImpl = null;
    statFileImpl = null;
    deleteFileImpl = null;
    mkdirImpl = null;
    readFileImpl = null;
  }

  // Run the retention sweep ONCE at construction time when enabled.
  // The TS6 behaviour is verified by the test: a clock seam that
  // pushes the cutoff returns a known {deleted, retained}. When
  // disabled, the retention sweep is also skipped so the disabled
  // path is bit-for-bit zero filesystem ops (TS2 invariant).
  if (enabled) {
    applyRetention();
  }

  return {
    appendTurn,
    purge,
    list,
    applyRetention,
    isEnabled,
    dispose,
  };
}
