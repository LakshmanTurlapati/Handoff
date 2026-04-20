#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const workspaceName = "@codex-mobile/handoff";
const packCommand = `npm pack --workspace ${workspaceName}`;
const cliHelpCommand = "node package/dist/cli.js --help";
const expectedNameSnippet = '"name": "@codex-mobile/handoff"';
const expectedBinSnippet = '"handoff": "dist/cli.js"';

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

run("npm", ["run", "build:handoff-publish"]);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parsePackedTarball(stdout) {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const tarballName = [...lines].reverse().find((line) => line.endsWith(".tgz"));
  assert(tarballName, `could not determine tarball name from ${packCommand}`);
  return tarballName;
}

const workspaceDir = join(repoRoot, ".tmp-handoff-pack");
const extractDir = join(workspaceDir, "extract");
let tarballPath;

try {
  rmSync(workspaceDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  const packedTarball = parsePackedTarball(run("npm", ["pack", "--workspace", workspaceName]));
  tarballPath = join(repoRoot, packedTarball);
  assert(existsSync(tarballPath), `expected tarball at ${tarballPath}`);

  execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const packedManifestPath = join(extractDir, "package", "package.json");
  const packedManifestRaw = readFileSync(packedManifestPath, "utf8");
  assert(
    packedManifestRaw.includes(expectedNameSnippet),
    `packed manifest is missing ${expectedNameSnippet}`,
  );
  assert(
    packedManifestRaw.includes(expectedBinSnippet),
    `packed manifest is missing ${expectedBinSnippet}`,
  );

  const packedManifest = JSON.parse(packedManifestRaw);
  assert(
    packedManifest.name === workspaceName,
    `packed package name must be "${workspaceName}"`,
  );
  assert(
    packedManifest.bin?.handoff === "dist/cli.js",
    'packed bin.handoff must equal "dist/cli.js"',
  );

  execFileSync("node", ["package/dist/cli.js", "--help"], {
    cwd: extractDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  process.stdout.write(
    `Validated ${packCommand} and ${cliHelpCommand} against the local tarball.\n`,
  );
} finally {
  if (tarballPath && existsSync(tarballPath)) {
    rmSync(tarballPath, { force: true });
  }
  rmSync(workspaceDir, { recursive: true, force: true });
}
