import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listAuditEventsForUser,
  listDeviceSessionsForUser,
} from "@codex-mobile/db";
import {
  SessionListResponseSchema,
  type BrowserSessionListItem,
} from "@codex-mobile/protocol/live-session";
import {
  AuditFeed,
  type AuditFeedItem,
} from "../../components/device/audit-feed";
import {
  DeviceManagementList,
  type DeviceManagementDevice,
} from "../../components/device/device-management-list";
import {
  relayInternalFetch,
  requireRemotePrincipal,
} from "../../lib/live-session/server";

export const dynamic = "force-dynamic";

async function loadDeviceManagementState(): Promise<{
  currentDeviceSessionId: string;
  devices: DeviceManagementDevice[];
  activeSessions: BrowserSessionListItem[];
  auditEvents: AuditFeedItem[];
}> {
  const principal = await requireRemotePrincipal();
  const devices = await listDeviceSessionsForUser(principal.userId);
  const auditEvents = await listAuditEventsForUser({
    userId: principal.userId,
    limit: 25,
  });
  const relayResponse = await relayInternalFetch(
    "/internal/browser/sessions",
    principal,
    { method: "GET" },
  );

  let activeSessions: BrowserSessionListItem[] = [];
  if (relayResponse.ok) {
    const parsed = SessionListResponseSchema.safeParse(await relayResponse.json());
    if (parsed.success) {
      activeSessions = parsed.data.sessions;
    }
  }

  return {
    currentDeviceSessionId: principal.deviceSessionId,
    devices: devices.map((device) => ({
      id: device.id,
      deviceLabel: device.deviceLabel,
      devicePublicId: device.devicePublicId,
      createdAt: device.createdAt.toISOString(),
      expiresAt: device.expiresAt.toISOString(),
      lastSeenAt: device.lastSeenAt.toISOString(),
      revokedAt: device.revokedAt?.toISOString() ?? null,
    })),
    activeSessions,
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      subject: event.subject,
      outcome: event.outcome,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export default async function DevicesPage() {
  try {
    const { currentDeviceSessionId, devices, activeSessions, auditEvents } =
      await loadDeviceManagementState();

    return (
      <main
        style={{
          minHeight: "100dvh",
          background: "#F6F3ED",
          color: "#1F1A14",
          padding: "24px 24px 48px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "480px",
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <header style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Link
              href="/"
              style={{
                width: "fit-content",
                color: "#635541",
                fontSize: "14px",
                lineHeight: 1.35,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back to sessions
            </Link>
            <span
              style={{
                fontSize: "14px",
                lineHeight: 1.35,
                fontWeight: 600,
                color: "#635541",
              }}
            >
              Device safety
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: "28px",
                lineHeight: 1.1,
                fontWeight: 600,
              }}
            >
              Paired access stays explicit
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "16px",
                lineHeight: 1.5,
                color: "#4B4032",
              }}
            >
              Review the phones tied to this Codex account and cut off any device
              that should no longer control your local session.
            </p>
          </header>

          <section
            style={{
              borderRadius: "24px",
              background: "#E4DED4",
              border: "1px solid #D7CEC0",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "20px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                }}
              >
                Paired devices
              </h2>
              <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
                Device sessions expire after seven days unless you revoke them sooner.
              </p>
            </div>

            <DeviceManagementList
              section="devices"
              devices={devices}
              activeSessions={activeSessions}
              currentDeviceSessionId={currentDeviceSessionId}
            />
          </section>

          <section
            style={{
              borderRadius: "24px",
              background: "#E4DED4",
              border: "1px solid #D7CEC0",
              padding: "24px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: "20px",
                  lineHeight: 1.2,
                  fontWeight: 600,
                }}
              >
                Active remote sessions
              </h2>
              <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
                Live sessions remain scoped to this paired device and stop once access is revoked.
              </p>
            </div>

            <DeviceManagementList
              section="sessions"
              devices={devices}
              activeSessions={activeSessions}
              currentDeviceSessionId={currentDeviceSessionId}
            />
          </section>

          <AuditFeed events={auditEvents} />
        </div>
      </main>
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";

    if (message === "unauthenticated") {
      redirect("/sign-in?callbackUrl=/devices");
    }

    if (
      message === "device_session_required" ||
      message === "device_session_expired" ||
      message === "device_session_revoked" ||
      message === "user_mismatch"
    ) {
      redirect("/");
    }

    throw error;
  }
}
