/**
 * Mobile pairing confirmation screen.
 *
 * Rendered on the phone after the authenticated user opens the pairing URL
 * emitted by the bridge CLI. Responsibilities:
 *
 *   1. Redeem the pairing session — this is the transition that produces
 *      the `verificationPhrase` the terminal and browser must compare.
 *   2. Show the verification phrase, fallback code, and current status so
 *      the developer can confirm the pairing from the terminal side.
 *   3. Offer a single primary action that posts to the `/confirm` route,
 *      which is the gate that issues the `cm_device_session` cookie.
 *
 * This file is intentionally mobile-first: one column, large text, no
 * desktop terminal chrome. The layout assumes a phone viewport and does
 * not try to replicate a developer IDE style.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import {
  redeemPairing,
  loadPairingStatus,
  PAIRING_REDEEM_ALLOWED_STATES,
} from "../../../lib/pairing-service";
import type { PairingStatus } from "@codex-mobile/protocol";

interface PairingPageProps {
  params: Promise<{ pairingId: string }>;
}

/**
 * Human-readable description for each pairing lifecycle state. Kept in one
 * place so the copy is consistent between the status label and any
 * follow-up guidance text.
 */
const STATUS_COPY: Record<PairingStatus, { label: string; hint: string }> = {
  pending: {
    label: "Waiting for confirmation",
    hint: "The terminal should now show the same phrase. Confirm on the laptop to finish pairing.",
  },
  redeemed: {
    label: "Verification phrase shown",
    hint: "Compare the phrase below with the one in your terminal, then confirm.",
  },
  confirmed: {
    label: "Paired",
    hint: "This device is now paired for the next 7 days.",
  },
  expired: {
    label: "Pairing expired",
    hint: "Start a new pairing from the terminal and try again.",
  },
  cancelled: {
    label: "Pairing cancelled",
    hint: "Start a new pairing from the terminal and try again.",
  },
};

export default async function PairingPage({ params }: PairingPageProps) {
  const { pairingId } = await params;
  const session = await auth();

  if (!session?.user) {
    // Middleware should have already redirected; this is a belt-and-braces
    // guard for any path that bypasses the matcher.
    redirect(`/sign-in?callbackUrl=/pair/${pairingId}`);
  }

  // Attempt to redeem the pairing so the verificationPhrase becomes visible
  // to the browser. If the pairing is already redeemed or confirmed the
  // service will return the existing state without mutating it.
  const requestHeaders = await headers();
  const currentUserId = (session.user as { id?: string }).id ?? session.user.email ?? "unknown";
  const pairing = await redeemPairing({
    pairingId,
    userId: currentUserId,
    userAgent: requestHeaders.get("user-agent") ?? undefined,
    // Tolerate the redeem call failing on an already-terminal pairing by
    // falling back to a plain status read.
    allowExistingStates: PAIRING_REDEEM_ALLOWED_STATES,
  }).catch(async () => loadPairingStatus(pairingId));

  const statusCopy = STATUS_COPY[pairing.status] ?? STATUS_COPY.pending;
  const verificationPhrase = pairing.verificationPhrase ?? "";
  const userCode = pairing.userCode ?? "";

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "24px",
        gap: "24px",
        maxWidth: "480px",
        margin: "0 auto",
      }}
    >
      <header style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "6px" }}>
        <h1 style={{ fontSize: "26px", fontWeight: 600, margin: 0 }}>
          Pair this phone
        </h1>
        <p style={{ fontSize: "15px", color: "#555", margin: 0 }}>
          {statusCopy.label}
        </p>
      </header>

      <section
        aria-label="Verification phrase"
        style={{
          width: "100%",
          border: "1px solid #e5e5e5",
          borderRadius: "12px",
          padding: "20px",
          background: "#fafafa",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "#777",
          }}
        >
          Verification phrase
        </span>
        <strong
          style={{
            fontSize: "22px",
            fontFamily: "system-ui, -apple-system, sans-serif",
            wordBreak: "break-word",
          }}
        >
          {verificationPhrase || "Waiting for phrase..."}
        </strong>
        <p style={{ fontSize: "14px", color: "#555", margin: "4px 0 0" }}>
          {statusCopy.hint}
        </p>
      </section>

      <section
        aria-label="Fallback code"
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <span style={{ fontSize: "12px", color: "#777", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Fallback code
        </span>
        <code
          style={{
            fontSize: "18px",
            background: "#111",
            color: "#fff",
            padding: "12px 16px",
            borderRadius: "10px",
            textAlign: "center",
            letterSpacing: "0.12em",
          }}
        >
          {userCode || "----"}
        </code>
      </section>

      {pairing.status === "pending" || pairing.status === "redeemed" ? (
        <p style={{ fontSize: "13px", color: "#666", textAlign: "center", margin: 0 }}>
          The device session is only granted after you confirm this phrase from the
          terminal on your laptop.
        </p>
      ) : null}

      <Link
        href="/"
        style={{
          fontSize: "14px",
          color: "#0366d6",
          textDecoration: "none",
          marginTop: "12px",
        }}
      >
        Back to Codex Mobile
      </Link>
    </main>
  );
}
