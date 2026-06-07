/**
 * Behaviour tests for the Plan 14-02 transcript-store (SAFE-02).
 *
 * The store is a pure module — no Electron, no live filesystem, no
 * timer side effects. Every test injects deterministic seams (clock,
 * fs spies) so the SAFE-02 default-off invariant is verified
 * structurally, not behaviourally.
 *
 * Tests are organised TS1..TS10 mapping the plan's behaviour table:
 *   - TS1  factory + handle surface
 *   - TS2  default-off: NO fs op when enabled=false
 *   - TS3  enabled=true: append path writes one JSONL line
 *   - TS4  multiple appends in the same UTC day → same file
 *   - TS5  clock advance to next UTC day → new file
 *   - TS6  applyRetention deletes files older than N days
 *   - TS7  purge deletes every JSONL file + returns count + bytes
 *   - TS8  list returns {filename, lineCount, bytes} per file
 *   - TS9  log lines never include transcript text (privacy invariant)
 *   - TS10 30-event mock loop, enabled=false: ZERO fs ops (default-off
 *         structural enforcement — the CONTEXT.md quality gate)
 */

import { describe, expect, it, vi } from "vitest";
import {
  createTranscriptStore,
  DEFAULT_RETENTION_DAYS,
  TRANSCRIPT_FILENAME_REGEX,
  type CreateTranscriptStoreDeps,
  type TranscriptStore,
} from "./transcript-store.js";

/**
 * Helper: build a deps object with vi.fn() spies for every seam plus
 * a frozen-clock seam. Overrides merge on top.
 */
interface BuildDepsOverrides {
  enabled?: boolean;
  retentionDays?: number;
  dirPath?: string;
  now?: Date;
  dirEntries?: readonly string[];
  fileSize?: number;
  fileContent?: string;
  logger?: (msg: string) => void;
}

function buildDeps(overrides: BuildDepsOverrides = {}): {
  deps: CreateTranscriptStoreDeps;
  writeFileSpy: ReturnType<typeof vi.fn>;
  readDirSpy: ReturnType<typeof vi.fn>;
  statFileSpy: ReturnType<typeof vi.fn>;
  deleteFileSpy: ReturnType<typeof vi.fn>;
  mkdirSpy: ReturnType<typeof vi.fn>;
  readFileSpy: ReturnType<typeof vi.fn>;
  nowRef: { current: Date };
  logs: string[];
} {
  const nowRef = { current: overrides.now ?? new Date("2026-06-06T12:00:00.000Z") };
  const dirEntries = overrides.dirEntries ?? [];
  const fileSize = overrides.fileSize ?? 128;
  const fileContent = overrides.fileContent ?? "line1\nline2\nline3\n";
  const writeFileSpy = vi.fn();
  const readDirSpy = vi.fn(() => dirEntries);
  const statFileSpy = vi.fn(() => ({
    size: fileSize,
    mtime: nowRef.current,
  }));
  const deleteFileSpy = vi.fn();
  const mkdirSpy = vi.fn();
  const readFileSpy = vi.fn(() => fileContent);
  const logs: string[] = [];
  const logger =
    overrides.logger ?? ((msg: string): void => {
      logs.push(msg);
    });
  const deps: CreateTranscriptStoreDeps = {
    enabled: overrides.enabled ?? false,
    dirPath: overrides.dirPath ?? "/tmp/achilles-transcripts",
    retentionDays: overrides.retentionDays,
    writeFileImpl: writeFileSpy as never,
    readDirImpl: readDirSpy as never,
    statFileImpl: statFileSpy as never,
    deleteFileImpl: deleteFileSpy as never,
    mkdirImpl: mkdirSpy as never,
    readFileImpl: readFileSpy as never,
    nowImpl: () => nowRef.current,
    logger,
  };
  return {
    deps,
    writeFileSpy,
    readDirSpy,
    statFileSpy,
    deleteFileSpy,
    mkdirSpy,
    readFileSpy,
    nowRef,
    logs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// TS1: factory + handle surface
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS1 factory + handle surface", () => {
  it("returns a TranscriptStore with appendTurn / purge / list / applyRetention / isEnabled / dispose", () => {
    const { deps } = buildDeps({ enabled: false });
    const store: TranscriptStore = createTranscriptStore(deps);
    expect(typeof store.appendTurn).toBe("function");
    expect(typeof store.purge).toBe("function");
    expect(typeof store.list).toBe("function");
    expect(typeof store.applyRetention).toBe("function");
    expect(typeof store.isEnabled).toBe("function");
    expect(typeof store.dispose).toBe("function");
  });

  it("DEFAULT_RETENTION_DAYS is exactly 30 (SAFE-02 locked default)", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it("TRANSCRIPT_FILENAME_REGEX accepts YYYY-MM-DD.jsonl and rejects stray patterns", () => {
    expect(TRANSCRIPT_FILENAME_REGEX.test("2026-06-06.jsonl")).toBe(true);
    expect(TRANSCRIPT_FILENAME_REGEX.test("2026-06-06.jsonl.tmp")).toBe(false);
    expect(TRANSCRIPT_FILENAME_REGEX.test("notes.txt")).toBe(false);
    expect(TRANSCRIPT_FILENAME_REGEX.test("2026-6-6.jsonl")).toBe(false);
    expect(TRANSCRIPT_FILENAME_REGEX.test("README.md")).toBe(false);
  });

  it("isEnabled returns the construction-time enabled flag", () => {
    {
      const { deps } = buildDeps({ enabled: false });
      const store = createTranscriptStore(deps);
      expect(store.isEnabled()).toBe(false);
    }
    {
      const { deps } = buildDeps({ enabled: true });
      const store = createTranscriptStore(deps);
      expect(store.isEnabled()).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS2: default-off — NO fs op when enabled=false
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS2 default-off invariant", () => {
  it("when enabled=false, appendTurn is a SYNC no-op: writeFileImpl spy NEVER called", () => {
    const { deps, writeFileSpy, mkdirSpy } = buildDeps({ enabled: false });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "user", text: "hello world" });
    expect(writeFileSpy).toHaveBeenCalledTimes(0);
    expect(mkdirSpy).toHaveBeenCalledTimes(0);
  });

  it("when enabled=false, construction does NOT invoke applyRetention's readDir spy", () => {
    const { deps, readDirSpy } = buildDeps({ enabled: false });
    createTranscriptStore(deps);
    expect(readDirSpy).toHaveBeenCalledTimes(0);
  });

  it("when enabled=false, repeated appendTurn calls remain no-ops across roles", () => {
    const { deps, writeFileSpy, mkdirSpy } = buildDeps({ enabled: false });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "user", text: "u1" });
    store.appendTurn({ role: "assistant", text: "a1" });
    store.appendTurn({ role: "user", text: "u2" });
    expect(writeFileSpy).toHaveBeenCalledTimes(0);
    expect(mkdirSpy).toHaveBeenCalledTimes(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS3: enabled=true append writes one JSONL line
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS3 enabled append writes one JSONL line", () => {
  it("computes the daily filename from nowImpl, ensures dirPath via mkdirImpl, appends one JSON line + '\\n'", () => {
    const fixedNow = new Date("2026-06-06T12:34:56.000Z");
    const { deps, writeFileSpy, mkdirSpy } = buildDeps({
      enabled: true,
      dirPath: "/tmp/achilles-transcripts",
      now: fixedNow,
    });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "user", text: "refactor the auth module" });
    expect(mkdirSpy).toHaveBeenCalledWith("/tmp/achilles-transcripts", {
      recursive: true,
    });
    expect(writeFileSpy).toHaveBeenCalledTimes(1);
    const call = writeFileSpy.mock.calls[0]!;
    expect(call[0]).toBe("/tmp/achilles-transcripts/2026-06-06.jsonl");
    const serialised = call[1] as string;
    expect(serialised.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(serialised.trim());
    expect(parsed).toEqual({
      ts: "2026-06-06T12:34:56.000Z",
      role: "user",
      text: "refactor the auth module",
    });
    expect(call[2]).toEqual({ flag: "a" });
  });

  it("persists assistant role symmetrically with the same shape", () => {
    const fixedNow = new Date("2026-06-06T12:34:56.000Z");
    const { deps, writeFileSpy } = buildDeps({
      enabled: true,
      now: fixedNow,
    });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "assistant", text: "I have finished the refactor." });
    const call = writeFileSpy.mock.calls[0]!;
    const parsed = JSON.parse((call[1] as string).trim());
    expect(parsed.role).toBe("assistant");
    expect(parsed.text).toBe("I have finished the refactor.");
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS4: multiple appends in the same UTC day → same file
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS4 same UTC day = same file", () => {
  it("three appendTurn calls during one UTC day target the SAME file as separate lines", () => {
    const fixedDay = new Date("2026-06-06T05:00:00.000Z");
    const { deps, writeFileSpy, nowRef } = buildDeps({
      enabled: true,
      now: fixedDay,
    });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "user", text: "u1" });
    nowRef.current = new Date("2026-06-06T08:00:00.000Z");
    store.appendTurn({ role: "assistant", text: "a1" });
    nowRef.current = new Date("2026-06-06T23:59:00.000Z");
    store.appendTurn({ role: "user", text: "u2" });
    expect(writeFileSpy).toHaveBeenCalledTimes(3);
    const paths = writeFileSpy.mock.calls.map((c) => c[0]);
    expect(paths.every((p) => p.endsWith("2026-06-06.jsonl"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS5: clock advance to next UTC day → new file
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS5 next UTC day = new file", () => {
  it("a clock tick across UTC midnight produces a new filename", () => {
    const { deps, writeFileSpy, nowRef } = buildDeps({
      enabled: true,
      now: new Date("2026-06-06T23:59:59.000Z"),
    });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "user", text: "day1" });
    nowRef.current = new Date("2026-06-07T00:00:01.000Z");
    store.appendTurn({ role: "assistant", text: "day2" });
    expect(writeFileSpy).toHaveBeenCalledTimes(2);
    expect(writeFileSpy.mock.calls[0]![0]).toContain("2026-06-06.jsonl");
    expect(writeFileSpy.mock.calls[1]![0]).toContain("2026-06-07.jsonl");
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS6: applyRetention deletes files older than N days
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS6 applyRetention age sweep", () => {
  it("deletes files where ageDays > retentionDays AND retains the rest", () => {
    const fixedNow = new Date("2026-06-06T12:00:00.000Z");
    // 5-day retention. Files from 2026-05-01 (36 days ago) and
    // 2026-05-25 (12 days ago) are deleted; 2026-06-04 (2 days ago)
    // and 2026-06-06 (today) are retained. A stray non-JSONL file is
    // skipped entirely.
    const { deps, deleteFileSpy, logs } = buildDeps({
      enabled: false, // disable to suppress the construction-time sweep so we drive it explicitly
      retentionDays: 5,
      now: fixedNow,
      dirEntries: [
        "2026-05-01.jsonl",
        "2026-05-25.jsonl",
        "2026-06-04.jsonl",
        "2026-06-06.jsonl",
        "notes.txt",
      ],
    });
    const store = createTranscriptStore(deps);
    const result = store.applyRetention();
    expect(result.deleted).toBe(2);
    expect(result.retained).toBe(2);
    const deletedPaths = deleteFileSpy.mock.calls.map((c) => c[0]);
    expect(deletedPaths.some((p) => p.endsWith("2026-05-01.jsonl"))).toBe(true);
    expect(deletedPaths.some((p) => p.endsWith("2026-05-25.jsonl"))).toBe(true);
    expect(deletedPaths.some((p) => p.endsWith("2026-06-04.jsonl"))).toBe(false);
    expect(deletedPaths.some((p) => p.endsWith("2026-06-06.jsonl"))).toBe(false);
    // Log line records counts only.
    const sweepLines = logs.filter((l) => l.includes("retention sweep"));
    expect(sweepLines.length).toBeGreaterThan(0);
  });

  it("runs the retention sweep once at construction when enabled=true (TS6 default-off auto-sweep)", () => {
    const fixedNow = new Date("2026-06-06T12:00:00.000Z");
    const { deps, deleteFileSpy } = buildDeps({
      enabled: true,
      retentionDays: 5,
      now: fixedNow,
      dirEntries: ["2026-05-01.jsonl", "2026-06-06.jsonl"],
    });
    createTranscriptStore(deps);
    // The old file is deleted by the auto-sweep.
    const deletedPaths = deleteFileSpy.mock.calls.map((c) => c[0]);
    expect(deletedPaths.some((p) => p.endsWith("2026-05-01.jsonl"))).toBe(true);
  });

  it("default-off: when enabled=false, construction does NOT run applyRetention", () => {
    const { deps, deleteFileSpy } = buildDeps({
      enabled: false,
      retentionDays: 5,
      now: new Date("2026-06-06T12:00:00.000Z"),
      dirEntries: ["2026-05-01.jsonl"],
    });
    createTranscriptStore(deps);
    expect(deleteFileSpy).toHaveBeenCalledTimes(0);
  });

  // WR-06 regression. Phase 14 review found applyRetention emitted a noisy
  // 'transcript-store retention readdir failed: ENOENT' line on every
  // fresh-install boot because the transcripts directory does not exist
  // yet. The catch block lumped ENOENT in with genuine permission failures.
  // After WR-06 ENOENT is treated as 'directory does not exist, nothing to
  // retain' and returns {deleted: 0, retained: 0} without logging.
  it("WR-06: applyRetention swallows ENOENT silently (fresh install)", () => {
    const { deps, logs } = buildDeps({
      enabled: false,
      retentionDays: 5,
    });
    // Replace readDirImpl with one that throws ENOENT.
    const enoent = Object.assign(new Error("no such file or directory"), {
      code: "ENOENT",
    });
    const enoentDeps: CreateTranscriptStoreDeps = {
      ...deps,
      readDirImpl: (() => {
        throw enoent;
      }) as never,
    };
    const store = createTranscriptStore(enoentDeps);
    const result = store.applyRetention();
    expect(result).toEqual({ deleted: 0, retained: 0 });
    // No 'retention readdir failed' line was logged.
    const errLogs = logs.filter((l) =>
      l.includes("retention readdir failed"),
    );
    expect(errLogs.length).toBe(0);
  });

  it("WR-06: non-ENOENT readdir errors still log so a genuine failure is visible", () => {
    const { deps, logs } = buildDeps({
      enabled: false,
      retentionDays: 5,
    });
    const eacces = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const errDeps: CreateTranscriptStoreDeps = {
      ...deps,
      readDirImpl: (() => {
        throw eacces;
      }) as never,
    };
    const store = createTranscriptStore(errDeps);
    const result = store.applyRetention();
    expect(result).toEqual({ deleted: 0, retained: 0 });
    const errLogs = logs.filter((l) =>
      l.includes("retention readdir failed"),
    );
    expect(errLogs.length).toBe(1);
    expect(errLogs[0]).toContain("permission denied");
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS7: purge deletes every JSONL file + returns count + bytes
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS7 purge", () => {
  it("walks the dir, stats + deletes every matching file, totals bytes, returns {fileCount, totalBytes}", () => {
    const { deps, statFileSpy, deleteFileSpy } = buildDeps({
      enabled: false,
      dirEntries: [
        "2026-05-01.jsonl",
        "2026-05-25.jsonl",
        "2026-06-06.jsonl",
        "notes.txt",
      ],
      fileSize: 1024,
    });
    const store = createTranscriptStore(deps);
    const result = store.purge();
    expect(result.fileCount).toBe(3);
    expect(result.totalBytes).toBe(3 * 1024);
    // Non-JSONL is skipped.
    const deletedPaths = deleteFileSpy.mock.calls.map((c) => c[0]);
    expect(deletedPaths.length).toBe(3);
    expect(deletedPaths.every((p) => !p.endsWith("notes.txt"))).toBe(true);
    expect(statFileSpy.mock.calls.length).toBe(3);
  });

  it("on an empty directory returns {fileCount: 0, totalBytes: 0}", () => {
    const { deps } = buildDeps({
      enabled: false,
      dirEntries: [],
    });
    const store = createTranscriptStore(deps);
    expect(store.purge()).toEqual({ fileCount: 0, totalBytes: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS8: list returns {filename, lineCount, bytes} per file
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS8 list", () => {
  it("returns one entry per matching file with line counts via injected readFile seam", () => {
    const { deps } = buildDeps({
      enabled: false,
      dirEntries: ["2026-06-05.jsonl", "2026-06-06.jsonl", "notes.txt"],
      fileContent: "a\nb\nc\n",
      fileSize: 6,
    });
    const store = createTranscriptStore(deps);
    const entries = store.list();
    expect(entries.length).toBe(2);
    expect(entries[0]!.filename).toBe("2026-06-05.jsonl");
    expect(entries[0]!.lineCount).toBe(3);
    expect(entries[0]!.bytes).toBe(6);
    expect(entries[1]!.filename).toBe("2026-06-06.jsonl");
  });

  it("a file without trailing newline counts as N-1 lines (documented off-by-one)", () => {
    const { deps } = buildDeps({
      enabled: false,
      dirEntries: ["2026-06-06.jsonl"],
      fileContent: "a\nb\nc", // 3 records, 2 newlines → count = 2
      fileSize: 5,
    });
    const store = createTranscriptStore(deps);
    const entries = store.list();
    expect(entries[0]!.lineCount).toBe(2);
  });

  it("on an empty directory returns []", () => {
    const { deps } = buildDeps({
      enabled: false,
      dirEntries: [],
    });
    const store = createTranscriptStore(deps);
    expect(store.list()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS9: privacy invariant — log lines never include transcript text
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS9 logs never contain transcript text", () => {
  it("appendTurn log line includes filename + role + bytes but NEVER text content", () => {
    const SECRET_TEXT = "DO-NOT-LOG-THIS-PHRASE-XYZ";
    const fixedNow = new Date("2026-06-06T12:00:00.000Z");
    const { deps, logs } = buildDeps({
      enabled: true,
      now: fixedNow,
    });
    const store = createTranscriptStore(deps);
    store.appendTurn({ role: "user", text: SECRET_TEXT });
    const blob = logs.join("\n");
    expect(blob).not.toContain(SECRET_TEXT);
    // The append log line is present.
    expect(blob).toContain("transcript-store append");
  });

  it("purge log line includes counts but NEVER per-file content", () => {
    const SECRET_TEXT = "PURGE-DO-NOT-ECHO-PHRASE-XYZ";
    const { deps, logs } = buildDeps({
      enabled: false,
      dirEntries: ["2026-06-06.jsonl"],
      fileContent: SECRET_TEXT,
    });
    const store = createTranscriptStore(deps);
    store.purge();
    const blob = logs.join("\n");
    expect(blob).not.toContain(SECRET_TEXT);
  });

  it("list log line includes file count but NEVER file content", () => {
    const SECRET_TEXT = "LIST-DO-NOT-ECHO-PHRASE-XYZ";
    const { deps, logs } = buildDeps({
      enabled: false,
      dirEntries: ["2026-06-06.jsonl"],
      fileContent: SECRET_TEXT,
    });
    const store = createTranscriptStore(deps);
    store.list();
    const blob = logs.join("\n");
    expect(blob).not.toContain(SECRET_TEXT);
  });
});

// ─────────────────────────────────────────────────────────────────────
// TS10: default-off structural test — 30 events, zero fs ops
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — TS10 SAFE-02 default-off structural enforcement", () => {
  it("default-off — 30 mock appendTurn calls with enabled=false: writeFileImpl + mkdirImpl + statFile + deleteFile + readDir spies invoked ZERO times", () => {
    const { deps, writeFileSpy, mkdirSpy, statFileSpy, deleteFileSpy, readDirSpy, readFileSpy } =
      buildDeps({ enabled: false });
    const store = createTranscriptStore(deps);
    // Drive 30 alternating user/assistant turns.
    for (let i = 0; i < 30; i++) {
      const role: "user" | "assistant" = i % 2 === 0 ? "user" : "assistant";
      store.appendTurn({ role, text: `turn-${i}-text` });
    }
    expect(writeFileSpy).toHaveBeenCalledTimes(0);
    expect(mkdirSpy).toHaveBeenCalledTimes(0);
    expect(statFileSpy).toHaveBeenCalledTimes(0);
    expect(deleteFileSpy).toHaveBeenCalledTimes(0);
    expect(readDirSpy).toHaveBeenCalledTimes(0);
    expect(readFileSpy).toHaveBeenCalledTimes(0);
  });

  it("the SAFE-02 quality gate is met: 30-event loop drives 0 writeFileImpl invocations (default-off invariant)", () => {
    const { deps, writeFileSpy } = buildDeps({ enabled: false });
    const store = createTranscriptStore(deps);
    for (let i = 0; i < 30; i++) {
      store.appendTurn({ role: "user", text: "x" });
    }
    expect(writeFileSpy).toHaveBeenCalledTimes(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Bonus: dispose() is idempotent and disables subsequent calls safely
// ─────────────────────────────────────────────────────────────────────

describe("createTranscriptStore — dispose() idempotency", () => {
  it("dispose() can be called twice without throwing; subsequent appendTurn is a no-op", () => {
    const { deps, writeFileSpy } = buildDeps({ enabled: true });
    const store = createTranscriptStore(deps);
    expect(() => store.dispose()).not.toThrow();
    expect(() => store.dispose()).not.toThrow();
    const callsBeforeAppend = writeFileSpy.mock.calls.length;
    store.appendTurn({ role: "user", text: "post-dispose" });
    expect(writeFileSpy.mock.calls.length).toBe(callsBeforeAppend);
  });
});
