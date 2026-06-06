/**
 * Prompt-content contract gate for the embedded companion system prompt.
 *
 * This file is the PROMPT-02/03/04/05 contract gate. Edits to
 * skill/prompts/companion.md that loosen the word caps, change the
 * marker syntax, or drop the error-override phrasing fail this test and
 * block the build.
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md PROMPT-02 — <=12-word spoken acknowledgement
 *     emitted BEFORE any tool calls
 *   - REQUIREMENTS.md PROMPT-03 — <=40-word `<spoken-summary>` block;
 *     marker tag syntax is the syntactic boundary Plan 10-01's
 *     extractor regex relies on
 *   - REQUIREMENTS.md PROMPT-04 — only the ack and the spoken-summary
 *     are routed to TTS; everything else is silent
 *   - REQUIREMENTS.md PROMPT-05 — "I ran into a problem" override when
 *     work fails
 *   - PITFALLS.md #16 — long / symbol-heavy spoken completion
 *   - PITFALLS.md #17 — hallucinated success on failed runs
 *
 * Notes on test discipline:
 *
 *   - Body is read ONCE in beforeAll and shared across tests so a
 *     subsequent edit-and-rerun cycle does not re-touch the disk per
 *     test
 *   - The marker-extractor round-trip uses a SYNTHETIC stream literal
 *     constructed inline, NOT the companion.md body. This is the
 *     T-12-05 mitigation: prompt-injection fragments and adversarial
 *     fixtures are not committed alongside the prompt body
 *   - NO emojis in assertion messages or test names (CLAUDE.md global)
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { extractSpokenSummary } from "@achilles/claude-code-bridge";

import { companionPromptPath } from "./index.js";

let body = "";

beforeAll(() => {
  body = readFileSync(companionPromptPath, "utf8");
});

describe("PROMPT-02: spoken acknowledgement word cap (<=12 words)", () => {
  it("body contains the numeric word cap 12 with the matching phrasing", () => {
    // Accepted phrasings: "no more than 12 words" or "at most 12 words"
    // (case-insensitive). The literal numeric 12 is the hard-coded cap;
    // copy may evolve as long as the cap stays.
    const matcher = new RegExp("(?:no more than|at most)\\s+12\\s+words", "i");
    expect(matcher.test(body)).toBe(true);
  });
});

describe("PROMPT-03: spoken summary word cap (<=40 words)", () => {
  it("body contains the numeric word cap 40 with the matching phrasing", () => {
    const matcher = new RegExp("(?:no more than|at most)\\s+40\\s+words", "i");
    expect(matcher.test(body)).toBe(true);
  });
});

describe("PROMPT-03: spoken-summary marker tag syntax", () => {
  it("body contains the literal opening tag <spoken-summary>", () => {
    expect(body.includes("<spoken-summary>")).toBe(true);
  });

  it("body contains the literal closing tag </spoken-summary>", () => {
    expect(body.includes("</spoken-summary>")).toBe(true);
  });
});

describe("PROMPT-05: error-override phrase", () => {
  it("body contains the literal phrase 'I ran into a problem' (exact casing)", () => {
    expect(body.includes("I ran into a problem")).toBe(true);
  });
});

describe("PROMPT-04: silent-by-default phrasing near spoken-summary", () => {
  it("body mentions silence within 400 chars of a spoken-summary reference", () => {
    // Either "silent" precedes a "spoken-summary" mention within 400
    // chars, or follows one within 400 chars. The window is generous
    // enough to span a paragraph break without crossing into an
    // unrelated section.
    const matcher =
      /(silent|Silent)[\s\S]{0,400}spoken-summary|spoken-summary[\s\S]{0,400}(silent|Silent)/;
    expect(matcher.test(body)).toBe(true);
  });
});

describe("structural sections: 5 required H2 headings", () => {
  const requiredHeadings = [
    "## Spoken acknowledgement",
    "## Spoken summary",
    "## Silent by default",
    "## When work fails",
    "## Formatting rules",
  ];

  for (const heading of requiredHeadings) {
    it(`body contains heading '${heading}' (exact casing, exact markdown syntax)`, () => {
      expect(body.includes(heading)).toBe(true);
    });
  }
});

describe("forbidden content: no emoji codepoints", () => {
  it("body does NOT contain any Extended_Pictographic Unicode codepoints", () => {
    // The Unicode property escape \p{Extended_Pictographic} covers the
    // canonical emoji presentation range without enumerating individual
    // codepoints. Supported by Node 22+ (the v1.2 milestone Node target).
    expect(/\p{Extended_Pictographic}/u.test(body)).toBe(false);
  });
});

describe("marker-extractor round-trip integration (Phase 10 lock)", () => {
  it("extractSpokenSummary returns the inner text of a synthetic stream", () => {
    // Synthetic stream constructed inline; NOT read from companion.md.
    // T-12-05 mitigation: keep adversarial / instruction-shaped
    // fixtures out of the committed prompt assets.
    const stream =
      "Looking at the failing test. <spoken-summary>Fixed the off-by-one bug.</spoken-summary>";
    expect(extractSpokenSummary(stream)).toBe("Fixed the off-by-one bug.");
  });
});
