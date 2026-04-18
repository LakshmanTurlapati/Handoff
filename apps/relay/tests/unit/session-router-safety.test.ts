import { describe, expect, it, vi } from "vitest";
import { SessionRouter } from "../../src/browser/session-router.js";

function createSocket() {
  return {
    OPEN: 1,
    readyState: 1,
    send: vi.fn(),
  } as const;
}

describe("session router command-surface safety", () => {
  it("rejects unknown command kinds such as shell", async () => {
    const socket = createSocket();
    const router = new SessionRouter();

    await router.handleBrowserMessage(
      "user-alpha",
      "session-alpha",
      JSON.stringify({
        kind: "shell",
        command: "ls -la",
      }),
      socket as never,
    );

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0]?.[0]).toContain('"kind":"session.error"');
    expect(socket.send.mock.calls[0]?.[0]).toContain('"code":"invalid_command"');
  });
});
