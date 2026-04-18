import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../src/daemon/codex-adapter.js";

class FakeCodexProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;
  readonly writes: string[] = [];

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer | string) => {
      this.writes.push(...chunk.toString().trim().split("\n").filter(Boolean));
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0, null);
    return true;
  }
}

describe("CodexAdapter", () => {
  it("sends initialize then initialized during startup", async () => {
    const process = new FakeCodexProcess();
    const adapter = new CodexAdapter({
      spawnProcess: () => process,
    });

    const startPromise = adapter.start();

    const initLine = process.writes[0];
    expect(initLine).toContain('"method":"initialize"');

    process.stdout.write(
      `${JSON.stringify({
        id: 0,
        result: {
          userAgent: "codex/test",
        },
      })}\n`,
    );

    await startPromise;

    const writes = process.writes;
    expect(writes[0]).toContain('"method":"initialize"');
    expect(writes[1]).toBe('{"method":"initialized"}');
  });

  it("maps thread/list responses into session metadata", async () => {
    const process = new FakeCodexProcess();
    const adapter = new CodexAdapter({
      spawnProcess: () => process,
    });

    const startPromise = adapter.start();
    process.stdout.write(`${JSON.stringify({ id: 0, result: {} })}\n`);
    await startPromise;

    const listPromise = adapter.listSessions();
    const writes = process.writes;
    const listLine = writes.find((line) => line.includes('"method":"thread/list"'));
    expect(listLine).toBeTruthy();

    process.stdout.write(
      `${JSON.stringify({
        id: 1,
        result: {
          data: [
            {
              conversationId: "thr_alpha",
              preview: "Bridge planning thread",
              modelProvider: "openai",
              updatedAt: "2026-04-18T07:00:00.000Z",
            },
          ],
        },
      })}\n`,
    );

    await expect(listPromise).resolves.toEqual([
      {
        sessionId: "thr_alpha",
        threadTitle: "Bridge planning thread",
        model: "openai",
        startedAt: "2026-04-18T07:00:00.000Z",
        status: "notLoaded",
        turnCount: 0,
      },
    ]);
  });

  it("issues thread/resume and thread/read requests for session preparation", async () => {
    const process = new FakeCodexProcess();
    const adapter = new CodexAdapter({
      spawnProcess: () => process,
    });

    const startPromise = adapter.start();
    process.stdout.write(`${JSON.stringify({ id: 0, result: {} })}\n`);
    await startPromise;

    const resumePromise = adapter.resumeSession("thr_resume");
    process.stdout.write(`${JSON.stringify({ id: 1, result: { ok: true } })}\n`);
    await expect(resumePromise).resolves.toEqual({ ok: true });

    const readPromise = adapter.readSession("thr_resume");
    process.stdout.write(
      `${JSON.stringify({
        id: 2,
        result: { thread: { turns: [] } },
      })}\n`,
    );
    await expect(readPromise).resolves.toEqual({ thread: { turns: [] } });

    const writes = process.writes;
    expect(writes.some((line) => line.includes('"method":"thread/resume"'))).toBe(true);
    expect(writes.some((line) => line.includes('"method":"thread/read"'))).toBe(true);
  });
});
