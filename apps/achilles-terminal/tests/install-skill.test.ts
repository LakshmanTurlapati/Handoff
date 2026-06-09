/**
 * Phase 19, Plan 02, Task 3 — install-skill subcommand tests.
 *
 * Port of apps/achilles-cli/src/commands/install-skill.test.ts adapted
 * for the v1.3 flat layout. Six test cases:
 *
 *   T-IS-01 successful symlink creation at default destination
 *   T-IS-02 already-installed (same source) returns idempotent path
 *   T-IS-03 --force overwrites an existing wrong-target symlink
 *   T-IS-04 ExistingDestinationConflictError raised when destination
 *           exists with a different target AND --force is false
 *   T-IS-05 SymlinkNotPermittedError raised on darwin/linux when
 *           symlinkSync throws (any code)
 *   T-IS-06 Windows EPERM fallback uses cpSync recursive copy
 *
 * Test discipline:
 *   - NO real filesystem touch; fs + homedir + skillSourceProvider
 *     seams are injected fakes
 *   - NO process.exit; processExitImpl is a recording fake
 *   - NO emojis (CLAUDE.md global)
 */
import { describe, expect, it } from "vitest";

import {
  installSkillCommand,
  type InstallSkillCommandOptions,
} from "../src/install-skill.js";
import type {
  InstallSkillSymlinkFs,
  InstallSkillSymlinkLogger,
} from "../src/skill-symlink.js";

interface FakeWriteStream {
  lines: string[];
  write(chunk: string): boolean;
}

function buildFakeWriteStream(): FakeWriteStream {
  const lines: string[] = [];
  return {
    lines,
    write(chunk: string): boolean {
      lines.push(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk);
      return true;
    },
  };
}

interface FsCall {
  fn: string;
  args: unknown[];
}

function buildFsFake(
  seed: {
    existingDestinations?: Record<
      string,
      { isSymlink: boolean; readlinkTarget?: string }
    >;
    throwOnSymlink?: { code: string; message?: string };
  } = {},
): { fs: InstallSkillSymlinkFs; calls: FsCall[] } {
  const calls: FsCall[] = [];
  const existing = seed.existingDestinations ?? {};
  const fs: InstallSkillSymlinkFs = {
    mkdirSync: (path, opts) => {
      calls.push({ fn: "mkdirSync", args: [path, opts] });
      return undefined;
    },
    lstatSync: (path) => {
      calls.push({ fn: "lstatSync", args: [path] });
      const entry = existing[path];
      if (!entry) {
        const err = new Error(`ENOENT: ${path}`);
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      }
      return {
        isSymbolicLink: () => entry.isSymlink,
        isDirectory: () => !entry.isSymlink,
        isFile: () => false,
      };
    },
    readlinkSync: (path) => {
      calls.push({ fn: "readlinkSync", args: [path] });
      const entry = existing[path];
      if (!entry || !entry.isSymlink) {
        const err = new Error(`EINVAL: ${path}`);
        (err as unknown as { code: string }).code = "EINVAL";
        throw err;
      }
      return entry.readlinkTarget ?? "";
    },
    symlinkSync: (target, path, type) => {
      calls.push({ fn: "symlinkSync", args: [target, path, type] });
      if (seed.throwOnSymlink) {
        const err = new Error(
          seed.throwOnSymlink.message ??
            `symlinkSync failed with ${seed.throwOnSymlink.code}`,
        );
        (err as unknown as { code: string }).code = seed.throwOnSymlink.code;
        throw err;
      }
      existing[path] = { isSymlink: true, readlinkTarget: target };
      return undefined;
    },
    rmSync: (path, opts) => {
      calls.push({ fn: "rmSync", args: [path, opts] });
      delete existing[path];
      return undefined;
    },
    cpSync: (src, dest, opts) => {
      calls.push({ fn: "cpSync", args: [src, dest, opts] });
      existing[dest] = { isSymlink: false };
      return undefined;
    },
  };
  return { fs, calls };
}

function buildLogger(): {
  logger: InstallSkillSymlinkLogger;
  messages: { level: "info" | "warn"; msg: string }[];
} {
  const messages: { level: "info" | "warn"; msg: string }[] = [];
  return {
    logger: {
      info: (msg) => messages.push({ level: "info", msg }),
      warn: (msg) => messages.push({ level: "warn", msg }),
    },
    messages,
  };
}

interface ExitRecord {
  called: boolean;
  code: number;
}

function buildOptions(
  overrides: Partial<InstallSkillCommandOptions> = {},
): {
  options: InstallSkillCommandOptions;
  stdout: FakeWriteStream;
  stderr: FakeWriteStream;
  exit: ExitRecord;
  fsCalls: FsCall[];
} {
  const stdout = buildFakeWriteStream();
  const stderr = buildFakeWriteStream();
  const exit: ExitRecord = { called: false, code: -1 };
  const { fs, calls } = buildFsFake({});
  const { logger } = buildLogger();
  const baseOptions: InstallSkillCommandOptions = {
    force: false,
    homedir: () => "/home/alice",
    platform: "darwin",
    fs,
    stdout,
    stderr,
    processExitImpl: (code) => {
      exit.called = true;
      exit.code = code;
    },
    skillSourceProvider: () => "/pkg/skill",
    logger,
  };
  return {
    options: { ...baseOptions, ...overrides },
    stdout,
    stderr,
    exit,
    fsCalls: calls,
  };
}

describe("T-IS-01: install-skill happy path creates symlink at default destination", () => {
  it("symlinkSync is called with target=/pkg/skill + destination=~/.claude/skills/achilles", () => {
    const captured: { target?: string; destination?: string } = {};
    const { fs } = buildFsFake({});
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    const observingFs: InstallSkillSymlinkFs = {
      ...fs,
      symlinkSync: (target, path, type) => {
        captured.target = target;
        captured.destination = path;
        return fs.symlinkSync(target, path, type);
      },
    };
    installSkillCommand({
      force: false,
      homedir: () => "/home/alice",
      platform: "darwin",
      fs: observingFs,
      stdout,
      stderr,
      processExitImpl: (code) => {
        exit.called = true;
        exit.code = code;
      },
      skillSourceProvider: () => "/pkg/skill",
      logger,
    });
    expect(captured.target).toBe("/pkg/skill");
    expect(captured.destination).toBe("/home/alice/.claude/skills/achilles");
    expect(exit.called).toBe(false);
    expect(stdout.lines.join("\n")).toContain("restart Claude Code");
  });
});

describe("T-IS-02: idempotent already-installed path returns mode='already-installed'", () => {
  it("when destination is a symlink to the same source, no rmSync or symlinkSync is called", () => {
    const dest = "/home/alice/.claude/skills/achilles";
    const src = "/pkg/skill";
    const existing: Record<
      string,
      { isSymlink: boolean; readlinkTarget?: string }
    > = {
      [dest]: { isSymlink: true, readlinkTarget: src },
    };
    const fs: InstallSkillSymlinkFs = {
      mkdirSync: () => undefined,
      lstatSync: (path) => {
        const entry = existing[path];
        if (!entry) {
          const err = new Error("ENOENT");
          (err as unknown as { code: string }).code = "ENOENT";
          throw err;
        }
        return {
          isSymbolicLink: () => entry.isSymlink,
          isDirectory: () => !entry.isSymlink,
          isFile: () => false,
        };
      },
      readlinkSync: (path) => existing[path]?.readlinkTarget ?? "",
      symlinkSync: () => undefined,
      rmSync: () => undefined,
      cpSync: () => undefined,
    };
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    installSkillCommand({
      force: false,
      homedir: () => "/home/alice",
      platform: "darwin",
      fs,
      stdout,
      stderr,
      processExitImpl: (code) => {
        exit.called = true;
        exit.code = code;
      },
      skillSourceProvider: () => src,
      logger,
    });
    expect(exit.called).toBe(false);
    expect(stdout.lines.join("\n")).toContain("already installed");
  });
});

describe("T-IS-03: --force overwrites existing wrong-target symlink", () => {
  it("rmSync is called and the new symlink points at the requested source", () => {
    const dest = "/home/alice/.claude/skills/achilles";
    const existing: Record<
      string,
      { isSymlink: boolean; readlinkTarget?: string }
    > = {
      [dest]: { isSymlink: true, readlinkTarget: "/old/wrong/target" },
    };
    let rmCount = 0;
    const fs: InstallSkillSymlinkFs = {
      mkdirSync: () => undefined,
      lstatSync: (path) => {
        const entry = existing[path];
        if (!entry) {
          const err = new Error("ENOENT");
          (err as unknown as { code: string }).code = "ENOENT";
          throw err;
        }
        return {
          isSymbolicLink: () => entry.isSymlink,
          isDirectory: () => !entry.isSymlink,
          isFile: () => false,
        };
      },
      readlinkSync: (path) => existing[path]?.readlinkTarget ?? "",
      symlinkSync: () => undefined,
      rmSync: (path) => {
        rmCount += 1;
        delete existing[path];
        return undefined;
      },
      cpSync: () => undefined,
    };
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    installSkillCommand({
      force: true,
      homedir: () => "/home/alice",
      platform: "darwin",
      fs,
      stdout,
      stderr,
      processExitImpl: (code) => {
        exit.called = true;
        exit.code = code;
      },
      skillSourceProvider: () => "/pkg/skill",
      logger,
    });
    expect(rmCount).toBe(1);
    expect(exit.called).toBe(false);
  });
});

describe("T-IS-04: ExistingDestinationConflictError when destination exists + force is false", () => {
  it("stderr contains --force and the user-visible conflict copy; processExit(1)", () => {
    const dest = "/home/alice/.claude/skills/achilles";
    const existing: Record<
      string,
      { isSymlink: boolean; readlinkTarget?: string }
    > = {
      [dest]: { isSymlink: true, readlinkTarget: "/old/target" },
    };
    const fs: InstallSkillSymlinkFs = {
      mkdirSync: () => undefined,
      lstatSync: (path) => {
        const entry = existing[path];
        if (!entry) {
          const err = new Error("ENOENT");
          (err as unknown as { code: string }).code = "ENOENT";
          throw err;
        }
        return {
          isSymbolicLink: () => entry.isSymlink,
          isDirectory: () => !entry.isSymlink,
          isFile: () => false,
        };
      },
      readlinkSync: (path) => existing[path]?.readlinkTarget ?? "",
      symlinkSync: () => undefined,
      rmSync: () => undefined,
      cpSync: () => undefined,
    };
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    installSkillCommand({
      force: false,
      homedir: () => "/home/alice",
      platform: "darwin",
      fs,
      stdout,
      stderr,
      processExitImpl: (code) => {
        exit.called = true;
        exit.code = code;
      },
      skillSourceProvider: () => "/pkg/skill",
      logger,
    });
    expect(exit.called).toBe(true);
    expect(exit.code).toBe(1);
    const joined = stderr.lines.join("\n");
    expect(joined).toContain("--force");
    expect(joined).toContain("overwrite");
  });
});

describe("T-IS-05: SymlinkNotPermittedError on darwin when symlinkSync throws", () => {
  it("stderr contains the platform/error info and processExit(1)", () => {
    const { fs } = buildFsFake({
      throwOnSymlink: { code: "EACCES", message: "permission denied" },
    });
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    installSkillCommand({
      force: false,
      homedir: () => "/home/alice",
      platform: "darwin",
      fs,
      stdout,
      stderr,
      processExitImpl: (code) => {
        exit.called = true;
        exit.code = code;
      },
      skillSourceProvider: () => "/pkg/skill",
      logger,
    });
    expect(exit.called).toBe(true);
    expect(exit.code).toBe(1);
    const joined = stderr.lines.join("\n");
    expect(joined.includes("darwin") || joined.includes("EACCES")).toBe(true);
  });
});

describe("T-IS-06: Windows EPERM fallback copies the skill directory", () => {
  it("on win32 + EPERM, cpSync is invoked with recursive=true and exit is not called", () => {
    let cpCount = 0;
    const fs: InstallSkillSymlinkFs = {
      mkdirSync: () => undefined,
      lstatSync: () => {
        // No existing destination.
        const err = new Error("ENOENT");
        (err as unknown as { code: string }).code = "ENOENT";
        throw err;
      },
      readlinkSync: () => "",
      symlinkSync: () => {
        const err = new Error("EPERM");
        (err as unknown as { code: string }).code = "EPERM";
        throw err;
      },
      rmSync: () => undefined,
      cpSync: () => {
        cpCount += 1;
        return undefined;
      },
    };
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    installSkillCommand({
      force: false,
      homedir: () => "C:/Users/Alice",
      platform: "win32",
      fs,
      stdout,
      stderr,
      processExitImpl: (code) => {
        exit.called = true;
        exit.code = code;
      },
      skillSourceProvider: () => "C:/pkg/skill",
      logger,
    });
    expect(cpCount).toBe(1);
    expect(exit.called).toBe(false);
    const joined = stdout.lines.join("\n");
    expect(joined).toContain("restart Claude Code");
  });
});

describe("No emojis in install-skill output (CLAUDE.md global)", () => {
  it("no stdout or stderr line contains Extended_Pictographic codepoints", () => {
    const { options, stdout, stderr } = buildOptions({});
    installSkillCommand(options);
    for (const line of stdout.lines) {
      expect(/\p{Extended_Pictographic}/u.test(line)).toBe(false);
    }
    for (const line of stderr.lines) {
      expect(/\p{Extended_Pictographic}/u.test(line)).toBe(false);
    }
  });
});
