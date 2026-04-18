import { z } from "zod";

/** Base JSON-RPC 2.0 schemas (bridge-relay channel) */
export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.string().min(1),
    id: z.union([z.string(), z.number()]),
    params: z.unknown().optional(),
  })
  .strict();

export const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export const JsonRpcErrorSchema = z
  .object({
    code: z.number().int(),
    message: z.string().min(1),
    data: z.unknown().optional(),
  })
  .strict();

export const JsonRpcResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]),
    result: z.unknown().optional(),
    error: JsonRpcErrorSchema.optional(),
  })
  .strict();

export const JsonRpcMessageSchema = z.union([
  JsonRpcRequestSchema,
  JsonRpcNotificationSchema,
  JsonRpcResponseSchema,
]);

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;
export type JsonRpcError = z.infer<typeof JsonRpcErrorSchema>;
export type JsonRpcResponse = z.infer<typeof JsonRpcResponseSchema>;
export type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

/** Session metadata exchanged between bridge and relay (D-09) */
export const SessionMetadataSchema = z
  .object({
    sessionId: z.string().min(1),
    threadTitle: z.string().nullable(),
    model: z.string().min(1),
    startedAt: z.string().nullable(),
    status: z.enum(["idle", "active", "notLoaded"]),
    turnCount: z.number().int().nonnegative(),
  })
  .strict();

export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

/** bridge.register notification (bridge -> relay after connect) */
export const BridgeRegisterParamsSchema = z
  .object({
    bridgeVersion: z.string().min(1),
    bridgeInstanceId: z.string().min(1),
  })
  .strict();

export type BridgeRegisterParams = z.infer<typeof BridgeRegisterParamsSchema>;

/** session.list result */
export const SessionListResultSchema = z
  .object({
    sessions: z.array(SessionMetadataSchema),
  })
  .strict();

export type SessionListResult = z.infer<typeof SessionListResultSchema>;

/** session.attach request (relay -> bridge) */
export const SessionAttachParamsSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export type SessionAttachParams = z.infer<typeof SessionAttachParamsSchema>;

/** session.detach request (relay -> bridge) */
export const SessionDetachParamsSchema = z
  .object({
    sessionId: z.string().min(1),
  })
  .strict();

export type SessionDetachParams = z.infer<typeof SessionDetachParamsSchema>;

/** session.history batch notification (bridge -> relay) */
export const SessionHistoryParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    turns: z.array(z.unknown()),
  })
  .strict();

export type SessionHistoryParams = z.infer<typeof SessionHistoryParamsSchema>;

/** session.event notification (bridge -> relay) */
export const SessionEventParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    eventType: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

export type SessionEventParams = z.infer<typeof SessionEventParamsSchema>;

/** session.ended notification (bridge -> relay) */
export const SessionEndedParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();

export type SessionEndedParams = z.infer<typeof SessionEndedParamsSchema>;

/** turn.send request (relay -> bridge) */
export const TurnSendParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    userMessage: z.string().min(1),
  })
  .strict();

export type TurnSendParams = z.infer<typeof TurnSendParamsSchema>;

/** approval.respond request (relay -> bridge) */
export const ApprovalRespondParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    requestId: z.union([z.string(), z.number()]),
    decision: z.enum(["approved", "denied", "abort"]),
  })
  .strict();

export type ApprovalRespondParams = z.infer<typeof ApprovalRespondParamsSchema>;

/** Standard JSON-RPC error codes used by bridge and relay */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Application-specific
  SESSION_NOT_FOUND: -32001,
  SESSION_ALREADY_ATTACHED: -32002,
  SESSION_NOT_ATTACHED: -32003,
  BRIDGE_NOT_READY: -32004,
} as const;

export type JsonRpcErrorCode = (typeof JSON_RPC_ERRORS)[keyof typeof JSON_RPC_ERRORS];
