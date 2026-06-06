// v1.2 hand-rolls the wire protocol for CI offline-testability; v1.3 will migrate to @elevenlabs/* SDKs once a sandbox account is provisioned.
/**
 * Renderer-side ElevenLabs Scribe v2 Realtime client.
 *
 * Boundary contract (SAFE-01):
 *   This module accepts a `getToken` callback ONLY. The raw ElevenLabs
 *   API key is the main process's responsibility (see
 *   `./token-mint.ts`) and never reaches this surface. The
 *   `createRealtimeSttClient` signature deliberately excludes any
 *   `apiKey` field; adding one is a regression.
 *
 * Boundary contract (SAFE-03):
 *   The outbound WebSocket URL is validated against the ElevenLabs
 *   allowlist (`assertElevenLabsHost`) at construction time, BEFORE
 *   any network I/O. A substring-attack host such as
 *   `wss://api.elevenlabs.io.evil.com/...` is refused with the
 *   `SAFE-03` marker in the error message.
 *
 * Boundary contract (PITFALLS #1):
 *   Frames passed to `write(frame)` MUST already be 16 kHz mono int16
 *   PCM. Resampling is the responsibility of the renderer's
 *   AudioWorklet (Phase 11). The wrapper does not inspect the audio
 *   bytes; it simply base64-encodes them and forwards them.
 *
 * Boundary contract (PITFALLS #4):
 *   The WebSocket is opened on `start()` and closed on `stop()` or on
 *   a final committed transcript. Reconnect logic uses
 *   `computeBackoffMs` with the cap from `RECONNECT_MAX_ATTEMPTS`. The
 *   429 family is mapped to typed `SttErrorEvent` codes
 *   (`rate_limit`, `concurrent_limit`, `auth`) so the UI surface can
 *   distinguish them and so a `concurrent_limit` does not provoke a
 *   retry storm.
 *
 * Logging discipline (PITFALLS #22):
 *   Only `console.error` is used and only with the `[voice-stt]` prefix.
 *   Audio bytes, the token, and full transcript content are NEVER
 *   logged. Transcript length and lifecycle transitions are permitted.
 */
import type { SttEvent } from "@achilles/voice-protocol";
import {
  CommittedTranscriptSchema,
  PartialTranscriptSchema,
  SttErrorEventSchema,
  assertElevenLabsHost,
} from "@achilles/voice-protocol";
import { computeBackoffMs } from "./backoff.js";
import {
  AUDIO_FORMAT,
  RECONNECT_MAX_ATTEMPTS,
  STT_REALTIME_URL,
} from "./constants.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Minimal WebSocket type accepted by the realtime client. We do not
 * import `lib.dom`'s `WebSocket` directly because the wrapper must be
 * able to run under Node's Vitest where the global type is absent;
 * accepting a structural interface keeps the surface portable.
 */
export interface SttWebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    event: "open" | "close" | "message" | "error",
    handler: (ev: SttSocketEvent) => void,
  ): void;
  removeEventListener?(
    event: "open" | "close" | "message" | "error",
    handler: (ev: SttSocketEvent) => void,
  ): void;
}

/**
 * Tagged-union of the WebSocket events the wrapper cares about. The
 * shape mirrors the DOM `WebSocket` event surface but is intentionally
 * narrow so a mock WebSocket in tests does not need to implement the
 * full DOM type hierarchy.
 */
export type SttSocketEvent =
  | { type: "open" }
  | { type: "close"; code: number; reason?: string }
  | { type: "message"; data: string }
  | { type: "error"; message?: string };

/**
 * Constructor signature for a WebSocket-like factory. Accepts the URL
 * and an optional sub-protocols array (Scribe v2 Realtime carries the
 * single-use token in the subprotocol position; see
 * https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming).
 */
export type SttWebSocketCtor = (
  url: string,
  protocols?: string | string[],
) => SttWebSocketLike;

/**
 * Options for `createRealtimeSttClient`.
 *
 * - `getToken`: callback the wrapper invokes on every `start()` to
 *   obtain a fresh single-use STT token. The token is short-lived
 *   (~15 minutes); the callback typically delegates to the main
 *   process over IPC.
 * - `url`: optional WebSocket URL override. Defaults to
 *   `STT_REALTIME_URL`. MUST pass the SAFE-03 allowlist or
 *   construction throws.
 * - `webSocketCtor`: optional WebSocket constructor for testing or
 *   bring-your-own-transport. Defaults to `globalThis.WebSocket`.
 * - `onEvent`: optional sink that receives every emitted `SttEvent`.
 *   Provided as a synchronous callback so tests can collect events
 *   without depending on async-iterator polyfills.
 */
export interface CreateRealtimeSttClientOptions {
  getToken: () => Promise<{ token: string; expiresAt: string }>;
  url?: string;
  webSocketCtor?: SttWebSocketCtor;
  onEvent?: (e: SttEvent) => void;
}

/**
 * The realtime STT client surface returned by
 * `createRealtimeSttClient`. The `events$` field is an
 * `AsyncIterable<SttEvent>` for downstream code that wants to consume
 * the event stream as an async iterator. `onEvent` (set at
 * construction time) is the synchronous alternative used by tests.
 */
export interface RealtimeSttClient {
  events$: AsyncIterable<SttEvent>;
  start(): Promise<void>;
  stop(): Promise<void>;
  write(frame: Int16Array): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * WebSocket close code emitted by ElevenLabs on a successful clean
 * close. 1000 is the standard "normal closure" close code; any other
 * code is treated as a candidate for reconnect.
 */
const WS_NORMAL_CLOSE = 1000;

/**
 * Logging prefix per PITFALLS #22 / CONTEXT.md logging directive.
 * Stable so the consuming app can grep for `[voice-stt]` in logs.
 */
const LOG_PREFIX = "[voice-stt]";

/**
 * Internal lifecycle states. Kept narrow so the wrapper cannot fall
 * into an in-between state silently.
 */
type Lifecycle = "idle" | "connecting" | "open" | "closing" | "closed";

/**
 * Inbound ElevenLabs Scribe v2 Realtime message types we recognise.
 * Any other `type` value is logged and ignored — the wrapper is a
 * lenient consumer to survive minor server-side additions.
 */
interface ServerSessionStarted {
  type: "session_started";
}
interface ServerPartialTranscript {
  type: "partial_transcript";
  text?: string;
  confidence?: number;
}
interface ServerCommittedTranscript {
  type: "committed_transcript";
  text?: string;
  duration_ms?: number;
}
interface ServerError {
  type: "error";
  status?: string;
  message?: string;
}
type ServerMessage =
  | ServerSessionStarted
  | ServerPartialTranscript
  | ServerCommittedTranscript
  | ServerError
  | { type: string };

/**
 * Factory for the realtime STT client. See
 * {@link CreateRealtimeSttClientOptions} for the input contract and
 * {@link RealtimeSttClient} for the output.
 */
export function createRealtimeSttClient(
  opts: CreateRealtimeSttClientOptions,
): RealtimeSttClient {
  // ---- SAFE-03 enforcement (BEFORE any I/O, BEFORE any return) ----
  const url = opts.url ?? STT_REALTIME_URL;
  assertElevenLabsHost(url);

  // ---- Defence-in-depth: ensure the caller did not slip an apiKey in.
  // TypeScript already rejects this, but a JS caller could. We pluck
  // the documented fields and ignore anything else.
  const getToken = opts.getToken;
  const webSocketCtor = opts.webSocketCtor ?? defaultWebSocketCtor();
  const onEvent = opts.onEvent;

  let lifecycle: Lifecycle = "idle";
  let socket: SttWebSocketLike | null = null;
  let reconnectAttempt = 0;
  let utteranceStartMs: number | null = null;
  // CR-01: handle for the in-flight reconnect timer. We retain a reference
  // so stop() can clear it; without this, a reconnect scheduled inside the
  // backoff window fires unconditionally and opens a new WebSocket AFTER
  // the consumer asked to stop — a real resource and quota leak.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // WR-04: per-socket listener handles. We retain explicit references so
  // detachAll() can unbind them before the socket is replaced. Without
  // this, late events fired on a stale socket (notably a delayed
  // `close` after the reconnect path has already taken over) would
  // re-enter scheduleReconnect on the old listener and provoke an
  // unintended reconnect.
  type ListenerBag = {
    open: (ev: SttSocketEvent) => void;
    close: (ev: SttSocketEvent) => void;
    message: (ev: SttSocketEvent) => void;
    error: (ev: SttSocketEvent) => void;
  } | null;
  let listeners: ListenerBag = null;

  // Async-iterable backing buffer. We hold a list of pending events
  // and an awaiter promise; this is the standard pattern for turning
  // a push-based callback into an async iterable without an external
  // dep.
  const pendingEvents: SttEvent[] = [];
  let awaiter: (() => void) | null = null;
  let iterableDone = false;

  function emit(event: SttEvent): void {
    pendingEvents.push(event);
    if (awaiter) {
      const fn = awaiter;
      awaiter = null;
      fn();
    }
    if (onEvent) {
      try {
        onEvent(event);
      } catch (cbErr) {
        console.error(`${LOG_PREFIX} onEvent callback threw`, asError(cbErr));
      }
    }
  }

  const events$: AsyncIterable<SttEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<SttEvent> {
      return {
        async next(): Promise<IteratorResult<SttEvent>> {
          while (pendingEvents.length === 0 && !iterableDone) {
            await new Promise<void>((resolve) => {
              awaiter = resolve;
            });
          }
          if (pendingEvents.length > 0) {
            const value = pendingEvents.shift() as SttEvent;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };

  function closeIterable(): void {
    iterableDone = true;
    if (awaiter) {
      const fn = awaiter;
      awaiter = null;
      fn();
    }
  }

  /**
   * WR-04: unbind all listeners from `socket` before replacing it. Safe
   * to call when listeners or socket is null (no-op). The wrapper holds
   * named references so removeEventListener can identify the exact
   * handlers — anonymous functions cannot be removed.
   */
  function detachAll(): void {
    if (socket && listeners && typeof socket.removeEventListener === "function") {
      try {
        socket.removeEventListener("open", listeners.open);
        socket.removeEventListener("close", listeners.close);
        socket.removeEventListener("message", listeners.message);
        socket.removeEventListener("error", listeners.error);
      } catch (detachErr) {
        // Removal is best-effort — if the runtime refuses, we still
        // null out the references below so the wrapper itself does not
        // re-enter via the listeners.
        console.error(
          `${LOG_PREFIX} listener detach failed`,
          asError(detachErr).message,
        );
      }
    }
    listeners = null;
  }

  async function connect(): Promise<void> {
    lifecycle = "connecting";
    let token: string;
    try {
      const tokenResult = await getToken();
      token = tokenResult.token;
    } catch (tokenErr) {
      const err = asError(tokenErr);
      console.error(`${LOG_PREFIX} getToken failed`, err.message);
      emitErrorEvent("auth", false, "getToken rejected");
      lifecycle = "closed";
      closeIterable();
      return;
    }
    // CR-02: re-check lifecycle after `await getToken()`. A consumer
    // that called stop() during the token fetch already wants the
    // wrapper torn down — we MUST NOT construct a fresh WebSocket
    // afterwards. Silent return is correct: stop() already set
    // lifecycle = "closed" and closed the iterable.
    //
    // The double-cast is necessary because TypeScript's control-flow
    // analyzer narrows `lifecycle` to "connecting" after the assignment
    // on the first line of connect(); it does not see that the outer
    // `let` can be mutated by stop() during the await. We re-read
    // through a non-narrowing reference so the comparison type-checks.
    const readLifecycle = (): Lifecycle => lifecycle;
    const post = readLifecycle();
    if (post === "closing" || post === "closed") {
      return;
    }

    // ElevenLabs realtime auth uses the single-use token in a header
    // location they document. The browser SDK passes the token via the
    // WebSocket subprotocol position; we mirror that here so the same
    // shape works against the real SDK and the mock in tests.
    let ws: SttWebSocketLike;
    try {
      ws = webSocketCtor(url, ["xi-realtime-token", token]);
    } catch (ctorErr) {
      console.error(
        `${LOG_PREFIX} WebSocket construction threw`,
        asError(ctorErr).message,
      );
      scheduleReconnect("network");
      return;
    }
    socket = ws;

    // WR-04: define named handlers in a bag so detachAll() can unbind
    // the exact same references later.
    const bag: NonNullable<ListenerBag> = {
      open: () => {
        lifecycle = "open";
        reconnectAttempt = 0;
        utteranceStartMs = Date.now();
      },
      message: (ev) => {
        if (ev.type !== "message") {
          return;
        }
        handleServerMessage(ev.data);
      },
      close: (ev) => {
        if (ev.type !== "close") {
          return;
        }
        // WR-04: defensive — if this fires on a stale socket after the
        // wrapper has already swapped to a new one, the bag reference
        // mismatch means we are not the active listener bag and must
        // do nothing.
        if (bag !== listeners) {
          return;
        }
        socket = null;
        listeners = null;
        if (lifecycle === "closing") {
          lifecycle = "closed";
          closeIterable();
          return;
        }
        if (ev.code === WS_NORMAL_CLOSE) {
          lifecycle = "closed";
          closeIterable();
          return;
        }
        scheduleReconnect("network");
      },
      error: (ev) => {
        if (ev.type !== "error") {
          return;
        }
        console.error(
          `${LOG_PREFIX} websocket error`,
          ev.message ?? "(no message)",
        );
      },
    };
    listeners = bag;
    ws.addEventListener("open", bag.open);
    ws.addEventListener("message", bag.message);
    ws.addEventListener("close", bag.close);
    ws.addEventListener("error", bag.error);
  }

  function handleServerMessage(raw: string): void {
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(raw) as ServerMessage;
    } catch {
      console.error(`${LOG_PREFIX} dropped non-JSON server message`);
      return;
    }

    switch (parsed.type) {
      case "session_started":
        return;
      case "partial_transcript": {
        const candidate = {
          type: "partial" as const,
          text: (parsed as ServerPartialTranscript).text ?? "",
          confidence: (parsed as ServerPartialTranscript).confidence ?? 0,
        };
        const result = PartialTranscriptSchema.safeParse(candidate);
        if (result.success) {
          emit(result.data);
        } else {
          // WR-01: do NOT silently drop. Surface to console.error so
          // ops can see the dropped event, and emit a synthetic
          // SttErrorEvent so downstream consumers can observe the
          // failure on the same events$ surface. The most common
          // trigger is the server emitting an empty `text` for a
          // very short utterance (Zod's z.string().min(1) rejects it).
          console.error(
            `${LOG_PREFIX} schema parse failed for partial_transcript`,
            result.error,
          );
          emitErrorEvent(
            "unknown",
            true,
            "partial_transcript dropped: schema validation failed",
          );
        }
        return;
      }
      case "committed_transcript": {
        const startedAt = utteranceStartMs ?? Date.now();
        const inferredDuration = Math.max(0, Date.now() - startedAt);
        const candidate = {
          type: "committed" as const,
          text: (parsed as ServerCommittedTranscript).text ?? "",
          durationMs: Math.floor(
            (parsed as ServerCommittedTranscript).duration_ms ??
              inferredDuration,
          ),
        };
        const result = CommittedTranscriptSchema.safeParse(candidate);
        if (result.success) {
          emit(result.data);
        } else {
          // WR-01: surface the parse failure (see partial_transcript
          // comment for the rationale).
          console.error(
            `${LOG_PREFIX} schema parse failed for committed_transcript`,
            result.error,
          );
          emitErrorEvent(
            "unknown",
            true,
            "committed_transcript dropped: schema validation failed",
          );
        }
        utteranceStartMs = Date.now();
        return;
      }
      case "error": {
        const status = (parsed as ServerError).status ?? "";
        if (status === "too_many_concurrent_requests") {
          emitErrorEvent("concurrent_limit", true);
        } else if (status === "system_busy" || status === "rate_limited") {
          emitErrorEvent("rate_limit", true);
        } else if (status === "unauthorized" || status === "auth") {
          emitErrorEvent("auth", false);
        } else {
          emitErrorEvent("unknown", true);
        }
        return;
      }
      default:
        // Unknown server type — log and ignore.
        console.error(
          `${LOG_PREFIX} unknown server message type`,
          String(parsed.type),
        );
    }
  }

  function emitErrorEvent(
    code:
      | "rate_limit"
      | "concurrent_limit"
      | "network"
      | "auth"
      | "unknown",
    retryable: boolean,
    message?: string,
  ): void {
    const candidate = {
      type: "error" as const,
      code,
      retryable,
      ...(message ? { message } : {}),
    };
    const parsed = SttErrorEventSchema.safeParse(candidate);
    if (parsed.success) {
      emit(parsed.data);
    }
  }

  function scheduleReconnect(reason: "network" | "rate_limit"): void {
    if (lifecycle === "closing" || lifecycle === "closed") {
      return;
    }
    const delay = computeBackoffMs(reconnectAttempt);
    if (!Number.isFinite(delay)) {
      // Give-up sentinel — surface terminal error.
      emitErrorEvent(
        reason === "rate_limit" ? "rate_limit" : "network",
        false,
        `reconnect cap reached after ${RECONNECT_MAX_ATTEMPTS} attempts`,
      );
      lifecycle = "closed";
      closeIterable();
      return;
    }
    reconnectAttempt += 1;
    lifecycle = "connecting";
    // CR-01: retain the timer handle and re-check lifecycle inside the
    // timer body. If stop() ran during the backoff window, both the
    // clearTimeout in stop() AND this guard prevent a stray connect().
    // (The clearTimeout is the primary defence; the guard is belt and
    // braces in case the timer fires before clearTimeout takes effect.)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (lifecycle === "closing" || lifecycle === "closed") {
        return;
      }
      void connect();
    }, delay);
  }

  function write(frame: Int16Array): void {
    if (!socket || lifecycle !== "open") {
      // Silently drop frames before the socket is open — the renderer's
      // AudioWorklet may begin emitting frames before `start()` resolves.
      return;
    }
    const audioB64 = encodeInt16ToBase64(frame);
    const payload = JSON.stringify({
      type: "input_audio_chunk",
      audio: audioB64,
      sample_rate: AUDIO_FORMAT.sampleRate,
    });
    try {
      socket.send(payload);
    } catch (sendErr) {
      console.error(
        `${LOG_PREFIX} socket send failed`,
        asError(sendErr).message,
      );
    }
  }

  async function start(): Promise<void> {
    if (lifecycle !== "idle" && lifecycle !== "closed") {
      return;
    }
    lifecycle = "idle";
    reconnectAttempt = 0;
    await connect();
  }

  async function stop(): Promise<void> {
    lifecycle = "closing";
    // CR-01: cancel any pending reconnect BEFORE we tear the socket
    // down. If the timer has already fired but the connect() callback
    // is queued on the microtask queue, the lifecycle re-check inside
    // connect() (CR-02) catches that case.
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // WR-04: unbind listeners BEFORE close() so a synchronous close
    // event fired by the runtime cannot re-enter scheduleReconnect on
    // the old socket. detachAll() is safe to call when listeners are
    // already null.
    detachAll();
    if (socket) {
      try {
        socket.close(WS_NORMAL_CLOSE, "client requested stop");
      } catch (closeErr) {
        console.error(
          `${LOG_PREFIX} socket close failed`,
          asError(closeErr).message,
        );
      }
      socket = null;
    }
    lifecycle = "closed";
    closeIterable();
  }

  return { events$, start, stop, write };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Resolve a default WebSocket constructor at lookup time. We do the
 * lookup lazily so the module can be imported under Node (Vitest)
 * without `globalThis.WebSocket` being defined.
 */
function defaultWebSocketCtor(): SttWebSocketCtor {
  return (url: string, protocols?: string | string[]): SttWebSocketLike => {
    const Ctor = (globalThis as { WebSocket?: unknown }).WebSocket as
      | (new (u: string, p?: string | string[]) => SttWebSocketLike)
      | undefined;
    if (!Ctor) {
      throw new Error(
        "createRealtimeSttClient: globalThis.WebSocket is not defined; pass `webSocketCtor` explicitly",
      );
    }
    return new Ctor(url, protocols);
  };
}

/**
 * Base64-encode an Int16Array. Uses `Buffer` when available (Node /
 * Electron main) and falls back to `btoa` (renderer / browsers).
 *
 * NOTE: this helper does NOT inspect the audio bytes; it just relays
 * them. PITFALLS #1 / #22 — audio bytes are never logged here.
 */
function encodeInt16ToBase64(frame: Int16Array): string {
  const bytes = new Uint8Array(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength,
  );
  const NodeBuffer = (
    globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } }
  ).Buffer;
  if (NodeBuffer) {
    return NodeBuffer.from(bytes).toString("base64");
  }
  // Browser fallback.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  const browserBtoa = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (browserBtoa) {
    return browserBtoa(binary);
  }
  throw new Error(
    "encodeInt16ToBase64: no Buffer or btoa available in this runtime",
  );
}
