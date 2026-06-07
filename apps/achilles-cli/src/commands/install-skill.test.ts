/**
 * Plan 13-02 install-skill command unit tests.
 *
 * Scope of THIS file:
 *
 *   - IS1: source resolved from injected skillSourceProvider (production
 *     path reads @achilles/achilles-skill's SKILL_PROMPTS_DIR)
 *   - IS2: destination resolved via injected homedir seam to
 *     ~/.claude/skills/achilles
 *   - IS3: force flag passed through to installSkillSymlink
 *   - IS4: ExistingDestinationConflictError surfaces remediation copy
 *     (already installed at a different path / pass --force to overwrite)
 *     and calls processExitImpl(1)
 *   - IS5: on success, stdout contains "restart Claude Code" reminder
 *     (Pitfall #5: live discovery requires restart for new skills dirs)
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md DIST-02 — install-skill subcommand
 *   - PITFALLS.md #5 — Claude Code skills directory discovery
 *
 * Notes on test discipline:
 *
 *   - NO real filesystem touch; the fs + homedir + skillSourceProvider
 *     seams are injected fakes
 *   - NO process.exit; the processExitImpl seam is a recording fake
 *   - NO emojis (CLAUDE.md global)
 */
import { describe, expect, it } from "vitest";

import { installSkillCommand } from "./install-skill.js";
import type { InstallSkillCommandOptions } from "./install-skill.js";
import type {
  InstallSkillSymlinkFs,
  InstallSkillSymlinkLogger,
} from "../skill-symlink.js";

interface FsCall {
  fn: string;
  args: unknown[];
}

interface FakeWriteStream {
  lines: string[];
  write(chunk: string): boolean;
}

function buildFakeWriteStream(): FakeWriteStream {
  const lines: string[] = [];
  return {
    lines,
    write(chunk: string): boolean {
      // Normalise trailing newline so test assertions don't have to
      // account for it; the command writes one logical line per call.
      lines.push(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk);
      return true;
    },
  };
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
      const entry = existing[path as string];
      if (!entry) {
        const err = new Error(`ENOENT: ${path as string}`);
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
      const entry = existing[path as string];
      if (!entry || !entry.isSymlink) {
        const err = new Error(`EINVAL: ${path as string}`);
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
      return undefined;
    },
    rmSync: (path, opts) => {
      calls.push({ fn: "rmSync", args: [path, opts] });
      delete existing[path as string];
      return undefined;
    },
    cpSync: (src, dest, opts) => {
      calls.push({ fn: "cpSync", args: [src, dest, opts] });
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
  loggerMessages: { level: "info" | "warn"; msg: string }[];
} {
  const stdout = buildFakeWriteStream();
  const stderr = buildFakeWriteStream();
  const exit: ExitRecord = { called: false, code: -1 };
  const { fs, calls } = buildFsFake({});
  const { logger, messages } = buildLogger();
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
    loggerMessages: messages,
  };
}

describe("IS1: source resolved from injected skillSourceProvider", () => {
  it("the symlink call's target equals the value returned by skillSourceProvider", () => {
    const captured: { source?: string; destination?: string } = {};
    const { fs } = buildFsFake({});
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    const observingFs: InstallSkillSymlinkFs = {
      ...fs,
      symlinkSync: (target, path, type) => {
        captured.source = target as string;
        captured.destination = path as string;
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
      skillSourceProvider: () => "/custom/source/skill",
      logger,
    });
    expect(captured.source).toBe("/custom/source/skill");
  });
});

describe("IS2: destination resolved via homedir seam", () => {
  it("destination equals <homedir>/.claude/skills/achilles", () => {
    const captured: { destination?: string } = {};
    const { fs } = buildFsFake({});
    const stdout = buildFakeWriteStream();
    const stderr = buildFakeWriteStream();
    const exit: ExitRecord = { called: false, code: -1 };
    const { logger } = buildLogger();
    const observingFs: InstallSkillSymlinkFs = {
      ...fs,
      symlinkSync: (target, path, type) => {
        captured.destination = path as string;
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
    // path.join collapses separators per the host platform; in the test
    // environment (POSIX) the segments are forward-slash separated.
    expect(captured.destination).toBe("/home/alice/.claude/skills/achilles");
  });
});

describe("IS3: force flag passed through to installSkillSymlink", () => {
  it("--force true triggers rmSync on an existing wrong-target symlink", () => {
    const dest = "/home/alice/.claude/skills/achilles";
    const captured: { rmCount: number } = { rmCount: 0 };
    const existing: Record<
      string,
      { isSymlink: boolean; readlinkTarget?: string }
    > = {
      [dest]: { isSymlink: true, readlinkTarget: "/old/wrong/target" },
    };
    const fs: InstallSkillSymlinkFs = {
      mkdirSync: () => undefined,
      lstatSync: (path) => {
        const entry = existing[path as string];
        if (!entry) {
          const err = new Error(`ENOENT`);
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
        const entry = existing[path as string];
        return entry?.readlinkTarget ?? "";
      },
      symlinkSync: () => undefined,
      rmSync: (path) => {
        captured.rmCount += 1;
        delete existing[path as string];
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
    expect(captured.rmCount).toBe(1);
    expect(exit.called).toBe(false);
  });

  it("--force false on the same existing destination calls processExitImpl(1)", () => {
    const dest = "/home/alice/.claude/skills/achilles";
    const existing: Record<
      string,
      { isSymlink: boolean; readlinkTarget?: string }
    > = {
      [dest]: { isSymlink: true, readlinkTarget: "/old/wrong/target" },
    };
    const fs: InstallSkillSymlinkFs = {
      mkdirSync: () => undefined,
      lstatSync: (path) => {
        const entry = existing[path as string];
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
      readlinkSync: (path) => existing[path as string]?.readlinkTarget ?? "",
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
  });
});

describe("IS4: ExistingDestinationConflictError surfaces remediation copy", () => {
  it("stderr contains 'pass --force to overwrite' and 'different' or path; processExit(1) called", () => {
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
        const entry = existing[path as string];
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
      readlinkSync: (path) => existing[path as string]?.readlinkTarget ?? "",
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
    expect(joined.includes("already")).toBe(true);
    expect(joined.includes("different")).toBe(true);
    expect(joined.includes("--force")).toBe(true);
    expect(joined.includes("overwrite")).toBe(true);
  });
});

describe("IS5: success message includes 'restart Claude Code' reminder", () => {
  it("on mode 'symlink', stdout contains 'restart Claude Code'", () => {
    const { options, stdout, exit } = buildOptions({});
    installSkillCommand(options);
    const joined = stdout.lines.join("\n");
    expect(joined.includes("restart Claude Code")).toBe(true);
    expect(exit.called).toBe(false);
  });

  it("on mode 'copy' (Windows fallback), stdout still contains 'restart Claude Code'", () => {
    const { fs } = buildFsFake({
      throwOnSymlink: { code: "EPERM", message: "permission denied" },
    });
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
    const joined = stdout.lines.join("\n");
    expect(joined.includes("restart Claude Code")).toBe(true);
    expect(exit.called).toBe(false);
  });

  it("on mode 'already-installed', stdout reports 'already installed' (no restart reminder needed)", () => {
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
        const entry = existing[path as string];
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
      readlinkSync: (path) => existing[path as string]?.readlinkTarget ?? "",
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
    const joined = stdout.lines.join("\n");
    expect(joined.includes("already installed")).toBe(true);
    expect(exit.called).toBe(false);
  });
});

describe("SymlinkNotPermittedError surfaces Developer Mode hint", () => {
  it("on darwin EPERM, stderr names the underlying error", () => {
    const { fs } = buildFsFake({
      throwOnSymlink: { code: "EPERM", message: "permission denied" },
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
    // Either the platform name OR the error code appears in the message.
    expect(joined.includes("darwin") || joined.includes("EPERM")).toBe(true);
  });
});

describe("output zero emojis (CLAUDE.md global)", () => {
  it("no stdout / stderr line contains Extended_Pictographic codepoints", () => {
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
