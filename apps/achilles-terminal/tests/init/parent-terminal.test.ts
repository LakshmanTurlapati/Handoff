/**
 * Phase 18, Plan 02, Task 3 — RED tests for parent-terminal.ts
 *
 * Tests for resolveParentEmulator + getRemediationHint.
 * All tests inject execSyncImpl + ppidImpl so no real ps command is run.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import {
  resolveParentEmulator,
  getRemediationHint,
  REMEDIATION_TABLE,
  type ParentEmulator,
  type ParentTerminalDeps,
} from "../../src/init/parent-terminal.js";

/** Helper to build deps that return a given ps output string. */
function makeDeps(psOutput: string): ParentTerminalDeps {
  return {
    ppidImpl: () => 12345,
    execSyncImpl: () => psOutput,
  };
}

/** Helper for deps that throw (simulates ps failure). */
function makeThrowingDeps(): ParentTerminalDeps {
  return {
    ppidImpl: () => 12345,
    execSyncImpl: () => { throw new Error("ps failed"); },
  };
}

describe("resolveParentEmulator — iTerm2", () => {
  it("maps 'iTerm2' execSync output to 'iTerm2'", () => {
    expect(resolveParentEmulator(makeDeps("iTerm2\n"))).toBe("iTerm2");
  });
});

describe("resolveParentEmulator — VSCode via Code Helper", () => {
  it("maps 'Code Helper' to 'VSCode'", () => {
    expect(resolveParentEmulator(makeDeps("Code Helper\n"))).toBe("VSCode");
  });
});

describe("resolveParentEmulator — Cursor Helper", () => {
  it("maps 'Cursor Helper' to 'Cursor'", () => {
    expect(resolveParentEmulator(makeDeps("Cursor Helper\n"))).toBe("Cursor");
  });
});

describe("resolveParentEmulator — ghostty lowercase", () => {
  it("maps 'ghostty' (lowercase) to 'Ghostty'", () => {
    expect(resolveParentEmulator(makeDeps("ghostty\n"))).toBe("Ghostty");
  });
});

describe("resolveParentEmulator — wezterm", () => {
  it("maps 'wezterm' to 'WezTerm'", () => {
    expect(resolveParentEmulator(makeDeps("wezterm\n"))).toBe("WezTerm");
  });
});

describe("resolveParentEmulator — Warp stable", () => {
  it("maps 'stable' (Warp's embedded shape) to 'Warp'", () => {
    expect(resolveParentEmulator(makeDeps("stable\n"))).toBe("Warp");
  });
});

describe("resolveParentEmulator — unknown string", () => {
  it("maps unknown string 'kitty' to 'unknown'", () => {
    expect(resolveParentEmulator(makeDeps("kitty\n"))).toBe("unknown");
  });
});

describe("resolveParentEmulator — execSync throws", () => {
  it("returns 'unknown' when execSync throws", () => {
    expect(resolveParentEmulator(makeThrowingDeps())).toBe("unknown");
  });
});

describe("getRemediationHint — VSCode", () => {
  it("getRemediationHint('VSCode') contains the substring 'microsoft/vscode#307364'", () => {
    const hint = getRemediationHint("VSCode");
    expect(hint).toContain("microsoft/vscode#307364");
  });
});

describe("getRemediationHint — Cursor", () => {
  it("getRemediationHint('Cursor') contains the substring 'Cursor does not propagate'", () => {
    const hint = getRemediationHint("Cursor");
    expect(hint).toContain("Cursor does not propagate");
  });
});

describe("getRemediationHint — unknown", () => {
  it("getRemediationHint('unknown') suggests trying iTerm2 or Terminal.app as a known-working alternative", () => {
    const hint = getRemediationHint("unknown");
    expect(hint.toLowerCase()).toContain("iterm2");
    expect(hint.toLowerCase()).toContain("terminal");
  });
});

describe("REMEDIATION_TABLE completeness", () => {
  it("REMEDIATION_TABLE has an entry for every ParentEmulator value (no missing case)", () => {
    const allEmulators: ParentEmulator[] = [
      "iTerm2",
      "Terminal",
      "VSCode",
      "Cursor",
      "Ghostty",
      "WezTerm",
      "Warp",
      "unknown",
    ];
    for (const emulator of allEmulators) {
      expect(REMEDIATION_TABLE[emulator]).toBeDefined();
      expect(typeof REMEDIATION_TABLE[emulator]).toBe("string");
      expect(REMEDIATION_TABLE[emulator].length).toBeGreaterThan(0);
    }
  });
});
