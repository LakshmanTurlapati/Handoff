/**
 * `achilles transcripts <subcommand>` — Plan 14-02 FULL IMPLEMENTATION
 * replacing the Plan 13-01 stub.
 *
 * Operator surface for the SAFE-02 transcript persistence file set.
 * The CLI process runs OUTSIDE the Electron app and reads / deletes
 * files at the documented data directory (production wiring uses
 * `~/.achilles/transcripts/`).
 *
 * Subcommands:
 *
 *   - `achilles transcripts purge` — walks the transcripts dir,
 *      deletes EVERY file matching the locked JSONL pattern (NOT only
 *      old ones — purge is an intentional destructive op), prints
 *      "[achilles] Purged N transcript files (BYTES bytes freed)." on
 *      stdout, exits 0.
 *   - `achilles transcripts list` — walks the transcripts dir, prints
 *      one line per matching file: `<filename>\t<lineCount> lines\t<bytes> bytes`,
 *      exits 0. Empty directory prints `[achilles] No transcript files.`
 *
 * Privacy invariants (Threat T-14-06 / T-14-07):
 *
 *   - NO transcript content is ever printed to stdout / stderr. The
 *     list subcommand reads files to compute line counts but ONLY the
 *     count crosses the operator surface — the body never does.
 *   - NO emoji anywhere (CLAUDE.md global).
 *
 * The filename regex is duplicated locally rather than imported from
 * `@achilles/app/main/transcript-store.ts`. The cross-package import
 * would require adding `@achilles/app` as a bundledDependency of the
 * `achilles` npm package, which is not viable (apps/achilles is the
 * Electron app, not a publishable library; its cross-package types
 * would not resolve in the dist build). The constant is small enough
 * that duplication has a lower maintenance cost than the cross-package
 * coupling — this mirrors the Plan 14-01 latency.ts decision for the
 * percentile helper.
 *
 * Threat model: T-13-04 (DoS) — operator-driven; repeated invocations
 * fan out filesystem operations bounded by the directory size.
 * T-14-08 (tampering via purge) — intentional destructive op invoked
 * by the user; we surface the deleted count + bytes so they can
 * confirm.
 *
 * @public
 */

/**
 * Filename regex used to filter transcript files. Pinned identically to
 * `TRANSCRIPT_FILENAME_REGEX` in
 * `apps/achilles/src/main/transcript-store.ts` — keep both sites in
 * sync. Exactly `YYYY-MM-DD.jsonl` per the SAFE-02 file shape.
 *
 * @public
 */
const TRANSCRIPT_FILENAME_REGEX = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/**
 * Subset of `node:stream` Writable used by transcriptsCommand. Mirrors
 * `WritableSeam` in the sibling commands so the cli.ts production
 * wiring can pass `process.stdout` / `process.stderr` directly.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Per-file stat result the subcommand consumes. Production binds to
 * `fs.statSync`; tests pass a spy with deterministic fixtures.
 *
 * @public
 */
export interface TranscriptsStatResult {
  readonly size: number;
  readonly mtime: Date;
}

/**
 * Injected dependencies for transcriptsCommand.
 *
 * The production wiring (in cli.ts) resolves `dirPath` to
 * `path.join(os.homedir(), ".achilles", "transcripts")` and binds the
 * four fs seams to their `node:fs` equivalents. Tests inject spies for
 * every seam so neither the real filesystem nor the real `node:fs`
 * module is reached during unit testing.
 *
 * @public
 */
export interface TranscriptsDeps {
  /**
   * Stdout sink. Production binds to `process.stdout`. The empty-
   * directory and success-summary lines are written here.
   */
  readonly stdout: WritableSeam;
  /**
   * Stderr sink. Production binds to `process.stderr`. The
   * "Unknown subcommand" diagnostic is written here.
   */
  readonly stderr: WritableSeam;
  /**
   * Process-exit seam. Production binds to `(code) => process.exit(code)`;
   * tests inject a spy. The handler NEVER calls `process.exit` directly.
   */
  readonly processExitImpl: (code: number) => void;
  /**
   * Absolute path to the transcripts directory. Production uses
   * `~/.achilles/transcripts/`; tests pass a fixture path.
   */
  readonly dirPath: string;
  /**
   * Directory-read seam — production binds to `fs.readdirSync`. Throws
   * on a missing directory; the handler treats the throw as "no
   * transcript files" (informational, not an error).
   */
  readonly readDirImpl: (path: string) => readonly string[];
  /**
   * Per-file stat seam — production binds to `fs.statSync`. Tests inject
   * a spy with deterministic sizes + mtimes.
   */
  readonly statFileImpl: (path: string) => TranscriptsStatResult;
  /**
   * Per-file delete seam — production binds to `fs.unlinkSync`. Tests
   * inject a spy that records calls.
   */
  readonly deleteFileImpl: (path: string) => void;
  /**
   * Per-file read seam — production binds to `(p) => fs.readFileSync(p, "utf8")`.
   * Used only by `list` for line-count computation. The body is NEVER
   * surfaced to stdout — only the count is.
   */
  readonly readFileImpl: (path: string, enc: "utf8") => string;
}

/**
 * Joins a directory path and a basename with a platform-appropriate
 * separator. We avoid pulling in node:path so the file is trivially
 * portable.
 */
function joinPath(dirPath: string, basename: string): string {
  if (dirPath.length === 0) return basename;
  const last = dirPath.charAt(dirPath.length - 1);
  if (last === "/" || last === "\\") {
    return `${dirPath}${basename}`;
  }
  return `${dirPath}/${basename}`;
}

/**
 * Count '\n' occurrences in the supplied string. Mirrors the
 * documented N-1 semantic from transcript-store.ts: a file without a
 * trailing newline counts as N-1 lines (one fewer than the number of
 * records present). The append path always writes a trailing newline
 * so this only manifests for externally-edited files.
 */
function countNewlines(content: string): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 0x0a /* \n */) count++;
  }
  return count;
}

/**
 * Run the purge subcommand. Walks the directory, sums bytes, deletes
 * every matching file, prints the summary, exits 0.
 */
function runPurge(deps: TranscriptsDeps): void {
  const { stdout, processExitImpl, dirPath, readDirImpl, statFileImpl, deleteFileImpl } =
    deps;
  let entries: readonly string[];
  try {
    entries = readDirImpl(dirPath);
  } catch {
    // Missing directory is informational, not an error: nothing to
    // purge.
    stdout.write("[achilles] No transcript files to purge.\n");
    processExitImpl(0);
    return;
  }
  let fileCount = 0;
  let totalBytes = 0;
  for (const basename of entries) {
    if (!TRANSCRIPT_FILENAME_REGEX.test(basename)) continue;
    const filePath = joinPath(dirPath, basename);
    let size = 0;
    try {
      const st = statFileImpl(filePath);
      size = st.size;
    } catch {
      // Skip files we cannot stat — likely a race with another
      // process removing the file. Continue with the rest.
      continue;
    }
    try {
      deleteFileImpl(filePath);
    } catch {
      // Skip files we cannot delete. The total stays consistent: we
      // only credit bytes when both stat AND delete succeed.
      continue;
    }
    fileCount += 1;
    totalBytes += size;
  }
  if (fileCount === 0) {
    stdout.write("[achilles] No transcript files to purge.\n");
    processExitImpl(0);
    return;
  }
  stdout.write(
    `[achilles] Purged ${fileCount} transcript files (${totalBytes} bytes freed).\n`,
  );
  processExitImpl(0);
}

/**
 * Run the list subcommand. Walks the directory, computes line count
 * per file, prints one line per file, exits 0.
 */
function runList(deps: TranscriptsDeps): void {
  const { stdout, processExitImpl, dirPath, readDirImpl, statFileImpl, readFileImpl } =
    deps;
  let entries: readonly string[];
  try {
    entries = readDirImpl(dirPath);
  } catch {
    // Missing directory → empty listing.
    stdout.write("[achilles] No transcript files.\n");
    processExitImpl(0);
    return;
  }
  interface ListLine {
    readonly filename: string;
    readonly lineCount: number;
    readonly bytes: number;
  }
  const lines: ListLine[] = [];
  for (const basename of entries) {
    if (!TRANSCRIPT_FILENAME_REGEX.test(basename)) continue;
    const filePath = joinPath(dirPath, basename);
    let size = 0;
    try {
      const st = statFileImpl(filePath);
      size = st.size;
    } catch {
      continue;
    }
    let lineCount = 0;
    try {
      const content = readFileImpl(filePath, "utf8");
      lineCount = countNewlines(content);
    } catch {
      continue;
    }
    lines.push({ filename: basename, lineCount, bytes: size });
  }
  if (lines.length === 0) {
    stdout.write("[achilles] No transcript files.\n");
    processExitImpl(0);
    return;
  }
  // Stable sort by filename so the output is deterministic.
  lines.sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  );
  for (const ln of lines) {
    stdout.write(
      `${ln.filename}\t${ln.lineCount} lines\t${ln.bytes} bytes\n`,
    );
  }
  processExitImpl(0);
}

/**
 * Subcommand dispatcher. See file-level contract for behaviour.
 *
 * @public
 */
export function transcriptsCommand(
  subcommand: string,
  deps: TranscriptsDeps,
): void {
  if (subcommand === "purge") {
    runPurge(deps);
    return;
  }
  if (subcommand === "list") {
    runList(deps);
    return;
  }
  deps.stderr.write(
    `[achilles] Unknown subcommand: ${subcommand}. Supported: purge, list.\n`,
  );
  deps.processExitImpl(2);
}
