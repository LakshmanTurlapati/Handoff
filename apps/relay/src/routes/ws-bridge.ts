import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import websocket from "@fastify/websocket";
import { verifyWsTicket } from "@codex-mobile/auth/ws-ticket";
import { BridgeRegistry, type BridgeEntry } from "../bridge/bridge-registry.js";
import {
  BridgeRegisterParamsSchema,
  JsonRpcNotificationSchema,
} from "@codex-mobile/protocol";

const HEARTBEAT_INTERVAL_MS = 30_000;

// Shared bridge registry -- single instance for the relay process
export const bridgeRegistry = new BridgeRegistry();

export async function registerBridgeWsRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Register @fastify/websocket plugin
  await app.register(websocket);

  // ws-ticket secret from environment
  const wsTicketSecret = new TextEncoder().encode(
    process.env.WS_TICKET_SECRET ?? "dev-ws-ticket-secret-change-me",
  );

  // JTI store for single-use enforcement
  const usedJtis = new Map<string, number>();

  // Periodic cleanup of expired JTIs (every 5 minutes)
  const jtiCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [jti, expiry] of usedJtis) {
      if (expiry < now) usedJtis.delete(jti);
    }
  }, 5 * 60 * 1000);
  app.addHook("onClose", () => clearInterval(jtiCleanupInterval));

  // Bridge WebSocket upgrade route
  app.get("/ws/bridge", { websocket: true }, (socket, request) => {
    const claims = (request as any)._wsTicketClaims;
    if (!claims) {
      socket.close(1008, "unauthorized");
      return;
    }

    let bridgeInstanceId = "unknown";
    let isAlive = true;

    // Heartbeat ping/pong
    const heartbeat = setInterval(() => {
      if (!isAlive) {
        socket.terminate();
        return;
      }
      isAlive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);

    socket.on("pong", () => {
      isAlive = true;
    });

    socket.on("message", (data) => {
      try {
        const raw = data.toString();
        const parsed = JSON.parse(raw);

        // Handle bridge.register notification
        const notif = JsonRpcNotificationSchema.safeParse(parsed);
        if (notif.success && notif.data.method === "bridge.register") {
          const params = BridgeRegisterParamsSchema.safeParse(
            notif.data.params,
          );
          if (params.success) {
            bridgeInstanceId = params.data.bridgeInstanceId;
            const entry: BridgeEntry = {
              userId: claims.userId,
              deviceSessionId: claims.deviceSessionId,
              bridgeInstanceId,
              socket,
              connectedAt: new Date(),
            };
            bridgeRegistry.register(entry);
          }
        }

        // Other messages will be routed in Plan 02-03
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      bridgeRegistry.unregister(claims.userId);
    });

    socket.on("error", () => {
      clearInterval(heartbeat);
      bridgeRegistry.unregister(claims.userId);
    });
  });

  // preValidation hook for ws-ticket auth on /ws/bridge
  app.addHook(
    "preValidation",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.url.startsWith("/ws/bridge")) return;

      // Extract ticket from Authorization header or query param
      const authHeader = request.headers.authorization;
      let ticket: string | undefined;

      if (authHeader?.startsWith("Bearer ")) {
        ticket = authHeader.slice(7);
      } else {
        const url = new URL(
          request.url,
          `http://${request.headers.host ?? "localhost"}`,
        );
        ticket = url.searchParams.get("ticket") ?? undefined;
      }

      if (!ticket) {
        reply.code(401).send({ error: "missing ws-ticket" });
        return;
      }

      try {
        const claims = await verifyWsTicket({ ticket, secret: wsTicketSecret });

        // Enforce single-use via jti
        if (usedJtis.has(claims.jti)) {
          reply.code(401).send({ error: "ws-ticket already used" });
          return;
        }
        usedJtis.set(claims.jti, claims.exp * 1000);

        (request as any)._wsTicketClaims = claims;
      } catch {
        reply.code(401).send({ error: "invalid ws-ticket" });
        return;
      }
    },
  );
}
