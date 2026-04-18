import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyWsTicket } from "@codex-mobile/auth/ws-ticket";
import {
  SessionCommandSchema,
  SessionCommandResponseSchema,
  SessionListResponseSchema,
} from "@codex-mobile/protocol/live-session";
import { sessionRouter } from "../browser/session-router.js";

const BROWSER_PROTOCOL = "codex-mobile.live.v1";

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

export async function registerBrowserWsRoutes(
  app: FastifyInstance,
): Promise<void> {
  const authenticateBrowserTicket = createBrowserTicketVerifier(app);

  app.get(
    "/ws/browser",
    {
      websocket: true,
      preValidation: authenticateBrowserTicket,
    },
    (socket, request) => {
      const claims = (
        request as FastifyRequest & {
          _wsTicketClaims?: {
            userId: string;
            deviceSessionId: string;
          };
        }
      )._wsTicketClaims;

      if (!claims) {
        socket.close(1008, "unauthorized");
        return;
      }

      const url = new URL(
        request.url,
        `http://${request.headers.host ?? "localhost"}`,
      );
      const sessionId = url.searchParams.get("sessionId");
      const cursorParam = url.searchParams.get("cursor");
      const cursor = cursorParam ? Number(cursorParam) : undefined;

      if (!sessionId) {
        socket.close(1008, "missing sessionId");
        return;
      }

      let browserId: string | null = null;
      let closed = false;
      void sessionRouter
        .attachBrowser({
          userId: claims.userId,
          deviceSessionId: claims.deviceSessionId,
          sessionId,
          socket,
          cursor: Number.isFinite(cursor) ? cursor : undefined,
        })
        .then((id) => {
          if (closed) {
            sessionRouter.unregisterBrowser(id);
            return;
          }
          browserId = id;
        })
        .catch(() => {
          socket.close(1011, "attach failed");
        });

      socket.on("message", (data) => {
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
    },
  );

  app.get(
    "/internal/browser/sessions",
    {
      preValidation: authenticateBrowserTicket,
    },
    async (request, reply) => {
      const claims = (
        request as FastifyRequest & {
          _wsTicketClaims?: {
            userId: string;
          };
        }
      )._wsTicketClaims;

      if (!claims) {
        return reply.code(401).send({ error: "missing ws-ticket" });
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
      const claims = (
        request as FastifyRequest & {
          _wsTicketClaims?: {
            userId: string;
          };
          body: unknown;
          params: { sessionId?: string };
        }
      )._wsTicketClaims;
      const sessionId = (
        request as FastifyRequest & { params: { sessionId?: string } }
      ).params.sessionId;

      if (!claims) {
        return reply.code(401).send({ error: "missing ws-ticket" });
      }

      if (!sessionId) {
        return reply.code(400).send({ error: "missing_session_id" });
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
