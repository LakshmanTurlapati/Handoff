#!/usr/bin/env node
// The 30-line ESM JS bin shim — install-time and runtime contract between
// the parent `achilles` package and the five
// `@achilles/cli-<platform>-<arch>` platform-binary sibling packages.
// Resolves the matching platform binary via `import.meta.resolve` and
// execs it inheriting stdio; falls through silently to the Node 22 ESM
// fallback bundle (`dist/main.js`) when no platform binary is available.
// See RESEARCH.md "Pattern 3" + Pitfalls 1 (resolver divergence),
// 2 (import.meta.resolve sync vs async), 3 (Windows .exe suffix).
// Do not edit dist/cli.js — it is copied verbatim from this file at build time.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve as pathResolve, join } from "node:path";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const platform = `${process.platform}-${process.arch}`;
const pkgName = `@achilles/cli-${platform}`;

let binPath = null;
try {
  const resolved = import.meta.resolve(`${pkgName}/package.json`);
  const pkgDir = dirname(fileURLToPath(resolved));
  const exe = process.platform === "win32" ? "achilles.exe" : "achilles";
  const candidate = join(pkgDir, "bin", exe);
  if (existsSync(candidate)) binPath = candidate;
} catch { /* package not installed; fall through */ }

if (binPath !== null) {
  const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
  process.exit(result.status ?? 0);
} else {
  await import(pathResolve(HERE, "main.js"));
}
