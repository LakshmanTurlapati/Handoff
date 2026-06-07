/**
 * Tests for the macOS hardened-runtime entitlements plist.
 *
 * The plist must declare the four Electron-required entitlements:
 *   - com.apple.security.device.audio-input — mic access
 *   - com.apple.security.network.client — outbound HTTPS for ElevenLabs
 *     STT/TTS calls. Under hardenedRuntime=true (set in
 *     electron-builder.json), macOS blocks every outbound TCP/UDP
 *     connection unless this entitlement is explicitly granted, so the
 *     signed DMG would otherwise fail every voice-loop network call
 *     (CR-01 fix).
 *   - com.apple.security.cs.allow-jit — V8 JIT
 *   - com.apple.security.cs.allow-unsigned-executable-memory — V8 needs
 *     writable+executable memory pages
 *
 * Each must be paired with a <true/> value. The file must be valid XML
 * (we do a regex-based shape check rather than depend on an external
 * XML parser).
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

test("ENT1: entitlements.mac.plist has the four Electron-required entitlements paired with <true/>", async () => {
  const text = await readText("entitlements.mac.plist");

  // Validate XML preamble (loose: starts with the XML declaration and
  // contains the plist DOCTYPE).
  assert.ok(
    text.includes("<?xml version=\"1.0\""),
    "expected XML declaration",
  );
  assert.ok(
    text.includes("<plist"),
    "expected <plist root element",
  );
  assert.ok(
    text.includes("</plist>"),
    "expected </plist> close tag",
  );

  // Extract <key>...</key><true/> pairs.
  // The XML may have whitespace between the key close and the true/. We
  // accept any whitespace between them.
  const requiredKeys = [
    "com.apple.security.device.audio-input",
    // CR-01: without com.apple.security.network.client, hardened-runtime
    // macOS blocks every outbound TCP/UDP connection so the signed DMG
    // would fail every ElevenLabs STT/TTS call.
    "com.apple.security.network.client",
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
  ];

  for (const key of requiredKeys) {
    // Match: <key>{key}</key>(whitespace)<true/>
    const escaped = key.replace(/[.]/g, "\\.");
    const pattern = new RegExp(
      `<key>${escaped}<\\/key>\\s*<true\\s*/>`,
    );
    assert.ok(
      pattern.test(text),
      `expected <key>${key}</key><true/> pair, got: ${text.slice(0, 500)}`,
    );
  }
});

test("ENT2: NO emoji codepoints anywhere in entitlements.mac.plist", async () => {
  const text = await readText("entitlements.mac.plist");
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    assert.ok(
      !(cp >= 0x2600 && cp <= 0x27ff) && !(cp >= 0x1f000 && cp <= 0x1ffff),
      `emoji codepoint U+${cp.toString(16)} found in entitlements.mac.plist (CLAUDE.md violation)`,
    );
  }
});
