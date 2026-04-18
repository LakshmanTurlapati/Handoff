"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BrowserSessionListItem } from "@codex-mobile/protocol/live-session";

export interface DeviceManagementDevice {
  id: string;
  deviceLabel: string;
  devicePublicId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

interface DeviceManagementListProps {
  section: "devices" | "sessions";
  devices: DeviceManagementDevice[];
  activeSessions: BrowserSessionListItem[];
  currentDeviceSessionId: string;
}

function formatDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DeviceManagementList({
  section,
  devices,
  activeSessions,
  currentDeviceSessionId,
}: DeviceManagementListProps) {
  const router = useRouter();
  const [pendingDeviceSessionId, setPendingDeviceSessionId] = useState<string | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const revokeDevice = (deviceSessionId: string) => {
    setErrorMessage(null);
    setPendingDeviceSessionId(deviceSessionId);

    void (async () => {
      try {
        const response = await fetch(
          `/api/devices/${encodeURIComponent(deviceSessionId)}/revoke`,
          {
            method: "POST",
          },
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? "device_revoke_failed");
        }

        router.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "device_revoke_failed";
        setErrorMessage(message.replaceAll("_", " "));
      } finally {
        setPendingDeviceSessionId(null);
      }
    })();
  };

  if (section === "sessions") {
    if (activeSessions.length === 0) {
      return (
        <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
          No active remote sessions are attached to this paired device right now.
        </p>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {activeSessions.map((session) => (
          <article
            key={session.sessionId}
            style={{
              borderRadius: "20px",
              border: "1px solid #D7CEC0",
              background: "#F6F3ED",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "20px", lineHeight: 1.2, fontWeight: 600 }}>
                  {session.title}
                </span>
                <span style={{ fontSize: "14px", lineHeight: 1.35, color: "#635541" }}>
                  Updated {session.updatedLabel}
                </span>
              </div>
              <span
                style={{
                  border: "1px solid #0F766E",
                  color: "#0F766E",
                  borderRadius: "999px",
                  padding: "4px 8px",
                  fontSize: "14px",
                  lineHeight: 1.35,
                  fontWeight: 600,
                }}
              >
                {session.status}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                fontSize: "16px",
                lineHeight: 1.5,
                color: "#3F372B",
              }}
            >
              <span>{session.model}</span>
              <span aria-hidden="true">•</span>
              <span>{session.turnCount} turns</span>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {devices.length === 0 ? (
        <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
          No paired devices have been claimed for this account yet.
        </p>
      ) : null}

      {devices.map((device) => {
        const isCurrentDevice = device.id === currentDeviceSessionId;
        const isRevoked = device.revokedAt !== null;
        const isSubmitting = pendingDeviceSessionId === device.id;

        return (
          <article
            key={device.id}
            style={{
              borderRadius: "20px",
              border: "1px solid #D7CEC0",
              background: "#F6F3ED",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "20px", lineHeight: 1.2, fontWeight: 600 }}>
                  {device.deviceLabel}
                </span>
                <span style={{ fontSize: "14px", lineHeight: 1.35, color: "#635541" }}>
                  Device ID {device.devicePublicId}
                </span>
              </div>

              <span
                style={{
                  border: `1px solid ${isRevoked ? "#B93815" : "#0F766E"}`,
                  color: isRevoked ? "#B93815" : "#0F766E",
                  borderRadius: "999px",
                  padding: "4px 8px",
                  fontSize: "14px",
                  lineHeight: 1.35,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {isRevoked ? "Revoked" : isCurrentDevice ? "This phone" : "Paired"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))",
                gap: "12px",
                fontSize: "16px",
                lineHeight: 1.5,
                color: "#3F372B",
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.35, color: "#635541" }}>
                  Last seen
                </p>
                <p style={{ margin: 0 }}>{formatDateLabel(device.lastSeenAt)}</p>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.35, color: "#635541" }}>
                  Expires
                </p>
                <p style={{ margin: 0 }}>{formatDateLabel(device.expiresAt)}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => revokeDevice(device.id)}
              disabled={isRevoked || isSubmitting}
              style={{
                minHeight: "44px",
                borderRadius: "16px",
                border: "1px solid #B93815",
                background: isRevoked ? "#F2DDD7" : "#B93815",
                color: isRevoked ? "#8E3116" : "#FFF8F4",
                fontSize: "16px",
                lineHeight: 1.5,
                fontWeight: 600,
                cursor: isRevoked ? "not-allowed" : "pointer",
                opacity: isSubmitting ? 0.75 : 1,
              }}
            >
              {isSubmitting ? "Revoking..." : "Revoke device"}
            </button>
          </article>
        );
      })}

      {errorMessage ? (
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.35, color: "#B93815" }}>
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
