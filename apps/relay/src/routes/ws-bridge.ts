import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyWsTicket } from "@codex-mobile/auth/ws-ticket";
import {
  markBridgeLeaseDisconnected,
  refreshBridgeLease,
  upsertBridgeLease,
} from "@codex-mobile/db";
import { bridgeRegistry, type BridgeEntry } from "../bridge/bridge-registry.js";
import {
  BridgeRegisterParamsSchema,
  JsonRpcNotificationSchema,
} from "@codex-mobile/protocol";
import { sessionRouter } from "../browser/session-router.js";
import { getRelayInstanceIdentity } from "../ownership/relay-instance.js";

const HEARTBEAT_INTERVAL_MS = 30_000;
const BRIDGE_LEASE_TTL_MS = 90_000;

export async function registerBridgeWsRoutes(
  app: FastifyInstance,
): Promise<void> {
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

    const relayInstance = getRelayInstanceIdentity();
    let bridgeInstanceId = "unknown";
    let isAlive = true;
    let bridgeClosed = false;

    const handleBridgeDisconnect = async () => {
      if (bridgeClosed) {
        return;
      }

      bridgeClosed = true;
      clearInterval(heartbeat);
      if (bridgeInstanceId !== "unknown") {
        await markBridgeLeaseDisconnected({
          userId: claims.userId,
          bridgeInstanceId,
        });
      }
      void sessionRouter.handleBridgeUnavailable(claims.userId);
      bridgeRegistry.unregister(claims.userId);
    };

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
      if (bridgeInstanceId === "unknown") {
        return;
      }

      void refreshBridgeLease({
        userId: claims.userId,
        bridgeInstanceId,
        expiresAt: new Date(Date.now() + BRIDGE_LEASE_TTL_MS),
      });
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
              relayMachineId: relayInstance.machineId,
              socket,
              connectedAt: new Date(),
            };
            bridgeRegistry.register(entry);
            void upsertBridgeLease({
              userId: claims.userId,
              deviceSessionId: claims.deviceSessionId,
              bridgeInstanceId,
              relayMachineId: relayInstance.machineId,
              relayRegion: relayInstance.region,
              expiresAt: new Date(Date.now() + BRIDGE_LEASE_TTL_MS),
              leaseVersion: 1,
            });
          }
        }

        void sessionRouter.handleBridgeMessage(claims.userId, raw);
      } catch {
        // Ignore malformed messages
      }
    });

    socket.on("close", () => {
      void handleBridgeDisconnect();
    });

    socket.on("error", () => {
      void handleBridgeDisconnect();
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
