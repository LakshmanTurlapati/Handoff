import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCodexHandoffCommand } from "../../src/cli/codex-handoff.js";

function createOutputCapture(): {
  out: PassThrough;
  read: () => string;
} {
  const out = new PassThrough();
  let output = "";
  out.on("data", (chunk: Buffer | string) => {
    output += chunk.toString();
  });
  return {
    out,
    read: () => output,
  };
}

describe("codex-handoff safety", () => {
  it("fails closed with missing_active_thread_context and no session picker fallback", async () => {
    const sessionPicker = vi.fn();
    const result = await runCodexHandoffCommand({
      format: "json",
      createPairingClient: vi.fn().mockReturnValue({
        createHandoff: vi.fn(),
        listSessions: sessionPicker,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.message).toBe("missing_active_thread_context");
    expect(result.guidance).toContain("No session picker fallback");
    expect(sessionPicker).not.toHaveBeenCalled();
  });

  it("returns reused true for the same thread when the hosted handoff is reused", async () => {
    const output = createOutputCapture();
    const createHandoff = vi.fn().mockResolvedValue({
      threadId: "thread-123",
      sessionId: "session-123",
      launchUrl: "https://handoff.example.test/launch/public-123",
      qrText: "https://handoff.example.test/launch/public-123",
      expiresAt: "2026-04-19T22:30:00.000Z",
      reused: true,
    });

    const result = await runCodexHandoffCommand({
      threadId: "thread-123",
      sessionId: "session-123",
      format: "json",
      out: output.out,
      launchCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        message: "daemon_reused",
      }),
      loadBootstrapState: vi.fn().mockResolvedValue({
        baseUrl: "https://handoff.example.test",
        relayUrl: "wss://relay.example.test/ws/browser",
        bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
        bridgeInstanceId: "bridge-instance-123",
        deviceLabel: null,
        bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
      }),
      createPairingClient: vi.fn().mockReturnValue({
        createHandoff,
        listSessions: vi.fn(),
      }),
    });

    expect(result.payload).toMatchObject({
      reused: true,
      daemonAction: "daemon_reused",
    });
    expect(JSON.parse(output.read())).toMatchObject({
      reused: true,
    });
  });

  it("does not reuse a previous handoff across different thread ids", async () => {
    const createHandoff = vi
      .fn()
      .mockResolvedValueOnce({
        threadId: "thread-123",
        sessionId: "session-123",
        launchUrl: "https://handoff.example.test/launch/public-123",
        qrText: "https://handoff.example.test/launch/public-123",
        expiresAt: "2026-04-19T22:30:00.000Z",
        reused: true,
      })
      .mockResolvedValueOnce({
        threadId: "thread-456",
        sessionId: "session-123",
        launchUrl: "https://handoff.example.test/launch/public-456",
        qrText: "https://handoff.example.test/launch/public-456",
        expiresAt: "2026-04-19T22:31:00.000Z",
        reused: false,
      });

    const createPairingClient = vi.fn().mockReturnValue({
      createHandoff,
      listSessions: vi.fn(),
    });
    const bootstrapState = {
      baseUrl: "https://handoff.example.test",
      relayUrl: "wss://relay.example.test/ws/browser",
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "bridge-instance-123",
      deviceLabel: null,
      bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
    };

    const first = await runCodexHandoffCommand({
      threadId: "thread-123",
      sessionId: "session-123",
      format: "json",
      out: createOutputCapture().out,
      launchCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        message: "daemon_reused",
      }),
      loadBootstrapState: vi.fn().mockResolvedValue(bootstrapState),
      createPairingClient,
    });
    const second = await runCodexHandoffCommand({
      threadId: "thread-456",
      sessionId: "session-123",
      format: "json",
      out: createOutputCapture().out,
      launchCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        message: "daemon_reused",
      }),
      loadBootstrapState: vi.fn().mockResolvedValue(bootstrapState),
      createPairingClient,
    });

    expect(first.payload).toMatchObject({
      threadId: "thread-123",
      reused: true,
    });
    expect(second.payload).toMatchObject({
      threadId: "thread-456",
      reused: false,
    });
    expect(createHandoff).toHaveBeenNthCalledWith(1, {
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "bridge-instance-123",
      threadId: "thread-123",
      sessionId: "session-123",
    });
    expect(createHandoff).toHaveBeenNthCalledWith(2, {
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "bridge-instance-123",
      threadId: "thread-456",
      sessionId: "session-123",
    });
  });
});
