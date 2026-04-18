import { z } from "zod";
import type {
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  JsonRpcError,
} from "@codex-mobile/protocol";

let _nextId = 1;

export function resetIdCounter(): void {
  _nextId = 1;
}

export function createRequest(
  method: string,
  params?: unknown,
): { jsonrpc: "2.0"; method: string; id: number; params?: unknown } {
  const msg: any = { jsonrpc: "2.0" as const, method, id: _nextId++ };
  if (params !== undefined) msg.params = params;
  return msg;
}

export function createNotification(
  method: string,
  params?: unknown,
): { jsonrpc: "2.0"; method: string; params?: unknown } {
  const msg: any = { jsonrpc: "2.0" as const, method };
  if (params !== undefined) msg.params = params;
  return msg;
}

export function createResponse(
  id: string | number,
  result: unknown,
): { jsonrpc: "2.0"; id: string | number; result: unknown } {
  return { jsonrpc: "2.0" as const, id, result };
}

export function createErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): object {
  const error: any = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0" as const, id, error };
}

export function parseMessage(
  raw: string,
):
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse
  | JsonRpcError
  | null {
  try {
    const parsed = JSON.parse(raw);

    const reqResult = z
      .object({
        jsonrpc: z.literal("2.0"),
        method: z.string(),
        id: z.union([z.string(), z.number()]),
      })
      .safeParse(parsed);
    if (reqResult.success) return reqResult.data as JsonRpcRequest;

    const notifResult = z
      .object({
        jsonrpc: z.literal("2.0"),
        method: z.string(),
      })
      .safeParse(parsed);
    if (notifResult.success) return notifResult.data as JsonRpcNotification;

    const respResult = z
      .object({
        jsonrpc: z.literal("2.0"),
        id: z.union([z.string(), z.number(), z.null()]),
      })
      .safeParse(parsed);
    if (respResult.success) return respResult.data as JsonRpcResponse;

    return null;
  } catch {
    return null;
  }
}
