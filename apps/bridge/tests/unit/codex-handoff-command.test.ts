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

describe("codex-handoff command", () => {
  it("fails with missing_active_thread_context when the thread context is absent", async () => {
    const launchCommand = vi.fn();
    const createPairingClient = vi.fn();

    const result = await runCodexHandoffCommand({
      format: "json",
      sessionId: "session-123",
      launchCommand,
      createPairingClient,
    });

    expect(result).toEqual({
      exitCode: 1,
      message: "missing_active_thread_context",
    });
    expect(launchCommand).not.toHaveBeenCalled();
    expect(createPairingClient).not.toHaveBeenCalled();
  });

  it("creates a fresh handoff and returns clean JSON with daemon_started", async () => {
    const output = createOutputCapture();
    const createHandoff = vi.fn().mockResolvedValue({
      threadId: "thread-123",
      sessionId: "session-123",
      launchUrl: "https://handoff.example.test/launch/public-123",
      qrText: "https://handoff.example.test/launch/public-123",
      expiresAt: "2026-04-19T22:30:00.000Z",
      reused: false,
    });

    const result = await runCodexHandoffCommand({
      threadId: "thread-123",
      sessionId: "session-123",
      format: "json",
      out: output.out,
      launchCommand: vi.fn().mockResolvedValue({
        exitCode: 0,
        message: "daemon_started",
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
      }),
    });

    expect(createHandoff).toHaveBeenCalledWith({
      bridgeInstallationId: "11111111-1111-4111-8111-111111111111",
      bridgeInstanceId: "bridge-instance-123",
      threadId: "thread-123",
      sessionId: "session-123",
    });
    expect(result.exitCode).toBe(0);
    expect(result.payload).toEqual({
      threadId: "thread-123",
      sessionId: "session-123",
      launchUrl: "https://handoff.example.test/launch/public-123",
      qrText: "https://handoff.example.test/launch/public-123",
      expiresAt: "2026-04-19T22:30:00.000Z",
      reused: false,
      daemonAction: "daemon_started",
    });
    expect(JSON.parse(output.read())).toEqual(result.payload);
  });

  it("reuses the same-thread handoff and propagates daemon_reused", async () => {
    const output = createOutputCapture();

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
        deviceLabel: "Pocket phone",
        bridgeBootstrapToken: "bootstrap-token-123456789012345678901234567890",
      }),
      createPairingClient: vi.fn().mockReturnValue({
        createHandoff: vi.fn().mockResolvedValue({
          threadId: "thread-123",
          sessionId: "session-123",
          launchUrl: "https://handoff.example.test/launch/public-123",
          qrText: "https://handoff.example.test/launch/public-123",
          expiresAt: "2026-04-19T22:30:00.000Z",
          reused: true,
        }),
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.payload).toMatchObject({
      reused: true,
      daemonAction: "daemon_reused",
    });
    expect(JSON.parse(output.read())).toMatchObject({
      reused: true,
      daemonAction: "daemon_reused",
    });
  });
});
