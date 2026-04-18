import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveSessionEvent } from "@codex-mobile/protocol/live-session";

const transportMocks = vi.hoisted(() => {
  const state: {
    handlers: {
      onConnectionChange: (connection: string) => void;
      onEvent: (event: LiveSessionEvent) => void;
      onTransportError: (error: Error) => void;
    } | null;
    fakeTransport: {
      disconnect: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
    };
  } = {
    handlers: null,
    fakeTransport: {
      disconnect: vi.fn(),
      send: vi.fn(async () => undefined),
    },
  };

  return {
    state,
    connectLiveSession: vi.fn(async (_sessionId: string, handlers: typeof state.handlers) => {
      state.handlers = handlers;
      return state.fakeTransport;
    }),
    sendSessionCommand: vi.fn(async () => undefined),
  };
});

vi.mock("../../lib/live-session/transport", () => ({
  connectLiveSession: transportMocks.connectLiveSession,
  sendSessionCommand: transportMocks.sendSessionCommand,
}));

import { SessionShell } from "../../app/session/[sessionId]/session-shell";

async function renderShell() {
  Object.defineProperty(window, "innerHeight", {
    value: 600,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "scrollY", {
    value: 0,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: 2_000,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
  });

  render(
    <SessionShell sessionId="session-test" initialConnection="connecting" />,
  );

  await act(async () => {
    await Promise.resolve();
  });
}

describe("SessionShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMocks.state.handlers = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the reconnect banner when the live connection starts reconnecting", async () => {
    await renderShell();

    await act(async () => {
      transportMocks.state.handlers?.onConnectionChange("reconnecting");
    });

    expect(
      screen.getByText("Live connection lost. Reconnecting now."),
    ).toBeInTheDocument();
  });

  it("restores follow mode when Jump to live is tapped", async () => {
    await renderShell();

    fireEvent.scroll(window);

    const jumpButton = await screen.findByRole("button", {
      name: "Jump to live",
    });
    expect(jumpButton).toBeInTheDocument();

    fireEvent.click(jumpButton);
    Object.defineProperty(window, "scrollY", {
      value: 1_500,
      configurable: true,
      writable: true,
    });
    fireEvent.scroll(window);

    expect(
      screen.queryByRole("button", { name: "Jump to live" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the approval card inside the live turn", async () => {
    await renderShell();

    const liveTurn = screen.getByLabelText("Turn session-test-turn-002");
    expect(
      within(liveTurn).getByText("Waiting for approval"),
    ).toBeInTheDocument();
  });

  it("shows pending interrupt state until the transport sends an interrupt completion event", async () => {
    await renderShell();

    fireEvent.click(screen.getByRole("button", { name: "Interrupt" }));

    expect(transportMocks.state.fakeTransport.send).toHaveBeenCalledWith({
      kind: "interrupt",
      reason: "user_request",
    });
    expect(
      screen.getByRole("button", { name: "Interrupting..." }),
    ).toBeInTheDocument();

    await act(async () => {
      transportMocks.state.handlers?.onEvent({
        kind: "interrupt.finished",
        sessionId: "session-test",
        cursor: 7,
        occurredAt: "2026-04-18T07:45:00.000Z",
        stateLabel: "Interrupted",
        actorDetail: "The current Codex turn stopped remotely",
      });
    });

    expect(screen.getByRole("button", { name: "Interrupt" })).toBeInTheDocument();
  });
});
