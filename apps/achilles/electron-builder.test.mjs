/**
 * Tests for the electron-builder.json cross-platform config and the
 * dist:* scripts in apps/achilles/package.json.
 *
 * Locked constraints:
 *   - appId === "com.achilles.voice"
 *   - productName === "Achilles"
 *   - directories.output === "dist-installers"
 *   - mac targets dmg, hardenedRuntime true, entitlements file reference
 *   - mac.extendInfo.NSMicrophoneUsageDescription matches the
 *     Info.plist.fragment string (drift-prevention)
 *   - mac.notarize.teamId is "${env.APPLE_TEAM_ID}"
 *   - win targets nsis, icon path
 *   - linux targets AppImage
 *   - apps/achilles/package.json scripts has dist, dist:mac, dist:win,
 *     dist:linux invoking electron-builder
 *   - electron-builder devDependency pinned to "25.1.8"
 *   - NO emoji in the JSON
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

async function readJson(relPath) {
  const raw = await readFile(resolve(HERE, relPath), "utf8");
  return JSON.parse(raw);
}

async function readText(relPath) {
  return readFile(resolve(HERE, relPath), "utf8");
}

test("EB1: electron-builder.json parses as valid JSON with the expected top-level keys", async () => {
  const eb = await readJson("electron-builder.json");
  assert.equal(
    eb.appId,
    "com.achilles.voice",
    `appId expected 'com.achilles.voice', got: ${eb.appId}`,
  );
  assert.equal(
    eb.productName,
    "Achilles",
    `productName expected 'Achilles', got: ${eb.productName}`,
  );
  assert.equal(
    eb.directories?.output,
    "dist-installers",
    `directories.output expected 'dist-installers', got: ${eb.directories?.output}`,
  );
  // Sanity: the three platform blocks must exist.
  assert.ok(eb.mac, "expected mac block in electron-builder.json");
  assert.ok(eb.win, "expected win block in electron-builder.json");
  assert.ok(eb.linux, "expected linux block in electron-builder.json");
});

test("EB2: mac config locked — dmg target, hardenedRuntime, entitlements, NSMicrophoneUsageDescription mirrors Info.plist.fragment, notarize.teamId env-var ref", async () => {
  const eb = await readJson("electron-builder.json");
  // target can be string or array — accept both shapes.
  const macTarget = eb.mac.target;
  const targetsDmg =
    macTarget === "dmg" ||
    (Array.isArray(macTarget) && macTarget.includes("dmg"));
  assert.ok(
    targetsDmg,
    `expected mac.target to include 'dmg', got: ${JSON.stringify(macTarget)}`,
  );
  assert.equal(
    eb.mac.hardenedRuntime,
    true,
    `expected mac.hardenedRuntime true, got: ${eb.mac.hardenedRuntime}`,
  );
  assert.equal(
    eb.mac.entitlements,
    "build/entitlements.mac.plist",
    `expected mac.entitlements path, got: ${eb.mac.entitlements}`,
  );
  // extendInfo must be an object with NSMicrophoneUsageDescription set.
  assert.ok(
    eb.mac.extendInfo && typeof eb.mac.extendInfo === "object",
    "expected mac.extendInfo to be an object",
  );
  const prompt = eb.mac.extendInfo.NSMicrophoneUsageDescription;
  assert.ok(
    typeof prompt === "string" && prompt.length > 0,
    `expected non-empty NSMicrophoneUsageDescription string, got: ${prompt}`,
  );
  // notarize.teamId is the env-var ref electron-builder substitutes at
  // build time.
  assert.equal(
    eb.mac.notarize?.teamId,
    "${env.APPLE_TEAM_ID}",
    `expected mac.notarize.teamId env-var ref, got: ${eb.mac.notarize?.teamId}`,
  );

  // Drift-prevention: Info.plist.fragment's NSMicrophoneUsageDescription
  // must match the electron-builder.json's mac.extendInfo string
  // (byte-equal).
  const infoPlistText = await readText("build/Info.plist.fragment");
  const fragmentValueMatch = infoPlistText.match(
    /<key>NSMicrophoneUsageDescription<\/key>\s*<string>([^<]+)<\/string>/,
  );
  assert.ok(
    fragmentValueMatch,
    `expected NSMicrophoneUsageDescription <string> in Info.plist.fragment, got: ${infoPlistText.slice(0, 300)}`,
  );
  assert.equal(
    fragmentValueMatch[1],
    prompt,
    `drift: electron-builder.json mac.extendInfo NSMicrophoneUsageDescription !== Info.plist.fragment string`,
  );
});

test("EB3: win config locked — nsis target, icon path", async () => {
  const eb = await readJson("electron-builder.json");
  const winTarget = eb.win.target;
  const targetsNsis =
    winTarget === "nsis" ||
    (Array.isArray(winTarget) && winTarget.includes("nsis"));
  assert.ok(
    targetsNsis,
    `expected win.target to include 'nsis', got: ${JSON.stringify(winTarget)}`,
  );
  assert.equal(
    eb.win.icon,
    "build/icon.ico",
    `expected win.icon path, got: ${eb.win.icon}`,
  );
});

test("EB4: linux config locked — AppImage target, Development category", async () => {
  const eb = await readJson("electron-builder.json");
  const linuxTarget = eb.linux.target;
  const targetsAppImage =
    linuxTarget === "AppImage" ||
    (Array.isArray(linuxTarget) && linuxTarget.includes("AppImage"));
  assert.ok(
    targetsAppImage,
    `expected linux.target to include 'AppImage', got: ${JSON.stringify(linuxTarget)}`,
  );
  assert.equal(
    eb.linux.category,
    "Development",
    `expected linux.category 'Development', got: ${eb.linux.category}`,
  );
});

test("EB5: NO emoji codepoints anywhere in electron-builder.json", async () => {
  const raw = await readText("electron-builder.json");
  for (const ch of raw) {
    const cp = ch.codePointAt(0);
    assert.ok(
      !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
      `emoji codepoint U+${cp.toString(16)} found in electron-builder.json (CLAUDE.md violation)`,
    );
  }
});

test("DIST1: apps/achilles/package.json scripts.dist invokes electron-builder", async () => {
  const pkg = await readJson("package.json");
  assert.ok(
    pkg.scripts?.dist?.includes("electron-builder"),
    `expected scripts.dist to include 'electron-builder', got: ${pkg.scripts?.dist}`,
  );
});

test("DIST2: per-platform dist:mac, dist:win, dist:linux scripts each invoke electron-builder with their platform flag", async () => {
  const pkg = await readJson("package.json");
  assert.ok(
    pkg.scripts?.["dist:mac"]?.includes("electron-builder") &&
      pkg.scripts?.["dist:mac"]?.includes("--mac"),
    `expected dist:mac script with --mac flag, got: ${pkg.scripts?.["dist:mac"]}`,
  );
  assert.ok(
    pkg.scripts?.["dist:win"]?.includes("electron-builder") &&
      pkg.scripts?.["dist:win"]?.includes("--win"),
    `expected dist:win script with --win flag, got: ${pkg.scripts?.["dist:win"]}`,
  );
  assert.ok(
    pkg.scripts?.["dist:linux"]?.includes("electron-builder") &&
      pkg.scripts?.["dist:linux"]?.includes("--linux"),
    `expected dist:linux script with --linux flag, got: ${pkg.scripts?.["dist:linux"]}`,
  );
});

test("DIST3: apps/achilles/package.json devDependencies pins electron-builder to '25.1.8'", async () => {
  const pkg = await readJson("package.json");
  assert.equal(
    pkg.devDependencies?.["electron-builder"],
    "25.1.8",
    `expected devDependencies['electron-builder'] === '25.1.8', got: ${pkg.devDependencies?.["electron-builder"]}`,
  );
});
