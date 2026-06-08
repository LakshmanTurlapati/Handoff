#!/usr/bin/env node
/**
 * Plan 16-03 Task 1 helper (D-16-03-01).
 *
 * Workspace dependency-graph reconciliation hook (pretest).
 *
 * npm 10.9.3 in this monorepo hoists several packages to the workspace-root
 * node_modules. Two packages cause cross-React-instance failures because
 * they import `react` natively (not through a build step that the vitest
 * resolve.alias could intercept):
 *
 *   - `ink-testing-library`: hoisted at root (no chalk peer conflict). Its
 *     `import "ink"` then walks UP from the root and finds no ink (because
 *     ink lives only at apps/achilles-terminal/node_modules due to ink@7's
 *     chalk@5 peer requirement vs the root's chalk@4).
 *
 *   - `react-reconciler`: hoisted at root because ink's peer is at
 *     apps/achilles-terminal. Its `import "react"` resolves to the root's
 *     react@19.2.4 (apps/web Next.js + apps/achilles legacy Electron). But
 *     apps/achilles-terminal pins react@19.2.7 (Ink 7's peer requirement).
 *     Two React copies in the same vitest process produce "Invalid hook
 *     call" errors inside the reconciler.
 *
 * Fix: COPY both packages from the root into
 * apps/achilles-terminal/node_modules so their native ESM resolution walks
 * UP from the workspace and finds the workspace-local react@19.2.7 and ink
 * (same physical files everyone else uses).
 *
 * A copy is used rather than a symlink because Node's default resolution
 * (`--preserve-symlinks=false`) follows symlinks to the real path BEFORE
 * walking up the node_modules tree, defeating the nesting.
 *
 * Idempotent: skips when the destination already exists and contains the
 * expected sentinel file. If the destination contents look wrong (e.g.
 * partial copy or stale symlink), the directory is replaced.
 *
 * No emojis (CLAUDE.md global). No application launches.
 */

import {
  mkdirSync,
  existsSync,
  rmSync,
  cpSync,
  lstatSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Workspace-root node_modules (where npm hoisted ink-testing-library and react-reconciler).
const ROOT_NODE_MODULES = resolve(__dirname, "..", "..", "..", "node_modules");

// Workspace-local node_modules (where ink + react@19.2.7 live).
const WORKSPACE_NODE_MODULES = resolve(__dirname, "..", "node_modules");

function log(msg) {
  process.stdout.write("[link-ink] " + msg + "\n");
}

/**
 * Copy a package from the root node_modules into the workspace node_modules
 * if not already present (or if the destination is a stale symlink).
 *
 * @param {string} packageName name under node_modules (e.g. "ink-testing-library")
 * @param {string} sentinelRelative relative path inside the package to test for presence
 *   (e.g. "build/index.js" — the file that must exist for the package to be usable)
 */
function copyPackageIntoWorkspace(packageName, sentinelRelative) {
  const target = resolve(ROOT_NODE_MODULES, packageName);
  const destination = resolve(WORKSPACE_NODE_MODULES, packageName);
  if (!existsSync(target)) {
    log(packageName + ": source not found at " + target + "; skipping");
    return;
  }
  const sentinel = resolve(destination, sentinelRelative);
  if (existsSync(sentinel)) {
    // Already a real directory copy — leave alone.
    const stat = lstatSync(destination);
    if (!stat.isSymbolicLink()) {
      log(packageName + ": already present at " + destination + "; skipping");
      return;
    }
    // Stale symlink (created by a previous version of this script); replace.
  }
  if (existsSync(destination)) {
    rmSync(destination, { recursive: true, force: true });
  }
  cpSync(target, destination, { recursive: true, dereference: true });
  log(packageName + ": copied " + target + " -> " + destination);
}

if (!existsSync(WORKSPACE_NODE_MODULES)) {
  mkdirSync(WORKSPACE_NODE_MODULES, { recursive: true });
}

copyPackageIntoWorkspace("ink-testing-library", "build/index.js");
copyPackageIntoWorkspace("react-reconciler", "index.js");
