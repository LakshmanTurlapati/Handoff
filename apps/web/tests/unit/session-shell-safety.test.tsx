import React from "react";
import {
  act,
  cleanup,
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
    <SessionShell sessionId="session-safety" initialConnection="connecting" />,
  );

  await act(async () => {
    await Promise.resolve();
  });
}

describe("SessionShell terminal safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportMocks.state.handlers = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the timeline visible during a transient reconnect", async () => {
    await renderShell();

    await act(async () => {
      transportMocks.state.handlers?.onConnectionChange("reconnecting");
    });

    expect(screen.getByLabelText("Timeline")).toBeInTheDocument();
    expect(
      screen.getByText("Live connection lost. Reconnecting now."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Turn session-safety-turn-002")).getByText(
        "Waiting for approval",
      ),
    ).toBeInTheDocument();
  });

  it("renders Device revoked and disables controls after device_session_revoked", async () => {
    await renderShell();

    await act(async () => {
      transportMocks.state.handlers?.onEvent({
        kind: "session.ended",
        sessionId: "session-safety",
        cursor: 9,
        occurredAt: "2026-04-18T08:10:00.000Z",
        reason: "device_session_revoked",
      });
    });

    const revokedCard = screen.getByLabelText("Device revoked");
    expect(
      within(revokedCard).getByRole("heading", { name: "Device revoked" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Prompt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Steer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Interrupt" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abort" })).toBeDisabled();
  });

  it("renders Session ended on your laptop for codex_process_exited", async () => {
    await renderShell();

    await act(async () => {
      transportMocks.state.handlers?.onEvent({
        kind: "session.ended",
        sessionId: "session-safety",
        cursor: 10,
        occurredAt: "2026-04-18T08:12:00.000Z",
        reason: "codex_process_exited",
      });
    });

    const endedCard = screen.getByLabelText("Session ended on your laptop");
    expect(
      within(endedCard).getByRole("heading", {
        name: "Session ended on your laptop",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Codex stopped on your laptop, so remote controls are now locked for safety.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Live connection lost. Reconnecting now."),
    ).not.toBeInTheDocument();
  });
});
