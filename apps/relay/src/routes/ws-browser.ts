import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyWsTicket } from "@codex-mobile/auth/ws-ticket";
import { findDeviceSessionForPrincipal } from "@codex-mobile/db";
import {
  SessionCommandSchema,
  SessionCommandResponseSchema,
  SessionListResponseSchema,
} from "@codex-mobile/protocol/live-session";
import { sessionRouter } from "../browser/session-router.js";
import { bridgeRegistry } from "../bridge/bridge-registry.js";
import {
  ownershipService,
  type OwnerResolution,
} from "../ownership/ownership-service.js";
import { sendFlyReplay } from "../ownership/replay-routing.js";
import { recordReplayFailure } from "./ops.js";

const BROWSER_PROTOCOL = "codex-mobile.live.v1";
const OWNER_MACHINE_HEADER = "x-codex-owner-machine-id";
const OWNER_REGION_HEADER = "x-codex-owner-region";
const REPLAY_FAILED_HEADER = "fly-replay-failed";
const REPLAY_SOURCE_HEADER = "fly-replay-src";

type BrowserClaims = {
  userId: string;
  deviceSessionId: string;
};

function extractBearerTicket(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return undefined;
}

function extractProtocolTicket(request: FastifyRequest): string | undefined {
  const rawHeader = request.headers["sec-websocket-protocol"];
  if (typeof rawHeader !== "string") {
    return undefined;
  }

  const protocols = rawHeader
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (protocols[0] !== BROWSER_PROTOCOL) {
    return undefined;
  }

  return protocols[1];
}

function extractBrowserClaims(request: FastifyRequest): BrowserClaims | undefined {
  return (
    request as FastifyRequest & {
      _wsTicketClaims?: BrowserClaims;
    }
  )._wsTicketClaims;
}

function extractSessionId(request: FastifyRequest): string | undefined {
  const url = new URL(
    request.url,
    `http://${request.headers.host ?? "localhost"}`,
  );
  return url.searchParams.get("sessionId") ?? undefined;
}

function getHeaderValue(
  request: FastifyRequest,
  headerName: string,
): string | undefined {
  const value = request.headers[headerName];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}

async function resolveBrowserRouteOwnership(input: {
  userId: string;
  sessionId?: string;
}): Promise<OwnerResolution> {
  if (input.sessionId) {
    const sessionResolution = await ownershipService.resolveOwnerForSession(
      input.sessionId,
    );
    if (sessionResolution.status !== "bridge_owner_missing") {
      return sessionResolution;
    }
  }

  return ownershipService.resolveOwnerForUser(input.userId);
}

function requireLocalBridge(
  resolution: OwnerResolution,
  userId: string,
): OwnerResolution {
  if (resolution.status !== "local_owner") {
    return resolution;
  }

  if (bridgeRegistry.has(userId)) {
    return resolution;
  }

  return {
    status: "bridge_owner_missing",
    lease: resolution.lease,
    ownerMachineId: resolution.ownerMachineId,
    ownerRegion: resolution.ownerRegion,
  };
}

function buildReplayState(claims: BrowserClaims, sessionId?: string): string {
  return `browser:${claims.userId}:${sessionId ?? "list"}:${claims.deviceSessionId}`;
}

function hasReplayFailed(request: FastifyRequest): boolean {
  return getHeaderValue(request, REPLAY_FAILED_HEADER) != null;
}

function extractReplaySource(request: FastifyRequest): string | undefined {
  return getHeaderValue(request, REPLAY_SOURCE_HEADER);
}

function hasReplayAttempt(request: FastifyRequest): boolean {
  return hasReplayFailed(request) || extractReplaySource(request) != null;
}

function extractReplayStateFromSource(
  replaySource: string | undefined,
): string | undefined {
  if (!replaySource) {
    return undefined;
  }

  const match = replaySource.match(/(?:^|[;, ])state=([^;,\s]+)/);
  return match?.[1] ?? undefined;
}

function logReplayBranch(
  request: FastifyRequest,
  input: {
    event: string;
    resolution: OwnerResolution;
    replayState: string;
  },
): void {
  const replaySource = extractReplaySource(request) ?? null;
  const replayFailed = hasReplayFailed(request);
  const replayState =
    extractReplayStateFromSource(replaySource ?? undefined) ?? input.replayState;
  if (input.event === "browser_replay_failed") {
    recordReplayFailure({
      event: input.event,
      ownerMachineId: input.resolution.ownerMachineId ?? "unknown",
      ownerRegion: input.resolution.ownerRegion ?? "unknown",
      replayState,
      replaySource,
      replayFailed,
    });
  }

  request.log.info({
    event: input.event,
    ownerMachineId: input.resolution.ownerMachineId ?? "unknown",
    ownerRegion: input.resolution.ownerRegion ?? "unknown",
    replayState,
    replaySource,
    replayFailed,
  });
}

function sendOwnerUnavailable(
  reply: FastifyReply,
  resolution: OwnerResolution,
): FastifyReply {
  const ownerMachineId = resolution.ownerMachineId ?? "unknown";
  const ownerRegion = resolution.ownerRegion ?? "unknown";
  reply.header(OWNER_MACHINE_HEADER, ownerMachineId);
  reply.header(OWNER_REGION_HEADER, ownerRegion);
  return reply.code(503).send({
    error: "owner_unavailable",
    ownerMachineId,
    ownerRegion,
  });
}

function createBrowserTicketVerifier(app: FastifyInstance) {
  const wsTicketSecret = new TextEncoder().encode(
    process.env.WS_TICKET_SECRET ?? "dev-ws-ticket-secret-change-me",
  );

  const usedJtis = new Map<string, number>();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [jti, expiry] of usedJtis) {
      if (expiry < now) {
        usedJtis.delete(jti);
      }
    }
  }, 5 * 60 * 1000);

  app.addHook("onClose", () => clearInterval(cleanupInterval));

  return async function authenticateBrowserTicket(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const isWebSocketRoute = request.url.startsWith("/ws/browser");
    const ticket = isWebSocketRoute
      ? extractProtocolTicket(request) ?? extractBearerTicket(request)
      : extractBearerTicket(request);

    if (!ticket) {
      reply.code(401).send({ error: "missing ws-ticket" });
      return;
    }

    try {
      const claims = await verifyWsTicket({ ticket, secret: wsTicketSecret });

      if (usedJtis.has(claims.jti)) {
        reply.code(401).send({ error: "ws-ticket already used" });
        return;
      }

      usedJtis.set(claims.jti, claims.exp * 1000);
      (request as FastifyRequest & { _wsTicketClaims?: typeof claims })._wsTicketClaims =
        claims;
    } catch {
      reply.code(401).send({ error: "invalid ws-ticket" });
    }
  };
}

async function validateBrowserDeviceSession(input: {
  userId: string;
  deviceSessionId: string;
}): Promise<void> {
  const deviceSession = await findDeviceSessionForPrincipal({
    deviceSessionId: input.deviceSessionId,
    userId: input.userId,
  });

  if (!deviceSession) {
    throw new Error("device_session_required");
  }

  if (deviceSession.userId !== input.userId) {
    throw new Error("user_mismatch");
  }

  if (deviceSession.revokedAt) {
    throw new Error("device_session_revoked");
  }

  if (deviceSession.expiresAt.getTime() <= Date.now()) {
    throw new Error("device_session_expired");
  }
}

export async function registerBrowserWsRoutes(
  app: FastifyInstance,
): Promise<void> {
  const authenticateBrowserTicket = createBrowserTicketVerifier(app);
  const ensureBrowserWsOwnerIsLocal = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const claims = extractBrowserClaims(request);
    if (!claims) {
      return;
    }

    const sessionId = extractSessionId(request);
    if (!sessionId) {
      reply.code(400).send({ error: "missing_session_id" });
      return;
    }

    const replayState = buildReplayState(claims, sessionId);
    const resolution = requireLocalBridge(
      await ownershipService.resolveOwnerForUser(claims.userId),
      claims.userId,
    );
    if (
      hasReplayFailed(request) ||
      (hasReplayAttempt(request) && resolution.status === "bridge_owner_missing")
    ) {
      logReplayBranch(request, {
        event: "browser_replay_failed",
        resolution,
        replayState,
      });
      sendOwnerUnavailable(reply, resolution);
      return;
    }
    if (resolution.status === "owner_not_local") {
      logReplayBranch(request, {
        event: "browser_replay_requested",
        resolution,
        replayState,
      });
      sendFlyReplay(reply, {
        ownerMachineId: resolution.ownerMachineId ?? "unknown",
        state: replayState,
      });
      return;
    }

    (
      request as FastifyRequest & {
        _browserAttach?: { sessionId: string; ownerResolution: OwnerResolution };
      }
    )._browserAttach = { sessionId, ownerResolution: resolution };
  };

  app.get(
    "/ws/browser",
    {
      websocket: true,
      preValidation: [authenticateBrowserTicket, ensureBrowserWsOwnerIsLocal],
    },
    (socket, request) => {
      const claims = extractBrowserClaims(request);
      const attachContext = (
        request as FastifyRequest & {
          _browserAttach?: { sessionId: string; ownerResolution: OwnerResolution };
        }
      )._browserAttach;

      if (!claims) {
        socket.close(1008, "unauthorized");
        return;
      }

      const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
      const sessionId = attachContext?.sessionId ?? url.searchParams.get("sessionId");
      const cursorParam = url.searchParams.get("cursor");
      const cursor = cursorParam ? Number(cursorParam) : undefined;

      if (!sessionId) {
        socket.close(1008, "missing sessionId");
        return;
      }

      let browserId: string | null = null;
      let closed = false;
      let attached = false;

      socket.on("message", (data) => {
        if (!attached) {
          return;
        }

        void sessionRouter.handleBrowserMessage(
          claims.userId,
          sessionId,
          data.toString(),
          socket,
        );
      });

      socket.on("close", () => {
        closed = true;
        if (browserId) sessionRouter.unregisterBrowser(browserId);
      });

      socket.on("error", () => {
        closed = true;
        if (browserId) sessionRouter.unregisterBrowser(browserId);
      });

      void (async () => {
        try {
          await validateBrowserDeviceSession({
            userId: claims.userId,
            deviceSessionId: claims.deviceSessionId,
          });

          const ownerResolution = attachContext?.ownerResolution
            ? requireLocalBridge(attachContext.ownerResolution, claims.userId)
            : requireLocalBridge(
                await ownershipService.resolveOwnerForUser(claims.userId),
                claims.userId,
              );
          if (ownerResolution.status === "bridge_owner_missing") {
            socket.close(1013, "bridge_owner_missing");
            return;
          }

          const id = await sessionRouter.attachBrowser({
            userId: claims.userId,
            deviceSessionId: claims.deviceSessionId,
            sessionId,
            socket,
            cursor: Number.isFinite(cursor) ? cursor : undefined,
          });

          if (closed) {
            sessionRouter.unregisterBrowser(id);
            return;
          }

          browserId = id;
          attached = true;
        } catch (error) {
          socket.close(
            1008,
            error instanceof Error ? error.message : "attach failed",
          );
        }
      })();
    },
  );

  app.get(
    "/internal/browser/sessions",
    {
      preValidation: authenticateBrowserTicket,
    },
    async (request, reply) => {
      const claims = extractBrowserClaims(request);

      if (!claims) {
        return reply.code(401).send({ error: "missing ws-ticket" });
      }

      const replayState = buildReplayState(claims);
      const ownership = requireLocalBridge(
        await ownershipService.resolveOwnerForUser(claims.userId),
        claims.userId,
      );
      if (
        hasReplayFailed(request) ||
        (hasReplayAttempt(request) && ownership.status === "bridge_owner_missing")
      ) {
        logReplayBranch(request, {
          event: "browser_replay_failed",
          resolution: ownership,
          replayState,
        });
        return sendOwnerUnavailable(reply, ownership);
      }
      if (ownership.status === "owner_not_local") {
        logReplayBranch(request, {
          event: "browser_replay_requested",
          resolution: ownership,
          replayState,
        });
        return sendFlyReplay(reply, {
          ownerMachineId: ownership.ownerMachineId ?? "unknown",
          state: replayState,
        });
      }
      if (ownership.status === "bridge_owner_missing") {
        return reply.code(503).send({ error: "bridge_owner_missing" });
      }

      const body = SessionListResponseSchema.parse({
        sessions: await sessionRouter.listSessionsForUser(claims.userId),
      });

      return reply.send(body);
    },
  );

  app.post(
    "/internal/browser/sessions/:sessionId/command",
    {
      preValidation: authenticateBrowserTicket,
    },
    async (request, reply) => {
      const claims = extractBrowserClaims(request);
      const sessionId = (
        request as FastifyRequest & { params: { sessionId?: string } }
      ).params.sessionId;

      if (!claims) {
        return reply.code(401).send({ error: "missing ws-ticket" });
      }

      if (!sessionId) {
        return reply.code(400).send({ error: "missing_session_id" });
      }

      const replayState = buildReplayState(claims, sessionId);
      const ownership = requireLocalBridge(
        await resolveBrowserRouteOwnership({
          userId: claims.userId,
          sessionId,
        }),
        claims.userId,
      );
      if (
        hasReplayFailed(request) ||
        (hasReplayAttempt(request) && ownership.status === "bridge_owner_missing")
      ) {
        logReplayBranch(request, {
          event: "browser_replay_failed",
          resolution: ownership,
          replayState,
        });
        return sendOwnerUnavailable(reply, ownership);
      }
      if (ownership.status === "owner_not_local") {
        logReplayBranch(request, {
          event: "browser_replay_requested",
          resolution: ownership,
          replayState,
        });
        return sendFlyReplay(reply, {
          ownerMachineId: ownership.ownerMachineId ?? "unknown",
          state: replayState,
        });
      }
      if (ownership.status === "bridge_owner_missing") {
        return reply.code(503).send({ error: "bridge_owner_missing" });
      }

      const command = SessionCommandSchema.safeParse(request.body);
      if (!command.success) {
        return reply.code(400).send({ error: "invalid_command" });
      }

      const accepted = sessionRouter.forwardCommand(
        claims.userId,
        sessionId,
        command.data,
      );

      const body = SessionCommandResponseSchema.parse({
        accepted,
        via: accepted ? "relay" : "unavailable",
        sessionId,
      });

      return reply.code(accepted ? 202 : 503).send(body);
    },
  );

  app.post(
    "/internal/browser/devices/:deviceSessionId/revoke",
    {
      preValidation: authenticateBrowserTicket,
    },
    async (request, reply) => {
      const claims = (
        request as FastifyRequest & {
          _wsTicketClaims?: {
            userId: string;
          };
          params: { deviceSessionId?: string };
        }
      )._wsTicketClaims;
      const deviceSessionId = (
        request as FastifyRequest & { params: { deviceSessionId?: string } }
      ).params.deviceSessionId;

      if (!claims) {
        return reply.code(401).send({ error: "missing ws-ticket" });
      }

      if (!deviceSessionId) {
        return reply.code(400).send({ error: "missing_device_session_id" });
      }

      const closedConnections = sessionRouter.revokeDeviceSession(
        claims.userId,
        deviceSessionId,
      );

      return reply.send({
        status: "revoked",
        deviceSessionId,
        closedConnections,
      });
    },
  );
}
