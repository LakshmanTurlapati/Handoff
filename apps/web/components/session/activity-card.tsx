import type { LiveActivity, LiveActionOption } from "../../lib/live-session/session-model";

interface ActivityCardProps {
  activity: LiveActivity;
}

const CARD_TONES: Record<
  LiveActivity["kind"],
  {
    border: string;
    background: string;
    label: string;
  }
> = {
  assistant: {
    border: "#0F766E",
    background: "#F3FBFA",
    label: "Assistant message",
  },
  tool: {
    border: "#B8AE9F",
    background: "#FBF8F2",
    label: "Tool activity",
  },
  command: {
    border: "#B79A72",
    background: "#FCF7EF",
    label: "Command execution",
  },
  approval: {
    border: "#0F766E",
    background: "#DFF4F1",
    label: "Approval request",
  },
  system: {
    border: "#8F7C63",
    background: "#F1EDE7",
    label: "System notice",
  },
  error: {
    border: "#B93815",
    background: "#FFF2EE",
    label: "Error",
  },
};

function renderActions(actions: LiveActionOption[] | undefined) {
  if (!actions || actions.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
      }}
    >
      {actions.map((action) => {
        const palette =
          action.variant === "accent"
            ? { background: "#0F766E", color: "#F6F3ED", border: "#0F766E" }
            : action.variant === "destructive"
              ? { background: "#FFF2EE", color: "#B93815", border: "#B93815" }
              : { background: "#F6F3ED", color: "#3F372B", border: "#B8AE9F" };

        return (
          <span
            key={action.id}
            style={{
              minHeight: "44px",
              padding: "10px 14px",
              borderRadius: "999px",
              border: `1px solid ${palette.border}`,
              background: palette.background,
              color: palette.color,
              fontSize: "14px",
              lineHeight: 1.35,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {action.label}
          </span>
        );
      })}
    </div>
  );
}

export function ActivityCard({ activity }: ActivityCardProps) {
  const tone = CARD_TONES[activity.kind];
  const errorActions = activity.kind === "error" ? activity.actions : undefined;
  const approvalActions = activity.kind === "approval" ? activity.actions : undefined;

  return (
    <article
      aria-label={tone.label}
      style={{
        borderRadius: "20px",
        border: `1px solid ${tone.border}`,
        background: tone.background,
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
            color: tone.border,
          }}
        >
          {activity.title}
        </span>
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            lineHeight: 1.5,
            color: "#3F372B",
          }}
        >
          {activity.preview}
        </p>
      </div>

      {activity.detail ? (
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            lineHeight: 1.5,
            color: "#635541",
          }}
        >
          {activity.detail}
        </p>
      ) : null}

      {activity.kind === "command" ? (
        <code
          style={{
            display: "block",
            padding: "12px",
            borderRadius: "16px",
            background: "#1F1A14",
            color: "#F6F3ED",
            fontSize: "14px",
            lineHeight: 1.35,
            overflowX: "auto",
          }}
        >
          {activity.command}
        </code>
      ) : null}

      {renderActions(approvalActions ?? errorActions)}
    </article>
  );
}
