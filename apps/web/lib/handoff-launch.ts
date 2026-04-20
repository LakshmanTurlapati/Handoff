import {
  appendAuditEvent,
  createDeviceSessionRecord,
  findBridgeInstallationById,
  findBridgeInstallationForDeviceSession,
  findDeviceSessionForPrincipal,
  findThreadHandoffByPublicId,
  revokeThreadHandoff,
  touchBridgeInstallationLastUsed,
} from "@codex-mobile/db";
import { AUDIT_EVENT_TYPES } from "@codex-mobile/protocol";
import {
  hashCookieToken,
  issueDeviceSession,
  readDeviceSession,
  readRawDeviceSessionToken,
} from "./device-session";

export interface ClaimHandoffLaunchResult {
  sessionId: string;
  reusedDeviceSession: boolean;
}

function isTerminalDeviceSessionState(input: {
  revokedAt: Date | null;
  expiresAt: Date;
}): boolean {
  return Boolean(input.revokedAt) || input.expiresAt.getTime() <= Date.now();
}

export async function claimHandoffLaunch(input: {
  publicId: string;
  userAgent?: string;
}): Promise<ClaimHandoffLaunchResult> {
  const handoff = await findThreadHandoffByPublicId({
    publicId: input.publicId,
  });
  if (!handoff) {
    throw new Error("handoff_not_found");
  }

  const now = Date.now();
  if (handoff.revokedAt) {
    throw new Error("handoff_revoked");
  }
  if (handoff.expiresAt.getTime() <= now) {
    throw new Error("handoff_expired");
  }

  const installation = await findBridgeInstallationById({
    bridgeInstallationId: handoff.bridgeInstallationId,
  });
  if (!installation || installation.revokedAt) {
    throw new Error("handoff_not_authorized");
  }

  const rawDeviceSessionToken = await readRawDeviceSessionToken();
  const currentDeviceSession = rawDeviceSessionToken
    ? await readDeviceSession()
    : null;

  if (rawDeviceSessionToken && currentDeviceSession) {
    const currentRow = await findDeviceSessionForPrincipal({
      deviceSessionId: currentDeviceSession.deviceSessionId,
      cookieTokenHash: hashCookieToken(rawDeviceSessionToken),
    });

    if (currentRow && !isTerminalDeviceSessionState(currentRow)) {
      const currentInstallation = await findBridgeInstallationForDeviceSession({
        deviceSessionId: currentRow.id,
      });

      if (currentInstallation?.id === installation.id) {
        await touchBridgeInstallationLastUsed({
          bridgeInstallationId: installation.id,
        });
        await revokeThreadHandoff({ publicId: input.publicId });

        return {
          sessionId: handoff.sessionId,
          reusedDeviceSession: true,
        };
      }
    }
  }

  const deviceSession = await issueDeviceSession({
    userId: installation.userId,
    deviceLabel: installation.deviceLabel ?? "Handoff phone",
  });

  await createDeviceSessionRecord({
    id: deviceSession.deviceSessionId,
    userId: installation.userId,
    deviceLabel: deviceSession.deviceLabel,
    devicePublicId: deviceSession.devicePublicId,
    cookieTokenHash: deviceSession.cookieTokenHash,
    expiresAt: deviceSession.expiresAt,
    issuedFromPairingId: installation.pairingId,
  });

  await appendAuditEvent({
    userId: installation.userId,
    eventType: AUDIT_EVENT_TYPES.pairingClaimed,
    subject: handoff.sessionId,
    outcome: "success",
    metadata: {
      source: "handoff.launch",
      handoffPublicId: input.publicId,
      bridgeInstallationId: installation.id,
      threadId: handoff.threadId,
      deviceSessionId: deviceSession.deviceSessionId,
      reusedDeviceSession: false,
    },
    userAgent: input.userAgent ?? null,
  });

  await touchBridgeInstallationLastUsed({
    bridgeInstallationId: installation.id,
  });
  await revokeThreadHandoff({ publicId: input.publicId });

  return {
    sessionId: handoff.sessionId,
    reusedDeviceSession: false,
  };
}
