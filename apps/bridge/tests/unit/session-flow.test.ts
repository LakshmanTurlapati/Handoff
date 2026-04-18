import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { SessionMetadata } from "@codex-mobile/protocol";
import { BridgeDaemon } from "../../src/daemon/bridge-daemon.js";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeRelayConnection extends EventEmitter {
  connected = false;
  disconnected = false;
  readonly sent: object[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    this.emit("connected");
  }

  disconnect(): void {
    this.connected = false;
    this.disconnected = true;
  }

  send(message: object): boolean {
    this.sent.push(message);
    return true;
  }
}

class FakeCodexAdapter extends EventEmitter {
  readonly listSessionsCalls: number[] = [];
  readonly readCalls: string[] = [];
  readonly resumeCalls: string[] = [];
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

  sessions: SessionMetadata[] = [];
  readResults = new Map<string, unknown>();

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async listSessions(): Promise<SessionMetadata[]> {
    this.listSessionsCalls.push(this.listSessionsCalls.length + 1);
    return this.sessions.map((session) => ({ ...session }));
  }

  async resumeSession(sessionId: string): Promise<unknown> {
    this.resumeCalls.push(sessionId);
    return { ok: true };
  }

  async readSession(sessionId: string): Promise<unknown> {
    this.readCalls.push(sessionId);
    return this.readResults.get(sessionId) ?? { thread: { turns: [] } };
  }

  async startTurn(sessionId: string, userMessage: string): Promise<unknown> {
    this.startTurnCalls.push({ sessionId, userMessage });
    return { turn: { id: "turn-started" } };
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

describe("BridgeDaemon session flow", () => {
  it("lists sessions and attaches with history replay", async () => {
    const relay = new FakeRelayConnection();
    const codex = new FakeCodexAdapter();
    codex.sessions = [createSession("thr_alpha"), createSession("thr_beta")];
    codex.readResults.set("thr_alpha", {
      thread: {
        turns: [
          {
            id: "turn-1",
            status: "completed",
            items: [{ type: "agentMessage", text: "Existing remote-safe history" }],
          },
        ],
      },
    });

    const daemon = new BridgeDaemon({
      relayConnection: relay,
      codexAdapter: codex,
    });

    await daemon.start();

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "list-1",
        method: "session.list",
      }),
    );
    await flush();

    const listResponse = relay.sent.find(
      (message) =>
        "id" in message &&
        (message as { id?: string }).id === "list-1",
    ) as { result?: { sessions: SessionMetadata[] } } | undefined;
    expect(listResponse?.result?.sessions).toHaveLength(2);
    expect(listResponse?.result?.sessions[0]?.sessionId).toBe("thr_alpha");

    relay.emit(
      "message",
      JSON.stringify({
        jsonrpc: "2.0",
        id: "attach-1",
        method: "session.attach",
        params: { sessionId: "thr_alpha" },
      }),
    );
    await flush();

    expect(codex.resumeCalls).toEqual(["thr_alpha"]);
    expect(codex.readCalls).toEqual(["thr_alpha"]);

    const attachedEvent = relay.sent.find(
      (message) =>
        "method" in message &&
        (message as { method?: string }).method === "session.event" &&
        (message as { params?: { event?: { kind?: string } } }).params?.event?.kind ===
          "session.attached",
    ) as { params?: { event?: { sessionId?: string } } } | undefined;
    expect(attachedEvent?.params?.event?.sessionId).toBe("thr_alpha");

    const historyNotification = relay.sent.find(
      (message) =>
        "method" in message &&
        (message as { method?: string }).method === "session.history",
    ) as { params?: { turns?: Array<{ assistantPreview?: string }> } } | undefined;
    expect(historyNotification?.params?.turns?.[0]?.assistantPreview).toBe(
      "Existing remote-safe history",
    );

    const attachResponse = relay.sent.find(
      (message) =>
        "id" in message &&
        (message as { id?: string }).id === "attach-1",
    ) as { result?: { ok?: boolean } } | undefined;
    expect(attachResponse?.result?.ok).toBe(true);

    await daemon.stop();
  });
});
