/**
 * Phase 18, Plan 02, Task 1 — RED tests for preflight.ts
 *
 * Tests for checkPreflight: which + device-open smoke for sox/ffmpeg/claude.
 * All tests are hermetic via deps injection — no real process spawned, no
 * real mic opened.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  checkPreflight,
  type PreflightDeps,
} from "../../src/init/preflight.js";

/**
 * Build a fake ChildProcess-like EventEmitter that exits with a given code
 * after a delay.
 */
function makeFakeProc(
  exitCode: number | null,
  stderrData: string,
  delayMs = 0,
): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  const stderrEe = new EventEmitter();
  (ee as unknown as Record<string, unknown>).stderr = stderrEe;
  (ee as unknown as Record<string, unknown>).stdout = null;
  (ee as unknown as Record<string, unknown>).kill = vi.fn();

  if (delayMs > 0) {
    setTimeout(() => {
      stderrEe.emit("data", Buffer.from(stderrData));
      (ee as unknown as EventEmitter).emit("exit", exitCode, null);
    }, delayMs);
  } else {
    // Defer slightly so listeners can be attached before the emit.
    process.nextTick(() => {
      stderrEe.emit("data", Buffer.from(stderrData));
      (ee as unknown as EventEmitter).emit("exit", exitCode, null);
    });
  }

  return ee;
}

/**
 * Build a fake that never exits (for timeout tests).
 */
function makeHangingProc(): ChildProcess {
  const ee = new EventEmitter() as unknown as ChildProcess;
  const stderrEe = new EventEmitter();
  (ee as unknown as Record<string, unknown>).stderr = stderrEe;
  (ee as unknown as Record<string, unknown>).stdout = null;
  (ee as unknown as Record<string, unknown>).kill = vi.fn(() => {
    // When kill is called (SIGTERM from timeout), emit exit.
    process.nextTick(() => {
      (ee as unknown as EventEmitter).emit("exit", null, "SIGTERM");
    });
  });
  return ee;
}

/** Build basic deps where all three binaries are found + smoke exits 0. */
function makeAllOkDeps(): PreflightDeps {
  return {
    execImpl: (cmd: string) => {
      if (cmd.includes("which sox")) return "/usr/local/bin/sox\n";
      if (cmd.includes("which ffmpeg")) return "/usr/local/bin/ffmpeg\n";
      if (cmd.includes("which claude")) return "/usr/local/bin/claude\n";
      if (cmd.includes("where.exe sox")) return "C:\\sox.exe\n";
      if (cmd.includes("where.exe ffmpeg")) return "C:\\ffmpeg.exe\n";
      if (cmd.includes("where.exe claude")) return "C:\\claude.exe\n";
      return "";
    },
    spawnImpl: (_cmd, _args, _opts) => makeFakeProc(0, "", 0),
    timeoutMs: 3000,
  };
}

describe("checkPreflight — sox ok", () => {
  it("returns sox.status='ok' when whichSync resolves AND device-open smoke exit code is 0", async () => {
    const result = await checkPreflight(makeAllOkDeps());
    expect(result.sox.status).toBe("ok");
    expect(result.sox.name).toBe("sox");
    expect(result.sox.path).toBe("/usr/local/bin/sox");
  });
});

describe("checkPreflight — sox missing", () => {
  it("returns sox.status='missing' when whichSync returns null", async () => {
    const deps: PreflightDeps = {
      ...makeAllOkDeps(),
      execImpl: (cmd: string) => {
        if (cmd.includes("which sox") || cmd.includes("where.exe sox"))
          throw new Error("not found");
        if (cmd.includes("which ffmpeg")) return "/usr/local/bin/ffmpeg\n";
        if (cmd.includes("which claude")) return "/usr/local/bin/claude\n";
        return "";
      },
    };
    const result = await checkPreflight(deps);
    expect(result.sox.status).toBe("missing");
    expect(result.sox.path).toBeNull();
    expect(result.allOk).toBe(false);
  });
});

describe("checkPreflight — sox device-failed (non-zero exit)", () => {
  it("returns sox.status='device-failed' with stderr when device-open smoke exits non-zero", async () => {
    const deps: PreflightDeps = {
      ...makeAllOkDeps(),
      spawnImpl: (cmd, _args, _opts) => {
        if (typeof cmd === "string" && cmd.includes("sox")) {
          return makeFakeProc(1, "rec FAIL formats: can't open input");
        }
        return makeFakeProc(0, "");
      },
    };
    const result = await checkPreflight(deps);
    expect(result.sox.status).toBe("device-failed");
    expect(result.sox.stderr).toContain("rec FAIL formats");
    expect(result.allOk).toBe(false);
  });
});

describe("checkPreflight — sox device-failed (timeout)", () => {
  it("returns sox.status='device-failed' with stderr when the device-open smoke times out at 3s", async () => {
    const hangingProc = makeHangingProc();
    const deps: PreflightDeps = {
      ...makeAllOkDeps(),
      spawnImpl: (cmd, _args, _opts) => {
        if (typeof cmd === "string" && (cmd.includes("rec") || cmd.includes("sox"))) {
          return hangingProc;
        }
        return makeFakeProc(0, "");
      },
      timeoutMs: 50, // Very short for testing
    };
    const result = await checkPreflight(deps);
    expect(result.sox.status).toBe("device-failed");
    expect(result.allOk).toBe(false);
  }, 5000);
});

describe("checkPreflight — allOk false", () => {
  it("returns allOk=false when any of sox/ffmpeg/claude is not ok", async () => {
    const deps: PreflightDeps = {
      ...makeAllOkDeps(),
      execImpl: (cmd: string) => {
        if (cmd.includes("which sox") || cmd.includes("where.exe sox"))
          throw new Error("not found");
        if (cmd.includes("which ffmpeg")) return "/usr/local/bin/ffmpeg\n";
        if (cmd.includes("which claude")) return "/usr/local/bin/claude\n";
        return "";
      },
    };
    const result = await checkPreflight(deps);
    expect(result.allOk).toBe(false);
  });
});

describe("checkPreflight — allOk true", () => {
  it("allOk=true only when every binary reports ok", async () => {
    const result = await checkPreflight(makeAllOkDeps());
    expect(result.sox.status).toBe("ok");
    expect(result.ffmpeg.status).toBe("ok");
    expect(result.claude.status).toBe("ok");
    expect(result.allOk).toBe(true);
  });
});

describe("checkPreflight — EPERM stderr captured", () => {
  it("captures EPERM stderr verbatim into BinaryCheck.stderr", async () => {
    const epermMsg =
      "rec FAIL formats: can't open input `default': Permission denied";
    const deps: PreflightDeps = {
      ...makeAllOkDeps(),
      spawnImpl: (cmd, _args, _opts) => {
        if (typeof cmd === "string" && (cmd.includes("rec") || cmd.includes("sox"))) {
          return makeFakeProc(1, epermMsg);
        }
        return makeFakeProc(0, "");
      },
    };
    const result = await checkPreflight(deps);
    expect(result.sox.status).toBe("device-failed");
    expect(result.sox.stderr).toBe(epermMsg);
  });
});
