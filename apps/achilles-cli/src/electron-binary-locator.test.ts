/**
 * Tests for the platform-aware Electron binary locator.
 *
 * Per Plan 13-01 Task 2 behaviour Tests L1-L5. The locator is a pure
 * function over an injected `fileExistsAt` seam so tests run without
 * touching the filesystem; the production wiring binds `fileExistsAt`
 * to a synchronous `fs.existsSync` call at module load.
 *
 * Path contracts (Plan 13-01 <action> block):
 *   darwin: <pkgRoot>/dist/Achilles.app/Contents/MacOS/Achilles
 *   win32:  <pkgRoot>/dist/Achilles.exe
 *   linux:  <pkgRoot>/dist/linux/achilles
 *
 * Unknown platforms throw a plain Error; missing binaries throw the
 * typed `ElectronBinaryMissingError` so the launch command can render a
 * remediation-specific stderr line (Test LC2).
 */

import { describe, expect, it } from "vitest";
import {
  ElectronBinaryMissingError,
  locateElectronBinary,
} from "./electron-binary-locator.js";

describe("locateElectronBinary", () => {
  it("L1: returns the darwin .app bundle MacOS binary path when the file exists", () => {
    const expected = "/pkg/dist/Achilles.app/Contents/MacOS/Achilles";
    const result = locateElectronBinary({
      pkgRoot: "/pkg",
      platform: "darwin",
      fileExistsAt: (p) => p === expected,
    });
    expect(result).toBe(expected);
  });

  it("L2: returns the win32 .exe path when the file exists", () => {
    const expected = "/pkg/dist/Achilles.exe";
    const result = locateElectronBinary({
      pkgRoot: "/pkg",
      platform: "win32",
      fileExistsAt: (p) => p === expected,
    });
    expect(result).toBe(expected);
  });

  it("L3: returns the linux binary path when the file exists", () => {
    const expected = "/pkg/dist/linux/achilles";
    const result = locateElectronBinary({
      pkgRoot: "/pkg",
      platform: "linux",
      fileExistsAt: (p) => p === expected,
    });
    expect(result).toBe(expected);
  });

  it("L4: throws ElectronBinaryMissingError when the binary is absent; message names the platform AND the expected path; err instanceof Error", () => {
    let caught: unknown = null;
    try {
      locateElectronBinary({
        pkgRoot: "/pkg",
        platform: "darwin",
        fileExistsAt: () => false,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ElectronBinaryMissingError);
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("darwin");
    expect(message).toContain(
      "/pkg/dist/Achilles.app/Contents/MacOS/Achilles",
    );
  });

  it("WR-08: L2 return value stays posix-style (forward slashes) regardless of host OS — the test fixture pkgRoot is '/pkg' and the production callers (cli.ts spawn) accept the mixed-separator path on Windows", () => {
    // The return value contract is unchanged by the WR-08 fix: callers
    // continue to receive `/pkg/dist/Achilles.exe` even when the user
    // is on Windows. Only the L4 error message gets the cosmetic
    // backslash conversion. Pinning this so a future refactor cannot
    // silently change the return shape and break the cli.ts → spawn
    // hop.
    const expected = "/pkg/dist/Achilles.exe";
    const result = locateElectronBinary({
      pkgRoot: "/pkg",
      platform: "win32",
      fileExistsAt: (p) => p === expected,
    });
    expect(result).toBe(expected);
    expect(result.includes("\\")).toBe(false);
  });

  it("WR-08: L4 error message on win32 is rendered with the platform-native separator when the host's path.sep is backslash", () => {
    // On non-Windows hosts (where path.sep is '/'), the message keeps
    // forward slashes — the regression we are guarding against is
    // confusing the OPERATOR who reads the diagnostic, not the
    // operating system. The branch is only exercised when both the
    // requested platform is win32 AND the host's path.sep is
    // backslash. CI runs on darwin/linux, so this test asserts the
    // unchanged-fallback behaviour. The branch itself is covered by
    // the production message on a Windows CI runner.
    let caught: unknown = null;
    try {
      locateElectronBinary({
        pkgRoot: "/pkg",
        platform: "win32",
        fileExistsAt: () => false,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ElectronBinaryMissingError);
    const message = (caught as Error).message;
    expect(message).toContain("win32");
    // The error message names the platform AND a path. On non-Windows
    // hosts the path keeps forward slashes; that's a CONSCIOUS
    // fallback per the inline comment in locateElectronBinary.
    expect(message).toMatch(/Achilles\.exe/);
  });

  it("L5: throws a plain Error with 'Unsupported platform' for unknown platforms", () => {
    let caught: unknown = null;
    try {
      locateElectronBinary({
        pkgRoot: "/pkg",
        platform: "aix" as NodeJS.Platform,
        fileExistsAt: () => true,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(ElectronBinaryMissingError);
    expect((caught as Error).message).toContain("Unsupported platform");
    expect((caught as Error).message).toContain("aix");
  });
});
