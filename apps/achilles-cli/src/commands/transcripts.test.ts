/**
 * Tests for the `achilles transcripts <subcommand>` Plan 14-02 FULL
 * implementation (REPLACES the Plan 13-01 stub T1/T2).
 *
 *   - T3: 'purge' walks dir, sums + deletes every matching file,
 *         prints summary line, exits 0.
 *   - T4: 'purge' on empty / missing directory prints the empty
 *         message, exits 0.
 *   - T5: 'list' prints per-file lines + counts, exits 0.
 *   - T6: 'list' on empty / missing directory prints the empty
 *         message, exits 0.
 *   - T7: 'list' tolerates malformed JSONL lines (line counts are
 *         '\n' counts, not parser-driven).
 *   - T8: unknown subcommand writes 'Unknown subcommand' to STDERR,
 *         exits 2.
 *
 * Every test injects spies for the four fs seams (readDir / statFile /
 * deleteFile / readFile) so the real filesystem is never touched.
 * Threat T-14-06 / T-14-07 is preserved: the assertions verify that
 * stdout output carries only filenames + counts, never per-line file
 * content.
 */

import { describe, expect, it, vi } from "vitest";
import {
  transcriptsCommand,
  type TranscriptsDeps,
  type TranscriptsStatResult,
} from "./transcripts.js";

type WriteSeam = { write: (chunk: string) => boolean };

function makeStreamSpy(): {
  seam: WriteSeam;
  chunks: string[];
} {
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
}

interface BuildDepsOptions {
  dirEntries?: readonly string[];
  fileSize?: number;
  fileContent?: string;
  readDirThrows?: boolean;
}

function buildDeps(opts: BuildDepsOptions = {}): {
  deps: TranscriptsDeps;
  stdout: ReturnType<typeof makeStreamSpy>;
  stderr: ReturnType<typeof makeStreamSpy>;
  exitSpy: ReturnType<typeof vi.fn>;
  readDirSpy: ReturnType<typeof vi.fn>;
  statFileSpy: ReturnType<typeof vi.fn>;
  deleteFileSpy: ReturnType<typeof vi.fn>;
  readFileSpy: ReturnType<typeof vi.fn>;
} {
  const stdout = makeStreamSpy();
  const stderr = makeStreamSpy();
  const exitSpy = vi.fn();
  const dirEntries = opts.dirEntries ?? [];
  const fileSize = opts.fileSize ?? 128;
  const fileContent = opts.fileContent ?? "line1\nline2\nline3\n";
  const readDirSpy = vi.fn(() => {
    if (opts.readDirThrows === true) {
      throw new Error("ENOENT: no such file or directory");
    }
    return dirEntries;
  });
  const statFileSpy = vi.fn(
    (): TranscriptsStatResult => ({
      size: fileSize,
      mtime: new Date("2026-06-06T12:00:00.000Z"),
    }),
  );
  const deleteFileSpy = vi.fn();
  const readFileSpy = vi.fn(() => fileContent);
  const deps: TranscriptsDeps = {
    stdout: stdout.seam,
    stderr: stderr.seam,
    processExitImpl: exitSpy as never,
    dirPath: "/tmp/achilles-transcripts",
    readDirImpl: readDirSpy as never,
    statFileImpl: statFileSpy as never,
    deleteFileImpl: deleteFileSpy as never,
    readFileImpl: readFileSpy as never,
  };
  return {
    deps,
    stdout,
    stderr,
    exitSpy,
    readDirSpy,
    statFileSpy,
    deleteFileSpy,
    readFileSpy,
  };
}

// ─────────────────────────────────────────────────────────────────────
// T3: purge with N files
// ─────────────────────────────────────────────────────────────────────

describe("transcriptsCommand — T3 purge with N files", () => {
  it("walks the dir, sums + deletes every matching file, prints '[achilles] Purged N transcript files (BYTES bytes freed).', exits 0", () => {
    const { deps, stdout, exitSpy, statFileSpy, deleteFileSpy } = buildDeps({
      dirEntries: [
        "2026-05-01.jsonl",
        "2026-05-25.jsonl",
        "2026-06-06.jsonl",
        "notes.txt",
      ],
      fileSize: 1024,
    });
    transcriptsCommand("purge", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const combined = stdout.chunks.join("");
    expect(combined).toContain("Purged 3 transcript files");
    expect(combined).toContain("3072 bytes freed");
    // statFile called per matching file (3 times); notes.txt is
    // skipped entirely.
    expect(statFileSpy.mock.calls.length).toBe(3);
    expect(deleteFileSpy.mock.calls.length).toBe(3);
    // notes.txt is never deleted.
    const deletedPaths = deleteFileSpy.mock.calls.map((c) => c[0]);
    expect(deletedPaths.every((p) => !p.endsWith("notes.txt"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// T4: purge with no files
// ─────────────────────────────────────────────────────────────────────

describe("transcriptsCommand — T4 purge with empty/missing dir", () => {
  it("empty directory prints '[achilles] No transcript files to purge.' on stdout, exits 0", () => {
    const { deps, stdout, exitSpy } = buildDeps({ dirEntries: [] });
    transcriptsCommand("purge", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdout.chunks.join("")).toContain("No transcript files to purge");
  });

  it("missing directory (readDir throws ENOENT) prints the same empty message, exits 0", () => {
    const { deps, stdout, exitSpy } = buildDeps({ readDirThrows: true });
    transcriptsCommand("purge", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdout.chunks.join("")).toContain("No transcript files to purge");
  });

  it("directory with only non-JSONL files prints the empty message, exits 0", () => {
    const { deps, stdout, exitSpy, deleteFileSpy } = buildDeps({
      dirEntries: ["notes.txt", "README.md"],
    });
    transcriptsCommand("purge", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdout.chunks.join("")).toContain("No transcript files to purge");
    // No file deleted.
    expect(deleteFileSpy.mock.calls.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// T5: list with N files
// ─────────────────────────────────────────────────────────────────────

describe("transcriptsCommand — T5 list with N files", () => {
  it("prints one line per matching file: '<filename>\\t<N> lines\\t<bytes> bytes', exits 0", () => {
    const { deps, stdout, exitSpy, readFileSpy } = buildDeps({
      dirEntries: ["2026-06-05.jsonl", "2026-06-06.jsonl", "notes.txt"],
      fileContent: "a\nb\nc\n",
      fileSize: 6,
    });
    transcriptsCommand("list", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const combined = stdout.chunks.join("");
    expect(combined).toContain("2026-06-05.jsonl\t3 lines\t6 bytes");
    expect(combined).toContain("2026-06-06.jsonl\t3 lines\t6 bytes");
    // notes.txt is NOT included.
    expect(combined).not.toContain("notes.txt");
    // readFile invoked per matching file (2 calls); the non-JSONL is
    // skipped before the read.
    expect(readFileSpy.mock.calls.length).toBe(2);
  });

  it("never surfaces per-file content (privacy invariant T-14-07)", () => {
    const SECRET_LINE = "DO-NOT-LEAK-TO-OPERATOR-XYZ";
    const { deps, stdout } = buildDeps({
      dirEntries: ["2026-06-06.jsonl"],
      fileContent: SECRET_LINE,
      fileSize: SECRET_LINE.length,
    });
    transcriptsCommand("list", deps);
    expect(stdout.chunks.join("")).not.toContain(SECRET_LINE);
  });
});

// ─────────────────────────────────────────────────────────────────────
// T6: list with no files
// ─────────────────────────────────────────────────────────────────────

describe("transcriptsCommand — T6 list with empty/missing dir", () => {
  it("empty directory prints '[achilles] No transcript files.' on stdout, exits 0", () => {
    const { deps, stdout, exitSpy } = buildDeps({ dirEntries: [] });
    transcriptsCommand("list", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdout.chunks.join("")).toContain("No transcript files");
  });

  it("missing directory (readDir throws ENOENT) prints the same empty message, exits 0", () => {
    const { deps, stdout, exitSpy } = buildDeps({ readDirThrows: true });
    transcriptsCommand("list", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(stdout.chunks.join("")).toContain("No transcript files");
  });
});

// ─────────────────────────────────────────────────────────────────────
// T7: list tolerates malformed JSONL lines (line counts via '\n' only)
// ─────────────────────────────────────────────────────────────────────

describe("transcriptsCommand — T7 list tolerates malformed JSONL", () => {
  it("line counts are computed via '\\n' count, NOT via JSON.parse; a file with a malformed line still yields a count", () => {
    const MALFORMED = "{not json\n{partial: x\n\nvalid:\"line\"\n";
    const { deps, stdout, exitSpy } = buildDeps({
      dirEntries: ["2026-06-06.jsonl"],
      fileContent: MALFORMED,
      fileSize: MALFORMED.length,
    });
    transcriptsCommand("list", deps);
    expect(exitSpy).toHaveBeenCalledWith(0);
    const combined = stdout.chunks.join("");
    // Count is the '\n' count (4 newlines in the fixture).
    expect(combined).toContain("4 lines");
    // The content is NEVER printed — only the count is.
    expect(combined).not.toContain("not json");
    expect(combined).not.toContain("partial");
  });
});

// ─────────────────────────────────────────────────────────────────────
// T8: unknown subcommand
// ─────────────────────────────────────────────────────────────────────

describe("transcriptsCommand — T8 unknown subcommand", () => {
  it("writes '[achilles] Unknown subcommand: <value>. Supported: purge, list.' to STDERR, exits 2", () => {
    const { deps, stdout, stderr, exitSpy } = buildDeps();
    transcriptsCommand("save", deps);
    expect(exitSpy).toHaveBeenCalledWith(2);
    // Diagnostic goes to STDERR, not stdout.
    expect(stdout.chunks.join("")).toBe("");
    const errOut = stderr.chunks.join("");
    expect(errOut).toContain("Unknown subcommand: save");
    expect(errOut).toContain("Supported: purge, list");
  });

  it("the empty-subcommand case routes to the unknown-subcommand path", () => {
    const { deps, stderr, exitSpy } = buildDeps();
    transcriptsCommand("", deps);
    expect(exitSpy).toHaveBeenCalledWith(2);
    expect(stderr.chunks.join("")).toContain("Unknown subcommand");
  });
});
