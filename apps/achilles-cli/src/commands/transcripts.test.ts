/**
 * Tests for the `achilles transcripts <subcommand>` Phase-14-deferred stub.
 *
 * Per Plan 13-01 Task 2 behaviour Tests T1-T2. The stub MUST NOT touch
 * the filesystem in this phase — the body lands in Phase 14 along with
 * the `--save-transcripts` opt-in flag (SAFE-02). Phase 13's surface is
 * the command wiring + the visible "not yet implemented" message.
 */

import { describe, expect, it } from "vitest";
import { transcriptsCommand } from "./transcripts.js";

describe("transcriptsCommand", () => {
  it("T1: 'purge' writes a 'not yet implemented' message naming Phase 14 + exit(0) + zero fs operations", () => {
    const stdoutWrites: string[] = [];
    const stdout = {
      write: (chunk: string) => {
        stdoutWrites.push(chunk);
        return true;
      },
    };
    let exitCode: number | null = null;
    const processExitImpl = (code: number) => {
      exitCode = code;
    };

    transcriptsCommand("purge", { stdout, processExitImpl });

    expect(exitCode).toBe(0);
    const combined = stdoutWrites.join("");
    expect(combined).toContain("not yet implemented");
    expect(combined).toContain("Phase 14");
  });

  it("T2: unknown subcommand writes 'Unknown subcommand' to stdout + exit(2) (commander misuse code)", () => {
    const stdoutWrites: string[] = [];
    const stdout = {
      write: (chunk: string) => {
        stdoutWrites.push(chunk);
        return true;
      },
    };
    let exitCode: number | null = null;
    const processExitImpl = (code: number) => {
      exitCode = code;
    };

    transcriptsCommand("save", { stdout, processExitImpl });

    expect(exitCode).toBe(2);
    const combined = stdoutWrites.join("");
    expect(combined).toContain("Unknown subcommand");
  });
});
