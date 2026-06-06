/**
 * Achilles renderer<->main IPC envelope (SAFE-01 boundary).
 *
 * These Zod schemas constrain the messages that cross the Electron
 * IPC bridge between the renderer (BrowserWindow) and the main process.
 * The boundary is the SAFE-01 trust boundary: the raw ElevenLabs API
 * key lives only in main and must NEVER traverse this envelope.
 *
 * The single concrete flow this file enforces today is the STT token
 * mint:
 *
 *   renderer -> main: MintSttTokenRequest  (no apiKey field allowed)
 *   main -> renderer: MintSttTokenResponse (token must not look like
 *                                            a raw ElevenLabs API key)
 *
 * Strictness model:
 *
 *   - `.strict()` on every object schema refuses unknown keys. This is
 *     the SAFE-01 enforcement against a compromised renderer that
 *     tries to piggyback an `apiKey`, `xi_api_key`, or `key` field
 *     into a request (see PITFALLS.md #22 — "ElevenLabs API key leaks
 *     to client-side code or logs"). The fields are not declared, so
 *     `.strict()` rejects them; the test suite asserts this directly.
 *
 *   - `MintSttTokenResponseSchema.token.refine(...)` is defence in
 *     depth: even if a future bug in the main process produces a raw
 *     API key where a single-use token was expected, the response is
 *     refused at the renderer's parse step. The shape we check
 *     against is "starts with the ElevenLabs key prefix AND is at
 *     least `ELEVENLABS_KEY_MIN_LENGTH` characters" — long enough
 *     to be a real key, not a short user input that happens to share
 *     the prefix.
 *
 * Discriminated union model: `VoiceIpcEnvelopeSchema` is the top-level
 * type that downstream consumers (Phase 11 renderer + main IPC
 * handlers) parse against. Unknown `type` literals are rejected.
 */
import { z } from "zod";

/**
 * Literal prefix used by raw ElevenLabs API keys (`sk_...`). Used by
 * `MintSttTokenResponseSchema` to refuse a token value that looks
 * like a raw key.
 */
export const ELEVENLABS_KEY_PREFIX = "sk_";

/**
 * Minimum length we require before refusing a response token that
 * starts with `ELEVENLABS_KEY_PREFIX`. ElevenLabs keys are well
 * above this length; this floor exists to avoid false positives on
 * short fixture tokens that happen to share the prefix.
 */
export const ELEVENLABS_KEY_MIN_LENGTH = 32;

/**
 * Renderer-to-main: please mint a single-use STT token for the
 * realtime Scribe v2 model.
 *
 * `.strict()` here is the SAFE-01 enforcement: the schema declares
 * exactly `type` and `model`, so any extra key — including the
 * "apiKey" / "xi_api_key" / "key" patterns called out in PITFALLS.md
 * #22 — is refused.
 *
 * NOTE: the only model permitted is `scribe_v2_realtime`. Scribe v1
 * and Turbo are deprecated (see STACK.md "What NOT to Use") and the
 * literal here prevents a downstream caller from negotiating them.
 */
export const MintSttTokenRequestSchema = z
  .object({
    type: z.literal("mint-stt-token"),
    model: z.literal("scribe_v2_realtime"),
  })
  .strict();

export type MintSttTokenRequest = z.infer<typeof MintSttTokenRequestSchema>;

/**
 * Main-to-renderer: here is your single-use STT token.
 *
 * - `token`: the short-lived (~15 minute) realtime token minted by
 *   main against `/v1/realtime/token`. MUST NOT be a raw API key.
 *   The `.refine` guard rejects any value that looks like one (begins
 *   with `ELEVENLABS_KEY_PREFIX` and is at least
 *   `ELEVENLABS_KEY_MIN_LENGTH` characters long).
 * - `expiresAt`: absolute ISO-8601 timestamp at which the token stops
 *   being accepted by the ElevenLabs WebSocket.
 *
 * `.strict()` again — no extra fields allowed.
 */
export const MintSttTokenResponseSchema = z
  .object({
    type: z.literal("mint-stt-token-response"),
    token: z
      .string()
      .min(1)
      .refine(
        (t) =>
          !(
            t.startsWith(ELEVENLABS_KEY_PREFIX) &&
            t.length >= ELEVENLABS_KEY_MIN_LENGTH
          ),
        {
          message:
            "Response token must not be a raw ElevenLabs API key (SAFE-01)",
        },
      ),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type MintSttTokenResponse = z.infer<typeof MintSttTokenResponseSchema>;

/**
 * Discriminated union over every renderer<->main voice IPC message.
 * Downstream handlers parse against this top-level schema; the
 * discriminator is `type` and unknown literals are rejected.
 */
export const VoiceIpcEnvelopeSchema = z.discriminatedUnion("type", [
  MintSttTokenRequestSchema,
  MintSttTokenResponseSchema,
]);

export type VoiceIpcEnvelope = z.infer<typeof VoiceIpcEnvelopeSchema>;
