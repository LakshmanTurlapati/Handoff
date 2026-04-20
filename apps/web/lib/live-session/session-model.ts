import type { LiveSessionEndedReason } from "@codex-mobile/protocol/live-session";

export type { LiveSessionEndedReason } from "@codex-mobile/protocol/live-session";

export type LiveConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

export type FollowMode = "live" | "paused";

export type TerminalState = "revoked" | "ended";

export type LiveActivityKind =
  | "assistant"
  | "tool"
  | "command"
  | "approval"
  | "system"
  | "error";

export type LiveActivityStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface LiveActionOption {
  id: string;
  label: string;
  variant?: "neutral" | "accent" | "destructive";
}

interface LiveActivityBase {
  activityId: string;
  turnId: string;
  title: string;
  preview: string;
  detail?: string;
  status: LiveActivityStatus;
  createdAt: string;
}

export interface AssistantActivity extends LiveActivityBase {
  kind: "assistant";
}

export interface ToolActivity extends LiveActivityBase {
  kind: "tool";
}

export interface CommandActivity extends LiveActivityBase {
  kind: "command";
  command: string;
}

export interface ApprovalActivity extends LiveActivityBase {
  kind: "approval";
  requestId: string | number;
  actions: LiveActionOption[];
}

export interface SystemActivity extends LiveActivityBase {
  kind: "system";
}

export interface ErrorActivity extends LiveActivityBase {
  kind: "error";
  actions?: LiveActionOption[];
}

export type LiveActivity =
  | AssistantActivity
  | ToolActivity
  | CommandActivity
  | ApprovalActivity
  | SystemActivity
  | ErrorActivity;

export interface LiveTurn {
  turnId: string;
  stateLabel: string;
  actorDetail: string;
  assistantPreview: string;
  activities: LiveActivity[];
  isLive: boolean;
  collapsed: boolean;
  hasReconnectMarker: boolean;
}

export interface LiveSessionState {
  sessionId: string;
  connection: LiveConnectionState;
  followMode: FollowMode;
  liveTurnId: string | null;
  pendingInterrupt: boolean;
  terminalState: TerminalState | null;
  terminalReason: LiveSessionEndedReason | null;
  turns: LiveTurn[];
}

export function resolveTerminalState(
  reason: LiveSessionEndedReason,
): TerminalState {
  return reason === "device_session_revoked" ? "revoked" : "ended";
}

export function createFixtureTurns(sessionId: string): LiveTurn[] {
  const baseTime = new Date("2026-04-18T07:00:00.000Z").toISOString();
  const firstTurnId = `${sessionId}-turn-001`;
  const secondTurnId = `${sessionId}-turn-002`;

  const historicalTurn: LiveTurn = {
    turnId: firstTurnId,
    stateLabel: "Completed",
    actorDetail: "Assistant drafted the relay summary",
    assistantPreview: "Mapped the relay ownership path and captured the next protocol gaps.",
    isLive: false,
    collapsed: true,
    hasReconnectMarker: false,
    activities: [
      {
        kind: "assistant",
        activityId: `${firstTurnId}-assistant`,
        turnId: firstTurnId,
        title: "Assistant update",
        preview:
          "Mapped the relay ownership path and captured the next protocol gaps.",
        detail:
          "This turn grouped the relay browser ownership decisions into a single summary before handoff.",
        status: "completed",
        createdAt: baseTime,
      },
      {
        kind: "tool",
        activityId: `${firstTurnId}-tool`,
        turnId: firstTurnId,
        title: "Read repository files",
        preview: "Reviewed relay server, ws-bridge route, and ticket helpers.",
        detail:
          "Captured the relay route limitations and the missing browser-safe upgrade path.",
        status: "completed",
        createdAt: baseTime,
      },
    ],
  };

  const liveTurn: LiveTurn = {
    turnId: secondTurnId,
    stateLabel: "Running bash",
    actorDetail: "Bridge transport is warming up",
    assistantPreview:
      "Streaming the active transport setup in readable chunks for the phone shell.",
    isLive: true,
    collapsed: false,
    hasReconnectMarker: false,
    activities: [
      {
        kind: "assistant",
        activityId: `${secondTurnId}-assistant`,
        turnId: secondTurnId,
        title: "Assistant update",
        preview:
          "Streaming the active transport setup in readable chunks for the phone shell.",
        detail:
          "The live turn stays expanded so the current activity owns the screen while older turns compress.",
        status: "running",
        createdAt: baseTime,
      },
      {
        kind: "command",
        activityId: `${secondTurnId}-command`,
        turnId: secondTurnId,
        title: "Command execution",
        preview: "Running targeted file reads for the browser transport surface.",
        detail:
          "node .codex/get-shit-done/bin/gsd-tools.cjs init execute-phase 03",
        command: "node .codex/get-shit-done/bin/gsd-tools.cjs init execute-phase 03",
        status: "running",
        createdAt: baseTime,
      },
      {
        kind: "approval",
        activityId: `${secondTurnId}-approval`,
        turnId: secondTurnId,
        title: "Waiting for approval",
        preview: "Approve the next relay browser route change before it lands.",
        detail:
          "Approval requests stay inline with the live turn instead of blocking the whole page.",
        requestId: `${secondTurnId}-approval-request`,
        status: "pending",
        createdAt: baseTime,
        actions: [
          { id: "approve", label: "Approve", variant: "accent" },
          { id: "deny", label: "Deny" },
          { id: "abort", label: "Abort", variant: "destructive" },
        ],
      },
    ],
  };

  return [historicalTurn, liveTurn];
}

export function createInitialLiveSessionState(
  sessionId: string,
  connection: LiveConnectionState = "connecting",
): LiveSessionState {
  const turns = createFixtureTurns(sessionId);
  const liveTurn = turns.find((turn) => turn.isLive) ?? null;

  return {
    sessionId,
    connection,
    followMode: "live",
    liveTurnId: liveTurn?.turnId ?? null,
    pendingInterrupt: false,
    terminalState: null,
    terminalReason: null,
    turns,
  };
}
