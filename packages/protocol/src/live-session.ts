import { z } from "zod";

const IsoDateTimeSchema = z.string().datetime();

export const BrowserSessionStatusSchema = z.enum([
  "Live",
  "Waiting for bridge",
  "Ready to resume",
]);

export const BrowserSessionListItemSchema = z
  .object({
    sessionId: z.string().min(1),
    title: z.string().min(1),
    model: z.string().min(1),
    status: BrowserSessionStatusSchema,
    turnCount: z.number().int().nonnegative(),
    updatedAt: IsoDateTimeSchema,
    updatedLabel: z.string().min(1),
  })
  .strict();

export type BrowserSessionListItem = z.infer<typeof BrowserSessionListItemSchema>;

export const SessionListResponseSchema = z
  .object({
    sessions: z.array(BrowserSessionListItemSchema),
  })
  .strict();

export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const LiveSessionCursorSchema = z.number().int().nonnegative();
export type LiveSessionCursor = z.infer<typeof LiveSessionCursorSchema>;

export const SessionConnectResponseSchema = z
  .object({
    relayUrl: z.string().url(),
    ticket: z.string().min(1),
    expiresAt: IsoDateTimeSchema,
    sessionId: z.string().min(1),
    cursor: LiveSessionCursorSchema.optional(),
  })
  .strict();

export type SessionConnectResponse = z.infer<typeof SessionConnectResponseSchema>;

export const LiveCommandActionOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    variant: z.enum(["neutral", "accent", "destructive"]).optional(),
  })
  .strict();

export type LiveCommandActionOption = z.infer<typeof LiveCommandActionOptionSchema>;

export const LiveActivityStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

export const LiveActivityBaseSchema = z
  .object({
    activityId: z.string().min(1),
    turnId: z.string().min(1),
    title: z.string().min(1),
    preview: z.string().min(1),
    detail: z.string().optional(),
    status: LiveActivityStatusSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const AssistantActivitySchema = LiveActivityBaseSchema.extend({
  kind: z.literal("assistant"),
}).strict();

export const ToolActivitySchema = LiveActivityBaseSchema.extend({
  kind: z.literal("tool"),
}).strict();

export const CommandActivitySchema = LiveActivityBaseSchema.extend({
  kind: z.literal("command"),
  command: z.string().min(1),
}).strict();

export const ApprovalActivitySchema = LiveActivityBaseSchema.extend({
  kind: z.literal("approval"),
  requestId: z.union([z.string(), z.number()]),
  actions: z.array(LiveCommandActionOptionSchema).min(1),
}).strict();

export const SystemActivitySchema = LiveActivityBaseSchema.extend({
  kind: z.literal("system"),
}).strict();

export const ErrorActivitySchema = LiveActivityBaseSchema.extend({
  kind: z.literal("error"),
  code: z.string().min(1).optional(),
  actions: z.array(LiveCommandActionOptionSchema).optional(),
}).strict();

export const LiveActivitySchema = z.discriminatedUnion("kind", [
  AssistantActivitySchema,
  ToolActivitySchema,
  CommandActivitySchema,
  ApprovalActivitySchema,
  SystemActivitySchema,
  ErrorActivitySchema,
]);

export type LiveActivity = z.infer<typeof LiveActivitySchema>;

export const LiveTurnSchema = z
  .object({
    turnId: z.string().min(1),
    stateLabel: z.string().min(1),
    actorDetail: z.string().min(1),
    assistantPreview: z.string().min(1),
    activities: z.array(LiveActivitySchema),
    isLive: z.boolean(),
    collapsed: z.boolean(),
    hasReconnectMarker: z.boolean(),
  })
  .strict();

export type LiveTurn = z.infer<typeof LiveTurnSchema>;

const LiveSessionEventBaseSchema = z
  .object({
    sessionId: z.string().min(1),
    cursor: LiveSessionCursorSchema,
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

export const LiveSessionAttachedEventSchema = LiveSessionEventBaseSchema.extend({
  kind: z.literal("session.attached"),
}).strict();

export const LiveSessionHistoryEventSchema = LiveSessionEventBaseSchema.extend({
  kind: z.literal("session.history"),
  replayed: z.boolean().optional(),
  turns: z.array(LiveTurnSchema),
}).strict();

export const LiveSessionActivityEventSchema = LiveSessionEventBaseSchema.extend({
  kind: z.literal("activity.appended"),
  activity: LiveActivitySchema,
  stateLabel: z.string().optional(),
  actorDetail: z.string().optional(),
  isLive: z.boolean().optional(),
}).strict();

export const LiveSessionReconnectEventSchema = LiveSessionEventBaseSchema.extend({
  kind: z.literal("session.reconnected"),
  activity: LiveActivitySchema,
}).strict();

export const LiveSessionInterruptFinishedEventSchema = LiveSessionEventBaseSchema.extend(
  {
    kind: z.literal("interrupt.finished"),
    stateLabel: z.string().optional(),
    actorDetail: z.string().optional(),
  },
).strict();

export const LiveSessionEndedReasonSchema = z.enum([
  "device_session_revoked",
  "device_session_expired",
  "bridge_unavailable",
  "codex_process_exited",
  "detached",
]);

export type LiveSessionEndedReason = z.infer<typeof LiveSessionEndedReasonSchema>;

export const LiveSessionEndedEventSchema = LiveSessionEventBaseSchema.extend({
  kind: z.literal("session.ended"),
  reason: LiveSessionEndedReasonSchema,
}).strict();

export const LiveSessionErrorEventSchema = LiveSessionEventBaseSchema.extend({
  kind: z.literal("session.error"),
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
}).strict();

export const LiveSessionEventSchema = z.discriminatedUnion("kind", [
  LiveSessionAttachedEventSchema,
  LiveSessionHistoryEventSchema,
  LiveSessionActivityEventSchema,
  LiveSessionReconnectEventSchema,
  LiveSessionInterruptFinishedEventSchema,
  LiveSessionEndedEventSchema,
  LiveSessionErrorEventSchema,
]);

export type LiveSessionEvent = z.infer<typeof LiveSessionEventSchema>;

export const PromptSessionCommandSchema = z
  .object({
    kind: z.literal("prompt"),
    text: z.string().min(1),
    clientRequestId: z.string().min(1).optional(),
  })
  .strict();

export const SteerSessionCommandSchema = z
  .object({
    kind: z.literal("steer"),
    text: z.string().min(1),
    targetTurnId: z.string().min(1).optional(),
    mode: z.enum(["append", "replace"]).default("append"),
    clientRequestId: z.string().min(1).optional(),
  })
  .strict();

export const ApprovalDecisionSchema = z.enum(["approved", "denied", "abort"]);

export const ApprovalSessionCommandSchema = z
  .object({
    kind: z.literal("approval"),
    requestId: z.union([z.string(), z.number()]),
    decision: ApprovalDecisionSchema,
    clientRequestId: z.string().min(1).optional(),
  })
  .strict();

export const TurnInterruptParamsSchema = z
  .object({
    kind: z.literal("interrupt"),
    turnId: z.string().min(1).optional(),
    reason: z.literal("user_request").default("user_request"),
    clientRequestId: z.string().min(1).optional(),
  })
  .strict();

export type TurnInterruptParams = z.infer<typeof TurnInterruptParamsSchema>;

export const SessionCommandSchema = z.discriminatedUnion("kind", [
  PromptSessionCommandSchema,
  SteerSessionCommandSchema,
  ApprovalSessionCommandSchema,
  TurnInterruptParamsSchema,
]);

export type SessionCommand = z.infer<typeof SessionCommandSchema>;

export const SessionCommandResponseSchema = z
  .object({
    accepted: z.boolean(),
    via: z.enum(["relay", "unavailable"]),
    sessionId: z.string().min(1),
  })
  .strict();

export type SessionCommandResponse = z.infer<typeof SessionCommandResponseSchema>;
