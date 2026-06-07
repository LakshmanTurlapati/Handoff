/**
 * Plan 13-02 skill-symlink primitive unit tests.
 *
 * Scope of THIS file:
 *
 *   - SS1: macOS happy path — destination missing, parent mkdir + one
 *     symlinkSync call; returns mode: 'symlink'
 *   - SS2: idempotent — existing symlink already points at our source;
 *     returns mode: 'already-installed' with no destructive call
 *   - SS3: existing symlink points at the WRONG source, force=false;
 *     throws ExistingDestinationConflictError naming both targets
 *   - SS4: existing destination, force=true; rmSync then symlinkSync
 *   - SS5: existing destination is a real directory (not a symlink),
 *     force=false; throws ExistingDestinationConflictError with the
 *     '--force to overwrite' remediation copy
 *   - SS6: Windows symlink EPERM fallback to recursive cpSync
 *   - SS7: Windows symlink EISDIR fallback (different errno codes on
 *     different Windows configurations)
 *   - SS8: non-Windows symlink failure throws SymlinkNotPermittedError
 *     (does NOT silently fall through to copy)
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md DIST-02 — install-skill subcommand
 *   - PITFALLS.md #13 — Windows global install pain; symlink may
 *     require admin or Developer Mode
 *
 * Notes on test discipline:
 *
 *   - NO real filesystem touch; the fs seam is a recording fake
 *   - NO console.* logging; the logger seam is a recording fake
 *   - NO emojis (CLAUDE.md global)
 */
import { describe, expect, it, vi } from "vitest";

import {
  ExistingDestinationConflictError,
  installSkillSymlink,
  SymlinkNotPermittedError,
} from "./skill-symlink.js";
import type {
  InstallSkillSymlinkFs,
  InstallSkillSymlinkLogger,
} from "./skill-symlink.js";

interface FsCall {
  fn: string;
  args: unknown[];
}

interface SymlinkErrorShape {
  code: string;
  message?: string;
}

/**
 * Build a recording fs fake. The seed object configures the state the
 * fake reports: which destinations exist, whether they are symlinks,
 * and (for symlinks) what their target is. Optional throw map injects a
 * specific Error on a named operation; used to simulate Windows EPERM.
 */
function buildFsFake(seed: {
  existingDestinations?: Record<
    string,
    { isSymlink: boolean; readlinkTarget?: string }
  >;
  throwOn?: Record<string, SymlinkErrorShape>;
}): {
  fs: InstallSkillSymlinkFs;
  calls: FsCall[];
} {
  const calls: FsCall[] = [];
  const existing = seed.existingDestinations ?? {};
  const throws = seed.throwOn ?? {};
  const fs: InstallSkillSymlinkFs = {
    mkdirSync: (path, opts) => {
      calls.push({ fn: "mkdirSync", args: [path, opts] });
      const throwShape = throws["mkdirSync"];
      if (throwShape) {
        const err = new Error(throwShape.message ?? "fake mkdirSync error");
        (err as unknown as { code: string }).code = throwShape.code;
        throw err;
      }
      return undefined;
    },
    lstatSync: (path) => {
      calls.push({ fn: "lstatSync", args: [path] });
      const entry = existing[path as string];
      if (!entry) {
        // emulate ENOENT
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
        const err = new Error(`EINVAL: ${path as string} is not a symlink`);
        (err as unknown as { code: string }).code = "EINVAL";
        throw err;
      }
      return entry.readlinkTarget ?? "";
    },
    symlinkSync: (target, path, type) => {
      calls.push({ fn: "symlinkSync", args: [target, path, type] });
      const throwShape = throws["symlinkSync"];
      if (throwShape) {
        const err = new Error(
          throwShape.message ?? `symlinkSync failed with ${throwShape.code}`,
        );
        (err as unknown as { code: string }).code = throwShape.code;
        throw err;
      }
      return undefined;
    },
    rmSync: (path, opts) => {
      calls.push({ fn: "rmSync", args: [path, opts] });
      // The fake removes the destination from the existing-record so a
      // subsequent lstatSync emulates ENOENT.
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
  const logger: InstallSkillSymlinkLogger = {
    info: (msg) => messages.push({ level: "info", msg }),
    warn: (msg) => messages.push({ level: "warn", msg }),
  };
  return { logger, messages };
}

describe("SS1: macOS happy path — symlink created at the destination", () => {
  it("creates parent dir, calls symlinkSync once, returns mode 'symlink'", () => {
    const { fs, calls } = buildFsFake({});
    const { logger, messages } = buildLogger();
    const result = installSkillSymlink({
      source: "/pkg/skill",
      destination: "/home/user/.claude/skills/achilles",
      force: false,
      fs,
      platform: "darwin",
      logger,
    });
    expect(result).toEqual({ mode: "symlink" });
    const mkdirCalls = calls.filter((c) => c.fn === "mkdirSync");
    expect(mkdirCalls).toHaveLength(1);
    expect(mkdirCalls[0]?.args[0]).toBe("/home/user/.claude/skills");
    expect((mkdirCalls[0]?.args[1] as { recursive: boolean }).recursive)
      .toBe(true);
    const symlinkCalls = calls.filter((c) => c.fn === "symlinkSync");
    expect(symlinkCalls).toHaveLength(1);
    expect(symlinkCalls[0]?.args[0]).toBe("/pkg/skill");
    expect(symlinkCalls[0]?.args[1]).toBe("/home/user/.claude/skills/achilles");
    expect(symlinkCalls[0]?.args[2]).toBe("dir");
    const successLine = messages.find((m) => m.msg.includes("symlinked"));
    expect(successLine).toBeDefined();
    expect(
      successLine?.msg.includes("/home/user/.claude/skills/achilles"),
    ).toBe(true);
  });
});

describe("SS2: idempotent — existing symlink points at the correct source", () => {
  it("returns mode 'already-installed' without destructive calls", () => {
    const dest = "/home/user/.claude/skills/achilles";
    const src = "/pkg/skill";
    const { fs, calls } = buildFsFake({
      existingDestinations: {
        [dest]: { isSymlink: true, readlinkTarget: src },
      },
    });
    const { logger, messages } = buildLogger();
    const result = installSkillSymlink({
      source: src,
      destination: dest,
      force: false,
      fs,
      platform: "darwin",
      logger,
    });
    expect(result).toEqual({ mode: "already-installed" });
    expect(calls.filter((c) => c.fn === "symlinkSync")).toHaveLength(0);
    expect(calls.filter((c) => c.fn === "rmSync")).toHaveLength(0);
    expect(calls.filter((c) => c.fn === "cpSync")).toHaveLength(0);
    const infoLine = messages.find((m) => m.msg.includes("already installed"));
    expect(infoLine).toBeDefined();
  });
});

describe("SS3: existing symlink points at WRONG source, force=false", () => {
  it("throws ExistingDestinationConflictError naming both targets", () => {
    const dest = "/home/user/.claude/skills/achilles";
    const src = "/pkg/skill";
    const wrongTarget = "/some/other/path";
    const { fs, calls } = buildFsFake({
      existingDestinations: {
        [dest]: { isSymlink: true, readlinkTarget: wrongTarget },
      },
    });
    const { logger } = buildLogger();
    expect(() =>
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "darwin",
        logger,
      }),
    ).toThrowError(ExistingDestinationConflictError);
    try {
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "darwin",
        logger,
      });
    } catch (err) {
      const message = (err as Error).message;
      expect(message.includes(wrongTarget)).toBe(true);
      expect(message.includes(src)).toBe(true);
    }
    expect(calls.filter((c) => c.fn === "symlinkSync")).toHaveLength(0);
    expect(calls.filter((c) => c.fn === "rmSync")).toHaveLength(0);
  });
});

describe("SS4: existing destination, force=true — rmSync then symlinkSync", () => {
  it("rmSync then one symlinkSync; returns mode 'symlink'", () => {
    const dest = "/home/user/.claude/skills/achilles";
    const src = "/pkg/skill";
    const { fs, calls } = buildFsFake({
      existingDestinations: {
        [dest]: { isSymlink: true, readlinkTarget: "/old/target" },
      },
    });
    const { logger } = buildLogger();
    const result = installSkillSymlink({
      source: src,
      destination: dest,
      force: true,
      fs,
      platform: "darwin",
      logger,
    });
    expect(result).toEqual({ mode: "symlink" });
    const rmCalls = calls.filter((c) => c.fn === "rmSync");
    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0]?.args[0]).toBe(dest);
    expect(
      rmCalls[0]?.args[1] as { recursive: boolean; force: boolean },
    ).toEqual({ recursive: true, force: true });
    const symlinkCalls = calls.filter((c) => c.fn === "symlinkSync");
    expect(symlinkCalls).toHaveLength(1);
    expect(symlinkCalls[0]?.args[0]).toBe(src);
    expect(symlinkCalls[0]?.args[1]).toBe(dest);
    // rmSync MUST happen before symlinkSync.
    const indexRm = calls.findIndex((c) => c.fn === "rmSync");
    const indexSym = calls.findIndex((c) => c.fn === "symlinkSync");
    expect(indexRm).toBeLessThan(indexSym);
  });
});

describe("SS5: existing real directory (not a symlink), force=false", () => {
  it("throws ExistingDestinationConflictError with --force remediation copy", () => {
    const dest = "/home/user/.claude/skills/achilles";
    const src = "/pkg/skill";
    const { fs, calls } = buildFsFake({
      existingDestinations: {
        [dest]: { isSymlink: false },
      },
    });
    const { logger } = buildLogger();
    expect(() =>
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "darwin",
        logger,
      }),
    ).toThrowError(ExistingDestinationConflictError);
    try {
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "darwin",
        logger,
      });
    } catch (err) {
      const message = (err as Error).message;
      expect(message.includes(dest)).toBe(true);
      expect(message.includes("--force")).toBe(true);
    }
    expect(calls.filter((c) => c.fn === "rmSync")).toHaveLength(0);
  });
});

describe("SS6: Windows symlink EPERM fallback to recursive cpSync", () => {
  it("falls back to cpSync; logger emits a warn + an info line; mode 'copy'", () => {
    const dest = "C:/Users/Alice/.claude/skills/achilles";
    const src = "C:/pkg/skill";
    const { fs, calls } = buildFsFake({
      throwOn: {
        symlinkSync: { code: "EPERM", message: "operation not permitted" },
      },
    });
    const { logger, messages } = buildLogger();
    const result = installSkillSymlink({
      source: src,
      destination: dest,
      force: false,
      fs,
      platform: "win32",
      logger,
    });
    expect(result).toEqual({ mode: "copy" });
    const cpCalls = calls.filter((c) => c.fn === "cpSync");
    expect(cpCalls).toHaveLength(1);
    expect(cpCalls[0]?.args[0]).toBe(src);
    expect(cpCalls[0]?.args[1]).toBe(dest);
    expect((cpCalls[0]?.args[2] as { recursive: boolean }).recursive).toBe(
      true,
    );
    const warnLine = messages.find(
      (m) => m.level === "warn" && m.msg.includes("symlink not permitted"),
    );
    expect(warnLine).toBeDefined();
    const infoLine = messages.find(
      (m) => m.level === "info" && m.msg.includes("copied"),
    );
    expect(infoLine).toBeDefined();
    expect(infoLine?.msg.includes(dest)).toBe(true);
  });
});

describe("SS7: Windows symlink EISDIR / EACCES fallback (alternate errno codes)", () => {
  it("falls back to cpSync on EISDIR", () => {
    const dest = "C:/Users/Alice/.claude/skills/achilles";
    const src = "C:/pkg/skill";
    const { fs, calls } = buildFsFake({
      throwOn: {
        symlinkSync: { code: "EISDIR", message: "is a directory" },
      },
    });
    const { logger } = buildLogger();
    const result = installSkillSymlink({
      source: src,
      destination: dest,
      force: false,
      fs,
      platform: "win32",
      logger,
    });
    expect(result).toEqual({ mode: "copy" });
    expect(calls.filter((c) => c.fn === "cpSync")).toHaveLength(1);
  });

  it("falls back to cpSync on EACCES", () => {
    const dest = "C:/Users/Alice/.claude/skills/achilles";
    const src = "C:/pkg/skill";
    const { fs, calls } = buildFsFake({
      throwOn: {
        symlinkSync: { code: "EACCES", message: "permission denied" },
      },
    });
    const { logger } = buildLogger();
    const result = installSkillSymlink({
      source: src,
      destination: dest,
      force: false,
      fs,
      platform: "win32",
      logger,
    });
    expect(result).toEqual({ mode: "copy" });
    expect(calls.filter((c) => c.fn === "cpSync")).toHaveLength(1);
  });
});

describe("SS8: non-Windows symlink failure throws SymlinkNotPermittedError", () => {
  it("throws SymlinkNotPermittedError on darwin (does NOT fall back to copy)", () => {
    const dest = "/home/user/.claude/skills/achilles";
    const src = "/pkg/skill";
    const { fs, calls } = buildFsFake({
      throwOn: {
        symlinkSync: { code: "EPERM", message: "permission denied" },
      },
    });
    const { logger } = buildLogger();
    expect(() =>
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "darwin",
        logger,
      }),
    ).toThrowError(SymlinkNotPermittedError);
    try {
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "darwin",
        logger,
      });
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      const message = (err as Error).message;
      expect(message.includes("darwin") || message.includes("EPERM")).toBe(
        true,
      );
    }
    expect(calls.filter((c) => c.fn === "cpSync")).toHaveLength(0);
  });

  it("throws SymlinkNotPermittedError on linux", () => {
    const dest = "/home/user/.claude/skills/achilles";
    const src = "/pkg/skill";
    const { fs, calls } = buildFsFake({
      throwOn: {
        symlinkSync: { code: "EROFS", message: "read-only file system" },
      },
    });
    const { logger } = buildLogger();
    expect(() =>
      installSkillSymlink({
        source: src,
        destination: dest,
        force: false,
        fs,
        platform: "linux",
        logger,
      }),
    ).toThrowError(SymlinkNotPermittedError);
    expect(calls.filter((c) => c.fn === "cpSync")).toHaveLength(0);
  });
});

describe("logger emits zero emojis (CLAUDE.md global)", () => {
  it("symlink success message does NOT contain Extended_Pictographic codepoints", () => {
    const { fs } = buildFsFake({});
    const { logger, messages } = buildLogger();
    installSkillSymlink({
      source: "/pkg/skill",
      destination: "/home/user/.claude/skills/achilles",
      force: false,
      fs,
      platform: "darwin",
      logger,
    });
    for (const m of messages) {
      expect(/\p{Extended_Pictographic}/u.test(m.msg)).toBe(false);
    }
  });
});

// vi is imported above so the test file's static analysis remains happy
// even if a future test inlines a vi.mock call; the unused-locals rule
// is satisfied by this no-op reference.
void vi;
