import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface, type Interface } from "node:readline";
import type {
  Readable,
  Writable,
} from "node:stream";
import type { SessionMetadata } from "@codex-mobile/protocol";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type RequestId = string | number;

export interface SpawnedCodexProcess extends EventEmitter {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
}

export interface CodexAdapterOptions {
  command?: string;
  args?: string[];
  spawnProcess?: () => SpawnedCodexProcess;
}

interface CodexConversationSummary {
  conversationId?: string;
  preview?: string | null;
  modelProvider?: string | null;
  timestamp?: string | null;
  updatedAt?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

function toSessionMetadata(item: unknown): SessionMetadata | null {
  const record = asRecord(item);
  if (!record) return null;

  const sessionId = readString(record, "conversationId");
  if (!sessionId) return null;

  return {
    sessionId,
    threadTitle: readString(record, "preview"),
    model: readString(record, "modelProvider") ?? "unknown",
    startedAt: readString(record, "timestamp") ?? readString(record, "updatedAt"),
    status: "notLoaded",
    turnCount: 0,
  };
}

export class CodexAdapter extends EventEmitter {
  private readonly command: string;
  private readonly args: string[];
  private readonly spawnProcess: () => SpawnedCodexProcess;
  private process: SpawnedCodexProcess | null = null;
  private stdoutReader: Interface | null = null;
  private stderrReader: Interface | null = null;
  private pending = new Map<RequestId, PendingRequest>();
  private nextId = 1;

  constructor(options: CodexAdapterOptions = {}) {
    super();
    this.command = options.command ?? "codex";
    this.args = options.args ?? ["app-server", "--listen", "stdio://"];
    this.spawnProcess =
      options.spawnProcess ??
      (() =>
        spawn(this.command, this.args, {
          stdio: ["pipe", "pipe", "pipe"],
        }) as unknown as SpawnedCodexProcess);
  }

  async start(): Promise<void> {
    if (this.process) return;

    this.process = this.spawnProcess();
    this.stdoutReader = createInterface({ input: this.process.stdout });
    this.stderrReader = createInterface({ input: this.process.stderr });

    this.stdoutReader.on("line", (line) => {
      this.handleLine(line);
    });
    this.stderrReader.on("line", (line) => {
      this.emit("stderr", line);
    });

    this.process.on("exit", (code, signal) => {
      const error = new Error(
        `codex_app_server_exited_${String(code ?? signal ?? "unknown")}`,
      );
      this.rejectAll(error);
      this.emit("exit", { code, signal });
      this.process = null;
      this.stdoutReader?.close();
      this.stderrReader?.close();
      this.stdoutReader = null;
      this.stderrReader = null;
    });

    await this.initialize();
  }

  async stop(): Promise<void> {
    if (!this.process) return;

    const proc = this.process;
    this.process = null;
    this.stdoutReader?.close();
    this.stderrReader?.close();
    this.stdoutReader = null;
    this.stderrReader = null;
    proc.kill();
    this.rejectAll(new Error("codex_app_server_stopped"));
  }

  async listSessions(): Promise<SessionMetadata[]> {
    const result = await this.request("thread/list", {
      sourceKinds: [],
      archived: false,
      sortKey: "updated_at",
      limit: 50,
    });

    const record = asRecord(result);
    const data = Array.isArray(record?.data) ? record.data : [];
    return data.map(toSessionMetadata).filter((item): item is SessionMetadata => item !== null);
  }

  async resumeSession(sessionId: string): Promise<unknown> {
    return this.request("thread/resume", {
      threadId: sessionId,
      persistExtendedHistory: true,
    });
  }

  async readSession(sessionId: string): Promise<unknown> {
    return this.request("thread/read", {
      threadId: sessionId,
      includeTurns: true,
    });
  }

  async startTurn(sessionId: string, userMessage: string): Promise<unknown> {
    return this.request("turn/start", {
      threadId: sessionId,
      input: [
        {
          type: "text",
          text: userMessage,
          text_elements: [],
        },
      ],
    });
  }

  async steerTurn(
    sessionId: string,
    userMessage: string,
    expectedTurnId: string,
  ): Promise<unknown> {
    return this.request("turn/steer", {
      threadId: sessionId,
      expectedTurnId,
      input: [
        {
          type: "text",
          text: userMessage,
          text_elements: [],
        },
      ],
    });
  }

  async interruptTurn(sessionId: string, turnId: string): Promise<unknown> {
    return this.request("turn/interrupt", {
      threadId: sessionId,
      turnId,
    });
  }

  async respondToApproval(
    requestId: string | number,
    decision: "approved" | "denied" | "abort",
  ): Promise<void> {
    this.writeMessage({
      id: requestId,
      result: { decision },
    });
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    this.ensureStarted();

    const id = this.nextId++;
    const payload: Record<string, unknown> = { method, id };
    if (params !== undefined) {
      payload.params = params;
    }

    this.writeMessage(payload);

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  notify(method: string, params?: unknown): void {
    this.ensureStarted();
    const payload: Record<string, unknown> = { method };
    if (params !== undefined) {
      payload.params = params;
    }
    this.writeMessage(payload);
  }

  private async initialize(): Promise<void> {
    await this.requestWithId(0, "initialize", {
      clientInfo: {
        name: "codex-mobile-bridge",
        title: "Codex Mobile Bridge",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: null,
      },
    });

    this.notify("initialized");
  }

  private async requestWithId(
    id: RequestId,
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    this.ensureStarted();

    const payload: Record<string, unknown> = { method, id };
    if (params !== undefined) {
      payload.params = params;
    }

    this.writeMessage(payload);

    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  private ensureStarted(): void {
    if (!this.process) {
      throw new Error("codex_app_server_not_started");
    }
  }

  private writeMessage(payload: Record<string, unknown>): void {
    if (!this.process) {
      throw new Error("codex_app_server_not_started");
    }

    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.emit("parse-error", line);
      return;
    }

    const record = asRecord(parsed);
    if (!record) return;

    const id = record.id;
    if ((typeof id === "number" || typeof id === "string") && "method" in record) {
      this.emit("server-request", record);
      return;
    }

    if (typeof id === "number" || typeof id === "string") {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);

      const errorRecord = asRecord(record.error);
      if (errorRecord) {
        const message =
          readString(errorRecord, "message") ?? "codex_request_failed";
        pending.reject(new Error(message));
        return;
      }

      pending.resolve(record.result);
      return;
    }

    if (typeof record.method === "string") {
      this.emit("server-notification", record);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
