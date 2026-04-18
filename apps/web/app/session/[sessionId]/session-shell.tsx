"use client";

import { startTransition, useEffect, useEffectEvent, useReducer, useRef } from "react";
import { Composer } from "../../../components/session/composer";
import { JumpToLive } from "../../../components/session/jump-to-live";
import { ReconnectBanner } from "../../../components/session/reconnect-banner";
import { TurnCard } from "../../../components/session/turn-card";
import {
  createInitialLiveSessionState,
  liveSessionReducer,
} from "../../../lib/live-session/reducer";
import {
  connectLiveSession,
  sendSessionCommand,
  type LiveSessionTransport,
} from "../../../lib/live-session/transport";
import type {
  FollowMode,
  LiveActionOption,
  LiveActivity,
  LiveConnectionState,
} from "../../../lib/live-session/session-model";
import type {
  LiveSessionEvent,
  SessionCommand,
} from "@codex-mobile/protocol/live-session";

interface SessionShellProps {
  sessionId: string;
  initialConnection: "connecting" | "connected" | "reconnecting";
}

export function SessionShell({
  sessionId,
  initialConnection,
}: SessionShellProps) {
  const transportRef = useRef<LiveSessionTransport | null>(null);
  const liveAnchorRef = useRef<HTMLDivElement | null>(null);
  const [state, dispatch] = useReducer(
    liveSessionReducer,
    createInitialLiveSessionState(
      sessionId,
      initialConnection as LiveConnectionState,
    ),
  );

  const appendLocalActivity = (
    kind: "assistant" | "system" | "error",
    title: string,
    preview: string,
    options?: {
      detail?: string;
      status?: "pending" | "running" | "completed" | "failed";
      actions?: LiveActionOption[];
      stateLabel?: string;
      actorDetail?: string;
    },
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
        detail: options?.detail,
        status: options?.status ?? "running",
        createdAt: new Date().toISOString(),
        ...(kind === "error" ? { actions: options?.actions } : {}),
      },
      stateLabel: options?.stateLabel ?? (kind === "assistant" ? "Running bash" : "System update"),
      actorDetail:
        options?.actorDetail ??
        (kind === "assistant"
          ? "Assistant drafted a new mobile follow-up"
          : kind === "error"
            ? "The live transport surfaced a recoverable error"
            : "Local session shell updated its pending state"),
      isLive: true,
    });
  };

  const applyTransportEvent = useEffectEvent((event: LiveSessionEvent) => {
    startTransition(() => {
      switch (event.kind) {
        case "session.history":
          dispatch({
            type: "hydrate_history",
            turns: event.turns,
            connection: "connected",
          });
          break;
        case "activity.appended":
          dispatch({
            type: "append_activity",
            activity: event.activity,
            stateLabel: event.stateLabel,
            actorDetail: event.actorDetail,
            isLive: event.isLive,
          });
          break;
        case "interrupt.finished":
          dispatch({
            type: "interrupt_finished",
            stateLabel: event.stateLabel,
            actorDetail: event.actorDetail,
          });
          break;
        case "session.reconnected":
          dispatch({
            type: "mark_reconnected",
            activity: event.activity,
          });
          break;
        case "session.error":
          appendLocalActivity(
            "error",
            "Live transport error",
            event.message,
            {
              status: "failed",
              actions: [
                { id: "retry", label: "Retry", variant: "accent" },
                { id: "context", label: "Context" },
              ],
              stateLabel: "Connection issue",
              actorDetail: event.code,
            },
          );
          break;
        case "session.ended":
          dispatch({ type: "set_connection", connection: "disconnected" });
          break;
        case "session.attached":
          dispatch({ type: "set_connection", connection: "connected" });
          break;
      }
    });
  });

  const handleConnectionChange = useEffectEvent((connection: LiveConnectionState) => {
    startTransition(() => {
      dispatch({ type: "set_connection", connection });
    });
  });

  const handleTransportError = useEffectEvent((error: Error) => {
    startTransition(() => {
      appendLocalActivity(
        "error",
        "Live transport error",
        error.message,
        {
          status: "failed",
          actions: [
            { id: "retry", label: "Retry", variant: "accent" },
            { id: "context", label: "Context" },
          ],
          stateLabel: "Connection issue",
        },
      );
    });
  });

  useEffect(() => {
    let disposed = false;

    void connectLiveSession(sessionId, {
      onConnectionChange: handleConnectionChange,
      onEvent: applyTransportEvent,
      onTransportError: handleTransportError,
    }).then((transport) => {
      if (disposed) {
        transport.disconnect();
        return;
      }

      transportRef.current = transport;
    });

    return () => {
      disposed = true;
      transportRef.current?.disconnect();
      transportRef.current = null;
    };
  }, [applyTransportEvent, handleConnectionChange, handleTransportError, sessionId]);

  const syncFollowMode = useEffectEvent(() => {
    const nearBottom =
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 160;
    const nextMode: FollowMode = nearBottom ? "live" : "paused";

    if (nextMode !== state.followMode) {
      startTransition(() => {
        dispatch({ type: "set_follow_mode", followMode: nextMode });
      });
    }
  });

  useEffect(() => {
    syncFollowMode();
    window.addEventListener("scroll", syncFollowMode, { passive: true });
    return () => {
      window.removeEventListener("scroll", syncFollowMode);
    };
  }, [syncFollowMode]);

  useEffect(() => {
    if (state.followMode !== "live") return;
    liveAnchorRef.current?.scrollIntoView({ block: "end" });
  }, [state.connection, state.followMode, state.turns]);

  const dispatchCommand = useEffectEvent(async (command: SessionCommand) => {
    if (transportRef.current) {
      await transportRef.current.send(command);
      return;
    }

    await sendSessionCommand(sessionId, command);
  });

  const handleRetryAction = useEffectEvent(async (activity: LiveActivity, actionId: string) => {
    if (activity.kind !== "error") return;

    if (actionId === "retry") {
      handleConnectionChange("reconnecting");
      return;
    }

    appendLocalActivity(
      "system",
      "Context note",
      `Captured extra context for ${activity.title}.`,
      {
        status: "completed",
        detail: activity.detail,
        stateLabel: "Context captured",
      },
    );
  });

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
            <JumpToLive
              onClick={() => {
                dispatch({ type: "set_follow_mode", followMode: "live" });
                liveAnchorRef.current?.scrollIntoView({
                  block: "end",
                  behavior: "smooth",
                });
              }}
            />
          ) : null}
        </section>

        {state.connection === "reconnecting" ? <ReconnectBanner /> : null}

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
            <TurnCard
              key={turn.turnId}
              turn={turn}
              onApprovalDecision={(requestId, decision) => {
                void dispatchCommand({
                  kind: "approval",
                  requestId,
                  decision,
                }).then(
                  () => {
                    appendLocalActivity(
                      "system",
                      "Approval decision sent",
                      `Sent ${decision} for request ${requestId}.`,
                      {
                        status: "completed",
                        stateLabel: "Approval updated",
                      },
                    );
                  },
                  (error) => {
                    appendLocalActivity(
                      "error",
                      "Approval action failed",
                      error instanceof Error ? error.message : "Approval action failed.",
                      {
                        status: "failed",
                        actions: [
                          { id: "retry", label: "Retry", variant: "accent" },
                          { id: "context", label: "Context" },
                        ],
                      },
                    );
                  },
                );
              }}
              onActivityAction={(activity, actionId) => {
                void handleRetryAction(activity, actionId);
              }}
            />
          ))}
          <div ref={liveAnchorRef} />
        </section>

        <Composer
          pendingInterrupt={state.pendingInterrupt}
          onSendPrompt={(text) => {
            appendLocalActivity(
              "system",
              "Prompt queued",
              `Send Prompt: ${text}`,
              {
                status: "pending",
                detail: "The relay is forwarding this prompt to the connected bridge.",
                stateLabel: "Prompt queued",
              },
            );
            void dispatchCommand({ kind: "prompt", text }).catch((error) => {
              appendLocalActivity(
                "error",
                "Prompt send failed",
                error instanceof Error ? error.message : "Prompt send failed.",
                {
                  status: "failed",
                  actions: [
                    { id: "retry", label: "Retry", variant: "accent" },
                    { id: "context", label: "Context" },
                  ],
                },
              );
            });
          }}
          onSteer={(text) => {
            appendLocalActivity(
              "system",
              "Steering note",
              `Steer: ${text}`,
              {
                status: "pending",
                detail: "Steer stays visible in the composer row while the live turn continues.",
                stateLabel: "Steering",
              },
            );
            void dispatchCommand({ kind: "steer", text }).catch((error) => {
              appendLocalActivity(
                "error",
                "Steer send failed",
                error instanceof Error ? error.message : "Steer send failed.",
                {
                  status: "failed",
                  actions: [
                    { id: "retry", label: "Retry", variant: "accent" },
                    { id: "context", label: "Context" },
                  ],
                },
              );
            });
          }}
          onInterrupt={() => {
            dispatch({ type: "request_interrupt" });
            void dispatchCommand({ kind: "interrupt", reason: "user_request" }).catch(
              (error) => {
                dispatch({
                  type: "interrupt_finished",
                  stateLabel: "Running bash",
                  actorDetail: "Interrupt request could not reach the relay",
                });
                appendLocalActivity(
                  "error",
                  "Interrupt failed",
                  error instanceof Error ? error.message : "Interrupt failed.",
                  {
                    status: "failed",
                    actions: [
                      { id: "retry", label: "Retry", variant: "accent" },
                      { id: "context", label: "Context" },
                    ],
                  },
                );
              },
            );
          }}
        />
      </div>
    </main>
  );
}
