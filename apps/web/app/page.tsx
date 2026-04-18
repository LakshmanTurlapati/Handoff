import { redirect } from "next/navigation";
import { auth } from "../auth";
import {
  SessionList,
  type SessionListItem,
} from "../components/session/session-list";

const recentSessions: SessionListItem[] = [
  {
    sessionId: "session-remote-alpha",
    title: "Resume relay routing pass",
    model: "gpt-5-codex",
    status: "Live",
    turnCount: 18,
    updatedAt: "just now",
  },
  {
    sessionId: "session-ui-shell",
    title: "Polish the mobile shell",
    model: "gpt-5-codex",
    status: "Ready to resume",
    turnCount: 11,
    updatedAt: "6 min ago",
  },
  {
    sessionId: "session-bridge-check",
    title: "Bridge heartbeat investigation",
    model: "gpt-5-codex-mini",
    status: "Waiting for bridge",
    turnCount: 7,
    updatedAt: "21 min ago",
  },
];

export default async function HomePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/");
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#F6F3ED",
        color: "#1F1A14",
        padding: "24px 24px 48px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
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
            Codex Mobile
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              lineHeight: 1.1,
              fontWeight: 600,
            }}
          >
            No remote session yet
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "16px",
              lineHeight: 1.5,
              color: "#4B4032",
            }}
          >
            Open Codex on your laptop, connect the bridge, then choose a session to continue here.
          </p>
        </header>

        <section
          aria-label="Session landing explanation"
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
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.35, fontWeight: 600 }}>
            This phone stays focused on the active Codex thread.
          </p>
          <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
            Recent sessions stay one tap away, but there is no desktop sidebar,
            table, or raw terminal chrome in this flow.
          </p>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2
              style={{
                margin: 0,
                fontSize: "20px",
                lineHeight: 1.2,
                fontWeight: 600,
              }}
            >
              Continue a session
            </h2>
            <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
              Pick up the latest remote-ready Codex work from this paired device.
            </p>
          </div>

          <SessionList sessions={recentSessions} />
        </section>
      </div>
    </main>
  );
}
