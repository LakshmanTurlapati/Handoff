#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rawScope = process.env.HANDOFF_NPM_SCOPE?.trim() || "@parzival1213";
const publishScope = rawScope.startsWith("@") ? rawScope : `@${rawScope}`;
const handoffPackageName =
  process.env.HANDOFF_NPM_PACKAGE_NAME?.trim() || "remote-handoff";
const safeStageId = `${publishScope.slice(1).replace(/\//gu, "-")}--${handoffPackageName.replace(/[@/]/gu, "-")}`;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolveInstalledPackagePath(root, packageName, filePath) {
  if (packageName.startsWith("@")) {
    const [scopeName, leafName] = packageName.split("/");
    return join(root, "node_modules", scopeName, leafName, filePath);
  }
  return join(root, "node_modules", packageName, filePath);
}

run("node", [
  "scripts/stage-handoff-publish.mjs",
  "--scope",
  publishScope,
  "--handoff-package",
  handoffPackageName,
]);

const stageRoot = join(repoRoot, ".tmp-handoff-publish", safeStageId);
const stageDirs = {
  protocol: join(stageRoot, "protocol"),
  auth: join(stageRoot, "auth"),
  handoff: join(stageRoot, "handoff"),
};

const tarballs = [];
for (const packageDir of Object.values(stageDirs)) {
  const tarballName = run("npm", ["pack"], { cwd: packageDir });
  tarballs.push(join(packageDir, tarballName));
}

const installRoot = mkdtempSync(join(tmpdir(), "codex-mobile-handoff-install-"));

try {
  run("npm", ["init", "-y"], { cwd: installRoot });
  run(
    "npm",
    ["install", "--no-package-lock", ...tarballs],
    { cwd: installRoot },
  );

  const manifest = readJson(
    resolveInstalledPackagePath(installRoot, handoffPackageName, "package.json"),
  );
  if (manifest.name !== handoffPackageName) {
    throw new Error(`installed package name mismatch: ${manifest.name}`);
  }

  const helpOutput = run(
    "node",
    [
      resolveInstalledPackagePath(installRoot, handoffPackageName, join("dist", "cli.js")),
      "--help",
    ],
    { cwd: installRoot },
  );

  if (!helpOutput.includes("handoff <command>")) {
    throw new Error("handoff CLI help output missing expected usage header");
  }

  process.stdout.write(
    `Validated clean install for ${handoffPackageName} via staged tarballs in ${installRoot}.\n`,
  );
} finally {
  for (const tarball of tarballs) {
    rmSync(tarball, { force: true });
  }
  rmSync(installRoot, { recursive: true, force: true });
}
