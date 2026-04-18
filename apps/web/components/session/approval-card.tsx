import type { ApprovalActivity } from "../../lib/live-session/session-model";

interface ApprovalCardProps {
  activity: ApprovalActivity;
  disabled?: boolean;
  onDecision?: (requestId: string, decision: "approved" | "denied" | "abort") => void;
}

function toDecision(actionId: string): "approved" | "denied" | "abort" {
  if (actionId === "approve") return "approved";
  if (actionId === "deny") return "denied";
  return "abort";
}

export function ApprovalCard({
  activity,
  disabled = false,
  onDecision,
}: ApprovalCardProps) {
  return (
    <article
      aria-label="Waiting for approval"
      style={{
        borderRadius: "20px",
        border: "1px solid #0F766E",
        background: "#DFF4F1",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <span
          style={{
            fontSize: "14px",
            lineHeight: 1.35,
            fontWeight: 600,
            color: "#0F766E",
          }}
        >
          Waiting for approval
        </span>
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            lineHeight: 1.5,
            color: "#1F1A14",
          }}
        >
          {activity.preview}
        </p>
        {activity.detail ? (
          <p
            style={{
              margin: 0,
              fontSize: "16px",
              lineHeight: 1.5,
              color: "#4B4032",
            }}
          >
            {activity.detail}
          </p>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "8px",
        }}
      >
        {activity.actions.map((action) => {
          const palette =
            action.variant === "accent"
              ? { background: "#0F766E", color: "#F6F3ED", border: "#0F766E" }
              : action.variant === "destructive"
                ? { background: "#FFF2EE", color: "#B93815", border: "#B93815" }
                : { background: "#F6F3ED", color: "#3F372B", border: "#B8AE9F" };

          return (
            <button
              key={action.id}
              type="button"
              disabled={disabled}
              onClick={() => onDecision?.(String(activity.requestId), toDecision(action.id))}
              style={{
                minHeight: "44px",
                borderRadius: "999px",
                border: `1px solid ${palette.border}`,
                background: disabled ? "#E5E7EB" : palette.background,
                color: disabled ? "#7A746B" : palette.color,
                fontSize: "14px",
                lineHeight: 1.35,
                fontWeight: 600,
                opacity: disabled ? 0.8 : 1,
              }}
            >
              {action.label}
            </button>
          );
        })}
      </div>
    </article>
  );
}
