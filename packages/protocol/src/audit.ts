import { z } from "zod";

export const AUDIT_EVENT_TYPES = {
  pairingCreated: "pairing.created",
  pairingRedeemed: "pairing.redeemed",
  pairingConfirmed: "pairing.confirmed",
  pairingExpired: "pairing.expired",
  pairingClaimed: "pairing.claimed",
  pairingConfirmFailed: "pairing.confirm_failed",
  approvalRequested: "approval.requested",
  approvalResponded: "approval.responded",
  deviceRevoked: "device.revoked",
  sessionReconnected: "session.reconnected",
  sessionDisconnected: "session.disconnected",
  wsTicketMinted: "ws_ticket.minted",
  wsTicketRejected: "ws_ticket.rejected",
} as const;

export const AuditEventTypeSchema = z.enum([
  AUDIT_EVENT_TYPES.pairingCreated,
  AUDIT_EVENT_TYPES.pairingRedeemed,
  AUDIT_EVENT_TYPES.pairingConfirmed,
  AUDIT_EVENT_TYPES.pairingExpired,
  AUDIT_EVENT_TYPES.pairingClaimed,
  AUDIT_EVENT_TYPES.pairingConfirmFailed,
  AUDIT_EVENT_TYPES.approvalRequested,
  AUDIT_EVENT_TYPES.approvalResponded,
  AUDIT_EVENT_TYPES.deviceRevoked,
  AUDIT_EVENT_TYPES.sessionReconnected,
  AUDIT_EVENT_TYPES.sessionDisconnected,
  AUDIT_EVENT_TYPES.wsTicketMinted,
  AUDIT_EVENT_TYPES.wsTicketRejected,
]);

export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;
