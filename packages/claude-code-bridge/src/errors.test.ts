import { describe, expect, it } from "vitest";
import { ClaudeVersionError } from "./errors.js";

describe("ClaudeVersionError", () => {
  it("renders the fixed message template with both version strings", () => {
    const err = new ClaudeVersionError("1.5.3", "2.0.0");
    expect(err.message).toBe(
      "Claude Code 2.0.0 or newer is required, found 1.5.3. Upgrade with: npm install -g @anthropic-ai/claude-code",
    );
  });

  it("sets name to ClaudeVersionError for stack-trace and instanceof distinguishability", () => {
    const err = new ClaudeVersionError("1.5.3", "2.0.0");
    expect(err.name).toBe("ClaudeVersionError");
  });

  it("exposes actualVersion and requiredVersion as readonly fields", () => {
    const err = new ClaudeVersionError("1.5.3", "2.0.0");
    expect(err.actualVersion).toBe("1.5.3");
    expect(err.requiredVersion).toBe("2.0.0");
  });

  it("is an instance of both Error and ClaudeVersionError", () => {
    const err = new ClaudeVersionError("1.5.3", "2.0.0");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ClaudeVersionError).toBe(true);
  });

  it("does not embed environment variables, cwd, or other process state in message (T-10-02)", () => {
    const err = new ClaudeVersionError("1.5.3", "2.0.0");
    // The message is a fixed template — assert it contains only the
    // two version strings and the install hint, nothing process-derived.
    expect(err.message).not.toMatch(/\$|process\.env|HOME|PATH|\/Users\//);
  });

  it("renders different version pairs without leaking the previous instance's strings", () => {
    const first = new ClaudeVersionError("1.0.0", "2.0.0");
    const second = new ClaudeVersionError("0.9.9", "2.5.1");
    expect(first.message).toBe(
      "Claude Code 2.0.0 or newer is required, found 1.0.0. Upgrade with: npm install -g @anthropic-ai/claude-code",
    );
    expect(second.message).toBe(
      "Claude Code 2.5.1 or newer is required, found 0.9.9. Upgrade with: npm install -g @anthropic-ai/claude-code",
    );
    expect(first.actualVersion).toBe("1.0.0");
    expect(second.actualVersion).toBe("0.9.9");
  });
});
