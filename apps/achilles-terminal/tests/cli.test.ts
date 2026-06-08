/**
 * Phase 15 seed test surface for INIT-07.
 *
 * Asserts that `achilles --version` (and the short `-v` form) exits 0 and
 * prints the version field from package.json without requiring any
 * pipeline-boot resource (no ELEVENLABS_API_KEY, no sox, no ffmpeg). The
 * argv parse MUST happen before any dynamic import that would touch those
 * resources; this surface is the structural assertion that Phase 16+
 * cannot regress.
 *
 * Test 5 is a file-level invariant: src/cli.ts must begin with the literal
 * shebang line so `npm install -g achilles` on POSIX systems finds the
 * interpreter without a wrapper.
 *
 * Note on Assumption A7 (RESEARCH.md): under Bun, process.execPath is the
 * bun binary, not node. The simple shape here assumes Node + tsx; Plan 04
 * adds the dual-runtime CI matrix that surfaces any runtime-detection gap.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = join(HERE, "..", "src", "cli.ts");
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(resolve(HERE, "..", "package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("achilles --version", () => {
  it("prints a non-empty semver-shaped version string matching package.json", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "--version"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
    expect(result.stderr).toBe("");
  });

  it("exits 0 without ELEVENLABS_API_KEY set (INIT-07)", () => {
    // Spread process.env then explicitly delete the key. Setting to
    // undefined would coerce to the string "undefined" via the spawn env
    // serialization; delete removes the key entirely.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.ELEVENLABS_API_KEY;

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "--version"],
      {
        encoding: "utf8",
        timeout: 5000,
        env,
      },
    );

    expect(result.status).toBe(0);
  });

  it("short -v flag prints the same version", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "-v"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(PACKAGE_VERSION);
  });

  it("unknown command exits 1 with stderr message", () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", CLI_SRC, "bogus-subcommand"],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/achilles: unknown command/);
  });

  it("src/cli.ts begins with the node shebang line", () => {
    const source = readFileSync(CLI_SRC, "utf8");
    const firstLine = source.split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });
});
