/**
 * Mobile-first sign-in screen for Codex Mobile.
 *
 * This page is intentionally the ONLY public route in `apps/web` other
 * than `/api/auth/*`. It uses a plain server component plus a server
 * action that invokes Auth.js `signIn("github")` so the flow works
 * without client-side JavaScript (OAuth redirect only).
 *
 * Design notes:
 *   - Phone-sized layout: single column, large touch targets, no desktop
 *     terminal chrome.
 *   - The exact CTA string is `Continue with GitHub` — matching the Phase
 *     1 plan acceptance criteria.
 *   - `callbackUrl` round-trips through the query string so users return
 *     to the pairing screen they originally tried to open.
 */
import { signIn } from "../../auth";

interface SignInPageProps {
  searchParams?: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = (await searchParams) ?? {};
  const callbackUrl = params.callbackUrl ?? "/";
  const error = params.error;

  async function handleSignIn() {
    "use server";
    await signIn("github", { redirectTo: callbackUrl });
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        gap: "24px",
        maxWidth: "420px",
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 600, margin: 0 }}>
          Codex Mobile
        </h1>
        <p style={{ fontSize: "16px", color: "#555", margin: 0 }}>
          Sign in to pair a local Codex session with this phone.
        </p>
      </header>

      <form action={handleSignIn} style={{ width: "100%" }}>
        <button
          type="submit"
          style={{
            width: "100%",
            minHeight: "52px",
            fontSize: "17px",
            fontWeight: 600,
            borderRadius: "12px",
            border: "1px solid #111",
            background: "#111",
            color: "#fff",
            padding: "12px 20px",
            cursor: "pointer",
          }}
        >
          Continue with GitHub
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          style={{
            color: "#b42318",
            fontSize: "14px",
            margin: 0,
          }}
        >
          Sign-in failed. Please try again.
        </p>
      ) : null}

      <footer style={{ fontSize: "12px", color: "#888" }}>
        By continuing you agree to the Codex Mobile trust-boundary terms.
      </footer>
    </main>
  );
}
