import Link from "next/link";

export interface SessionListItem {
  sessionId: string;
  title: string;
  model: string;
  status: "Live" | "Waiting for bridge" | "Ready to resume";
  turnCount: number;
  updatedAt: string;
}

interface SessionListProps {
  sessions: SessionListItem[];
}

const statusStyles: Record<SessionListItem["status"], { border: string; color: string }> =
  {
    Live: {
      border: "#0F766E",
      color: "#0F766E",
    },
    "Waiting for bridge": {
      border: "#8F7C63",
      color: "#635541",
    },
    "Ready to resume": {
      border: "#6B7280",
      color: "#4B5563",
    },
  };

export function SessionList({ sessions }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <section
        aria-label="Available sessions"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
          Available sessions
        </p>
        <p style={{ margin: 0, fontSize: "16px", color: "#635541" }}>
          The bridge has not published a resumable Codex session for this
          device yet.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Available sessions"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {sessions.map((session) => {
        const statusStyle = statusStyles[session.status];

        return (
          <Link
            key={session.sessionId}
            href={`/session/${session.sessionId}`}
            style={{
              textDecoration: "none",
              color: "inherit",
              border: "1px solid #D7CEC0",
              borderRadius: "20px",
              background: "#E4DED4",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              minHeight: "108px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span
                  style={{
                    fontSize: "20px",
                    lineHeight: 1.2,
                    fontWeight: 600,
                  }}
                >
                  {session.title}
                </span>
                <span style={{ fontSize: "14px", lineHeight: 1.35, color: "#635541" }}>
                  Updated {session.updatedAt}
                </span>
              </div>
              <span
                style={{
                  border: `1px solid ${statusStyle.border}`,
                  color: statusStyle.color,
                  borderRadius: "999px",
                  padding: "4px 8px",
                  fontSize: "14px",
                  lineHeight: 1.35,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {session.status}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                fontSize: "16px",
                lineHeight: 1.5,
                color: "#3F372B",
              }}
            >
              <span>{session.model}</span>
              <span aria-hidden="true">•</span>
              <span>{session.turnCount} turns</span>
            </div>
          </Link>
        );
      })}
    </section>
  );
}
