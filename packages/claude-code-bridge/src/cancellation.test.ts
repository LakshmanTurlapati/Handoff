/**
 * Tests for cancelChildProcess (Plan 10-03, Task 1).
 *
 * Coverage map (10 behaviours from the plan's <behavior> block):
 *
 *   1.  cancelChildProcess calls child.kill("SIGINT") SYNCHRONOUSLY on
 *       first invocation — verified within 50 simulated ms (well under
 *       the Phase 10 success criterion 3 budget).
 *   2.  Exit within sigintGraceMs resolves with the ProcessExitEvent
 *       carrying the exit code + signal the child emitted on "exit".
 *   3.  No exit within sigintGraceMs escalates to SIGTERM.
 *   4.  No exit within sigtermGraceMs (after SIGTERM) escalates to SIGKILL.
 *   5.  After SIGKILL, the primitive resolves when the child finally exits.
 *   6.  Two concurrent cancel calls on the same child return the SAME
 *       Promise reference; child.kill is called exactly once per signal.
 *   7.  Already-exited child (exitCode !== null OR killed === true) at
 *       call time: primitive resolves immediately without invoking
 *       child.kill at all.
 *   8.  Stdout chunks that arrive between cancel and the actual exit are
 *       still routed through the line parser and emitted (the
 *       drain-aware contract).
 *   9.  Resolved value shape: { type: "process_exit", exit_code, signal }
 *       with the exit_code/signal matching what the child reported.
 *   10. cancel-mid-stream.ndjson fixture exists with the documented
 *       content (session_init + partial assistant_text only).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cancelChildProcess } from "./cancellation.js";
import { createLineParser } from "./line-parser.js";
import { mapWireEvent } from "./wire-mapper.js";
import type { ClaudeBridgeEvent, ProcessExitEvent } from "./types.js";
import type { ParseErrorPayload } from "./line-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../test/fixtures");

/**
 * Hand-rolled ChildProcess stub satisfying the minimum shape
 * cancelChildProcess reads. Keeps the test independent of node:child_process
 * so vitest fake timers do not have to fight Node's real event-loop
 * primitives.
 */
interface FakeChildLike {
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  exitCode: number | null;
  on(event: "exit", handler: ExitHandler): void;
  removeListener(event: "exit", handler: ExitHandler): void;
  _exitHandlers: ExitHandler[];
}

type ExitHandler = (code: number | null, signal: NodeJS.Signals | null) => void;

function makeFakeChild(opts: { exitCode?: number | null; killed?: boolean } = {}): FakeChildLike {
  const exitHandlers: ExitHandler[] = [];
  return {
    kill: vi.fn().mockReturnValue(true),
    killed: opts.killed ?? false,
    exitCode: opts.exitCode ?? null,
    on(event: "exit", handler: ExitHandler): void {
      if (event === "exit") {
        exitHandlers.push(handler);
      }
    },
    removeListener(event: "exit", handler: ExitHandler): void {
      if (event === "exit") {
        const idx = exitHandlers.indexOf(handler);
        if (idx >= 0) {
          exitHandlers.splice(idx, 1);
        }
      }
    },
    _exitHandlers: exitHandlers,
  };
}

/**
 * Fire all registered exit handlers with the given code + signal. Mirrors
 * what a real ChildProcess does on `exit`.
 */
function triggerExit(
  child: FakeChildLike,
  code: number | null,
  signal: NodeJS.Signals | null,
): void {
  child.exitCode = code;
  for (const h of [...child._exitHandlers]) {
    h(code, signal);
  }
}

describe("cancelChildProcess", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("behaviour 1: calls child.kill('SIGINT') synchronously (within 50 ms wall budget)", () => {
    const child = makeFakeChild();
    // Capture wall-clock time before the call. Phase 10 success
    // criterion 3 budgets 50 ms; the test asserts the SIGINT call
    // happens before the first microtask boundary AND within that
    // budget. We use Date.now() because vitest's fake-timer module
    // does not expose `vi.now()` in 2.x; the SIGINT step is synchronous
    // in the implementation so the elapsed time should be ~0.
    const start = Date.now();
    void cancelChildProcess({ child });
    // child.kill must already have been called once with SIGINT, with
    // NO awaits between the call and the assertion.
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it("behaviour 2: exit within sigintGraceMs resolves with ProcessExitEvent", async () => {
    const child = makeFakeChild();
    const cancelPromise = cancelChildProcess({ child });
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    // Advance time by 500 ms (under the 1000 ms default grace), then
    // simulate exit. The primitive must resolve with the exit shape.
    vi.advanceTimersByTime(500);
    triggerExit(child, null, "SIGINT");
    const result = await cancelPromise;
    expect(result).toEqual({
      type: "process_exit",
      exit_code: null,
      signal: "SIGINT",
    });
    // No SIGTERM should have been sent — only the one SIGINT.
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("behaviour 3: no exit within sigintGraceMs escalates to SIGTERM", async () => {
    const child = makeFakeChild();
    const cancelPromise = cancelChildProcess({ child });
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    // Advance to JUST under the SIGINT grace: still only SIGINT sent.
    vi.advanceTimersByTime(999);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenLastCalledWith("SIGINT");
    // Cross the threshold: SIGTERM must now have been sent.
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenLastCalledWith("SIGTERM");
    // Clean up: simulate exit so the promise resolves.
    triggerExit(child, null, "SIGTERM");
    await cancelPromise;
  });

  it("behaviour 4: no exit within sigtermGraceMs (after SIGTERM) escalates to SIGKILL", async () => {
    const child = makeFakeChild();
    const cancelPromise = cancelChildProcess({ child });
    // Move past SIGINT grace to send SIGTERM.
    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGTERM");
    // Just under SIGTERM grace: still no SIGKILL.
    vi.advanceTimersByTime(1999);
    expect(child.kill).toHaveBeenCalledTimes(2);
    // Cross the threshold: SIGKILL must now have been sent.
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledTimes(3);
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
    // Clean up: simulate exit so the promise resolves.
    triggerExit(child, null, "SIGKILL");
    await cancelPromise;
  });

  it("behaviour 5: after SIGKILL, primitive waits for exit and resolves when it arrives", async () => {
    const child = makeFakeChild();
    const cancelPromise = cancelChildProcess({ child });
    vi.advanceTimersByTime(1000); // SIGTERM
    vi.advanceTimersByTime(2000); // SIGKILL
    expect(child.kill).toHaveBeenCalledTimes(3);
    expect(child.kill).toHaveBeenNthCalledWith(3, "SIGKILL");
    // Even if we advance more time, no further escalation occurs.
    vi.advanceTimersByTime(10_000);
    expect(child.kill).toHaveBeenCalledTimes(3);
    // The exit arrives at some later point; the primitive resolves.
    triggerExit(child, null, "SIGKILL");
    const result = await cancelPromise;
    expect(result.type).toBe("process_exit");
    expect(result.signal).toBe("SIGKILL");
  });

  it("behaviour 6: concurrent calls return the SAME Promise; child.kill is called exactly once per signal", async () => {
    const child = makeFakeChild();
    const p1 = cancelChildProcess({ child });
    const p2 = cancelChildProcess({ child });
    expect(p2).toBe(p1);
    // The first (synchronous) SIGINT was sent exactly once even across
    // two callers.
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    // Even after a third concurrent caller, the Promise is shared and
    // no extra kill() was issued.
    const p3 = cancelChildProcess({ child });
    expect(p3).toBe(p1);
    expect(child.kill).toHaveBeenCalledTimes(1);
    // Advance to SIGTERM threshold; only one SIGTERM is issued across
    // the three callers.
    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenLastCalledWith("SIGTERM");
    triggerExit(child, null, "SIGTERM");
    // All three Promises resolve to the same ProcessExitEvent value.
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it("behaviour 7: already-exited child resolves immediately without invoking child.kill", async () => {
    const child = makeFakeChild({ exitCode: 0 });
    const cancelPromise = cancelChildProcess({ child });
    // Advance microtask queue.
    await vi.advanceTimersByTimeAsync(0);
    const result = await cancelPromise;
    expect(child.kill).not.toHaveBeenCalled();
    expect(result.type).toBe("process_exit");
    expect(result.exit_code).toBe(0);
  });

  it("behaviour 7b: child.killed === true at call time is also a fast path", async () => {
    const child = makeFakeChild({ killed: true });
    const cancelPromise = cancelChildProcess({ child });
    await vi.advanceTimersByTimeAsync(0);
    const result = await cancelPromise;
    expect(child.kill).not.toHaveBeenCalled();
    expect(result.type).toBe("process_exit");
  });

  it("behaviour 8: stdout chunks that arrive between cancel and exit are still parsed through the line parser", async () => {
    // The drain-aware contract: the cancellation primitive does not own
    // the line parser. It owns the child. session.ts (Task 2) is what
    // wires child.stdout into the parser. This test verifies the
    // SEMANTIC: feeding the cancel-mid-stream fixture into a parser
    // BEFORE triggering exit produces the events the consumer sees.
    const child = makeFakeChild();
    const parser = createLineParser();
    const events: ClaudeBridgeEvent[] = [];
    parser.on("json", (obj: unknown) => {
      events.push(mapWireEvent(obj));
    });
    parser.on("parse_error", (err: ParseErrorPayload) => {
      const payload: ClaudeBridgeEvent = { type: "parse_error", error: err.error };
      if (err.raw_line !== undefined) payload.raw_line = err.raw_line;
      events.push(payload);
    });
    // 1. Feed the fixture bytes into the parser (simulating stdout
    //    chunks that arrived before cancel was called).
    const fixtureBuf = await fs.readFile(
      path.join(FIXTURES_DIR, "cancel-mid-stream.ndjson"),
    );
    parser.write(fixtureBuf);
    // 2. Initiate cancel.
    const cancelPromise = cancelChildProcess({ child });
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    // 3. After cancel, a final stdout chunk arrives BEFORE the actual
    //    exit. It must still be parsed and emitted.
    const postCancelLine = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "final byte" }] },
      partial: true,
    });
    parser.write(Buffer.from(`${postCancelLine}\n`, "utf8"));
    // 4. Now exit.
    triggerExit(child, null, "SIGINT");
    await cancelPromise;
    // The events the consumer saw: session_init + 2 deltas. The parser
    // owns drain; the primitive's contract is to not race with parsing.
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "session_init",
      "assistant_text_delta",
      "assistant_text_delta",
    ]);
    // The post-cancel delta carries the text we wrote after cancel.
    const postCancelDelta = events[2];
    if (postCancelDelta?.type === "assistant_text_delta") {
      expect(postCancelDelta.text).toBe("final byte");
    }
  });

  it("behaviour 9: resolved value has exit_code and signal fields matching the simulated exit", async () => {
    // Variant a: exit-by-code (no signal).
    const childA = makeFakeChild();
    const pA = cancelChildProcess({ child: childA });
    triggerExit(childA, 137, null);
    const rA = await pA;
    expect(rA).toEqual({ type: "process_exit", exit_code: 137, signal: null });

    // Variant b: exit-by-signal (no code).
    const childB = makeFakeChild();
    const pB = cancelChildProcess({ child: childB });
    triggerExit(childB, null, "SIGTERM");
    const rB = await pB;
    expect(rB).toEqual({ type: "process_exit", exit_code: null, signal: "SIGTERM" });

    // Variant c: both null (shouldn't happen on real children but the
    // primitive must still resolve).
    const childC = makeFakeChild();
    const pC = cancelChildProcess({ child: childC });
    triggerExit(childC, null, null);
    const rC = await pC;
    expect(rC).toEqual({ type: "process_exit", exit_code: null, signal: null });
  });

  it("behaviour 10: cancel-mid-stream.ndjson fixture exists with the documented 2-line content", async () => {
    const fixturePath = path.join(FIXTURES_DIR, "cancel-mid-stream.ndjson");
    const text = await fs.readFile(fixturePath, "utf8");
    const lines = text.split("\n");
    // 2 content lines + 1 trailing empty (from the trailing newline).
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("");
    // Line 1 is the session_init.
    const init = JSON.parse(lines[0] as string) as { type: string; session_id?: string };
    expect(init.type).toBe("system");
    expect(init.session_id).toBe("sid-cancel-001");
    // Line 2 is the partial assistant_text_delta.
    const delta = JSON.parse(lines[1] as string) as {
      type: string;
      partial?: boolean;
      message?: { content?: Array<{ type: string; text?: string }> };
    };
    expect(delta.type).toBe("assistant");
    expect(delta.partial).toBe(true);
    expect(delta.message?.content?.[0]?.type).toBe("text");
  });

  it("custom grace periods are honoured via deps.sigintGraceMs and deps.sigtermGraceMs", async () => {
    const child = makeFakeChild();
    const cancelPromise = cancelChildProcess({
      child,
      deps: { sigintGraceMs: 100, sigtermGraceMs: 200 },
    });
    // SIGINT goes immediately.
    expect(child.kill).toHaveBeenLastCalledWith("SIGINT");
    // Move past the custom 100 ms SIGINT grace.
    vi.advanceTimersByTime(100);
    expect(child.kill).toHaveBeenLastCalledWith("SIGTERM");
    // Move past the custom 200 ms SIGTERM grace.
    vi.advanceTimersByTime(200);
    expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
    triggerExit(child, null, "SIGKILL");
    const r = await cancelPromise;
    expect(r.signal).toBe("SIGKILL");
  });

  it("the returned ProcessExitEvent type matches the public ProcessExitEvent shape", async () => {
    // Compile-time check: the function returns Promise<ProcessExitEvent>.
    const child = makeFakeChild();
    const p: Promise<ProcessExitEvent> = cancelChildProcess({ child });
    triggerExit(child, 0, null);
    const out: ProcessExitEvent = await p;
    expect(out.type).toBe("process_exit");
  });
});
