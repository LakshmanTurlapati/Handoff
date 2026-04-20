import Link from "next/link";

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  handoff_not_found: {
    title: "Launch link unavailable",
    body: "That handoff link is no longer valid. Run /handoff again from the same Codex thread to mint a fresh launch.",
  },
  handoff_expired: {
    title: "Launch link expired",
    body: "This handoff link timed out. Run /handoff again from the same Codex thread to generate a fresh short-lived URL.",
  },
  handoff_revoked: {
    title: "Launch link revoked",
    body: "This handoff was revoked before the phone could attach. Start a new handoff from Codex and retry.",
  },
  handoff_not_authorized: {
    title: "Launch not authorized",
    body: "The hosted handoff no longer trusts this machine. Re-pair the bridge on the laptop and start a fresh handoff.",
  },
};

interface LaunchErrorPageProps {
  searchParams?: Promise<{ code?: string }>;
}

export default async function LaunchErrorPage({
  searchParams,
}: LaunchErrorPageProps) {
  const params = (await searchParams) ?? {};
  const copy =
    ERROR_COPY[params.code ?? ""] ??
    ERROR_COPY.handoff_not_found ??
    {
      title: "Launch link unavailable",
      body: "Run /handoff again from the same Codex thread to mint a fresh launch.",
    };

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#F6F3ED",
        color: "#1F1A14",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          padding: "24px",
          borderRadius: "24px",
          background: "#FFF8F3",
          border: "1px solid #D7CEC0",
        }}
      >
        <span
          style={{
            fontSize: "14px",
            lineHeight: 1.35,
            fontWeight: 600,
            color: "#8A4B2A",
          }}
        >
          Handoff launch
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: "28px",
            lineHeight: 1.1,
            fontWeight: 600,
          }}
        >
          {copy.title}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "16px",
            lineHeight: 1.5,
            color: "#4B4032",
          }}
        >
          {copy.body}
        </p>
        <Link
          href="/"
          style={{
            width: "fit-content",
            textDecoration: "none",
            color: "#1F1A14",
            fontWeight: 600,
          }}
        >
          Back to Codex Mobile
        </Link>
      </div>
    </main>
  );
}
