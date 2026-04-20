/**
 * Mobile pairing confirmation screen (server component).
 *
 * Rendered on the phone after the authenticated user opens the pairing URL
 * emitted by the bridge CLI. Responsibilities:
 *
 *   1. Auth check -- redirect to sign-in if unauthenticated.
 *   2. Redeem the pairing (SSR) -- produces the verificationPhrase.
 *   3. Pass initial pairing state to the PairingClaimFlow client component
 *      which handles polling, auto-claim, and state transitions.
 *
 * The interactive polling and claim logic is in pairing-claim-flow.tsx
 * ("use client") because server components cannot run useEffect or fetch
 * on the client side.
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
import { PairingClaimFlow } from "./pairing-claim-flow";

interface PairingPageProps {
  params: Promise<{ pairingId: string }>;
}

export default async function PairingPage({ params }: PairingPageProps) {
  const { pairingId } = await params;
  const session = await auth();

  if (!session?.user) {
    redirect(`/sign-in?callbackUrl=/pair/${pairingId}`);
  }

  const requestHeaders = await headers();
  const currentUserId =
    (session.user as { id?: string }).id ??
    session.user.email ??
    "unknown";
  const pairing = await redeemPairing({
    pairingId,
    userId: currentUserId,
    userAgent: requestHeaders.get("user-agent") ?? undefined,
    allowExistingStates: PAIRING_REDEEM_ALLOWED_STATES,
  }).catch(async () => loadPairingStatus(pairingId));

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
      <PairingClaimFlow
        pairingId={pairingId}
        initialStatus={pairing.status}
        verificationPhrase={pairing.verificationPhrase ?? ""}
        userCode={pairing.userCode ?? ""}
      />

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
