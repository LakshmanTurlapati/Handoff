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
