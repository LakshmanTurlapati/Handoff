import { createHash } from "node:crypto";
import {
  findBridgeInstallationByTokenHash,
  findDeviceSessionForPrincipal,
  touchBridgeInstallationLastUsed,
  touchDeviceSessionLastSeen,
  type BridgeInstallationRow,
} from "@codex-mobile/db";
import { mintWsTicket } from "@codex-mobile/auth/ws-ticket";
import { auth } from "../../auth";
import {
  hashCookieToken,
  readDeviceSession,
  readRawDeviceSessionToken,
} from "../device-session";

export interface RemotePrincipal {
  userId: string;
  deviceSessionId: string;
}

export interface RequireBridgeInstallationPrincipalOptions {
  bridgeBootstrapToken: string;
  bridgeInstallationId: string;
  bridgeInstanceId?: string;
  touchLastUsed?: boolean;
  lastUsedAt?: Date;
}

export function loadWsTicketSecret(): Uint8Array {
  const raw = process.env.WS_TICKET_SECRET ?? "dev-ws-ticket-secret-change-me";
  const bytes = new TextEncoder().encode(raw);

  if (bytes.byteLength < 32) {
    throw new Error(
      "WS_TICKET_SECRET must be at least 32 bytes after UTF-8 encoding",
    );
  }

  return bytes;
}

export async function requireRemotePrincipal(): Promise<RemotePrincipal> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("unauthenticated");
  }

  const userId =
    (session.user as { id?: string }).id ??
    session.user.email ??
    "unknown-user";

  const rawDeviceSessionToken = await readRawDeviceSessionToken();
  if (!rawDeviceSessionToken) {
    throw new Error("device_session_required");
  }

  const deviceSession = await readDeviceSession();
  if (!deviceSession) {
    throw new Error("device_session_required");
  }

  const cookieTokenHash = hashCookieToken(rawDeviceSessionToken);
  const deviceSessionRow = await findDeviceSessionForPrincipal({
    deviceSessionId: deviceSession.deviceSessionId,
    userId,
    cookieTokenHash,
  });
  if (!deviceSessionRow) {
    throw new Error("device_session_required");
  }

  if (deviceSessionRow.cookieTokenHash !== cookieTokenHash) {
    throw new Error("device_session_required");
  }

  if (
    deviceSession.userId !== userId ||
    deviceSessionRow.userId !== userId
  ) {
    throw new Error("user_mismatch");
  }

  if (deviceSessionRow.revokedAt) {
    throw new Error("device_session_revoked");
  }

  if (deviceSessionRow.expiresAt.getTime() <= Date.now()) {
    throw new Error("device_session_expired");
  }

  await touchDeviceSessionLastSeen(deviceSessionRow.id);

  return {
    userId,
    deviceSessionId: deviceSessionRow.id,
  };
}

export async function requireBridgeInstallationPrincipal(
  options: RequireBridgeInstallationPrincipalOptions,
): Promise<BridgeInstallationRow> {
  if (!options.bridgeBootstrapToken.trim()) {
    throw new Error("missing_bridge_bootstrap_token");
  }

  const installTokenHash = createHash("sha256")
    .update(options.bridgeBootstrapToken)
    .digest("hex");
  const installation = await findBridgeInstallationByTokenHash({
    installTokenHash,
  });

  if (!installation || installation.id !== options.bridgeInstallationId) {
    throw new Error("bridge_installation_invalid");
  }

  if (
    options.bridgeInstanceId &&
    installation.bridgeInstanceId !== options.bridgeInstanceId
  ) {
    throw new Error("bridge_installation_invalid");
  }

  if (installation.revokedAt) {
    throw new Error("bridge_installation_revoked");
  }

  if (options.touchLastUsed) {
    await touchBridgeInstallationLastUsed({
      bridgeInstallationId: installation.id,
      lastUsedAt: options.lastUsedAt ?? new Date(),
    });
  }

  return installation;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) return;

  try {
    if (new URL(origin).host !== host) {
      throw new Error("cross_origin_not_allowed");
    }
  } catch {
    throw new Error("cross_origin_not_allowed");
  }
}

export function resolveRelayPublicWebSocketUrl(): string {
  const directWs =
    process.env.RELAY_PUBLIC_WS_URL ?? process.env.NEXT_PUBLIC_RELAY_WS_URL;
  if (directWs) {
    return directWs;
  }

  const base =
    process.env.RELAY_PUBLIC_URL ??
    process.env.RELAY_INTERNAL_URL ??
    (process.env.FLY_APP_NAME_RELAY
      ? `https://${process.env.FLY_APP_NAME_RELAY}.fly.dev`
      : "http://127.0.0.1:8080");

  const url = new URL("/ws/browser", base);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  }
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  }

  return url.toString();
}

export function resolveRelayInternalBrowserUrl(pathname: string): string {
  const base =
    process.env.RELAY_INTERNAL_URL ??
    process.env.RELAY_PUBLIC_URL ??
    (process.env.FLY_APP_NAME_RELAY
      ? `https://${process.env.FLY_APP_NAME_RELAY}.fly.dev`
      : "http://127.0.0.1:8080");

  return new URL(pathname, base).toString();
}

export async function mintRelayTicket(principal: RemotePrincipal): Promise<{
  ticket: string;
  expiresAt: Date;
}> {
  const minted = await mintWsTicket({
    userId: principal.userId,
    deviceSessionId: principal.deviceSessionId,
    secret: loadWsTicketSecret(),
  });

  return {
    ticket: minted.ticket,
    expiresAt: minted.expiresAt,
  };
}

export async function relayInternalFetch(
  pathname: string,
  principal: RemotePrincipal,
  init: RequestInit = {},
): Promise<Response> {
  const { ticket } = await mintRelayTicket(principal);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ticket}`);

  return fetch(resolveRelayInternalBrowserUrl(pathname), {
    ...init,
    headers,
    cache: "no-store",
  });
}
