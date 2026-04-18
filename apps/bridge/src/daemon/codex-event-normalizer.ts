import type {
  LiveActivity,
  LiveCommandActionOption,
  LiveSessionEvent,
  LiveTurn,
  SessionHistoryParams,
} from "@codex-mobile/protocol";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function readArray(record: Record<string, unknown>, key: string): unknown[] {
  return Array.isArray(record[key]) ? (record[key] as unknown[]) : [];
}

function toOccurredAt(
  params: Record<string, unknown> | null,
  fallback?: string,
): string {
  return (
    (params ? readString(params, "timestamp", "updatedAt", "occurredAt") : null) ??
    fallback ??
    new Date().toISOString()
  );
}

function toDecisionActionOption(
  decision: string,
): LiveCommandActionOption | null {
  switch (decision) {
    case "approved":
      return { id: "approve", label: "Approve", variant: "accent" };
    case "denied":
      return { id: "deny", label: "Deny" };
    case "abort":
      return { id: "abort", label: "Abort", variant: "destructive" };
    default:
      return null;
  }
}

function createActivityBase(
  kind: LiveActivity["kind"],
  turnId: string,
  suffix: string,
  preview: string,
  occurredAt: string,
): Omit<LiveActivity, "kind"> {
  return {
    activityId: `${turnId}-${suffix}`,
    turnId,
    title:
      kind === "assistant"
        ? "Assistant update"
        : kind === "command"
          ? "Command execution"
          : kind === "approval"
            ? "Waiting for approval"
            : kind === "error"
              ? "Bridge error"
              : "System update",
    preview,
    status:
      kind === "approval" ? "pending" : kind === "error" ? "failed" : "running",
    createdAt: occurredAt,
  };
}

function normalizeHistoryActivity(
  turnId: string,
  item: unknown,
  occurredAt: string,
  index: number,
): LiveActivity {
  const record = asRecord(item) ?? {};
  const itemType = (
    readString(record, "kind", "type", "method") ?? "system"
  ).toLowerCase();
  const text =
    readString(record, "text", "preview", "delta", "message", "reason") ??
    "Codex activity";

  if (itemType.includes("assistant") || itemType.includes("agentmessage")) {
    return {
      kind: "assistant",
      ...createActivityBase("assistant", turnId, `assistant-${index}`, text, occurredAt),
      detail: text,
    };
  }

  if (itemType.includes("command")) {
    const command = readString(record, "command") ?? text;
    return {
      kind: "command",
      ...createActivityBase("command", turnId, `command-${index}`, text, occurredAt),
      detail: readString(record, "reason") ?? undefined,
      command,
    };
  }

  return {
    kind: "system",
    ...createActivityBase("system", turnId, `system-${index}`, text, occurredAt),
    detail: readString(record, "detail") ?? undefined,
  };
}

function toTurn(input: unknown, sessionId: string, index: number): LiveTurn {
  const record = asRecord(input) ?? {};
  const turnId = readString(record, "turnId", "id") ?? `${sessionId}-turn-${index + 1}`;
  const occurredAt = toOccurredAt(record);
  const items = readArray(record, "items");
  const activities = items.map((item, itemIndex) =>
    normalizeHistoryActivity(turnId, item, occurredAt, itemIndex),
  );
  const assistantPreview =
    activities.find((activity) => activity.kind === "assistant")?.preview ??
    "Codex session turn";
  const status = readString(record, "status", "stateLabel") ?? "Completed";
  const isLive = status.toLowerCase() === "running" || status.toLowerCase() === "active";

  return {
    turnId,
    stateLabel: status,
    actorDetail: readString(record, "title", "actorDetail") ?? "Codex session turn",
    assistantPreview,
    activities,
    isLive,
    collapsed: !isLive,
    hasReconnectMarker: false,
  };
}

export function buildSessionHistoryPayload(input: {
  sessionId: string;
  cursor: number;
  readResult: unknown;
  replayed?: boolean;
}): SessionHistoryParams {
  const root = asRecord(input.readResult) ?? {};
  const thread = asRecord(root.thread);
  const turns = readArray(thread ?? root, "turns").map((turn, index) =>
    toTurn(turn, input.sessionId, index),
  );

  return {
    sessionId: input.sessionId,
    cursor: input.cursor,
    ...(input.replayed ? { replayed: true } : {}),
    turns,
  };
}

export function normalizeCodexServerEvent(input: {
  sessionId: string;
  cursor: number;
  message: unknown;
  occurredAt?: string;
}): LiveSessionEvent | null {
  const message = asRecord(input.message);
  if (!message || typeof message.method !== "string") return null;

  const params = asRecord(message.params);
  const occurredAt = toOccurredAt(params, input.occurredAt);
  const turnId =
    (params ? readString(params, "turnId") : null) ??
    `${input.sessionId}-turn-live`;

  switch (message.method) {
    case "item/agentMessage/delta": {
      const preview =
        (params ? readString(params, "delta", "text", "message") : null) ??
        "Assistant update";
      return {
        kind: "activity.appended",
        sessionId: input.sessionId,
        cursor: input.cursor,
        occurredAt,
        isLive: true,
        stateLabel: "Running",
        actorDetail: "Codex is responding",
        activity: {
          kind: "assistant",
          ...createActivityBase("assistant", turnId, `assistant-${input.cursor}`, preview, occurredAt),
          detail: preview,
        },
      };
    }
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval": {
      const preview =
        (params ? readString(params, "reason", "command", "summary") : null) ??
        "Remote approval required";
      const actions = (params ? readArray(params, "availableDecisions") : [])
        .map((decision) =>
          typeof decision === "string" ? toDecisionActionOption(decision) : null,
        )
        .filter((action): action is LiveCommandActionOption => action !== null);

      return {
        kind: "activity.appended",
        sessionId: input.sessionId,
        cursor: input.cursor,
        occurredAt,
        isLive: true,
        stateLabel: "Waiting for approval",
        actorDetail: "Codex requested approval",
        activity: {
          kind: "approval",
          ...createActivityBase("approval", turnId, `approval-${input.cursor}`, preview, occurredAt),
          detail: params ? readString(params, "command", "path") ?? undefined : undefined,
          requestId:
            (typeof message.id === "string" || typeof message.id === "number"
              ? message.id
              : `${turnId}-approval-${input.cursor}`),
          actions:
            actions.length > 0
              ? actions
              : [
                  { id: "approve", label: "Approve", variant: "accent" },
                  { id: "deny", label: "Deny" },
                  { id: "abort", label: "Abort", variant: "destructive" },
                ],
        },
      };
    }
    case "turn/started":
      return {
        kind: "activity.appended",
        sessionId: input.sessionId,
        cursor: input.cursor,
        occurredAt,
        isLive: true,
        stateLabel: "Running",
        actorDetail: "Codex started a turn",
        activity: {
          kind: "system",
          ...createActivityBase(
            "system",
            turnId,
            `turn-started-${input.cursor}`,
            "Codex started working on a new turn.",
            occurredAt,
          ),
          detail: "The local Codex session accepted the remote prompt.",
        },
      };
    case "item/commandExecution/started": {
      const command =
        (params ? readString(params, "command") : null) ?? "Codex command";
      return {
        kind: "activity.appended",
        sessionId: input.sessionId,
        cursor: input.cursor,
        occurredAt,
        isLive: true,
        stateLabel: "Running command",
        actorDetail: "Codex is executing a command",
        activity: {
          kind: "command",
          ...createActivityBase("command", turnId, `command-${input.cursor}`, command, occurredAt),
          detail: params ? readString(params, "reason") ?? undefined : undefined,
          command,
        },
      };
    }
    case "item/started": {
      const item = params ? asRecord(params.item) : null;
      if (!item || readString(item, "type") !== "commandExecution") {
        return null;
      }

      const command = readString(item, "command") ?? "Codex command";
      return {
        kind: "activity.appended",
        sessionId: input.sessionId,
        cursor: input.cursor,
        occurredAt,
        isLive: true,
        stateLabel: "Running command",
        actorDetail: "Codex is executing a command",
        activity: {
          kind: "command",
          ...createActivityBase("command", turnId, `command-${input.cursor}`, command, occurredAt),
          detail: readString(item, "cwd") ?? undefined,
          command,
        },
      };
    }
    case "thread/ended":
    case "session/ended":
    case "thread/closed":
      return {
        kind: "session.ended",
        sessionId: input.sessionId,
        cursor: input.cursor,
        occurredAt,
        reason:
          (params ? readString(params, "reason", "message") : null) ??
          "codex_session_ended",
      };
    default:
      return null;
  }
}
