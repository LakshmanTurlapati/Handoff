#!/usr/bin/env node
/**
 * Cross-compile the achilles CLI for 5 native targets via `bun build
 * --compile`.
 *
 * Wraps the five invocations enumerated in RESEARCH.md Pattern 1 (lines
 * 237-254): darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64.
 * Each spawn writes its output to apps/cli-<platform>-<arch>/bin/, then
 * chmod 0o755 the result per RESEARCH.md Pitfall 4 (bun --compile may
 * leave the executable bit unset on some hosts; the npm tarball preserves
 * mode bits per npm documented behavior, so setting it here propagates
 * correctly to installers).
 *
 * Note on the Bun target string vs the output directory name: Bun calls
 * the Windows target `bun-windows-x64` while the output directory uses
 * `cli-win32-x64` to match Node's `process.platform` value that the shim
 * interpolates at runtime. The two enumerations are NOT interchangeable;
 * RESEARCH.md line 258 calls this out explicitly.
 *
 * Logging contract (CLAUDE.md global: NO emojis; defence in depth):
 *   - Success: log to stdout with the literal prefix `[achilles] `.
 *   - Failure: log to stderr.
 *
 * No external dependencies. Node 22 stdlib only. Requires `bun` on PATH.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at apps/achilles-terminal/scripts/; the workspace root is
// one directory up.
const WORKSPACE = resolve(HERE, "..");

/**
 * Greppable targets array — five sibling platform packages.
 *
 * `bunTarget` is the string passed to `bun build --compile --target=...`
 * (Bun's naming: linux, darwin, windows). `outRelative` is resolved
 * against WORKSPACE to produce the absolute output path inside the
 * sibling package and matches Node's `process.platform-process.arch`
 * convention (linux, darwin, win32) — that is the directory name the shim
 * walks at runtime via import.meta.resolve.
 */
const targets = [
  {
    name: "darwin-arm64",
    bunTarget: "bun-darwin-arm64",
    outRelative: "../cli-darwin-arm64/bin/achilles",
  },
  {
    name: "darwin-x64",
    bunTarget: "bun-darwin-x64",
    outRelative: "../cli-darwin-x64/bin/achilles",
  },
  {
    name: "linux-x64",
    bunTarget: "bun-linux-x64",
    outRelative: "../cli-linux-x64/bin/achilles",
  },
  {
    name: "linux-arm64",
    bunTarget: "bun-linux-arm64",
    outRelative: "../cli-linux-arm64/bin/achilles",
  },
  {
    name: "win32-x64",
    bunTarget: "bun-windows-x64",
    outRelative: "../cli-win32-x64/bin/achilles.exe",
  },
];

const entry = join(WORKSPACE, "src/cli.ts");

for (const target of targets) {
  process.stdout.write(`[achilles] Building ${target.name} ...\n`);

  const outAbsolute = resolve(WORKSPACE, target.outRelative);
  mkdirSync(dirname(outAbsolute), { recursive: true });

  const result = spawnSync(
    "bun",
    [
      "build",
      entry,
      "--compile",
      `--target=${target.bunTarget}`,
      `--outfile=${outAbsolute}`,
      "--minify",
    ],
    { stdio: "inherit", cwd: WORKSPACE },
  );

  if (result.status !== 0) {
    process.stderr.write(
      `[achilles] FAILED building ${target.name} (status=${result.status ?? "null"})\n`,
    );
    process.exit(result.status ?? 1);
  }

  // Pitfall 4: ensure the executable bit is set on POSIX hosts; harmless
  // on Windows where mode bits are advisory.
  chmodSync(outAbsolute, 0o755);
  process.stdout.write(`[achilles] Built ${target.name} (chmod 755)\n`);
}

process.stdout.write("[achilles] All 5 targets built.\n");
