export interface AuditFeedItem {
  id: string;
  eventType: string;
  subject: string | null;
  outcome: string;
  createdAt: string;
}

interface AuditFeedProps {
  events: AuditFeedItem[];
}

function formatAuditLabel(eventType: string): string {
  return eventType
    .split(".")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function formatAuditTimestamp(createdAt: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(createdAt));
}

export function AuditFeed({ events }: AuditFeedProps) {
  const newestFirst = [...events].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );

  return (
    <section
      style={{
        borderRadius: "24px",
        background: "#E4DED4",
        border: "1px solid #D7CEC0",
        padding: "24px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "20px",
            lineHeight: 1.2,
            fontWeight: 600,
          }}
        >
          Recent security activity
        </h2>
        <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
          Newest first. Pairing, approval, ticket, and disconnect events stay visible
          in one compact phone feed.
        </p>
      </div>

      {newestFirst.length === 0 ? (
        <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
          No recent security activity has been recorded yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {newestFirst.map((event) => (
            <article
              key={event.id}
              style={{
                borderRadius: "20px",
                border: "1px solid #D7CEC0",
                background: "#F6F3ED",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ fontSize: "16px", lineHeight: 1.5, fontWeight: 600 }}>
                  {formatAuditLabel(event.eventType)}
                </span>
                <span
                  style={{
                    border: `1px solid ${event.outcome === "success" ? "#0F766E" : "#B93815"}`,
                    color: event.outcome === "success" ? "#0F766E" : "#B93815",
                    borderRadius: "999px",
                    padding: "4px 8px",
                    fontSize: "14px",
                    lineHeight: 1.35,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {event.outcome}
                </span>
              </div>

              <span style={{ fontSize: "14px", lineHeight: 1.35, color: "#635541" }}>
                {formatAuditTimestamp(event.createdAt)}
              </span>

              <span style={{ fontSize: "16px", lineHeight: 1.5, color: "#3F372B" }}>
                {event.subject ? `Subject: ${event.subject}` : "Subject: account-wide event"}
              </span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
