"use client";

import { useReducer } from "react";
import { Composer } from "../../../components/session/composer";
import { TurnCard } from "../../../components/session/turn-card";
import {
  createInitialLiveSessionState,
  liveSessionReducer,
} from "../../../lib/live-session/reducer";
import type { LiveConnectionState } from "../../../lib/live-session/session-model";

interface SessionShellProps {
  sessionId: string;
  initialConnection: "connecting" | "connected" | "reconnecting";
}

export function SessionShell({
  sessionId,
  initialConnection,
}: SessionShellProps) {
  const [state, dispatch] = useReducer(
    liveSessionReducer,
    createInitialLiveSessionState(
      sessionId,
      initialConnection as LiveConnectionState,
    ),
  );

  const handleLocalMessage = (
    kind: "assistant" | "system",
    title: string,
    preview: string,
  ) => {
    if (!state.liveTurnId) return;

    dispatch({
      type: "append_activity",
      activity: {
        kind,
        activityId: `${state.liveTurnId}-${kind}-${Date.now()}`,
        turnId: state.liveTurnId,
        title,
        preview,
        detail:
          kind === "assistant"
            ? "The live transport is not attached yet, so this uses local fixture state."
            : undefined,
        status: "running",
        createdAt: new Date().toISOString(),
      },
      stateLabel: kind === "assistant" ? "Running bash" : "System update",
      actorDetail:
        kind === "assistant"
          ? "Assistant drafted a new mobile follow-up"
          : "Local session shell updated its pending state",
      isLive: true,
    });
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#F6F3ED",
        color: "#1F1A14",
        padding: "24px 24px 0",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span
            style={{
              fontSize: "14px",
              lineHeight: 1.35,
              fontWeight: 600,
              color: "#635541",
            }}
          >
            Session {sessionId}
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: "20px",
              lineHeight: 1.2,
              fontWeight: 600,
            }}
          >
            Live remote timeline
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "16px",
              lineHeight: 1.5,
              color: "#635541",
            }}
          >
            Turn-grouped activity keeps the live step open while older turns
            stay compact and readable from your phone.
          </p>
        </header>

        <section
          aria-label="Live session status"
          style={{
            borderRadius: "20px",
            border: "1px solid #D7CEC0",
            background: "#E4DED4",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "14px", lineHeight: 1.35, fontWeight: 600 }}>
            Connection: {state.connection}
          </span>
          <span style={{ fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
            Auto-follow: {state.followMode === "live" ? "on" : "paused"}
          </span>
          {state.followMode === "paused" ? (
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "set_follow_mode", followMode: "live" })
              }
              style={{
                alignSelf: "flex-start",
                minHeight: "44px",
                borderRadius: "999px",
                border: "1px solid #0F766E",
                background: "#0F766E",
                color: "#F6F3ED",
                padding: "10px 16px",
                fontSize: "14px",
                lineHeight: 1.35,
                fontWeight: 600,
              }}
            >
              Jump to live
            </button>
          ) : null}
        </section>

        <section
          aria-label="Timeline"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            paddingBottom: "120px",
          }}
        >
          {state.turns.map((turn) => (
            <TurnCard key={turn.turnId} turn={turn} />
          ))}
        </section>

        <Composer
          pendingInterrupt={state.pendingInterrupt}
          onSendPrompt={(text) => {
            handleLocalMessage(
              "assistant",
              "Assistant update",
              `Queued a fresh prompt: ${text}`,
            );
          }}
          onSteer={(text) => {
            dispatch({ type: "set_follow_mode", followMode: "paused" });
            handleLocalMessage(
              "system",
              "Steering note",
              `Jump to live is ready because the operator stepped back to review: ${text}`,
            );
          }}
          onInterrupt={() => {
            dispatch({ type: "request_interrupt" });
          }}
        />
      </div>
    </main>
  );
}
