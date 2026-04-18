import type {
  LiveSessionEndedReason,
} from "@codex-mobile/protocol/live-session";
import type { TerminalState } from "../../lib/live-session/session-model";

interface SessionEndedCardProps {
  terminalState: TerminalState;
  terminalReason: LiveSessionEndedReason | null;
}

function resolveBodyCopy(reason: LiveSessionEndedReason | null): string {
  switch (reason) {
    case "device_session_revoked":
      return "This paired device no longer has permission to control the local Codex session.";
    case "device_session_expired":
      return "The paired device session expired before the relay could reconnect. Pair this device again to continue.";
    case "bridge_unavailable":
      return "The local bridge went offline, so this phone session cannot reconnect until your laptop reconnects.";
    case "codex_process_exited":
      return "Codex stopped on your laptop, so remote controls are now locked for safety.";
    case "detached":
      return "The live session detached from your laptop, so this phone view is now read-only.";
    default:
      return "This live session can no longer reconnect, so remote controls are disabled for safety.";
  }
}

export function SessionEndedCard({
  terminalState,
  terminalReason,
}: SessionEndedCardProps) {
  const heading =
    terminalState === "revoked" ? "Device revoked" : "Session ended on your laptop";

  const palette =
    terminalState === "revoked"
      ? { border: "#B93815", background: "#FFF2EE", label: "#B93815" }
      : { border: "#B8AE9F", background: "#ECE7DE", label: "#4B4032" };

  return (
    <section
      aria-label={heading}
      style={{
        borderRadius: "20px",
        border: `1px solid ${palette.border}`,
        background: palette.background,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <span
        style={{
          fontSize: "14px",
          lineHeight: 1.35,
          fontWeight: 600,
          color: palette.label,
        }}
      >
        Remote control unavailable
      </span>
      <h2
        style={{
          margin: 0,
          fontSize: "20px",
          lineHeight: 1.2,
          fontWeight: 600,
          color: "#1F1A14",
        }}
      >
        {heading}
      </h2>
      <p
        style={{
          margin: 0,
          fontSize: "16px",
          lineHeight: 1.5,
          color: "#4B4032",
        }}
      >
        {resolveBodyCopy(terminalReason)}
      </p>
    </section>
  );
}
