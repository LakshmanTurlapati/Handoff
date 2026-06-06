import { describe, expect, it } from "vitest";
import { extractAck, extractSpokenSummary } from "./extractor.js";

describe("extractAck", () => {
  it("returns the full text when the input is a single terminated sentence", () => {
    // Test 1
    expect(extractAck("Got it, listing the files.")).toBe(
      "Got it, listing the files.",
    );
  });

  it("returns only the first sentence when multiple sentences are present", () => {
    // Test 2
    expect(
      extractAck("Got it, listing the files. Now I will run ls."),
    ).toBe("Got it, listing the files.");
  });

  it("treats ?, !, and . as sentence terminators (takes the first)", () => {
    // Test 3
    expect(extractAck("Hello? Are you there!")).toBe("Hello?");
  });

  it("returns null when no sentence terminator is present", () => {
    // Test 4
    expect(extractAck("No terminator here")).toBeNull();
  });

  it("returns null on an empty input string", () => {
    // Test 5
    expect(extractAck("")).toBeNull();
  });

  it("returns null on a whitespace-only input string", () => {
    // Test 6
    expect(extractAck("   ")).toBeNull();
  });

  it("caps the returned ack at 120 characters when the first sentence is longer", () => {
    // Test 7
    const longSentence = `${"a".repeat(199)}.`; // 200 chars total
    const result = extractAck(longSentence);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(120);
    expect(result).toBe("a".repeat(120));
  });

  it("trims leading and trailing whitespace before returning the ack", () => {
    // Test 8
    expect(extractAck("  Got it.  ")).toBe("Got it.");
  });

  it("is a pure function — repeated calls return identical results without mutating input", () => {
    // Test 15a (extractAck purity)
    const input = "Got it, listing the files. Now I will run ls.";
    const first = extractAck(input);
    const second = extractAck(input);
    expect(first).toBe(second);
    expect(input).toBe("Got it, listing the files. Now I will run ls.");
  });
});

describe("extractSpokenSummary", () => {
  it("returns the inner text when the input contains a well-formed <spoken-summary>...</spoken-summary> block", () => {
    // Test 9
    expect(
      extractSpokenSummary(
        "Some text <spoken-summary>I finished the task.</spoken-summary> more text",
      ),
    ).toBe("I finished the task.");
  });

  it("returns null when the markers are absent from the input", () => {
    // Test 10
    expect(extractSpokenSummary("no markers at all")).toBeNull();
  });

  it("returns null when the open marker is present but the close marker is missing", () => {
    // Test 11 — unclosed markers do not match the regex; null is reserved for "markers not present"
    expect(extractSpokenSummary("<spoken-summary>unclosed marker")).toBeNull();
  });

  it("returns the empty string when the markers are present but enclose no content", () => {
    // Test 12 — empty inner is the empty string, NOT null (CONTEXT.md spec)
    expect(extractSpokenSummary("<spoken-summary></spoken-summary>")).toBe("");
  });

  it("handles inner newlines and trims surrounding whitespace inside the markers", () => {
    // Test 13
    expect(
      extractSpokenSummary("<spoken-summary>\nI did it.\n</spoken-summary>"),
    ).toBe("I did it.");
  });

  it("returns only the first <spoken-summary> block when multiple are present", () => {
    // Test 14
    expect(
      extractSpokenSummary(
        "<spoken-summary>first block</spoken-summary> middle <spoken-summary>second block</spoken-summary>",
      ),
    ).toBe("first block");
  });

  it("is a pure function — repeated calls return identical results without mutating input", () => {
    // Test 15b (extractSpokenSummary purity)
    const input =
      "Some text <spoken-summary>I finished the task.</spoken-summary> more text";
    const first = extractSpokenSummary(input);
    const second = extractSpokenSummary(input);
    expect(first).toBe(second);
    expect(input).toBe(
      "Some text <spoken-summary>I finished the task.</spoken-summary> more text",
    );
  });
});
