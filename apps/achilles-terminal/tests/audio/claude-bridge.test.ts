/**
 * Phase 17, Plan 03, Task 2 — claude-bridge wrapper test surface.
 *
 * 10 behaviour tests covering the LOOP-01 / LOOP-03 / LOOP-04 / LOOP-07
 * invariants. Tests are grouped by invariant:
 *
 *   T1   — LOOP-07: spawnImpl wrapper adds detached:true
 *   T2   — SAFE-04: wrapTranscript applied before bridge.send
 *   T3   — LOOP-01: extractAck emits claude_ack on first sentence terminator
 *   T4   — LOOP-01: extractSpokenSummary emits claude_summary on process_exit
 *   T5   — LOOP-04: failure-override fires on non-zero exit code
 *   T6   — LOOP-04: failure-override fires on tool_result.is_error
 *   T7   — LOOP-04: LLM narration of FAILURE_OVERRIDE_PHRASE does NOT trigger claude_failed
 *   T8   — FAILURE_OVERRIDE_PHRASE has no trailing period
 *   T9   — LOOP-03: tool_use events do not produce TTS-bound emissions
 *   T10  — SAFE-04: manipulation-token detection logs without stripping
 *
 * Test scaffolding uses an in-memory AsyncIterable of bridge events
 * plus a recording session.send / session.cancel / session.close —
 * none of the tests spawn a real claude subprocess. The createSession
 * dep is injected so the executor swap-out preserves the wrappedSpawn
 * + wrapTranscript + extractAck + extractSpokenSummary call path.
 */

import { describe, expect, it } from "vitest";
import {
  createClaudeBridge,
  buildFailureSummary,
  FAILURE_OVERRIDE_PHRASE,
} from "../../src/audio/claude-bridge.js";
import type {
  ClaudeBridgeEvent,
  ClaudeOutcome,
  ProcessExitEvent,
} from "@achilles/claude-code-bridge";
import type { SessionEvent } from "../../src/session-events.js";
import type { StructuredLogger } from "../../src/structured-logger.js";
import {
  DELIM_START,
  REMINDER_LINE,
} from "../../src/sandwich-defence.js";
import { generateAdversarialTranscripts } from "../../src/normalisation-fixtures.js";

/**
 * Build an AsyncIterable from a finite array of events. Mimics the
 * shape the bridge's events$ provides — single-consumer, completes
 * after the final event.
 */
function makeEvents$(events: ClaudeBridgeEvent[]): AsyncIterable<ClaudeBridgeEvent> {
  // Async generator with at least one await so the linter's
  // require-await rule is satisfied. The `await Promise.resolve()`
  // is a no-op for callers — the iterator still yields synchronously
  // — but it makes the function genuinely asynchronous at the type
  // and runtime level.
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      for (const ev of events) {
        yield ev;
      }
    },
  };
}

/**
 * Construct a fake ClaudeSession with the minimal surface
 * createClaudeBridge consumes. Tests parametrise events$, outcome,
 * lastTurnText, and recording send/cancel/close handlers.
 */
interface FakeSessionConfig {
  events: ClaudeBridgeEvent[];
  outcome: ClaudeOutcome | null;
  lastTurnText: string;
}

interface FakeSessionState {
  sendCalls: string[];
  cancelCalls: number;
  closeCalls: number;
}

function makeFakeSession(cfg: FakeSessionConfig) {
  const state: FakeSessionState = {
    sendCalls: [],
    cancelCalls: 0,
    closeCalls: 0,
  };
  const session = {
    sessionId: null as string | null,
    lastTurnText: cfg.lastTurnText,
    outcome: cfg.outcome,
    events$: makeEvents$(cfg.events),
    send(text: string): void {
      state.sendCalls.push(text);
    },
    close(): Promise<void> {
      state.closeCalls++;
      return Promise.resolve();
    },
    cancel(): Promise<ProcessExitEvent> {
      state.cancelCalls++;
      return Promise.resolve({
        type: "process_exit",
        exit_code: null,
        signal: "SIGINT",
      });
    },
    _internal: {
      childPid: null as number | null,
      argv: [] as readonly string[],
    },
  };
  return { session, state };
}

/**
 * Build a recording logger that captures warn() calls. The two other
 * sinks are no-ops since the wrapper only emits warnings.
 */
interface RecordingLoggerState {
  warnCalls: Array<{ event: string; fields: Record<string, unknown> | undefined }>;
}
function makeRecordingLogger(): {
  logger: StructuredLogger;
  state: RecordingLoggerState;
} {
  const state: RecordingLoggerState = { warnCalls: [] };
  const logger: StructuredLogger = {
    info: () => undefined,
    warn: (event, fields) => {
      state.warnCalls.push({ event, fields });
    },
    error: () => undefined,
    child: () => logger,
    flush: () => Promise.resolve(),
    dispose: () => undefined,
  };
  return { logger, state };
}

/**
 * Build a recording emit closure that captures every SessionEvent
 * the wrapper fans out.
 */
function makeRecordingEmit(): {
  emit: (ev: SessionEvent) => void;
  events: SessionEvent[];
} {
  const events: SessionEvent[] = [];
  return {
    emit: (ev) => {
      events.push(ev);
    },
    events,
  };
}

describe("createClaudeBridge() — LOOP-07 spawn detach", () => {
  it("T1: spawnImpl wrapper adds detached:true on every spawn call", () => {
    // Recording spawnImpl captures the options it receives. The fake
    // createSession runs the wrappedSpawn synchronously to exercise the
    // detach injection.
    let capturedOptions:
      | (Record<string, unknown> & { detached?: boolean; stdio?: unknown })
      | null = null;
    const spawnImpl = ((
      _command: string,
      _args: readonly string[],
      options: Record<string, unknown> & { detached?: boolean; stdio?: unknown },
    ) => {
      capturedOptions = options;
      // Return a minimal ChildProcess-like; createSession only needs
      // to call spawnImpl, not consume the return.
      return {
        pid: 1234,
        kill: () => true,
        on: () => undefined,
        stdout: null,
        stderr: null,
        stdin: null,
      } as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["spawnImpl"]>;

    const { session } = makeFakeSession({
      events: [
        {
          type: "process_exit",
          exit_code: 0,
          signal: null,
        },
      ],
      outcome: { kind: "success" },
      lastTurnText: "<spoken-summary>ok</spoken-summary>",
    });

    // The fake createSession invokes the spawnImpl once so the wrapper
    // path runs end-to-end. The function-literal shape matches the
    // SessionDeps spawnImpl signature without needing a cast.
    const createSession: NonNullable<
      Parameters<typeof createClaudeBridge>[0]["createSession"]
    > = (_opts, deps) => {
      if (deps?.spawnImpl !== undefined) {
        deps.spawnImpl("claude", ["-p"], {});
      }
      return session;
    };

    const { emit } = makeRecordingEmit();
    createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      spawnImpl,
      createSession,
      emit,
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions!.detached).toBe(true);
    // stdio defaults to ["pipe","pipe","pipe"]
    expect(capturedOptions!.stdio).toEqual(["pipe", "pipe", "pipe"]);
  });
});

describe("createClaudeBridge() — SAFE-04 sandwich-wrap on send", () => {
  it("T2: wrapTranscript applied before bridge.send", async () => {
    const { session, state } = makeFakeSession({
      events: [
        {
          type: "process_exit",
          exit_code: 0,
          signal: null,
        },
      ],
      outcome: { kind: "success" },
      lastTurnText: "<spoken-summary>ok</spoken-summary>",
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.send("hello");
    expect(state.sendCalls).toHaveLength(1);
    const wrapped = state.sendCalls[0]!;
    expect(wrapped.startsWith(DELIM_START)).toBe(true);
    expect(wrapped.includes("hello")).toBe(true);
    expect(wrapped.endsWith(REMINDER_LINE)).toBe(true);
  });
});

describe("createClaudeBridge() — LOOP-01 ack + summary extraction", () => {
  it("T3: extractAck emits claude_ack on first sentence terminator", async () => {
    const events: ClaudeBridgeEvent[] = [
      {
        type: "assistant_text_delta",
        text: "Working on that.",
      },
      {
        type: "assistant_text_delta",
        text: " Then I will check the logs.",
      },
      { type: "process_exit", exit_code: 0, signal: null },
    ];
    const { session } = makeFakeSession({
      events,
      outcome: { kind: "success" },
      lastTurnText: "Working on that. Then I will check the logs.",
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit, events: emitted } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.consume();
    const ackEvents = emitted.filter((e) => e.type === "claude_ack");
    expect(ackEvents).toHaveLength(1);
    // After normalisation the ack remains "Working on that." (no
    // paths / secrets / fenced code).
    expect(ackEvents[0]!.payload.text).toBe("Working on that.");
  });

  it("T4: extractSpokenSummary emits claude_summary on process_exit", async () => {
    const fullText =
      "Working on that. <spoken-summary>All clean, no errors.</spoken-summary>";
    const events: ClaudeBridgeEvent[] = [
      {
        type: "assistant_text_delta",
        text: fullText,
      },
      { type: "process_exit", exit_code: 0, signal: null },
    ];
    const { session } = makeFakeSession({
      events,
      outcome: { kind: "success" },
      lastTurnText: fullText,
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit, events: emitted } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.consume();
    const summaryEvents = emitted.filter((e) => e.type === "claude_summary");
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0]!.payload.text).toBe("All clean, no errors.");
    const doneEvents = emitted.filter((e) => e.type === "claude_done");
    expect(doneEvents).toHaveLength(1);
    // Verify event ordering: summary then done.
    const summaryIdx = emitted.findIndex((e) => e.type === "claude_summary");
    const doneIdx = emitted.findIndex((e) => e.type === "claude_done");
    expect(summaryIdx).toBeLessThan(doneIdx);
  });
});

describe("createClaudeBridge() — LOOP-04 failure-override", () => {
  it("T5: failure-override fires on non-zero exit code", async () => {
    const events: ClaudeBridgeEvent[] = [
      { type: "process_exit", exit_code: 2, signal: null },
    ];
    const { session } = makeFakeSession({
      events,
      outcome: { kind: "failure", reason: "exit_code", exitCode: 2 },
      lastTurnText: "",
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit, events: emitted } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.consume();
    const failedEvents = emitted.filter((e) => e.type === "claude_failed");
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]!.payload.reason).toBe("exit_code");
    const summaryEvents = emitted.filter((e) => e.type === "claude_summary");
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0]!.payload.text).toBe(
      "I ran into a problem. exit_code: 2",
    );
  });

  it("T6: failure-override fires on tool_result.is_error", async () => {
    const events: ClaudeBridgeEvent[] = [
      {
        type: "tool_result",
        tool_use_id: "t1",
        is_error: true,
        content: "boom",
      },
      { type: "process_exit", exit_code: 1, signal: null },
    ];
    const { session } = makeFakeSession({
      events,
      outcome: {
        kind: "failure",
        reason: "tool_error",
        details: "1 tool_result with is_error=true (ids: t1)",
      },
      lastTurnText: "",
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit, events: emitted } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.consume();
    const failedEvents = emitted.filter((e) => e.type === "claude_failed");
    expect(failedEvents).toHaveLength(1);
    expect(failedEvents[0]!.payload.reason).toBe("tool_error");
    const summaryEvents = emitted.filter((e) => e.type === "claude_summary");
    expect(summaryEvents[0]!.payload.text).toBe(
      "I ran into a problem. tool_error",
    );
  });

  it("T7: LLM narration of FAILURE_OVERRIDE_PHRASE does NOT trigger claude_failed", async () => {
    // Outcome is success — the bridge's authoritative derivation
    // (exit_code 0, no tool errors) says success regardless of what
    // the LLM wrote in its assistant_text_delta stream.
    const llmText =
      "I ran into a problem trying to read the file but I recovered. <spoken-summary>Done successfully.</spoken-summary>";
    const events: ClaudeBridgeEvent[] = [
      {
        type: "assistant_text_delta",
        text: llmText,
      },
      { type: "process_exit", exit_code: 0, signal: null },
    ];
    const { session } = makeFakeSession({
      events,
      outcome: { kind: "success" },
      lastTurnText: llmText,
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit, events: emitted } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.consume();
    const failedEvents = emitted.filter((e) => e.type === "claude_failed");
    expect(failedEvents).toHaveLength(0);
    const summaryEvents = emitted.filter((e) => e.type === "claude_summary");
    expect(summaryEvents).toHaveLength(1);
    expect(summaryEvents[0]!.payload.text).toBe("Done successfully.");
  });
});

describe("FAILURE_OVERRIDE_PHRASE — Phase 20 asciicast invariant", () => {
  it("T8: FAILURE_OVERRIDE_PHRASE has no trailing period", () => {
    expect(FAILURE_OVERRIDE_PHRASE).toBe("I ran into a problem");
    expect(FAILURE_OVERRIDE_PHRASE.endsWith(".")).toBe(false);
  });

  it("T8b: buildFailureSummary maps the 3 failure reasons", () => {
    expect(buildFailureSummary({ kind: "failure", reason: "exit_code", exitCode: 2 }))
      .toBe("I ran into a problem. exit_code: 2");
    expect(buildFailureSummary({ kind: "failure", reason: "exit_code", exitCode: null }))
      .toBe("I ran into a problem. exit_code: unknown");
    expect(buildFailureSummary({ kind: "failure", reason: "tool_error" })).toBe(
      "I ran into a problem. tool_error",
    );
    expect(buildFailureSummary({ kind: "failure", reason: "cancelled" })).toBe(
      "I ran into a problem. cancelled",
    );
    // Defensive default for kind=success
    expect(buildFailureSummary({ kind: "success" })).toBe(
      "I ran into a problem",
    );
  });
});

describe("createClaudeBridge() — LOOP-03 tool events stay silent", () => {
  it("T9: tool_use events do not produce TTS-bound emissions", async () => {
    const events: ClaudeBridgeEvent[] = [
      {
        type: "tool_use",
        id: "t1",
        name: "Bash",
        input: { command: "ls" },
      },
      {
        type: "assistant_text_delta",
        text: "Working on that. <spoken-summary>Listed.</spoken-summary>",
      },
      { type: "process_exit", exit_code: 0, signal: null },
    ];
    const { session } = makeFakeSession({
      events,
      outcome: { kind: "success" },
      lastTurnText:
        "Working on that. <spoken-summary>Listed.</spoken-summary>",
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit, events: emitted } = makeRecordingEmit();
    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
    });
    await handle.consume();
    // tool_use itself produces NO TTS-bound emission. Only
    // claude_ack + claude_summary + claude_done are emitted, all
    // sourced from the assistant_text_delta / process_exit branches.
    const ttsBoundForToolUse = emitted.filter((e) =>
      e.type === "claude_ack" && (e.payload.text === "ls" || e.payload.text === "Bash"),
    );
    expect(ttsBoundForToolUse).toHaveLength(0);
    // Sanity: ack and summary did fire from the assistant text path
    const ackEvents = emitted.filter((e) => e.type === "claude_ack");
    expect(ackEvents).toHaveLength(1);
    expect(ackEvents[0]!.payload.text).toBe("Working on that.");
  });
});

describe("createClaudeBridge() — SAFE-04 manipulation-token detection", () => {
  it("T10: manipulation-token detection logs without stripping", async () => {
    // Use the deterministic adversarial fixture from Task 1.
    const transcripts = generateAdversarialTranscripts();
    expect(transcripts.length).toBeGreaterThan(0);
    const adversarial = transcripts[0]!;

    const { session, state } = makeFakeSession({
      events: [
        { type: "process_exit", exit_code: 0, signal: null },
      ],
      outcome: { kind: "success" },
      lastTurnText: "<spoken-summary>ok</spoken-summary>",
    });
    const createSession = (() =>
      session) as unknown as NonNullable<Parameters<typeof createClaudeBridge>[0]["createSession"]>;
    const { emit } = makeRecordingEmit();
    const { logger, state: loggerState } = makeRecordingLogger();

    const handle = createClaudeBridge({
      systemPromptFile: "/tmp/companion.md",
      createSession,
      emit,
      logger,
    });
    await handle.send(adversarial);

    // Logger received the warning with pattern-name identifiers.
    expect(loggerState.warnCalls).toHaveLength(1);
    expect(loggerState.warnCalls[0]!.event).toBe("manipulation_tokens_detected");
    const fields = loggerState.warnCalls[0]!.fields;
    expect(fields).toBeDefined();
    const patterns = (fields as { patterns?: readonly string[] }).patterns;
    expect(Array.isArray(patterns)).toBe(true);
    expect((patterns as string[]).length).toBeGreaterThan(0);
    // Pattern names are stable identifiers, NEVER the matched
    // fragment from the input.
    for (const name of patterns as string[]) {
      expect(adversarial.includes(name)).toBe(false);
    }

    // bridge.send received the FULL wrapped transcript — NO strip.
    expect(state.sendCalls).toHaveLength(1);
    const wrapped = state.sendCalls[0]!;
    expect(wrapped.startsWith(DELIM_START)).toBe(true);
    // The adversarial body (post-trim) must appear inside the wrapped
    // envelope — proof we did not strip.
    expect(wrapped.includes(adversarial.trim())).toBe(true);
    expect(wrapped.endsWith(REMINDER_LINE)).toBe(true);
  });
});
