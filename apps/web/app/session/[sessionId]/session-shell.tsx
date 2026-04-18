interface SessionShellProps {
  sessionId: string;
  initialConnection: "connecting" | "connected" | "reconnecting";
}

export function SessionShell({
  sessionId,
  initialConnection,
}: SessionShellProps) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#F6F3ED",
        color: "#1F1A14",
        padding: "24px",
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
          <span style={{ fontSize: "14px", lineHeight: 1.35, fontWeight: 600 }}>
            Session {sessionId}
          </span>
          <h1 style={{ margin: 0, fontSize: "20px", lineHeight: 1.2, fontWeight: 600 }}>
            Preparing the live session shell
          </h1>
          <p style={{ margin: 0, fontSize: "16px", lineHeight: 1.5, color: "#635541" }}>
            The reducer-driven mobile session view is starting in a{" "}
            {initialConnection} state.
          </p>
        </header>
      </div>
    </main>
  );
}
