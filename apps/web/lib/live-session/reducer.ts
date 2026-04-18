import {
  createInitialLiveSessionState,
  type FollowMode,
  type LiveActivity,
  type LiveConnectionState,
  type LiveSessionEndedReason,
  type LiveSessionState,
  type TerminalState,
  type LiveTurn,
} from "./session-model";

export type LiveSessionAction =
  | {
      type: "hydrate_history";
      turns: LiveTurn[];
      connection?: LiveConnectionState;
    }
  | {
      type: "append_activity";
      activity: LiveActivity;
      stateLabel?: string;
      actorDetail?: string;
      isLive?: boolean;
    }
  | {
      type: "set_follow_mode";
      followMode: FollowMode;
    }
  | {
      type: "set_connection";
      connection: LiveConnectionState;
    }
  | {
      type: "request_interrupt";
    }
  | {
      type: "interrupt_finished";
      stateLabel?: string;
      actorDetail?: string;
    }
  | {
      type: "mark_reconnected";
      activity: LiveActivity;
    }
  | {
      type: "set_terminal_state";
      terminalState: TerminalState;
      terminalReason: LiveSessionEndedReason;
    };

function deriveAssistantPreview(turn: LiveTurn, activity: LiveActivity): string {
  if (activity.kind === "assistant") {
    return activity.preview;
  }

  const latestAssistant = [...turn.activities]
    .reverse()
    .find((item) => item.kind === "assistant");
  return latestAssistant?.preview ?? turn.assistantPreview;
}

function upsertTurn(state: LiveSessionState, action: Extract<LiveSessionAction, { type: "append_activity" }>): LiveTurn[] {
  const nextTurns = [...state.turns];
  const existingIndex = nextTurns.findIndex(
    (turn) => turn.turnId === action.activity.turnId,
  );

  if (existingIndex === -1) {
    const newTurn: LiveTurn = {
      turnId: action.activity.turnId,
      stateLabel: action.stateLabel ?? "Running",
      actorDetail: action.actorDetail ?? action.activity.title,
      assistantPreview:
        action.activity.kind === "assistant"
          ? action.activity.preview
          : action.activity.preview,
      activities: [action.activity],
      isLive: action.isLive ?? true,
      collapsed: false,
      hasReconnectMarker: false,
    };

    return nextTurns.map((turn) =>
      turn.turnId === state.liveTurnId
        ? { ...turn, collapsed: true, isLive: false }
        : turn,
    ).concat(newTurn);
  }

  const existingTurn = nextTurns[existingIndex];
  const updatedTurn: LiveTurn = {
    ...existingTurn,
    stateLabel: action.stateLabel ?? existingTurn.stateLabel,
    actorDetail: action.actorDetail ?? existingTurn.actorDetail,
    isLive: action.isLive ?? existingTurn.isLive,
    collapsed: false,
    activities: [...existingTurn.activities, action.activity],
  };
  updatedTurn.assistantPreview = deriveAssistantPreview(updatedTurn, action.activity);

  nextTurns[existingIndex] = updatedTurn;

  return nextTurns.map((turn, index) => {
    if (index === existingIndex) return turn;
    if (!updatedTurn.isLive) return turn;
    return { ...turn, collapsed: true, isLive: false };
  });
}

export function liveSessionReducer(
  state: LiveSessionState,
  action: LiveSessionAction,
): LiveSessionState {
  switch (action.type) {
    case "hydrate_history": {
      const liveTurn = action.turns.find((turn) => turn.isLive) ?? null;
      return {
        ...state,
        connection: action.connection ?? state.connection,
        liveTurnId: liveTurn?.turnId ?? null,
        terminalState: null,
        terminalReason: null,
        turns: action.turns,
      };
    }
    case "append_activity": {
      const turns = upsertTurn(state, action);
      const nextLiveTurn =
        turns.find((turn) => turn.isLive)?.turnId ?? state.liveTurnId;
      return {
        ...state,
        liveTurnId: nextLiveTurn,
        turns,
      };
    }
    case "set_follow_mode":
      return {
        ...state,
        followMode: action.followMode,
      };
    case "set_connection":
      return {
        ...state,
        connection: action.connection,
      };
    case "request_interrupt":
      return {
        ...state,
        pendingInterrupt: true,
      };
    case "interrupt_finished": {
      const turns = state.turns.map((turn) =>
        turn.turnId === state.liveTurnId
          ? {
              ...turn,
              stateLabel: action.stateLabel ?? "Interrupted",
              actorDetail:
                action.actorDetail ?? "The current Codex turn stopped remotely",
            }
          : turn,
      );
      return {
        ...state,
        pendingInterrupt: false,
        turns,
      };
    }
    case "mark_reconnected": {
      const turns = state.turns.map((turn) => {
        if (turn.turnId !== action.activity.turnId) {
          return turn;
        }
        return {
          ...turn,
          hasReconnectMarker: true,
          activities: [...turn.activities, action.activity],
        };
      });
      return {
        ...state,
        connection: "connected",
        terminalState: null,
        terminalReason: null,
        turns,
      };
    }
    case "set_terminal_state": {
      const turns = state.turns.map((turn) => {
        if (turn.turnId !== state.liveTurnId) {
          return { ...turn, isLive: false };
        }

        return {
          ...turn,
          isLive: false,
          collapsed: false,
          stateLabel: action.terminalState === "revoked" ? "Device revoked" : "Ended",
          actorDetail:
            action.terminalState === "revoked"
              ? "Device revoked"
              : "Session ended on your laptop",
        };
      });

      return {
        ...state,
        connection: "disconnected",
        liveTurnId: null,
        pendingInterrupt: false,
        terminalState: action.terminalState,
        terminalReason: action.terminalReason,
        turns,
      };
    }
    default:
      return state;
  }
}

export { createInitialLiveSessionState };
