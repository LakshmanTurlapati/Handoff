/**
 * Tests for the Info.plist fragment.
 *
 * The fragment mirrors electron-builder.json's mac.extendInfo block. It
 * must contain NSMicrophoneUsageDescription with a non-empty <string>
 * value that names "Achilles" (so the macOS prompt is clear about which
 * app is asking for mic access).
 *
 * Also tests for the BR1 operator-facing README in this directory.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

async function readText(relPath) {
  return readFile(resolve(HERE, relPath), "utf8");
}

test("INFO1: Info.plist.fragment contains NSMicrophoneUsageDescription with a non-empty <string> that names 'Achilles'", async () => {
  const text = await readText("Info.plist.fragment");
  assert.ok(
    text.includes("<?xml version=\"1.0\""),
    "expected XML declaration in Info.plist.fragment",
  );
  assert.ok(
    text.includes("<plist"),
    "expected <plist root in Info.plist.fragment",
  );
  // Match: <key>NSMicrophoneUsageDescription</key>(ws)<string>...</string>
  const m = text.match(
    /<key>NSMicrophoneUsageDescription<\/key>\s*<string>([^<]+)<\/string>/,
  );
  assert.ok(
    m && m[1].length > 0,
    `expected NSMicrophoneUsageDescription <string> with non-empty value, got: ${text.slice(0, 300)}`,
  );
  assert.ok(
    m[1].includes("Achilles"),
    `expected NSMicrophoneUsageDescription to name 'Achilles', got: ${m[1]}`,
  );
});

test("INFO2: NO emoji codepoints in Info.plist.fragment", async () => {
  const text = await readText("Info.plist.fragment");
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    assert.ok(
      !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
      `emoji codepoint U+${cp.toString(16)} found in Info.plist.fragment (CLAUDE.md violation)`,
    );
  }
});

test("BR1: build/README.md documents the operator contract — icon files, code-signing env vars, CI policy", async () => {
  const text = await readText("README.md");
  // Required icon filenames the operator must supply
  for (const fname of ["icon.icns", "icon.ico", "icon.png"]) {
    assert.ok(
      text.includes(fname),
      `expected ${fname} mentioned in build/README.md`,
    );
  }
  // Required code-signing env vars
  for (const envVar of [
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
  ]) {
    assert.ok(
      text.includes(envVar),
      `expected ${envVar} env var documented in build/README.md`,
    );
  }
  // CI policy must be explicit
  assert.ok(
    text.toLowerCase().includes("ci policy") ||
      text.toLowerCase().includes("operator-triggered"),
    `expected CI policy section in build/README.md`,
  );
});

test("BR2: NO emoji codepoints in build/README.md", async () => {
  const text = await readText("README.md");
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    assert.ok(
      !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
      `emoji codepoint U+${cp.toString(16)} found in build/README.md (CLAUDE.md violation)`,
    );
  }
});
