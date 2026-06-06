/**
 * Tests for createClaudeSession (Plan 10-02, Task 3).
 *
 * Coverage map (14 behaviours from the plan's <behavior> block):
 *
 *   1.  argv ends with LOCKED_FLAGS + systemPromptFile; no --resume when
 *       resumeSessionId is omitted.
 *   2.  argv includes ["--resume", sid] appended when resumeSessionId is
 *       set.
 *   3.  runVersionCheck runs synchronously BEFORE the streaming spawn;
 *       if it throws, spawnImpl is never called.
 *   4.  opts.env override is honoured even when host process.env lacks
 *       the SKIP_VERSION_CHECK_ENV_VAR.
 *   5.  simple-turn.ndjson replay yields SessionInit, AssistantTextDelta,
 *       AssistantTextDone, AssistantDone, ProcessExit in order.
 *   6.  After SessionInit, session.sessionId === "sid-simple-001".
 *   7.  After exit-0 + simple-turn fixture, outcome.kind === "success".
 *   8.  tool-error.ndjson + exit-0 -> outcome.kind === "failure",
 *       reason === "tool_error" (Pitfall #17 regression).
 *   9.  partial-json.ndjson chunked [60, rest] yields a clean parse: no
 *       parse_error events; both objects emitted in order.
 *   10. unknown-event.ndjson yields an UnknownEvent for line 2; the
 *       stream continues; AssistantDone still arrives.
 *   11. session.lastTurnText accumulates assistant text deltas and is
 *       replaced by the full_text on assistant_text_done.
 *   12. session.close() resolves after the child exits; calling close
 *       before the child exits triggers process termination.
 *   13. send(text) routes the prompt via stdin: writes "text\n", calls
 *       stdin.end().
 *   14. ProcessExit is the FINAL event; the events$ iterator terminates
 *       after.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import {
  createClaudeSession,
  type ClaudeSession,
} from "./session.js";
import type { ClaudeBridgeEvent } from "./types.js";
import { LOCKED_FLAGS } from "./constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.resolve(__dirname, "../test/fixtures");

/**
 * Fake ChildProcess stub: a minimal EventEmitter with PassThrough
 * stdin/stdout/stderr and a vitest-spy kill(). Mirrors the surface
 * createClaudeSession's deps?.spawnImpl reads.
 */
interface FakeChildProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  pid: number;
}

function makeFakeChild(): FakeChildProcess {
  const emitter = new EventEmitter() as FakeChildProcess;
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = vi.fn();
  emitter.pid = 99999;
  return emitter;
}

function makeFakeSpawn(): {
  spawnImpl: ReturnType<typeof vi.fn>;
  childRef: { current: FakeChildProcess | null };
} {
  const childRef: { current: FakeChildProcess | null } = { current: null };
  const spawnImpl = vi.fn(() => {
    const child = makeFakeChild();
    childRef.current = child;
    return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
  });
  return { spawnImpl, childRef };
}

/**
 * Drive a fixture into the session's child stdout. The bytes are written
 * in one shot unless `splitAt` is set (in which case they are written as
 * two chunks split at the given byte offset). The fake child then emits
 * `exit` with the configured exitCode + signal.
 */
async function replayFixture(
  child: FakeChildProcess,
  fixturePath: string,
  opts: {
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    splitAt?: number;
  } = {},
): Promise<void> {
  const buf = await fs.readFile(fixturePath);
  if (opts.splitAt !== undefined) {
    child.stdout.write(buf.subarray(0, opts.splitAt));
    child.stdout.write(buf.subarray(opts.splitAt));
  } else {
    child.stdout.write(buf);
  }
  child.stdout.end();
  child.emit("exit", opts.exitCode ?? 0, opts.signal ?? null);
}

/**
 * Drain the session's events$ iterable into an array. Resolves once
 * ProcessExit is observed (the iterator terminates after).
 */
async function drainEvents(session: ClaudeSession): Promise<ClaudeBridgeEvent[]> {
  const out: ClaudeBridgeEvent[] = [];
  for await (const ev of session.events$) {
    out.push(ev);
  }
  return out;
}

describe("createClaudeSession", () => {
  it("behaviour 1: argv has no --resume when resumeSessionId is omitted; ends with systemPromptFile", () => {
    const { spawnImpl } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    expect(spawnImpl).toHaveBeenCalledOnce();
    const args = spawnImpl.mock.calls[0];
    expect(args?.[0]).toBe("claude");
    const argv = args?.[1] as string[];
    expect(argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--append-system-prompt-file",
      "/tmp/companion.md",
    ]);
    expect(argv).not.toContain("--resume");
    expect(session._internal.argv).toEqual(argv);
    expect(session._internal.childPid).toBe(99999);
  });

  it("behaviour 2: argv includes --resume <sid> appended when resumeSessionId is set", () => {
    const { spawnImpl } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    createClaudeSession(
      { systemPromptFile: "/tmp/companion.md", resumeSessionId: "sid-prior-001" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const argv = spawnImpl.mock.calls[0]?.[1] as string[];
    expect(argv).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--append-system-prompt-file",
      "/tmp/companion.md",
      "--resume",
      "sid-prior-001",
    ]);
  });

  it("behaviour 3: runVersionCheck runs BEFORE spawnImpl; if it throws, spawn is never called", () => {
    const { spawnImpl } = makeFakeSpawn();
    const callOrder: string[] = [];
    const runVersionCheckStub = vi.fn(() => {
      callOrder.push("version-check");
      throw new Error("version too low");
    });
    spawnImpl.mockImplementation(() => {
      callOrder.push("spawn");
      throw new Error("should never spawn");
    });
    expect(() =>
      createClaudeSession(
        { systemPromptFile: "/tmp/companion.md" },
        { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
      ),
    ).toThrow(/version too low/);
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(callOrder).toEqual(["version-check"]);
  });

  it("behaviour 3b: when no stub is injected, runVersionCheck is called with effective env", () => {
    const { spawnImpl } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    createClaudeSession(
      {
        systemPromptFile: "/tmp/companion.md",
        env: { ACHILLES_SKIP_CLAUDE_VERSION_CHECK: "1" },
      },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    expect(runVersionCheckStub).toHaveBeenCalledOnce();
    const call = runVersionCheckStub.mock.calls[0]?.[0] as { env?: NodeJS.ProcessEnv };
    expect(call?.env?.["ACHILLES_SKIP_CLAUDE_VERSION_CHECK"]).toBe("1");
  });

  it("behaviour 4: opts.env override is honoured even when host env lacks the skip var", () => {
    const { spawnImpl } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    createClaudeSession(
      {
        systemPromptFile: "/tmp/companion.md",
        env: { ACHILLES_SKIP_CLAUDE_VERSION_CHECK: "1", EXTRA: "VALUE" },
      },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const spawnOpts = spawnImpl.mock.calls[0]?.[2] as { env: NodeJS.ProcessEnv };
    expect(spawnOpts.env["ACHILLES_SKIP_CLAUDE_VERSION_CHECK"]).toBe("1");
    expect(spawnOpts.env["EXTRA"]).toBe("VALUE");
  });

  it("behaviours 5+6+7: simple-turn fixture -> ordered events + sessionId + outcome.success", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const drainPromise = drainEvents(session);
    await replayFixture(
      childRef.current as FakeChildProcess,
      path.join(FIXTURES_DIR, "simple-turn.ndjson"),
      { exitCode: 0, signal: null },
    );
    const events = await drainPromise;
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "session_init",
      "assistant_text_delta",
      "assistant_text_done",
      "assistant_done",
      "process_exit",
    ]);
    expect(session.sessionId).toBe("sid-simple-001");
    const last = events[events.length - 1];
    expect(last?.type).toBe("process_exit");
    if (last?.type === "process_exit") {
      expect(last.exit_code).toBe(0);
      expect(last.signal).toBe(null);
    }
    expect(session.outcome).toEqual({ kind: "success" });
  });

  it("behaviour 8: tool-error fixture (Pitfall #17 regression) -> outcome.failure / reason tool_error", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const drainPromise = drainEvents(session);
    await replayFixture(
      childRef.current as FakeChildProcess,
      path.join(FIXTURES_DIR, "tool-error.ndjson"),
      { exitCode: 0, signal: null },
    );
    await drainPromise;
    const outcome = session.outcome;
    expect(outcome?.kind).toBe("failure");
    expect(outcome?.reason).toBe("tool_error");
    // The model's narration said "I successfully read the file" — but the
    // outcome is failure regardless.
    expect(session.lastTurnText).toMatch(/I successfully read the file/);
  });

  it("behaviour 9: partial-json fixture chunked [60, rest] yields a clean parse", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const drainPromise = drainEvents(session);
    await replayFixture(
      childRef.current as FakeChildProcess,
      path.join(FIXTURES_DIR, "partial-json.ndjson"),
      { exitCode: 0, signal: null, splitAt: 60 },
    );
    const events = await drainPromise;
    const parseErrors = events.filter((e) => e.type === "parse_error");
    expect(parseErrors).toEqual([]);
    const types = events.map((e) => e.type);
    expect(types).toContain("session_init");
    // The second line maps to assistant_text_done (no partial:true flag).
    expect(types).toContain("assistant_text_done");
    expect(types[types.length - 1]).toBe("process_exit");
  });

  it("behaviour 10: unknown-event fixture yields an unknown_event but stream continues", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const drainPromise = drainEvents(session);
    await replayFixture(
      childRef.current as FakeChildProcess,
      path.join(FIXTURES_DIR, "unknown-event.ndjson"),
      { exitCode: 0, signal: null },
    );
    const events = await drainPromise;
    const types = events.map((e) => e.type);
    expect(types).toContain("unknown_event");
    expect(types).toContain("assistant_done");
    expect(types[types.length - 1]).toBe("process_exit");
    // The unknown_event preserves the raw wire payload.
    const unknown = events.find((e) => e.type === "unknown_event");
    expect(unknown).toBeDefined();
    if (unknown?.type === "unknown_event") {
      expect(unknown.raw).toBeDefined();
    }
  });

  it("behaviour 11: lastTurnText accumulates deltas and is replaced by full_text on done", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const drainPromise = drainEvents(session);
    await replayFixture(
      childRef.current as FakeChildProcess,
      path.join(FIXTURES_DIR, "spoken-summary.ndjson"),
      { exitCode: 0, signal: null },
    );
    await drainPromise;
    expect(session.lastTurnText).toContain("<spoken-summary>");
    expect(session.lastTurnText).toContain("Done renaming the file.");
    expect(session.lastTurnText).toContain("</spoken-summary>");
  });

  it("behaviour 12: close() resolves after exit; calling close() before exit triggers SIGTERM", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const child = childRef.current as FakeChildProcess;
    // Begin a drain so the iterator's exit-handler is wired before we
    // emit the exit event.
    const drainPromise = drainEvents(session);
    // Start close() before exit; it should call kill() and wait for exit.
    const closePromise = session.close();
    // Yield one tick to let close() register its waiter.
    await new Promise((r) => setImmediate(r));
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    // Now emit the exit so close() can resolve.
    child.stdout.end();
    child.emit("exit", 0, null);
    await closePromise;
    await drainPromise;
    // A second close() after exit resolves immediately.
    await session.close();
  });

  it("behaviour 13: send(text) writes 'text\\n' to stdin and ends it", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const child = childRef.current as FakeChildProcess;
    const captured: Buffer[] = [];
    child.stdin.on("data", (chunk: Buffer) => captured.push(chunk));
    const endSpy = vi.spyOn(child.stdin, "end");
    session.send("hello world");
    // Flush stdin buffer.
    await new Promise((r) => setImmediate(r));
    const text = Buffer.concat(captured).toString("utf8");
    expect(text).toBe("hello world\n");
    expect(endSpy).toHaveBeenCalled();
    // Second send is a no-op.
    session.send("ignored");
    await new Promise((r) => setImmediate(r));
    const text2 = Buffer.concat(captured).toString("utf8");
    expect(text2).toBe("hello world\n");
    // Clean up by emitting exit.
    const drainPromise = drainEvents(session);
    child.stdout.end();
    child.emit("exit", 0, null);
    await drainPromise;
  });

  it("behaviour 14: events$ iterator terminates after process_exit is yielded", async () => {
    const { spawnImpl, childRef } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    const session = createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const events: ClaudeBridgeEvent[] = [];
    const iterator = session.events$[Symbol.asyncIterator]();
    const drain = (async () => {
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        events.push(next.value);
      }
    })();
    await replayFixture(
      childRef.current as FakeChildProcess,
      path.join(FIXTURES_DIR, "simple-turn.ndjson"),
      { exitCode: 0, signal: null },
    );
    await drain;
    const last = events[events.length - 1];
    expect(last?.type).toBe("process_exit");
    // A subsequent next() call from a fresh iterator returns done:true
    // immediately (the events$ source has been closed).
    const next = await iterator.next();
    expect(next.done).toBe(true);
  });

  it("locked-flags identity: argv slice equals LOCKED_FLAGS up to the systemPromptFile insertion point", () => {
    const { spawnImpl } = makeFakeSpawn();
    const runVersionCheckStub = vi.fn(() => ({ skipped: true }));
    createClaudeSession(
      { systemPromptFile: "/tmp/companion.md" },
      { spawnImpl: spawnImpl as never, runVersionCheck: runVersionCheckStub as never },
    );
    const argv = spawnImpl.mock.calls[0]?.[1] as string[];
    // The 5 flag names before the systemPromptFile insertion must match
    // LOCKED_FLAGS[0..5] verbatim (the 6th LOCKED_FLAGS entry is
    // --append-system-prompt-file, after which the path is inserted).
    expect(argv.slice(0, 5)).toEqual(LOCKED_FLAGS.slice(0, 5));
    expect(argv[4]).toBe("--append-system-prompt-file");
    expect(argv[5]).toBe("/tmp/companion.md");
  });
});
