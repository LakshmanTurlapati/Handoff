import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { JSON_RPC_ERRORS, type SessionMetadata } from "@codex-mobile/protocol";
import { BridgeDaemon } from "../../src/daemon/bridge-daemon.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeRelayConnection extends EventEmitter {
  readonly sent: object[] = [];

  async connect(): Promise<void> {
    this.emit("connected");
  }

  disconnect(): void {}

  send(message: object): boolean {
    this.sent.push(message);
    return true;
  }
}

class FakeCodexAdapter extends EventEmitter {
  sessions: SessionMetadata[] = [];
  readonly startTurnCalls: Array<{ sessionId: string; userMessage: string }> = [];
  readonly steerTurnCalls: Array<{
    expectedTurnId: string;
    sessionId: string;
    userMessage: string;
  }> = [];
  readonly interruptTurnCalls: Array<{ sessionId: string; turnId: string }> = [];
  readonly approvalCalls: Array<{
    decision: "approved" | "denied" | "abort";
    requestId: string | number;
  }> = [];

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async listSessions(): Promise<SessionMetadata[]> {
    return this.sessions.map((session) => ({ ...session }));
  }

  async resumeSession(): Promise<unknown> {
    return { ok: true };
  }

  async readSession(): Promise<unknown> {
    return { thread: { turns: [] } };
  }

  async startTurn(sessionId: string, userMessage: string): Promise<unknown> {
    this.startTurnCalls.push({ sessionId, userMessage });
    return { turn: { id: "turn-live" } };
  }

  async steerTurn(
    sessionId: string,
    userMessage: string,
    expectedTurnId: string,
  ): Promise<unknown> {
    this.steerTurnCalls.push({ sessionId, userMessage, expectedTurnId });
    return { turnId: expectedTurnId };
  }

  async interruptTurn(sessionId: string, turnId: string): Promise<unknown> {
    this.interruptTurnCalls.push({ sessionId, turnId });
    return {};
  }

  async respondToApproval(
    requestId: string | number,
    decision: "approved" | "denied" | "abort",
  ): Promise<void> {
    this.approvalCalls.push({ requestId, decision });
  }
}

function createSession(sessionId: string): SessionMetadata {
  return {
    sessionId,
    threadTitle: `Session ${sessionId}`,
    model: "openai",
    startedAt: "2026-04-18T08:00:00.000Z",
    status: "notLoaded",
    turnCount: 0,
  };
}

async function attachSession(
  relay: FakeRelayConnection,
  sessionId: string,
): Promise<void> {
  relay.emit(
    "message",
    JSON.stringify({
      jsonrpc: "2.0",
      id: `attach-${sessionId}`,
      method: "session.attach",
      params: { sessionId },
    }),
  );
  await flush();
}

describe("BridgeDaemon event relay", () => {
  it("routes prompt, steer, approval, and interrupt through the attached session", async () => {
    const relay = new FakeRelayConnection();
    const codex = new FakeCodexAdapter();
    codex.sessions = [createSession("thr_alpha")];

    const daemon = new BridgeDaemon({
      relayConnection: relay,
      codexAdapter: codex,
    });

    await daemon.start();
    await attachSession(relay, "thr_alpha");

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "turn-send",
        method: "turn.send",
        params: {
          sessionId: "thr_alpha",
          userMessage: "Continue the rollout",
        },
      }),
    );
    await flush();

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "turn-steer",
        method: "turn.steer",
        params: {
          sessionId: "thr_alpha",
          userMessage: "Focus only on the daemon path",
          mode: "append",
        },
      }),
    );
    await flush();

    codex.emit("server-request", {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thr_alpha",
        turnId: "turn-live",
        command: "npm install",
        availableDecisions: ["approved", "denied", "abort"],
      },
    });
    await flush();

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "approval-respond",
        method: "approval.respond",
        params: {
          sessionId: "thr_alpha",
          requestId: 42,
          decision: "approved",
        },
      }),
    );
    await flush();

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "turn-interrupt",
        method: "turn.interrupt",
        params: {
          sessionId: "thr_alpha",
          reason: "user_request",
        },
      }),
    );
    await flush();

    expect(codex.startTurnCalls).toEqual([
      { sessionId: "thr_alpha", userMessage: "Continue the rollout" },
    ]);
    expect(codex.steerTurnCalls).toEqual([
      {
        sessionId: "thr_alpha",
        userMessage: "Focus only on the daemon path",
        expectedTurnId: "turn-live",
      },
    ]);
    expect(codex.approvalCalls).toEqual([
      { requestId: 42, decision: "approved" },
    ]);
    expect(codex.interruptTurnCalls).toEqual([
      { sessionId: "thr_alpha", turnId: "turn-live" },
    ]);

    const approvalEvent = relay.sent.find(
      (message) =>
        "method" in message &&
        (message as { method?: string }).method === "session.event" &&
        (message as { params?: { event?: { activity?: { kind?: string } } } }).params?.event
          ?.activity?.kind === "approval",
    );
    expect(approvalEvent).toBeTruthy();

    await daemon.stop();
  });

  it("rejects a second active attach and emits local session end signals", async () => {
    const relay = new FakeRelayConnection();
    const codex = new FakeCodexAdapter();
    codex.sessions = [createSession("thr_alpha"), createSession("thr_beta")];

    const daemon = new BridgeDaemon({
      relayConnection: relay,
      codexAdapter: codex,
    });

    await daemon.start();
    await attachSession(relay, "thr_alpha");

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "attach-beta",
        method: "session.attach",
        params: { sessionId: "thr_beta" },
      }),
    );
    await flush();

    const secondAttachResponse = relay.sent.find(
      (message) =>
        "id" in message &&
        (message as { id?: string }).id === "attach-beta",
    ) as { error?: { code?: number; message?: string } } | undefined;
    expect(secondAttachResponse?.error?.code).toBe(
      JSON_RPC_ERRORS.SESSION_ALREADY_ATTACHED,
    );
    expect(secondAttachResponse?.error?.message).toBe("session_already_attached");

    relay.sent.length = 0;
    codex.emit("server-notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: "thr_alpha",
        turnId: "turn-live",
        delta: "Streaming from local Codex",
      },
    });
    codex.emit("server-notification", {
      method: "thread/closed",
      params: {
        threadId: "thr_alpha",
      },
    });
    await flush();

    const assistantEvent = relay.sent.find(
      (message) =>
        "method" in message &&
        (message as { method?: string }).method === "session.event" &&
        (message as { params?: { event?: { activity?: { kind?: string } } } }).params?.event
          ?.activity?.kind === "assistant",
    );
    expect(assistantEvent).toBeTruthy();

    const endedNotification = relay.sent.find(
      (message) =>
        "method" in message &&
        (message as { method?: string }).method === "session.ended",
    ) as { params?: { sessionId?: string; reason?: string } } | undefined;
    expect(endedNotification?.params?.sessionId).toBe("thr_alpha");
    expect(endedNotification?.params?.reason).toBe("codex_session_ended");

    await daemon.stop();
  });
});
