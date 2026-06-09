/**
 * Phase 19, Plan 01, Task 2 — RED contract test for D-03 / D-04 / D-05 /
 * D-06 / D-07 SKILL.md rewrite.
 *
 * Asserts the publish-ready shape of packages/achilles-skill/skill/SKILL.md
 * after the full rewrite to the v1.3 terminal-only model:
 *
 *   1. YAML frontmatter exists (triple-dash bookended), parses cleanly,
 *      and has 3 fields: name, description, allowed-tools.
 *   2. `name: achilles` (unchanged from v1.2).
 *   3. `allowed-tools` is a SINGLE-LINE COMMA-SEPARATED STRING (RESEARCH
 *      §Pitfall 6 — Claude Code's parser expects this shape, NOT a YAML
 *      block list).
 *   4. The allowed-tools value contains EXACTLY 8 Bash() patterns in the
 *      D-04 locked order: voice, init, transcripts, config, latency, then
 *      which achilles, which sox, which ffmpeg.
 *   5. Body (text after the closing frontmatter ---) contains the literal
 *      string "BASH_MAX_TIMEOUT_MS=86400000" PROMINENTLY (within the first
 *      30 lines of body, per D-05).
 *   6. Body does NOT contain any v1.2 Electron-era language: "Electron",
 *      "floating UI", "systemPreferences.askForMediaAccess", "X-forwarding",
 *      "Achilles.app", "renderer process" (D-07 negative assertions).
 *   7. Body contains positive v1.3 terminal-only language: "achilles voice",
 *      "sox", "ffmpeg", "Node 22", "achilles init".
 *   8. File is ASCII-only (no emojis, CLAUDE.md global). The em-dash
 *      U+2014 is explicitly NOT permitted per PATTERNS.md S-5 (ASCII "--"
 *      double-hyphen only).
 *
 * Pattern: file-read + manual YAML-line parse (no gray-matter dependency
 * to keep the test self-contained) + assertion stack.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(
  HERE,
  "..",
  "..",
  "..",
  "packages",
  "achilles-skill",
  "skill",
  "SKILL.md",
);

interface ParsedSkill {
  readonly frontmatter: Record<string, string>;
  readonly body: string;
  readonly bodyLines: readonly string[];
}

/**
 * Minimal frontmatter parser. Splits on the first two `---` delimiter lines
 * and extracts simple `key: value` pairs (single-line values; this is the
 * shape the SKILL.md spec uses, including the single-line comma-separated
 * allowed-tools string per RESEARCH §Pitfall 6).
 */
function parseSkillMd(content: string): ParsedSkill {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error("SKILL.md does not start with --- frontmatter delimiter");
  }
  let closing = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      closing = i;
      break;
    }
  }
  if (closing === -1) {
    throw new Error("SKILL.md frontmatter not closed by a second --- line");
  }
  const frontmatter: Record<string, string> = {};
  for (let i = 1; i < closing; i += 1) {
    const line = lines[i];
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    frontmatter[key] = value;
  }
  const bodyLines = lines.slice(closing + 1);
  const body = bodyLines.join("\n");
  return { frontmatter, body, bodyLines };
}

const LOCKED_ALLOWED_TOOLS: readonly string[] = [
  "Bash(achilles voice *)",
  "Bash(achilles init *)",
  "Bash(achilles transcripts *)",
  "Bash(achilles config *)",
  "Bash(achilles latency *)",
  "Bash(which achilles)",
  "Bash(which sox)",
  "Bash(which ffmpeg)",
];

const FORBIDDEN_V12_LANGUAGE: readonly string[] = [
  "Electron",
  "floating UI",
  "systemPreferences.askForMediaAccess",
  "X-forwarding",
  "Achilles.app",
  "renderer process",
];

const REQUIRED_V13_LANGUAGE: readonly string[] = [
  "achilles voice",
  "sox",
  "ffmpeg",
  "Node 22",
  "achilles init",
];

describe("packages/achilles-skill/skill/SKILL.md contract (D-03..D-07)", () => {
  it("frontmatter parses cleanly with 3 expected fields", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const parsed = parseSkillMd(content);
    expect(parsed.frontmatter.name).toBeDefined();
    expect(parsed.frontmatter.description).toBeDefined();
    expect(parsed.frontmatter["allowed-tools"]).toBeDefined();
  });

  it("frontmatter name field is 'achilles' (unchanged from v1.2)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const parsed = parseSkillMd(content);
    expect(parsed.frontmatter.name).toBe("achilles");
  });

  it("allowed-tools is a single-line comma-separated string (RESEARCH §Pitfall 6)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    // The allowed-tools value, after the colon, must not be empty and must
    // not span multiple lines (no YAML block list shape "- Bash(...)").
    const lines = content.split(/\r?\n/);
    const allowedToolsLineIdx = lines.findIndex((l) =>
      l.startsWith("allowed-tools:"),
    );
    expect(allowedToolsLineIdx).toBeGreaterThan(0);
    const nextLine = lines[allowedToolsLineIdx + 1] ?? "";
    // The next line must NOT begin with "  -" (YAML list shape).
    expect(nextLine.trimStart().startsWith("- ")).toBe(false);
  });

  it("allowed-tools contains exactly 8 Bash() patterns in the D-04 locked order", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const parsed = parseSkillMd(content);
    const allowed = parsed.frontmatter["allowed-tools"] ?? "";
    // Extract every Bash(...) pattern in document order.
    const matches = allowed.match(/Bash\([^)]*\)/g) ?? [];
    expect(matches).toEqual(LOCKED_ALLOWED_TOOLS);
  });

  it("body contains BASH_MAX_TIMEOUT_MS=86400000 prominently in the first 30 lines (D-05)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const parsed = parseSkillMd(content);
    const topOfBody = parsed.bodyLines.slice(0, 30).join("\n");
    expect(topOfBody).toContain("BASH_MAX_TIMEOUT_MS=86400000");
  });

  it("body does NOT contain v1.2 Electron-era language (D-07 negative assertions)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const parsed = parseSkillMd(content);
    for (const forbidden of FORBIDDEN_V12_LANGUAGE) {
      expect(parsed.body, `forbidden token: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("body contains v1.3 terminal-only language (positive assertions)", () => {
    const content = readFileSync(SKILL_PATH, "utf8");
    const parsed = parseSkillMd(content);
    for (const required of REQUIRED_V13_LANGUAGE) {
      expect(parsed.body, `required token: ${required}`).toContain(required);
    }
  });

  it("file is ASCII-only (no emojis, no em-dash; CLAUDE.md global)", () => {
    const buf = readFileSync(SKILL_PATH);
    // Reject any byte >= 0x80 (non-ASCII). This catches both emojis
    // (multi-byte UTF-8) and the em-dash U+2014 (3-byte UTF-8: e2 80 94)
    // per PATTERNS.md Pattern S-5.
    const nonAscii: number[] = [];
    for (let i = 0; i < buf.length; i += 1) {
      if (buf[i] >= 0x80) nonAscii.push(i);
    }
    expect(
      nonAscii.length,
      `non-ASCII bytes at offsets: ${nonAscii.slice(0, 5).join(", ")}${
        nonAscii.length > 5 ? "..." : ""
      }`,
    ).toBe(0);
  });
});
