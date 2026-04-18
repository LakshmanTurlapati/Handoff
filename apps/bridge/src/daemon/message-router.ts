import {
  ApprovalRespondParamsSchema,
  JSON_RPC_ERRORS,
  JsonRpcMessageSchema,
  SessionAttachParamsSchema,
  SessionListResultSchema,
  SessionDetachParamsSchema,
  TurnInterruptRequestParamsSchema,
  TurnSendParamsSchema,
  TurnSteerParamsSchema,
  type ApprovalRespondParams,
  type SessionAttachParams,
  type SessionDetachParams,
  type SessionListResult,
  type TurnInterruptRequestParams,
  type TurnSendParams,
  type TurnSteerParams,
} from "@codex-mobile/protocol";
import { createErrorResponse, createResponse } from "../lib/jsonrpc.js";

interface BridgeMessageSender {
  send(message: object): boolean;
}

export interface BridgeMessageRouterHandlers {
  approvalRespond(params: ApprovalRespondParams): Promise<void>;
  attachSession(params: SessionAttachParams): Promise<void>;
  detachSession(params: SessionDetachParams): Promise<void>;
  interruptTurn(params: TurnInterruptRequestParams): Promise<void>;
  listSessions(): Promise<SessionListResult>;
  sendTurn(params: TurnSendParams): Promise<void>;
  steerTurn(params: TurnSteerParams): Promise<void>;
}

export class BridgeRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }
}

function toBridgeRpcError(error: unknown): BridgeRpcError {
  if (error instanceof BridgeRpcError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "session_not_found":
      return new BridgeRpcError(JSON_RPC_ERRORS.SESSION_NOT_FOUND, message);
    case "session_already_attached":
      return new BridgeRpcError(JSON_RPC_ERRORS.SESSION_ALREADY_ATTACHED, message);
    case "session_not_attached":
    case "turn_not_active":
      return new BridgeRpcError(JSON_RPC_ERRORS.SESSION_NOT_ATTACHED, message);
    case "bridge_not_ready":
      return new BridgeRpcError(JSON_RPC_ERRORS.BRIDGE_NOT_READY, message);
    default:
      return new BridgeRpcError(JSON_RPC_ERRORS.INTERNAL_ERROR, message);
  }
}

export class BridgeMessageRouter {
  constructor(
    private readonly sender: BridgeMessageSender,
    private readonly handlers: BridgeMessageRouterHandlers,
  ) {}

  async routeMessage(rawMessage: string): Promise<void> {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawMessage);
    } catch {
      this.sender.send(
        createErrorResponse(
          null,
          JSON_RPC_ERRORS.PARSE_ERROR,
          "bridge_request_parse_error",
        ),
      );
      return;
    }

    const message = JsonRpcMessageSchema.safeParse(parsedJson);
    if (!message.success) {
      this.sender.send(
        createErrorResponse(
          null,
          JSON_RPC_ERRORS.INVALID_REQUEST,
          "bridge_request_invalid",
        ),
      );
      return;
    }

    const payload = message.data;
    if (!("id" in payload) || !("method" in payload)) {
      return;
    }

    try {
      switch (payload.method) {
        case "session.list": {
          const result = SessionListResultSchema.parse(
            await this.handlers.listSessions(),
          );
          this.sender.send(createResponse(payload.id, result));
          return;
        }
        case "session.attach": {
          const params = SessionAttachParamsSchema.parse(payload.params);
          await this.handlers.attachSession(params);
          this.sender.send(createResponse(payload.id, { ok: true }));
          return;
        }
        case "session.detach": {
          const params = SessionDetachParamsSchema.parse(payload.params);
          await this.handlers.detachSession(params);
          this.sender.send(createResponse(payload.id, { ok: true }));
          return;
        }
        case "turn.send": {
          const params = TurnSendParamsSchema.parse(payload.params);
          await this.handlers.sendTurn(params);
          this.sender.send(createResponse(payload.id, { ok: true }));
          return;
        }
        case "turn.steer": {
          const params = TurnSteerParamsSchema.parse(payload.params);
          await this.handlers.steerTurn(params);
          this.sender.send(createResponse(payload.id, { ok: true }));
          return;
        }
        case "approval.respond": {
          const params = ApprovalRespondParamsSchema.parse(payload.params);
          await this.handlers.approvalRespond(params);
          this.sender.send(createResponse(payload.id, { ok: true }));
          return;
        }
        case "turn.interrupt": {
          const params = TurnInterruptRequestParamsSchema.parse(payload.params);
          await this.handlers.interruptTurn(params);
          this.sender.send(createResponse(payload.id, { ok: true }));
          return;
        }
        default:
          throw new BridgeRpcError(
            JSON_RPC_ERRORS.METHOD_NOT_FOUND,
            "bridge_method_not_found",
            { method: payload.method },
          );
      }
    } catch (error) {
      const rpcError = toBridgeRpcError(error);
      this.sender.send(
        createErrorResponse(
          payload.id,
          rpcError.code,
          rpcError.message,
          rpcError.data,
        ),
      );
    }
  }
}
