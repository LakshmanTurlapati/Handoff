/**
 * Achilles outbound network allowlist (SAFE-03).
 *
 * The wrapper packages (`@achilles/voice-stt` in the renderer and
 * `@achilles/voice-tts` in main) MUST only open WebSocket / HTTPS
 * connections to ElevenLabs hosts. This module is the single source
 * of truth for "is this host an ElevenLabs host?".
 *
 * The matcher refuses substring-attack hostnames by parsing the
 * host on dot boundaries instead of doing a naive `.endsWith()`.
 * For example, `api.elevenlabs.io.evil.com` would pass a naive
 * `host.endsWith("elevenlabs.io")` check only if the attacker chose
 * a different TLD; the actual host here is `evil.com` so it must be
 * refused. The implementation below splits on dots and verifies the
 * trailing TWO labels are exactly `elevenlabs` and `io`.
 *
 * SAFE-03 also bans third-party telemetry and any inbound listening
 * sockets. Those constraints are enforced elsewhere (the wrappers
 * simply do not open such sockets); the allowlist below is the
 * outbound side.
 */

/**
 * Concrete ElevenLabs hosts Achilles knows about today. Kept as a
 * read-only literal tuple so downstream code can typecheck against
 * the exact set. Regional residency subdomains are listed here for
 * EU and India users where data residency is required.
 *
 * NOTE: the allowlist below is wider than this tuple — anything
 * ending in `.elevenlabs.io` (and bare `elevenlabs.io`) is accepted
 * so that ElevenLabs can introduce new regional subdomains without
 * an Achilles release. The tuple exists for ergonomics: downstream
 * code can `import { ELEVENLABS_HOST_ALLOWLIST }` and bind concrete
 * URLs without rebuilding the regex.
 */
export const ELEVENLABS_HOST_ALLOWLIST = [
  "api.elevenlabs.io",
  "api.us.elevenlabs.io",
  "api.eu.residency.elevenlabs.io",
  "api.in.residency.elevenlabs.io",
] as const;

export type ElevenLabsHost = (typeof ELEVENLABS_HOST_ALLOWLIST)[number];

/**
 * Returns true if `host` is an ElevenLabs host under the SAFE-03
 * allowlist. Acceptance rules:
 *
 *   1. Exact match against any entry in `ELEVENLABS_HOST_ALLOWLIST`.
 *   2. The bare apex `elevenlabs.io`.
 *   3. Any host whose last two dot-separated labels are exactly
 *      `elevenlabs` and `io` (i.e. `<anything>.elevenlabs.io`).
 *
 * Rule (3) is implemented by splitting on dots and comparing the
 * trailing labels. This refuses substring attacks like
 * `api.elevenlabs.io.evil.com` (last two labels are `evil` and
 * `com`).
 */
export function isElevenLabsHost(host: string): boolean {
  if (typeof host !== "string" || host.length === 0) {
    return false;
  }
  const normalized = host.toLowerCase();
  for (const allowed of ELEVENLABS_HOST_ALLOWLIST) {
    if (normalized === allowed) {
      return true;
    }
  }
  if (normalized === "elevenlabs.io") {
    return true;
  }
  const labels = normalized.split(".");
  if (labels.length < 2) {
    return false;
  }
  const last = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  return last === "io" && second === "elevenlabs";
}

/**
 * Assert that `url` points at an ElevenLabs host. Returns the
 * canonical URL string when the host is allowed; throws an Error
 * whose message includes `SAFE-03` and the offending host when not.
 *
 * Accepts either a string URL or a URL object. The hostname is
 * lowercased before comparison so `API.ElevenLabs.IO` is accepted.
 *
 * Wrappers SHOULD call this exactly once per outbound connection
 * attempt — typically right before invoking the SDK's connect
 * method. Throwing here surfaces the policy violation at the
 * call site rather than as an opaque network error later.
 */
export function assertElevenLabsHost(url: string | URL): string {
  let parsed: URL;
  try {
    parsed = url instanceof URL ? url : new URL(url);
  } catch {
    throw new Error(
      `Outbound URL '${String(url)}' is not parseable; SAFE-03 allowlist cannot be evaluated`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (!isElevenLabsHost(host)) {
    throw new Error(
      `Outbound host '${host}' is not in the ElevenLabs allowlist (SAFE-03)`,
    );
  }
  return parsed.toString();
}
