"use client";

import {
  LiveSessionEventSchema,
  SessionCommandResponseSchema,
  SessionConnectResponseSchema,
  type LiveSessionEvent,
  type SessionCommand,
} from "@codex-mobile/protocol/live-session";
import type { LiveConnectionState } from "./session-model";

const BROWSER_PROTOCOL = "codex-mobile.live.v1";
const RECONNECT_DELAY_MS = 1_200;

export interface LiveSessionTransportHandlers {
  onConnectionChange: (connection: LiveConnectionState) => void;
  onEvent: (event: LiveSessionEvent) => void;
  onTransportError: (error: Error) => void;
}

export interface LiveSessionTransport {
  disconnect: () => void;
  send: (command: SessionCommand) => Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function fetchConnectPayload(sessionId: string) {
  const response = await fetch(`/api/sessions/${sessionId}/connect`, {
    method: "POST",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`connect_boot_failed_${response.status}`);
  }

  const body = await response.json();
  const parsed = SessionConnectResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("connect_boot_invalid");
  }

  return parsed.data;
}

export async function sendSessionCommand(
  sessionId: string,
  command: SessionCommand,
): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/command`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(command),
  });

  const body = await response.json();
  const parsed = SessionCommandResponseSchema.safeParse(body);
  if (!parsed.success || !response.ok || !parsed.data.accepted) {
    throw new Error(`command_failed_${response.status}`);
  }
}

export async function connectLiveSession(
  sessionId: string,
  handlers: LiveSessionTransportHandlers,
): Promise<LiveSessionTransport> {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let hasConnected = false;
  let lastCursor = 0;

  const openSocket = async () => {
    if (disposed) return;

    handlers.onConnectionChange(hasConnected ? "reconnecting" : "connecting");
    const payload = await fetchConnectPayload(sessionId);
    const url = new URL(payload.relayUrl);
    url.searchParams.set("sessionId", payload.sessionId);
    if (lastCursor > 0) {
      url.searchParams.set("cursor", String(lastCursor));
    }

    const nextSocket = new WebSocket(url.toString(), [
      BROWSER_PROTOCOL,
      payload.ticket,
    ]);
    socket = nextSocket;

    nextSocket.addEventListener("open", () => {
      hasConnected = true;
      handlers.onConnectionChange("connected");
    });

    nextSocket.addEventListener("message", (message) => {
      try {
        const parsed = LiveSessionEventSchema.safeParse(
          JSON.parse(String(message.data)),
        );
        if (!parsed.success) {
          throw new Error("live_event_invalid");
        }

        lastCursor = Math.max(lastCursor, parsed.data.cursor);
        handlers.onEvent(parsed.data);
      } catch (error) {
        handlers.onTransportError(asError(error));
      }
    });

    nextSocket.addEventListener("error", () => {
      handlers.onTransportError(new Error("live_session_socket_error"));
    });

    nextSocket.addEventListener("close", () => {
      socket = null;
      if (disposed) {
        handlers.onConnectionChange("disconnected");
        return;
      }

      handlers.onConnectionChange("reconnecting");
      if (reconnectTimer) return;

      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void openSocket().catch((error) => {
          handlers.onTransportError(asError(error));
          if (!disposed) {
            handlers.onConnectionChange("reconnecting");
          }
        });
      }, RECONNECT_DELAY_MS);
    });
  };

  await openSocket().catch((error) => {
    handlers.onTransportError(asError(error));
    handlers.onConnectionChange("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void openSocket().catch((retryError) => {
        handlers.onTransportError(asError(retryError));
      });
    }, RECONNECT_DELAY_MS);
  });

  return {
    disconnect() {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        socket.close();
        socket = null;
      }
      handlers.onConnectionChange("disconnected");
    },
    async send(command) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(command));
        return;
      }

      await sendSessionCommand(sessionId, command);
    },
  };
}
