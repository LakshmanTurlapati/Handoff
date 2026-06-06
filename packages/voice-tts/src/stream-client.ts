// v1.2 hand-rolls the wire protocol for CI offline-testability; v1.3 will migrate to @elevenlabs/* SDKs once a sandbox account is provisioned.
/**
 * @achilles/voice-tts stream client — ElevenLabs Flash v2.5 stream-input.
 *
 * Boundary contracts:
 *
 *   - SAFE-03: the outbound URL is validated against the ElevenLabs
 *     allowlist (`assertElevenLabsHost`) at construction time, BEFORE
 *     any WebSocket open. A substring-attack host such as
 *     `wss://api.elevenlabs.io.evil.com/...` is refused.
 *
 *   - SAFE-01 + PITFALLS #22: the API key NEVER appears in this
 *     module's options. The consumer injects a `KeySource` callback
 *     and the wrapper awaits it once per stream open. The resolved
 *     string is forwarded to the WebSocket header and then dropped
 *     from the local closure — it is never logged, never persisted,
 *     never re-emitted on `events$`.
 *
 *   - PITFALLS #5: the model id is locked to `FLASH_MODEL`; the
 *     deprecated Turbo id is refused upstream via `assertFlashModel`.
 *
 *   - PITFALLS #6: the initial frame carries the locked
 *     `CHUNK_LENGTH_SCHEDULE` so the upstream server uses the
 *     low-latency conversational schedule.
 *
 *   - PITFALLS #4: WebSocket close with a non-1000 code triggers an
 *     exponential-with-full-jitter reconnect via `computeBackoffMs`,
 *     capped at `RECONNECT_MAX_ATTEMPTS`. Past the cap, a final
 *     `error` event is emitted with code "network" and the client
 *     stops trying.
 */
import { Buffer } from "node:buffer";

import {
  assertElevenLabsHost,
  TtsChunkSchema,
  TtsStreamCompleteSchema,
  type TtsChunk,
  type TtsEvent,
  type TtsStreamComplete,
} from "@achilles/voice-protocol";

import { computeBackoffMs } from "./backoff.js";
import {
  buildTtsStreamUrl,
  CHUNK_LENGTH_SCHEDULE,
  DEFAULT_OUTPUT_FORMAT,
  FLASH_MODEL,
  RECONNECT_MAX_ATTEMPTS,
} from "./constants.js";
import { callKeySource, type KeySource } from "./key-source.js";

/**
 * Audio output format for the Flash v2.5 stream-input WS. MP3 is the
 * v1.2 default because the renderer's `AudioContext` decodes it
 * natively; PCM is permitted for callers that want raw frames.
 */
export type TtsOutputFormat = "mp3_44100" | "pcm_16000";

/**
 * Constructor options for the TTS stream client.
 *
 * The signature deliberately excludes any `apiKey` parameter — the
 * package never accepts a raw key. Authentication is via the
 * consumer-injected `keySource` callback, which the wrapper awaits
 * once per stream open and discards immediately after the open frame
 * lands on the wire.
 */
export interface CreateTtsStreamClientOptions {
  /**
   * Consumer-injected callback that resolves the ElevenLabs API key.
   * The wrapper never persists the resolved string after the open
   * frame is sent. See `key-source.ts` for the security stance.
   */
  keySource: KeySource;
  /**
   * The ElevenLabs voice id to synthesise against. Interpolated into
   * the stream-input URL template by `buildTtsStreamUrl`.
   */
  voiceId: string;
  /**
   * Optional URL override. Useful for the regional residency hosts
   * (`api.us.elevenlabs.io`, `api.eu.residency.elevenlabs.io`). The
   * supplied URL is passed through `assertElevenLabsHost` at
   * construction time — non-ElevenLabs hosts throw SAFE-03.
   */
  url?: string;
  /**
   * Injection point for a WebSocket constructor stub used by tests.
   * Defaults to `globalThis.WebSocket` if undefined.
   */
  webSocketCtor?: typeof WebSocket;
  /**
   * Output format override. Defaults to MP3 44.1 kHz.
   */
  outputFormat?: TtsOutputFormat;
}

/**
 * Public surface of the TTS stream client.
 *
 *   - `events$`: async iterable of `TtsEvent` (chunk + complete).
 *   - `appendText(s)`: send a text fragment to the upstream. The first
 *     call opens the WebSocket (awaits the keySource), the rest just
 *     send text frames.
 *   - `flush()`: send the documented empty-string end-of-utterance
 *     signal so the server flushes its buffer and emits the final
 *     `stream_complete`.
 *   - `close()`: tear down the WebSocket and signal `events$` complete.
 */
export interface TtsStreamClient {
  events$: AsyncIterable<TtsEvent>;
  appendText(s: string): void;
  flush(): void;
  close(): Promise<void>;
}

/**
 * Loosely typed shape of incoming server frames. Validated through
 * Zod before being surfaced on `events$`.
 */
interface RawIncomingFrame {
  type?: string;
  audio_base64?: string;
  sequence?: number;
  mime_type?: string;
  total_chunks?: number;
  duration_ms?: number;
  error?: { code?: string; message?: string };
}

/**
 * Translate a base64 string into a `Uint8Array`. Uses `Buffer.from`
 * when available (Node + Electron main) and `atob` + manual decode
 * otherwise. The Achilles main process is always Node — the
 * fallback exists for future renderer reuse and for completeness.
 */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Translate the upstream `mime_type` to the schema's `mimeType`.
 * Unknown values default to "audio/mpeg" — the wrapper's emit step
 * will refuse anything else at the Zod boundary.
 */
function normaliseMime(mime: string | undefined): "audio/mpeg" | "audio/pcm" {
  if (mime === "audio/pcm") {
    return "audio/pcm";
  }
  return "audio/mpeg";
}

/**
 * Construct a TTS stream client. The SAFE-03 host guard runs HERE,
 * BEFORE any I/O — a misrouted URL throws synchronously at the call
 * site rather than as an opaque network error later.
 */
export function createTtsStreamClient(
  opts: CreateTtsStreamClientOptions,
): TtsStreamClient {
  // SAFE-03 gate: validate BEFORE any I/O.
  const resolvedUrl = opts.url ?? buildTtsStreamUrl({ voiceId: opts.voiceId });
  const validatedUrl = assertElevenLabsHost(resolvedUrl);

  const outputFormat = opts.outputFormat ?? DEFAULT_OUTPUT_FORMAT;
  const WsCtor =
    opts.webSocketCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (WsCtor === undefined) {
    throw new Error(
      "[voice-tts] no WebSocket constructor available; pass `webSocketCtor` for non-browser environments",
    );
  }

  // Event queue + async-iterable adapter ---------------------------------
  // We push events into a queue and pull them out via an async iterable
  // that supports a single consumer. `awaiter` is the pending resolver
  // for the next event; if a producer pushes while a consumer is
  // awaiting, the awaiter resolves immediately, otherwise the event is
  // buffered.
  type Pending = { resolve: (v: IteratorResult<TtsEvent>) => void };
  const buffer: TtsEvent[] = [];
  let awaiter: Pending | null = null;
  let completed = false;
  // WR-03: single-consumer enforcement (see voice-stt for the rationale).
  let iteratorClaimed = false;

  function emit(event: TtsEvent): void {
    if (completed) {
      return;
    }
    if (awaiter !== null) {
      const a = awaiter;
      awaiter = null;
      a.resolve({ value: event, done: false });
      return;
    }
    buffer.push(event);
  }

  function complete(): void {
    if (completed) {
      return;
    }
    completed = true;
    if (awaiter !== null) {
      const a = awaiter;
      awaiter = null;
      a.resolve({ value: undefined as unknown as TtsEvent, done: true });
    }
  }

  const events$: AsyncIterable<TtsEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<TtsEvent> {
      // WR-03: enforce the documented single-consumer contract. A
      // second `for await` would silently race the first for shared
      // buffer.shift() and awaiter — emit a loud error instead.
      if (iteratorClaimed) {
        throw new Error(
          "[voice-tts] events$ is single-consumer: only one `for await` loop is permitted per TtsStreamClient. Construct a separate client per consumer.",
        );
      }
      iteratorClaimed = true;
      return {
        async next(): Promise<IteratorResult<TtsEvent>> {
          if (buffer.length > 0) {
            // WR-09: defensive undefined check rather than `as TtsEvent`
            // cast. shift() returns TtsEvent | undefined; the length
            // check covers the runtime case but the explicit guard
            // makes the type system enforce the invariant.
            const value = buffer.shift();
            if (value === undefined) {
              return { value: undefined as unknown as TtsEvent, done: true };
            }
            return { value, done: false };
          }
          if (completed) {
            return { value: undefined as unknown as TtsEvent, done: true };
          }
          return new Promise<IteratorResult<TtsEvent>>((resolve) => {
            awaiter = { resolve };
          });
        },
      };
    },
  };

  // WebSocket lifecycle --------------------------------------------------
  let ws: WebSocket | null = null;
  let openPromise: Promise<void> | null = null;
  let openResolved = false;
  let attempt = 0;
  let closedByCaller = false;
  let pendingTextBuffer: string[] = [];
  let pendingFlush = false;
  // CR-04: track the reconnect setTimeout handle so close() can cancel
  // an in-flight backoff window. Without retention, the timer fires
  // up to 2^5 * 250 = 8000 ms after close() returns and the wrapper
  // attempts an ensureOpen() on a torn-down instance.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // CR-03: a Promise that close() resolves so a pending ensureOpen()
  // wakes up and bails out instead of waiting forever for onopen.
  let closeSignalResolve: (() => void) | null = null;
  const closeSignal = new Promise<void>((resolve) => {
    closeSignalResolve = resolve;
  });

  // WR-06: simplified initial-frame builder. The key is not embedded in
  // the JSON body; the wrapper forwards it via the `xi-api-key` header
  // at WebSocket-construction time. The previous shape returned the key
  // alongside the frame which read as if the key flowed into the JSON.
  function buildInitialFrame(): string {
    return JSON.stringify({
      text: " ",
      model_id: FLASH_MODEL,
      chunk_length_schedule: Array.from(CHUNK_LENGTH_SCHEDULE),
      output_format: outputFormat,
    });
  }

  function attachWsHandlers(socket: WebSocket): void {
    // The browser WebSocket onmessage handler uses property assignment.
    // Tests pass a class that matches this shape, but real browsers use
    // `addEventListener("message", ...)`. The wrapper sets both to be
    // tolerant of either path.
    const messageHandler = (ev: { data: unknown }) => {
      const data = typeof ev.data === "string" ? ev.data : String(ev.data);
      let parsed: RawIncomingFrame;
      try {
        parsed = JSON.parse(data) as RawIncomingFrame;
      } catch (cause) {
        // Malformed inbound frame — log via console.error per the
        // CONTEXT.md logging directive and continue.
        const causeMessage =
          cause instanceof Error ? cause.message : String(cause);
        console.error(
          `[voice-tts] failed to parse incoming WS frame: ${causeMessage}`,
        );
        return;
      }
      handleIncomingFrame(parsed);
    };

    (socket as unknown as { onmessage: (ev: { data: unknown }) => void }).onmessage =
      messageHandler;
    (socket as unknown as { onclose: (ev: { code: number }) => void }).onclose =
      (ev: { code: number }) => {
        if (closedByCaller) {
          // close() is already tearing things down; do not reconnect
          // and do not re-fire complete (close() handles that).
          complete();
          return;
        }
        if (ev.code === 1000) {
          // Normal closure — emit complete and stop. finishStream()
          // is idempotent so it is safe even if stream_complete
          // already arrived just before the close.
          finishStream();
          return;
        }
        // CR-03 / CR-04 helper: if the WS closes BEFORE onopen fires,
        // wake any awaiter in ensureOpen() by resolving closeSignal so
        // close() and appendText().catch can unwind cleanly.
        if (closeSignalResolve !== null) {
          // We do NOT consume closeSignal here unless the wrapper has
          // not opened — leave closeSignal alive for close() to use.
        }
        scheduleReconnect();
      };
    (socket as unknown as { onerror: (ev: unknown) => void }).onerror = (
      _ev: unknown,
    ) => {
      console.error("[voice-tts] WebSocket error event");
    };
  }

  function handleIncomingFrame(parsed: RawIncomingFrame): void {
    const t = parsed.type;
    if (t === "chunk") {
      const audioBytes = base64ToBytes(parsed.audio_base64 ?? "");
      const candidate = {
        type: "chunk" as const,
        sequence:
          typeof parsed.sequence === "number" ? parsed.sequence : -1,
        audio: audioBytes,
        mimeType: normaliseMime(parsed.mime_type),
      };
      const result = TtsChunkSchema.safeParse(candidate);
      if (!result.success) {
        console.error(
          `[voice-tts] inbound chunk failed schema validation: ${result.error.message}`,
        );
        return;
      }
      emit(result.data as TtsChunk);
      return;
    }
    if (t === "stream_complete") {
      const candidate = {
        type: "complete" as const,
        totalChunks:
          typeof parsed.total_chunks === "number" ? parsed.total_chunks : 0,
        durationMs:
          typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0,
      };
      const result = TtsStreamCompleteSchema.safeParse(candidate);
      if (!result.success) {
        console.error(
          `[voice-tts] inbound stream_complete failed schema validation: ${result.error.message}`,
        );
        // Still propagate completion so consumers do not hang.
        finishStream();
        return;
      }
      emit(result.data as TtsStreamComplete);
      // WR-02: stream_complete is the terminal upstream signal — the
      // wrapper must also close the WS so consumers don't need to call
      // close() separately after seeing the complete event. The plan's
      // stated lifecycle ("open per utterance, drain, close") makes
      // stream_complete + close one terminal step from the consumer's
      // perspective.
      finishStream();
      return;
    }
    if (t === "error") {
      console.error(
        `[voice-tts] upstream error frame: ${
          parsed.error?.code ?? "unknown"
        } - ${parsed.error?.message ?? ""}`,
      );
      return;
    }
    // Unknown frame type — log and ignore.
    console.error(`[voice-tts] unknown WS frame type: ${String(t)}`);
  }

  function scheduleReconnect(): void {
    if (closedByCaller) {
      return;
    }
    const delay = computeBackoffMs(attempt);
    if (!Number.isFinite(delay)) {
      console.error(
        `[voice-tts] reconnect cap reached after ${RECONNECT_MAX_ATTEMPTS} attempts; giving up`,
      );
      complete();
      return;
    }
    attempt += 1;
    // CR-04: retain the handle so close() can cancel an in-flight
    // reconnect window. The previous code dropped the handle, meaning
    // the wrapper had no way to stop a pending reconnect deterministically.
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closedByCaller) {
        return;
      }
      openPromise = null;
      openResolved = false;
      void ensureOpen().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[voice-tts] reconnect failed: ${message}`);
        complete();
      });
    }, delay);
  }

  /**
   * WR-02 helper: terminal-stream teardown. Used by stream_complete and
   * by the normal-1000 onclose path. Idempotent: safe to call multiple
   * times. Closes the WS if still open and marks the iterable complete.
   */
  function finishStream(): void {
    if (ws !== null) {
      try {
        ws.close(1000, "stream-complete");
      } catch {
        // Ignore — we are tearing down.
      }
      ws = null;
    }
    complete();
  }

  function ensureOpen(): Promise<void> {
    if (openPromise !== null) {
      return openPromise;
    }
    openPromise = (async () => {
      const key = await callKeySource(opts.keySource);
      // Drop the key reference immediately after the WS is constructed.
      // The header is set at construction time; the local `key` falls
      // out of scope on the next tick.
      const headerFrame = buildInitialFrame();

      // CR-05: REQUIRE the Node.js-style WebSocket constructor signature
      // (url, undefined, { headers }). The previous code wrapped this
      // call in `try/catch` and silently fell back to `new WsCtor(url)`
      // — which drops the `xi-api-key` header. A browser-style global
      // WebSocket cannot carry the header, so silently downgrading to
      // unauthenticated opens a real auth-mode regression that surfaces
      // as an opaque close code from the server (no auth-mode signal).
      //
      // We detect the failure narrowly: if the constructor throws a
      // TypeError specifically because it does not accept three args,
      // we now raise an explicit error. Real `ws` package and the test
      // stubs both accept the three-arg form. If a consumer ever runs
      // this in a renderer/edge runtime, the failure is loud rather
      // than silent.
      try {
        ws = new (WsCtor as unknown as new (
          url: string | URL,
          protocols?: string | string[] | Record<string, unknown>,
          options?: { headers?: Record<string, string> },
        ) => WebSocket)(
          validatedUrl,
          undefined,
          { headers: { "xi-api-key": key } },
        );
      } catch (cause) {
        // WR-05: catch ONLY TypeError (the documented narrow-form failure).
        // Any other throw — out-of-memory, security, URL parse — is a
        // real bug we must NOT mask.
        if (cause instanceof TypeError) {
          throw new Error(
            "voice-tts WebSocket transport requires Node.js-style WebSocket constructor accepting headers; got browser-style. This package must run in the main process.",
          );
        }
        throw cause;
      }
      // Forget the key — `key` falls out of scope after this function.

      // Wire up handlers BEFORE awaiting the open so a synchronous
      // open in the test stub is not missed.
      attachWsHandlers(ws);

      // CR-03: race the open against (a) closeSignal (close() called)
      // and (b) a pre-open onclose (WS failed before onopen could fire).
      // Without these, a WebSocket that never fires onopen leaves
      // close() awaiting openPromise forever.
      const localWs = ws;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settleResolve = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const settleReject = (err: Error): void => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        (localWs as unknown as { onopen: () => void }).onopen = () => {
          settleResolve();
        };
        // Chain into the existing onclose set by attachWsHandlers so a
        // pre-open close also rejects the open promise.
        const prevOnClose = (
          localWs as unknown as { onclose: (ev: { code: number }) => void }
        ).onclose;
        (localWs as unknown as { onclose: (ev: { code: number }) => void }).onclose =
          (ev: { code: number }) => {
            settleReject(
              new Error(
                `[voice-tts] WebSocket closed before open (code=${ev.code})`,
              ),
            );
            if (typeof prevOnClose === "function") {
              prevOnClose(ev);
            }
          };

        // close() resolves closeSignal; rejecting here lets ensureOpen
        // unwind so close() does not hang.
        void closeSignal.then(() => {
          settleReject(new Error("[voice-tts] open aborted by close()"));
        });
      });

      // CR-03 guard: if close() ran while we were awaiting onopen,
      // skip the send-initial-frame and pending-text-flush phases.
      // close() will tear down ws via its own teardown branch.
      if (closedByCaller) {
        return;
      }

      // Send the initial configuration frame.
      ws.send(headerFrame);

      // Flush any text appended before the connection opened.
      for (const text of pendingTextBuffer) {
        ws.send(JSON.stringify({ text }));
      }
      pendingTextBuffer = [];
      if (pendingFlush) {
        ws.send(JSON.stringify({ text: "" }));
        pendingFlush = false;
      }
      openResolved = true;
    })();
    return openPromise;
  }

  // Public methods --------------------------------------------------------

  function appendText(s: string): void {
    if (closedByCaller) {
      return;
    }
    if (!openResolved) {
      pendingTextBuffer.push(s);
      // Open lazily on the first appendText.
      void ensureOpen().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[voice-tts] failed to open stream: ${message}`);
        complete();
      });
      return;
    }
    if (ws !== null) {
      ws.send(JSON.stringify({ text: s }));
    }
  }

  function flush(): void {
    if (closedByCaller) {
      return;
    }
    if (!openResolved) {
      pendingFlush = true;
      void ensureOpen().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[voice-tts] failed to open stream: ${message}`);
        complete();
      });
      return;
    }
    if (ws !== null) {
      ws.send(JSON.stringify({ text: "" }));
    }
  }

  async function close(): Promise<void> {
    if (closedByCaller) {
      return;
    }
    closedByCaller = true;
    // CR-04: cancel any pending reconnect window BEFORE we wait on
    // openPromise. Without this, a reconnect scheduled while we are
    // closing fires and re-enters ensureOpen() after teardown.
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // CR-03: signal the closeSignal so any pending ensureOpen() awaiter
    // unwinds promptly. Without this, an in-flight open that has not
    // received onopen yet would leave the await below blocked.
    if (closeSignalResolve !== null) {
      closeSignalResolve();
      closeSignalResolve = null;
    }
    if (openPromise !== null) {
      // CR-03 safety net: race the openPromise against a 250 ms timeout
      // so close() ALWAYS resolves in finite time, even if a misbehaving
      // WebSocket implementation never settles its onopen / onclose
      // hooks and the closeSignal race above somehow misses.
      try {
        await Promise.race([
          openPromise.catch(() => {
            // Open failed — fall through to teardown.
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ]);
      } catch {
        // Defensive — Promise.race rejects only if BOTH branches reject,
        // which the catch above already absorbs. Belt and braces.
      }
    }
    if (ws !== null) {
      try {
        ws.close(1000, "client-close");
      } catch {
        // Ignore close errors — we are tearing down anyway.
      }
      ws = null;
    }
    complete();
  }

  return {
    events$,
    appendText,
    flush,
    close,
  };
}
