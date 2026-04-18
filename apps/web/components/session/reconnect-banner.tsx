export function ReconnectBanner() {
  return (
    <section
      aria-label="Reconnect status"
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
      <p
        style={{
          margin: 0,
          fontSize: "16px",
          lineHeight: 1.5,
          color: "#0F766E",
          fontWeight: 600,
        }}
      >
        Live connection lost. Reconnecting now.
      </p>
      <p
        style={{
          margin: 0,
          fontSize: "16px",
          lineHeight: 1.5,
          color: "#4B4032",
        }}
      >
        If this does not recover, reopen the session from your paired device.
      </p>
    </section>
  );
}
