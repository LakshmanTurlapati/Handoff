/**
 * In-process mock of the ElevenLabs Flash v2.5 stream-input WebSocket.
 *
 * Used by the stream-client and ordering-fixture tests to exercise the
 * wrapper without opening a real network connection. The mock mimics
 * the Flash v2.5 stream-input envelope shape (a JSON message per chunk
 * containing `audio_base64`, `sequence`, and `mime_type`, terminated by
 * a `stream_complete` envelope).
 *
 * Critically, the mock does NOT verify the URL it receives — that is
 * the wrapper's job (SAFE-03 gate at construction). The mock records
 * the URL so tests can assert it after the fact.
 *
 * The mock is exported as a `createMockTtsWsCtor` factory that returns
 * a class shaped like the global `WebSocket` constructor. Tests pass
 * the class as the `webSocketCtor` option of the stream client.
 *
 * Citations:
 *   - 09-CONTEXT.md — testing strategy is in-process mocks; no live
 *     ElevenLabs network calls in CI.
 *   - PITFALLS #6 — out-of-order arrival exercised via arrivalOrder.
 */

/**
 * One synthetic chunk in the fixture. Matches the structure in
 * `sequenced-chunks.json`.
 */
export interface MockChunk {
  sequence: number;
  audioBase64: string;
  durationMs: number;
  mimeType: "audio/mpeg" | "audio/pcm";
}

/**
 * Options for `createMockTtsWsCtor`.
 *
 *   - `chunks`: the chunk array (each carries `sequence`, `audioBase64`,
 *     `durationMs`, `mimeType`).
 *   - `arrivalOrder`: permutation of indices into `chunks`; the mock
 *     emits chunks in this order. Default is identity (in-order).
 *   - `totalDurationMs`: emitted on `stream_complete`. Default sums
 *     each chunk's `durationMs`.
 *   - `chunkIntervalMs`: artificial inter-chunk delay (default 0).
 *   - `urlSink`: optional callback that receives the URL the wrapper
 *     constructs the mock with (used for SAFE-03 audit assertions).
 */
export interface MockTtsWsOptions {
  chunks: MockChunk[];
  arrivalOrder?: number[];
  totalDurationMs?: number;
  chunkIntervalMs?: number;
  urlSink?: (url: string) => void;
}

/**
 * Minimal WebSocket-shaped event for the mock. We do not use the real
 * `MessageEvent` constructor because Node's environment may not expose
 * it; the tests only access the `data` property.
 */
interface MockMessageEvent {
  data: string;
}

interface MockCloseEvent {
  code: number;
  reason: string;
}

/**
 * Listener bag used by the mock to dispatch events. We support both
 * the property-assignment style (`ws.onmessage = ...`) and the
 * `addEventListener` style; the wrapper uses property-assignment so
 * that is the path most heavily exercised.
 */
interface MockWsListeners {
  onopen: ((this: unknown, ev: Event) => void) | null;
  onmessage: ((this: unknown, ev: MockMessageEvent) => void) | null;
  onclose: ((this: unknown, ev: MockCloseEvent) => void) | null;
  onerror: ((this: unknown, ev: Event) => void) | null;
}

/**
 * Build a WebSocket-shaped constructor that emits the supplied chunks
 * in the supplied order. The returned class behaves enough like the
 * browser `WebSocket` to satisfy the wrapper:
 *
 *   - Construction records the URL and the second-argument (protocols)
 *     for assertions.
 *   - `open` fires on next microtask so the wrapper's handler is wired
 *     before the first message.
 *   - On the FIRST `send()` call the mock starts emitting chunks per
 *     the arrival order, followed by a `stream_complete` envelope.
 *   - `close()` fires the close handler with code 1000.
 *
 * The wrapper's reconnect path is exercised by tests that pass a
 * subclass / wrapper around this constructor (see stream-client.test.ts).
 */
export function createMockTtsWsCtor(
  opts: MockTtsWsOptions,
): new (url: string | URL, protocols?: string | string[]) => MockWebSocketLike {
  const chunks = opts.chunks;
  const arrivalOrder =
    opts.arrivalOrder ?? Array.from({ length: chunks.length }, (_, i) => i);
  const totalDurationMs =
    opts.totalDurationMs ??
    chunks.reduce((acc, c) => acc + c.durationMs, 0);
  const chunkIntervalMs = opts.chunkIntervalMs ?? 0;

  class MockWebSocket implements MockWebSocketLike {
    readonly url: string;
    readyState: 0 | 1 | 2 | 3 = 0;
    onopen: MockWsListeners["onopen"] = null;
    onmessage: MockWsListeners["onmessage"] = null;
    onclose: MockWsListeners["onclose"] = null;
    onerror: MockWsListeners["onerror"] = null;
    sentFrames: string[] = [];
    private streamStarted = false;

    constructor(url: string | URL, _protocols?: string | string[]) {
      this.url = typeof url === "string" ? url : url.toString();
      if (opts.urlSink !== undefined) {
        opts.urlSink(this.url);
      }
      // Fire open on next microtask so the wrapper's handler binding
      // (which usually happens immediately after `new WebSocket()`)
      // sees the open event.
      queueMicrotask(() => {
        this.readyState = 1;
        if (this.onopen !== null) {
          this.onopen({} as Event);
        }
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      const text = typeof data === "string" ? data : String(data);
      this.sentFrames.push(text);
      if (this.streamStarted) {
        return;
      }
      // Parse the frame; if it is a non-empty text frame, start the
      // emission. The Flash v2.5 wrapper sends the initial configuration
      // frame on first appendText / flush, so we always start on the
      // first send. Subsequent frames (subsequent text appends, the
      // empty-string flush) are recorded but do not re-trigger emission.
      this.streamStarted = true;
      this.beginEmission();
    }

    close(code: number = 1000, reason: string = ""): void {
      this.readyState = 3;
      if (this.onclose !== null) {
        this.onclose({ code, reason });
      }
    }

    private beginEmission(): void {
      const total = arrivalOrder.length;
      arrivalOrder.forEach((chunkIdx, position) => {
        const chunk = chunks[chunkIdx];
        if (chunk === undefined) {
          return;
        }
        const delay = chunkIntervalMs * position;
        setTimeout(() => {
          if (this.readyState !== 1 || this.onmessage === null) {
            return;
          }
          this.onmessage({
            data: JSON.stringify({
              type: "chunk",
              sequence: chunk.sequence,
              audio_base64: chunk.audioBase64,
              mime_type: chunk.mimeType,
            }),
          });
        }, delay);
      });
      // Schedule the stream_complete after the last chunk.
      setTimeout(
        () => {
          if (this.readyState !== 1 || this.onmessage === null) {
            return;
          }
          this.onmessage({
            data: JSON.stringify({
              type: "stream_complete",
              total_chunks: total,
              duration_ms: totalDurationMs,
            }),
          });
        },
        chunkIntervalMs * (total + 1),
      );
    }
  }

  return MockWebSocket as new (
    url: string | URL,
    protocols?: string | string[],
  ) => MockWebSocketLike;
}

/**
 * Structural type of the mock WebSocket. Mirrors the subset of the
 * browser WebSocket API the wrapper uses.
 */
export interface MockWebSocketLike {
  readonly url: string;
  readyState: 0 | 1 | 2 | 3;
  onopen: ((this: unknown, ev: Event) => void) | null;
  onmessage: ((this: unknown, ev: { data: string }) => void) | null;
  onclose:
    | ((this: unknown, ev: { code: number; reason: string }) => void)
    | null;
  onerror: ((this: unknown, ev: Event) => void) | null;
  sentFrames: string[];
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}
