#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function normalizeScope(rawScope) {
  const value = rawScope?.trim();
  if (!value) {
    throw new Error("missing_publish_scope");
  }
  return value.startsWith("@") ? value : `@${value}`;
}

function readFlagValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) {
    return undefined;
  }
  return process.argv[flagIndex + 1];
}

function readScope() {
  const scopeFromFlag = readFlagValue("--scope");
  const scopeFromEnv = process.env.HANDOFF_NPM_SCOPE;
  if (scopeFromFlag || scopeFromEnv) {
    return normalizeScope(scopeFromFlag ?? scopeFromEnv);
  }
  return normalizeScope(run("npm", ["whoami"]));
}

function readPackageName() {
  const packageNameFromFlag = readFlagValue("--handoff-package");
  const packageNameFromEnv = process.env.HANDOFF_NPM_PACKAGE_NAME;
  const value =
    (packageNameFromFlag ?? packageNameFromEnv ?? "remote-handoff").trim();
  if (!value) {
    throw new Error("missing_handoff_package_name");
  }
  return value;
}

function copyRecursive(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

function walkFiles(directory, callback) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walkFiles(fullPath, callback);
      continue;
    }
    callback(fullPath);
  }
}

function rewriteTextFiles(directory, replacements) {
  const textFilePattern = /\.(?:[cm]?js|d\.ts|md|json)$/u;
  walkFiles(directory, (filePath) => {
    if (!textFilePattern.test(filePath)) {
      return;
    }
    const original = readFileSync(filePath, "utf8");
    let next = original;
    for (const [from, to] of replacements) {
      next = next.split(from).join(to);
    }
    if (next !== original) {
      writeFileSync(filePath, next, "utf8");
    }
  });
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createPublicManifest(sourceManifest, overrides) {
  return {
    name: overrides.name,
    version: sourceManifest.version,
    private: false,
    description: sourceManifest.description,
    publishConfig: { access: "public" },
    type: sourceManifest.type,
    main: sourceManifest.main,
    types: sourceManifest.types,
    files: overrides.files,
    bin: overrides.bin,
    exports: overrides.exports ?? sourceManifest.exports,
    license: "MIT",
    engines: { node: ">=22.0.0" },
    dependencies: overrides.dependencies ?? sourceManifest.dependencies,
  };
}

function stageProtocol(stageRoot, targetName) {
  const sourceDir = join(repoRoot, "packages", "protocol");
  const stageDir = join(stageRoot, "protocol");
  const sourceManifest = readJson(join(sourceDir, "package.json"));
  copyRecursive(join(sourceDir, "dist"), join(stageDir, "dist"));
  writeJson(
    join(stageDir, "package.json"),
    createPublicManifest(sourceManifest, {
      name: targetName,
      files: ["dist"],
    }),
  );
  return stageDir;
}

function stageAuth(stageRoot, targetName) {
  const sourceDir = join(repoRoot, "packages", "auth");
  const stageDir = join(stageRoot, "auth");
  const sourceManifest = readJson(join(sourceDir, "package.json"));
  copyRecursive(join(sourceDir, "dist"), join(stageDir, "dist"));
  writeJson(
    join(stageDir, "package.json"),
    createPublicManifest(sourceManifest, {
      name: targetName,
      files: ["dist"],
    }),
  );
  return stageDir;
}

function stageHandoff(stageRoot, packageNames) {
  const sourceDir = join(repoRoot, "apps", "bridge");
  const stageDir = join(stageRoot, "handoff");
  const sourceManifest = readJson(join(sourceDir, "package.json"));

  copyRecursive(join(sourceDir, "dist"), join(stageDir, "dist"));
  copyRecursive(join(sourceDir, "resources"), join(stageDir, "resources"));
  copyRecursive(join(sourceDir, "README.md"), join(stageDir, "README.md"));

  rewriteTextFiles(stageDir, [
    ["@codex-mobile/auth", packageNames.auth],
    ["@codex-mobile/protocol", packageNames.protocol],
    ["@codex-mobile/handoff", packageNames.handoff],
  ]);

  writeJson(
    join(stageDir, "package.json"),
    createPublicManifest(sourceManifest, {
      name: packageNames.handoff,
      files: ["dist", "resources/codex", "README.md"],
      bin: sourceManifest.bin,
      dependencies: {
        [packageNames.auth]: sourceManifest.dependencies["@codex-mobile/auth"],
        [packageNames.protocol]: sourceManifest.dependencies["@codex-mobile/protocol"],
        qrcode: sourceManifest.dependencies.qrcode,
        ws: sourceManifest.dependencies.ws,
        zod: sourceManifest.dependencies.zod,
      },
    }),
  );

  return stageDir;
}

const publishScope = readScope();
const handoffPackageName = readPackageName();
const packageNames = {
  protocol: `${publishScope}/protocol`,
  auth: `${publishScope}/auth`,
  handoff: handoffPackageName,
};

run("npm", ["run", "build:handoff-publish"]);

const safeStageId = `${publishScope.slice(1).replace(/\//gu, "-")}--${handoffPackageName.replace(/[@/]/gu, "-")}`;
const stageRoot = join(repoRoot, ".tmp-handoff-publish", safeStageId);
rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

const staged = {
  protocol: stageProtocol(stageRoot, packageNames.protocol),
  auth: stageAuth(stageRoot, packageNames.auth),
  handoff: stageHandoff(stageRoot, packageNames),
};

process.stdout.write(
  `${JSON.stringify({ publishScope, handoffPackageName, packageNames, staged }, null, 2)}\n`,
);
