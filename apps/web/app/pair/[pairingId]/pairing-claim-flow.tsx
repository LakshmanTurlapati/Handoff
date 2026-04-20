"use client";
/**
 * Client-side polling + auto-claim component for the pairing flow.
 *
 * Rendered by the server component page.tsx after SSR. Receives initial
 * pairing state as props and handles:
 *   - 2-second polling of GET /api/pairings/[id] (D-07)
 *   - Auto-claim via POST /api/pairings/[id]/claim on confirmed detection (D-05)
 *   - Error states with actionable messages (D-08)
 *   - Stays on page showing paired confirmation after claim (D-06)
 */
import { useState, useEffect, useRef, useCallback } from "react";

type ClaimFlowStatus =
  | "pending"
  | "redeemed"
  | "confirmed"
  | "claimed"
  | "expired"
  | "cancelled"
  | "error"
  | "timeout";

interface PairingClaimFlowProps {
  pairingId: string;
  initialStatus: string;
  verificationPhrase: string;
  userCode: string;
}

/** D-07: 2-second fixed polling interval */
const POLL_INTERVAL_MS = 2000;

/** D-07: hard wall-clock timeout matching the 5-minute pairing TTL */
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

/** D-08: show reconnecting hint after this many consecutive poll failures */
const RECONNECT_HINT_THRESHOLD = 2;

/**
 * Human-readable status copy. Mirrors STATUS_COPY from the original page.tsx
 * but extended with claim-flow-specific states.
 */
const STATUS_COPY: Record<ClaimFlowStatus, { label: string; hint: string }> = {
  pending: {
    label: "Waiting for confirmation",
    hint: "The terminal should now show the same phrase. Confirm on the laptop to finish pairing.",
  },
  redeemed: {
    label: "Verification phrase shown",
    hint: "Compare the phrase below with the one in your terminal, then confirm.",
  },
  confirmed: {
    label: "Setting up device session...",
    hint: "Almost there. Claiming your device session.",
  },
  claimed: {
    label: "Paired",
    hint: "This device is paired for 7 days.",
  },
  expired: {
    label: "Pairing expired",
    hint: "Start a new pairing from the terminal and try again.",
  },
  cancelled: {
    label: "Pairing cancelled",
    hint: "Start a new pairing from the terminal and try again.",
  },
  error: {
    label: "Pairing failed",
    hint: "Start a new pairing from the terminal.",
  },
  timeout: {
    label: "Pairing timed out",
    hint: "The pairing window has closed. Start a new pairing from the terminal.",
  },
};

export function PairingClaimFlow({
  pairingId,
  initialStatus,
  verificationPhrase,
  userCode,
}: PairingClaimFlowProps) {
  const [status, setStatus] = useState<ClaimFlowStatus>(
    initialStatus as ClaimFlowStatus,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Refs for mutable state the interval callback reads (Pitfall 3: stale closure)
  const claimInProgress = useRef(false);
  const consecutiveErrors = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  /**
   * D-05: auto-claim on detection. Posts to /claim and updates state.
   * Uses claimInProgress ref to prevent duplicate claims (Pitfall 2).
   */
  const claimDeviceSession = useCallback(async () => {
    if (claimInProgress.current) return;
    claimInProgress.current = true;

    try {
      const res = await fetch(`/api/pairings/${pairingId}/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      if (res.ok) {
        await res.json();
        setStatus("claimed");
        return;
      }

      if (res.status === 403) {
        const data = await res.json();
        if (data.error === "user_mismatch") {
          // D-08: hard error, do not retry
          setErrorMessage(
            "This pairing was started from a different account. Sign in with the correct account or start a new pairing.",
          );
          setStatus("error");
          return;
        }
      }

      // D-08: retry once on 500 before showing error
      if (res.status >= 500) {
        claimInProgress.current = false;
        // One silent retry
        const retry = await fetch(`/api/pairings/${pairingId}/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
        });
        if (retry.ok) {
          await retry.json();
          setStatus("claimed");
          return;
        }
        // Retry also failed
        setErrorMessage(
          "Pairing failed. Start a new pairing from the terminal.",
        );
        setStatus("error");
        return;
      }

      // Other error codes
      setErrorMessage(
        "Pairing failed. Start a new pairing from the terminal.",
      );
      setStatus("error");
    } catch {
      // Network error on claim
      claimInProgress.current = false;
      setErrorMessage(
        "Pairing failed. Start a new pairing from the terminal.",
      );
      setStatus("error");
    }
  }, [pairingId]);

  // Polling effect (D-01, D-07)
  useEffect(() => {
    const terminalStatuses: ClaimFlowStatus[] = [
      "claimed",
      "expired",
      "cancelled",
      "error",
      "timeout",
    ];
    if (terminalStatuses.includes(statusRef.current)) return;

    const intervalId = setInterval(async () => {
      // Skip poll if we're already in a terminal state or claiming
      if (terminalStatuses.includes(statusRef.current)) {
        clearInterval(intervalId);
        return;
      }
      if (claimInProgress.current) return;

      try {
        const res = await fetch(`/api/pairings/${pairingId}`);
        if (!res.ok) {
          consecutiveErrors.current += 1;
          if (consecutiveErrors.current >= RECONNECT_HINT_THRESHOLD) {
            setIsReconnecting(true);
          }
          return;
        }

        // Successful poll -- reset error tracking
        consecutiveErrors.current = 0;
        setIsReconnecting(false);

        const data = await res.json();

        if (data.status === "confirmed" && !claimInProgress.current) {
          clearInterval(intervalId);
          setStatus("confirmed");
          await claimDeviceSession();
        } else if (data.status === "expired") {
          clearInterval(intervalId);
          setStatus("expired");
        } else if (data.status === "cancelled") {
          clearInterval(intervalId);
          setStatus("cancelled");
        }
        // pending or redeemed -- keep polling
      } catch {
        // Network error during poll -- D-08: silent retry with hint
        consecutiveErrors.current += 1;
        if (consecutiveErrors.current >= RECONNECT_HINT_THRESHOLD) {
          setIsReconnecting(true);
        }
      }
    }, POLL_INTERVAL_MS);

    // D-07: hard wall-clock timeout at 5 minutes
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      if (!terminalStatuses.includes(statusRef.current)) {
        setStatus("timeout");
      }
    }, POLL_TIMEOUT_MS);

    return () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [pairingId, claimDeviceSession]);

  const currentCopy = STATUS_COPY[status] ?? STATUS_COPY.error;

  return (
    <>
      <header
        style={{
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <h1 style={{ fontSize: "26px", fontWeight: 600, margin: 0 }}>
          {status === "claimed" ? "Phone paired" : "Pair this phone"}
        </h1>
        <p style={{ fontSize: "15px", color: "#555", margin: 0 }}>
          {currentCopy.label}
        </p>
      </header>

      {/* Verification phrase section -- shown for non-terminal states and claimed */}
      {verificationPhrase && (
        <section
          aria-label="Verification phrase"
          style={{
            width: "100%",
            border: "1px solid #e5e5e5",
            borderRadius: "12px",
            padding: "20px",
            background: status === "claimed" ? "#f0fdf0" : "#fafafa",
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
            {status === "claimed" ? "Paired device" : "Verification phrase"}
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
            {currentCopy.hint}
          </p>
        </section>
      )}

      {/* Fallback code -- only shown during non-terminal waiting states */}
      {(status === "pending" || status === "redeemed") && userCode && (
        <section
          aria-label="Fallback code"
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <span
            style={{
              fontSize: "12px",
              color: "#777",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
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
            {userCode}
          </code>
        </section>
      )}

      {/* Waiting hint for pre-confirmation states */}
      {(status === "pending" || status === "redeemed") && (
        <p
          style={{
            fontSize: "13px",
            color: "#666",
            textAlign: "center",
            margin: 0,
          }}
        >
          The device session is only granted after you confirm this phrase
          from the terminal on your laptop.
        </p>
      )}

      {/* D-08: reconnecting hint */}
      {isReconnecting && status !== "error" && status !== "timeout" && (
        <p
          style={{
            fontSize: "12px",
            color: "#999",
            textAlign: "center",
            margin: 0,
          }}
        >
          Reconnecting...
        </p>
      )}

      {/* D-08: error message */}
      {errorMessage && (
        <p
          style={{
            fontSize: "14px",
            color: "#c53030",
            textAlign: "center",
            margin: 0,
            padding: "12px 16px",
            background: "#fff5f5",
            borderRadius: "8px",
            border: "1px solid #feb2b2",
          }}
        >
          {errorMessage}
        </p>
      )}

      {/* Confirmed state -- visual indicator while claiming */}
      {status === "confirmed" && (
        <p
          style={{
            fontSize: "13px",
            color: "#555",
            textAlign: "center",
            margin: 0,
          }}
        >
          Confirmed! Setting up your device session...
        </p>
      )}
    </>
  );
}
