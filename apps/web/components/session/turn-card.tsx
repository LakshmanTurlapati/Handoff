import { ActivityCard } from "./activity-card";
import type { LiveTurn } from "../../lib/live-session/session-model";

interface TurnCardProps {
  turn: LiveTurn;
}

export function TurnCard({ turn }: TurnCardProps) {
  return (
    <section
      aria-label={`Turn ${turn.turnId}`}
      style={{
        borderRadius: "24px",
        border: `1px solid ${turn.isLive ? "#0F766E" : "#D7CEC0"}`,
        background: turn.isLive ? "#FCFFFE" : "#E4DED4",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        boxShadow: turn.isLive
          ? "0 10px 30px rgba(15, 118, 110, 0.12)"
          : "none",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span
          style={{
            fontSize: "14px",
            lineHeight: 1.35,
            fontWeight: 600,
            color: turn.isLive ? "#0F766E" : "#635541",
          }}
        >
          {turn.stateLabel}
        </span>
        <h2
          style={{
            margin: 0,
            fontSize: "20px",
            lineHeight: 1.2,
            fontWeight: 600,
          }}
        >
          {turn.actorDetail}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            lineHeight: 1.5,
            color: "#4B4032",
          }}
        >
          {turn.assistantPreview}
        </p>
      </header>

      {turn.collapsed ? (
        <div
          style={{
            borderRadius: "18px",
            border: "1px solid #D7CEC0",
            background: "#F3EEE6",
            padding: "16px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "14px",
              lineHeight: 1.35,
              color: "#635541",
              fontWeight: 600,
            }}
          >
            Collapsed turn preview
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {turn.hasReconnectMarker ? (
            <div
              style={{
                borderRadius: "999px",
                alignSelf: "flex-start",
                border: "1px solid #0F766E",
                padding: "4px 12px",
                background: "#E6F7F4",
                color: "#0F766E",
                fontSize: "14px",
                lineHeight: 1.35,
                fontWeight: 600,
              }}
            >
              Reconnected
            </div>
          ) : null}

          {turn.activities.map((activity) => (
            <ActivityCard key={activity.activityId} activity={activity} />
          ))}
        </div>
      )}
    </section>
  );
}
