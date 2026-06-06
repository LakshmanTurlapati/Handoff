/**
 * Behaviour tests for the pre-TTS normalisation pipeline.
 *
 * Mirrors the `<behavior>` block in 12-02-PLAN.md Task 2. Tests are
 * grouped by primitive (stripAnsi, maskAbsolutePaths, maskSecretPrefixes,
 * dropFencedCode, capLength) then by the composed `normaliseForTts`,
 * then by purity / idempotence properties. The PITFALLS #21
 * leak-prevention assertion lives in the composed block and verifies
 * the deterministic FIXTURE_SECRET_PADDING never appears in the
 * serialised report.
 *
 * Per the planner brief quality gate: this file contains NO verbatim
 * secrets. Every secret-shape string in the suite flows through
 * `./normalisation-fixtures.ts` so an attacker reading source sees
 * only the public prefix + a deterministic padding, never a real key.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TTS_CAP_CHARS,
  PATH_REPLACEMENT,
  REDACTION_TOKEN,
  TRUNCATION_TAIL,
  dropFencedCode,
  maskAbsolutePaths,
  maskSecretPrefixes,
  normaliseForTts,
  stripAnsi,
} from "./normalisation.js";
import {
  FIXTURE_SECRET_PADDING,
  generateAnsiNoisyStrings,
  generatePathShapedStrings,
  generateSecretShapedStrings,
} from "./normalisation-fixtures.js";

describe("stripAnsi() — CSI + OSC escape removal", () => {
  it("strips a single SGR colour-on / colour-off pair", () => {
    const input = "\x1b[31mERROR\x1b[0m: failed";
    const result = stripAnsi(input);
    expect(result.value).toBe("ERROR: failed");
    expect(result.count).toBe(2);
  });

  it("strips a CSI clear-screen sequence", () => {
    const input = "before\x1b[2Jafter";
    const result = stripAnsi(input);
    expect(result.value).toBe("beforeafter");
    expect(result.count).toBe(1);
  });

  it("strips an OSC terminal-title-set sequence", () => {
    const input = "title\x1b]0;remote\x07body";
    const result = stripAnsi(input);
    expect(result.value).toBe("titlebody");
    expect(result.count).toBe(1);
  });

  it("leaves non-ANSI text untouched and reports count = 0", () => {
    const input = "no escapes here";
    const result = stripAnsi(input);
    expect(result.value).toBe(input);
    expect(result.count).toBe(0);
  });

  it("strips every escape across the deterministic fixture set", () => {
    for (const noisy of generateAnsiNoisyStrings()) {
      const result = stripAnsi(noisy);
      expect(result.value).not.toMatch(/\x1b/);
      expect(result.count).toBeGreaterThan(0);
    }
  });
});

describe("maskAbsolutePaths() — Unix + Windows path masking", () => {
  it("masks a Unix /Users path inside prose", () => {
    const input = "edited /Users/alice/project/index.ts today";
    const result = maskAbsolutePaths(input);
    expect(result.value).toBe(`edited ${PATH_REPLACEMENT} today`);
    expect(result.count).toBe(1);
  });

  it("masks a Unix /home path", () => {
    const input = "see /home/bob/.bashrc for details";
    const result = maskAbsolutePaths(input);
    expect(result.value).toBe(`see ${PATH_REPLACEMENT} for details`);
    expect(result.count).toBe(1);
  });

  it("masks a Windows drive-letter path", () => {
    const input = "open C:\\Users\\carol\\Doc.txt please";
    const result = maskAbsolutePaths(input);
    expect(result.value).toBe(`open ${PATH_REPLACEMENT} please`);
    expect(result.count).toBe(1);
  });

  it("leaves a relative path like './index.ts' UNCHANGED", () => {
    const input = "see ./index.ts for the entry";
    const result = maskAbsolutePaths(input);
    expect(result.value).toBe(input);
    expect(result.count).toBe(0);
  });

  it("leaves a bare slash inside prose UNCHANGED", () => {
    const input = "a/b ratio is fine";
    const result = maskAbsolutePaths(input);
    expect(result.value).toBe(input);
    expect(result.count).toBe(0);
  });

  it("masks every path-shape from the deterministic fixture set", () => {
    for (const pathLike of generatePathShapedStrings()) {
      const input = `look at ${pathLike} now`;
      const result = maskAbsolutePaths(input);
      expect(result.value.includes(pathLike)).toBe(false);
      expect(result.count).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("maskSecretPrefixes() — provider-prefix redaction", () => {
  it("masks an sk- shaped string with REDACTION_TOKEN and reports 1", () => {
    const input = `the value sk-${FIXTURE_SECRET_PADDING} appeared`;
    const result = maskSecretPrefixes(input);
    expect(result.value).toBe(`the value ${REDACTION_TOKEN} appeared`);
    expect(result.count).toBe(1);
  });

  it("masks an xi- shaped string", () => {
    const input = `voice key xi-${FIXTURE_SECRET_PADDING} present`;
    const result = maskSecretPrefixes(input);
    expect(result.value).toContain(REDACTION_TOKEN);
    expect(result.value).not.toContain(FIXTURE_SECRET_PADDING);
    expect(result.count).toBe(1);
  });

  it("masks a ghp_ shaped string", () => {
    const input = `pat ghp_${FIXTURE_SECRET_PADDING} found`;
    const result = maskSecretPrefixes(input);
    expect(result.value).toContain(REDACTION_TOKEN);
    expect(result.count).toBe(1);
  });

  it("masks a github_pat_ shaped string", () => {
    const input = `fine-grained github_pat_${FIXTURE_SECRET_PADDING} ok`;
    const result = maskSecretPrefixes(input);
    expect(result.value).toContain(REDACTION_TOKEN);
    expect(result.count).toBe(1);
  });

  it("leaves the bare prefix 'sk-' (no padding) UNCHANGED", () => {
    const input = "the prefix sk- alone is fine";
    const result = maskSecretPrefixes(input);
    expect(result.value).toBe(input);
    expect(result.count).toBe(0);
  });

  it("masks every secret-shape from the deterministic fixture set", () => {
    for (const secretLike of generateSecretShapedStrings()) {
      const input = `key ${secretLike} present`;
      const result = maskSecretPrefixes(input);
      expect(result.value.includes(secretLike)).toBe(false);
      expect(result.value).toContain(REDACTION_TOKEN);
      expect(result.count).toBe(1);
    }
  });
});

describe("dropFencedCode() — triple-backtick block removal", () => {
  it("drops a single fenced block and reports 1", () => {
    const input = "before\n```\ncode here\n```\nafter";
    const result = dropFencedCode(input);
    expect(result.value).not.toContain("```");
    expect(result.value).not.toContain("code here");
    expect(result.count).toBe(1);
  });

  it("drops two separate fenced blocks and reports 2", () => {
    const input =
      "one\n```\nfirst\n```\ntwo\n```\nsecond\n```\nthree";
    const result = dropFencedCode(input);
    expect(result.value).not.toContain("first");
    expect(result.value).not.toContain("second");
    expect(result.count).toBe(2);
  });

  it("drops a fenced block with a language tag", () => {
    const input = "before\n```ts\nconst x = 1;\n```\nafter";
    const result = dropFencedCode(input);
    expect(result.value).not.toContain("const x");
    expect(result.count).toBe(1);
  });

  it("leaves inline single-backtick runs UNCHANGED", () => {
    const input = "use `console.log` here";
    const result = dropFencedCode(input);
    expect(result.value).toBe(input);
    expect(result.count).toBe(0);
  });
});

describe("capLength behaviour via normaliseForTts (private helper)", () => {
  it("DEFAULT_TTS_CAP_CHARS is locked at 600", () => {
    expect(DEFAULT_TTS_CAP_CHARS).toBe(600);
  });

  it("input <= 600 chars passes through unchanged with truncated:false", () => {
    const input = "a short summary fits under the cap";
    const { normalised, report } = normaliseForTts(input);
    expect(normalised).toBe(input);
    expect(report.truncated).toBe(false);
  });

  it("input > 600 chars is truncated with the TRUNCATION_TAIL", () => {
    const input = "x".repeat(800);
    const { normalised, report } = normaliseForTts(input);
    expect(report.truncated).toBe(true);
    expect(normalised.endsWith(TRUNCATION_TAIL)).toBe(true);
    expect(normalised.length).toBeLessThanOrEqual(DEFAULT_TTS_CAP_CHARS);
  });

  it("custom capChars overrides the default", () => {
    const input = "x".repeat(200);
    const { normalised, report } = normaliseForTts(input, { capChars: 100 });
    expect(report.truncated).toBe(true);
    expect(normalised.length).toBeLessThanOrEqual(100);
    expect(normalised.endsWith(TRUNCATION_TAIL)).toBe(true);
  });
});

describe("normaliseForTts() — composed pipeline", () => {
  it("happy path: short clean text passes through with all counts 0", () => {
    const input = "the work is done";
    const { normalised, report } = normaliseForTts(input);
    expect(normalised).toBe(input);
    expect(report.ansi.count).toBe(0);
    expect(report.paths.count).toBe(0);
    expect(report.secrets.count).toBe(0);
    expect(report.fences.count).toBe(0);
    expect(report.truncated).toBe(false);
  });

  it("composed adversarial fixture: ANSI + paths + secrets all redacted", () => {
    const ansi = generateAnsiNoisyStrings()[0];
    const pathLike = generatePathShapedStrings()[0];
    const secretLike = generateSecretShapedStrings()[0];
    const input = `${ansi} wrote to ${pathLike} using ${secretLike} successfully`;
    const { normalised, report } = normaliseForTts(input);

    // No \x1b bytes
    expect(normalised).not.toMatch(/\x1b/);
    // No absolute path
    expect(normalised).not.toContain(pathLike);
    // No secret-shape string
    expect(normalised).not.toContain(secretLike);
    expect(normalised).not.toContain(FIXTURE_SECRET_PADDING);

    expect(report.ansi.count).toBeGreaterThan(0);
    expect(report.paths.count).toBeGreaterThan(0);
    expect(report.secrets.count).toBeGreaterThan(0);
  });

  it("PITFALLS #16: input > 600 chars is capped with the locked tail", () => {
    const input = "alpha ".repeat(200); // ~1200 chars
    const { normalised, report } = normaliseForTts(input);
    expect(report.truncated).toBe(true);
    expect(normalised.endsWith(TRUNCATION_TAIL)).toBe(true);
    expect(normalised.length).toBeLessThanOrEqual(DEFAULT_TTS_CAP_CHARS);
  });

  it("PITFALLS #21: report carries no redacted content (fixture padding absent)", () => {
    const secretLike = generateSecretShapedStrings()[0];
    const input = `key ${secretLike} present in the summary`;
    const { report } = normaliseForTts(input);
    const serialised = JSON.stringify(report);
    // The deterministic padding is the fingerprint of any real
    // redacted bytes leaking into the report.
    expect(serialised).not.toContain(FIXTURE_SECRET_PADDING);
    expect(serialised).not.toContain(secretLike);
    expect(report.secrets.count).toBe(1);
  });

  it("idempotence: running the normaliser twice produces no further changes", () => {
    const ansi = generateAnsiNoisyStrings()[1];
    const pathLike = generatePathShapedStrings()[1];
    const secretLike = generateSecretShapedStrings()[1];
    const input = `${ansi} edited ${pathLike} with ${secretLike} now`;
    const first = normaliseForTts(input).normalised;
    const second = normaliseForTts(first).normalised;
    expect(second).toBe(first);
  });

  it("empty input returns '' with a zeroed report", () => {
    const { normalised, report } = normaliseForTts("");
    expect(normalised).toBe("");
    expect(report.ansi.count).toBe(0);
    expect(report.paths.count).toBe(0);
    expect(report.secrets.count).toBe(0);
    expect(report.fences.count).toBe(0);
    expect(report.truncated).toBe(false);
  });

  it("whitespace-only input returns '' after trim", () => {
    const { normalised, report } = normaliseForTts("   \n\t  ");
    expect(normalised).toBe("");
    expect(report.truncated).toBe(false);
  });

  it("drops fenced code and reports a fences count", () => {
    const input = "before\n```ts\nconst k = 1;\n```\nafter the block";
    const { normalised, report } = normaliseForTts(input);
    expect(normalised).not.toContain("```");
    expect(normalised).not.toContain("const k");
    expect(report.fences.count).toBe(1);
  });
});

describe("normaliseForTts() — purity properties", () => {
  it("two calls with the same input return deep-equal results", () => {
    const input = "the refactor finished cleanly";
    const a = normaliseForTts(input);
    const b = normaliseForTts(input);
    expect(a.normalised).toBe(b.normalised);
    expect(a.report).toEqual(b.report);
  });

  it("input is not mutated by the call", () => {
    const original = "the refactor finished cleanly";
    const copy = original;
    void normaliseForTts(original);
    expect(original).toBe(copy);
  });
});
