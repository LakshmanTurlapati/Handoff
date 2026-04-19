/**
 * Codex Mobile Phase 1 database schema.
 *
 * Tables:
 *   - users            application-level user identity
 *   - oauth_accounts   provider account linkage (GitHub OAuth for v1)
 *   - web_sessions     short-lived browser sessions (cm_web_session cookie)
 *   - device_sessions  7-day paired device trust records (cm_device_session)
 *   - pairing_sessions single-use pairing records bridging terminal and browser
 *   - audit_events     append-only audit trail for security-relevant actions
 *
 * Trust-boundary notes: see docs/adr/0001-phase-1-trust-boundary.md.
 *
 * These table names and columns are load-bearing for `packages/protocol` and
 * `packages/auth`. Rename carefully and keep in sync with the protocol
 * `PairingStatus` union in `@codex-mobile/protocol/pairing`.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 200 }),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  }),
);

export const oauth_accounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerAccountId: varchar("provider_account_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    providerAccountIdx: uniqueIndex("oauth_accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId,
    ),
    userIdx: index("oauth_accounts_user_idx").on(table.userId),
  }),
);

// ---------------------------------------------------------------------------
// Browser sessions (cm_web_session, 12-hour rolling window)
// ---------------------------------------------------------------------------

export const web_sessions = pgTable(
  "web_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cookieTokenHash: varchar("cookie_token_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
  },
  (table) => ({
    tokenIdx: uniqueIndex("web_sessions_token_idx").on(table.cookieTokenHash),
    userIdx: index("web_sessions_user_idx").on(table.userId),
  }),
);

// ---------------------------------------------------------------------------
// Device sessions (cm_device_session, 7-day absolute expiry)
// ---------------------------------------------------------------------------

export const device_sessions = pgTable(
  "device_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceLabel: varchar("device_label", { length: 120 }).notNull(),
    devicePublicId: varchar("device_public_id", { length: 64 }).notNull(),
    cookieTokenHash: varchar("cookie_token_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    issuedFromPairingId: uuid("issued_from_pairing_id"),
  },
  (table) => ({
    tokenIdx: uniqueIndex("device_sessions_token_idx").on(table.cookieTokenHash),
    devicePublicIdx: uniqueIndex("device_sessions_public_idx").on(
      table.devicePublicId,
    ),
    userIdx: index("device_sessions_user_idx").on(table.userId),
  }),
);

// ---------------------------------------------------------------------------
// Pairing sessions (single-use, terminal-confirmed)
// ---------------------------------------------------------------------------

/**
 * The `status` column uses the exact strings enumerated by
 * `PairingStatus` in `@codex-mobile/protocol/pairing`:
 *   pending | redeemed | confirmed | expired | cancelled
 *
 * Do not rename these values without updating the protocol union — routes,
 * bridge, and relay all depend on them.
 */
export const pairing_sessions = pgTable(
  "pairing_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    userCode: varchar("user_code", { length: 16 }).notNull(),
    verificationPhrase: varchar("verification_phrase", { length: 120 }),
    pairingTokenHash: varchar("pairing_token_hash", { length: 128 }).notNull(),
    deviceLabel: varchar("device_label", { length: 120 }),
    bridgeInstanceId: varchar("bridge_instance_id", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => ({
    userCodeIdx: uniqueIndex("pairing_sessions_user_code_idx").on(table.userCode),
    tokenIdx: uniqueIndex("pairing_sessions_token_idx").on(table.pairingTokenHash),
    statusIdx: index("pairing_sessions_status_idx").on(table.status),
  }),
);

// ---------------------------------------------------------------------------
// Bridge installations (durable local bridge bootstrap identity)
// ---------------------------------------------------------------------------

export const bridge_installations = pgTable(
  "bridge_installations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pairingId: uuid("pairing_id")
      .notNull()
      .references(() => pairing_sessions.id, { onDelete: "cascade" }),
    bridgeInstanceId: varchar("bridge_instance_id", { length: 120 }).notNull(),
    deviceLabel: varchar("device_label", { length: 120 }),
    installTokenHash: varchar("install_token_hash", { length: 128 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    pairingIdx: uniqueIndex("bridge_installations_pairing_idx").on(table.pairingId),
    tokenIdx: uniqueIndex("bridge_installations_token_idx").on(table.installTokenHash),
    userBridgeInstanceIdx: uniqueIndex("bridge_installations_user_bridge_instance_idx").on(
      table.userId,
      table.bridgeInstanceId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Thread handoffs (short-lived thread-bound launch descriptors)
// ---------------------------------------------------------------------------

export const thread_handoffs = pgTable(
  "thread_handoffs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 64 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bridgeInstallationId: uuid("bridge_installation_id")
      .notNull()
      .references(() => bridge_installations.id, { onDelete: "cascade" }),
    bridgeInstanceId: varchar("bridge_instance_id", { length: 120 }).notNull(),
    threadId: varchar("thread_id", { length: 200 }).notNull(),
    sessionId: varchar("session_id", { length: 200 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    publicIdIdx: uniqueIndex("thread_handoffs_public_id_idx").on(table.publicId),
    threadLookupIdx: index("thread_handoffs_thread_lookup_idx").on(
      table.userId,
      table.bridgeInstallationId,
      table.threadId,
      table.sessionId,
    ),
    expiresAtIdx: index("thread_handoffs_expires_at_idx").on(table.expiresAt),
  }),
);

// ---------------------------------------------------------------------------
// Relay bridge leases (multi-instance relay ownership)
// ---------------------------------------------------------------------------

export const relay_bridge_leases = pgTable(
  "relay_bridge_leases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The bridge ws-ticket subject may be either a browser device session id
    // or a bridge installation id depending on which actor is connecting.
    deviceSessionId: uuid("device_session_id").notNull(),
    bridgeInstanceId: varchar("bridge_instance_id", { length: 120 }).notNull(),
    relayMachineId: varchar("relay_machine_id", { length: 120 }).notNull(),
    relayRegion: varchar("relay_region", { length: 32 }).notNull(),
    attachedSessionId: varchar("attached_session_id", { length: 200 }),
    leaseVersion: integer("lease_version").notNull().default(1),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    replacedByLeaseId: uuid("replaced_by_lease_id"),
  },
  (table) => ({
    userIdx: uniqueIndex("relay_bridge_leases_user_idx").on(table.userId),
    attachedSessionIdx: index("relay_bridge_leases_attached_session_idx").on(
      table.attachedSessionId,
    ),
    relayMachineIdx: index("relay_bridge_leases_machine_idx").on(
      table.relayMachineId,
    ),
    expiresAtIdx: index("relay_bridge_leases_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export const audit_events = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    subject: varchar("subject", { length: 200 }),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    sequence: integer("sequence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index("audit_events_user_idx").on(table.userId),
    typeIdx: index("audit_events_type_idx").on(table.eventType),
    createdIdx: index("audit_events_created_idx").on(table.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Convenience row types
// ---------------------------------------------------------------------------

export type UserRow = typeof users.$inferSelect;
export type OAuthAccountRow = typeof oauth_accounts.$inferSelect;
export type WebSessionRow = typeof web_sessions.$inferSelect;
export type DeviceSessionRow = typeof device_sessions.$inferSelect;
export type PairingSessionRow = typeof pairing_sessions.$inferSelect;
export type BridgeInstallationRow = typeof bridge_installations.$inferSelect;
export type ThreadHandoffRow = typeof thread_handoffs.$inferSelect;
export type RelayBridgeLeaseRow = typeof relay_bridge_leases.$inferSelect;
export type AuditEventRow = typeof audit_events.$inferSelect;
