/**
 * DIST-02 shim resolve + fallback assertion (Phase 15, Plan 03).
 *
 * The 30-line shim at apps/achilles-terminal/src/shim/cli.shim.js is the
 * install-time + runtime contract between the parent `achilles` package
 * and the five `@achilles/cli-<platform>-<arch>` platform-binary sibling
 * packages. This test surface validates four behaviours:
 *
 *   1. Resolve-then-exec: when a matching platform binary is present
 *      under node_modules/@achilles/cli-<platform>-<arch>/bin/, the shim
 *      execs it with stdio: "inherit".
 *   2. Silent fallback: when the platform package is absent, the shim
 *      dynamically imports dist/main.js with no stderr output (the
 *      resolve-failure path is intentional, not an error).
 *   3. Exit-code propagation: the shim returns result.status ?? 0 so a
 *      platform binary that exits with status 42 surfaces 42 to the
 *      caller.
 *   4. Argv pass-through: process.argv.slice(2) is forwarded verbatim.
 *
 * Pattern: a temporary workspace is constructed under os.tmpdir() with a
 * mocked node_modules/@achilles/cli-<platform>-<arch>/ layout, the shim is
 * copied to <tmp>/dist/cli.js so its import.meta.resolve walks the
 * temp-dir's node_modules, and the shim is invoked through
 * process.execPath. Teardown removes the temp directory via rmSync.
 *
 * The Windows .exe-suffix path (Pitfall 3) is implicitly exercised by the
 * shim's branching on process.platform on a Windows CI runner; on POSIX
 * hosts the same mock infrastructure simply creates bin/achilles. No
 * separate skipIf branch is required — the shim itself selects the
 * correct exe name.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM_SRC = join(HERE, "..", "src", "shim", "cli.shim.js");

const PLATFORM_PKG = `@achilles/cli-${process.platform}-${process.arch}`;
const BIN_NAME = process.platform === "win32" ? "achilles.exe" : "achilles";

let createdDirs: string[] = [];

afterEach(() => {
  for (const d of createdDirs) {
    rmSync(d, { recursive: true, force: true });
  }
  createdDirs = [];
});

/**
 * Materialize a mock workspace mirroring the production layout that
 * import.meta.resolve walks at runtime:
 *
 *   <tmp>/dist/cli.js                                          (the shim)
 *   <tmp>/dist/main.js                                         (the fallback bundle)
 *   <tmp>/node_modules/@achilles/cli-<platform>-<arch>/package.json
 *   <tmp>/node_modules/@achilles/cli-<platform>-<arch>/bin/achilles[.exe]
 *
 * When `includePlatformBinary` is false the node_modules tree is omitted
 * so the shim's try/catch falls through to dist/main.js. When `mockExitCode`
 * is provided, the mock binary calls process.exit(mockExitCode); the
 * default 0 keeps the resolve-then-exec assertion straightforward.
 */
function createMockWorkspace(options: {
  includePlatformBinary: boolean;
  mockExitCode?: number;
}): string {
  const tmp = mkdtempSync(join(tmpdir(), "achilles-shim-"));
  createdDirs.push(tmp);

  // dist/cli.js (the shim under test) + dist/main.js (fallback target).
  mkdirSync(join(tmp, "dist"), { recursive: true });
  copyFileSync(SHIM_SRC, join(tmp, "dist", "cli.js"));
  writeFileSync(
    join(tmp, "dist", "main.js"),
    `#!/usr/bin/env node\nconsole.log("FALLBACK_RAN " + process.argv.slice(2).join(" "));\nprocess.exit(0);\n`,
    { encoding: "utf8" },
  );

  if (options.includePlatformBinary) {
    const pkgDir = join(tmp, "node_modules", PLATFORM_PKG);
    const binDir = join(pkgDir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: PLATFORM_PKG, version: "1.3.0" }),
      { encoding: "utf8" },
    );
    const exitCode = options.mockExitCode ?? 0;
    const binPath = join(binDir, BIN_NAME);
    writeFileSync(
      binPath,
      `#!/usr/bin/env node\nconsole.log("MOCK_BIN_RAN " + process.argv.slice(2).join(" "));\nprocess.exit(${exitCode});\n`,
      { encoding: "utf8" },
    );
    // Pitfall 4: ensure the executable bit is set so spawnSync can invoke
    // the mock without ENOEXEC under POSIX. On Windows chmod is a no-op
    // but the call is harmless.
    chmodSync(binPath, 0o755);
  }

  return tmp;
}

describe("cli.shim.js — DIST-02 resolve and fallback contract", () => {
  it("execs the platform binary when present", () => {
    const tmpDir = createMockWorkspace({ includePlatformBinary: true });
    const result = spawnSync(
      process.execPath,
      [join(tmpDir, "dist", "cli.js"), "--version"],
      { encoding: "utf8", timeout: 5000, cwd: tmpDir },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/MOCK_BIN_RAN --version/);
    expect(result.stderr).toBe("");
  });

  it("falls through to dist/main.js when platform binary missing", () => {
    const tmpDir = createMockWorkspace({ includePlatformBinary: false });
    const result = spawnSync(
      process.execPath,
      [join(tmpDir, "dist", "cli.js"), "--version"],
      { encoding: "utf8", timeout: 5000, cwd: tmpDir },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/FALLBACK_RAN --version/);
    // Silent fallback: the resolve-failure catch block must NOT log to
    // stderr (the fallback path is intentional, not an error).
    expect(result.stderr).toBe("");
  });

  it("propagates exit code from the platform binary", () => {
    const tmpDir = createMockWorkspace({
      includePlatformBinary: true,
      mockExitCode: 42,
    });
    const result = spawnSync(
      process.execPath,
      [join(tmpDir, "dist", "cli.js")],
      { encoding: "utf8", timeout: 5000, cwd: tmpDir },
    );

    expect(result.status).toBe(42);
  });

  it("passes argv through to the platform binary verbatim", () => {
    const tmpDir = createMockWorkspace({ includePlatformBinary: true });
    const result = spawnSync(
      process.execPath,
      [
        join(tmpDir, "dist", "cli.js"),
        "--foo",
        "bar",
        "--baz=qux",
      ],
      { encoding: "utf8", timeout: 5000, cwd: tmpDir },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/MOCK_BIN_RAN --foo bar --baz=qux/);
  });

  it.skipIf(process.platform !== "win32")(
    "uses the .exe suffix on win32 (Pitfall 3)",
    () => {
      const tmpDir = createMockWorkspace({ includePlatformBinary: true });
      // The mock binary was written as achilles.exe by createMockWorkspace
      // when process.platform === "win32". A successful exec here proves
      // the shim selected the .exe suffix path.
      const result = spawnSync(
        process.execPath,
        [join(tmpDir, "dist", "cli.js"), "--version"],
        { encoding: "utf8", timeout: 5000, cwd: tmpDir },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/MOCK_BIN_RAN --version/);
    },
  );
});
