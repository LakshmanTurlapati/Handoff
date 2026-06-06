/**
 * In-process WebSocket mock that mimics the ElevenLabs Scribe v2
 * Realtime server's envelope shape. Designed to be passed as the
 * `webSocketCtor` option of `createRealtimeSttClient` so the
 * round-trip test runs entirely in memory — no real network call.
 *
 * The mock collects every `input_audio_chunk` it receives from the
 * client. After the round-trip test has streamed the entire fixture
 * the test invokes `mock.flushCommit()` which causes the mock to emit:
 *
 *   1. A `partial_transcript` event with a short fragment.
 *   2. A `committed_transcript` event whose `text` is the verbatim
 *      ground-truth transcript the test supplied at construction.
 *
 * The mock is intentionally minimal: it does NOT model timing,
 * concurrency, errors, or backpressure. Those concerns are covered by
 * `realtime-client.test.ts` with a dedicated stub.
 */

import type {
  SttSocketEvent,
  SttWebSocketCtor,
  SttWebSocketLike,
} from "../../src/realtime-client.js";

export interface MockElevenLabsOptions {
  transcript: string;
}

export interface MockElevenLabsServer {
  ctor: SttWebSocketCtor;
  flushCommit(): void;
  receivedChunkCount(): number;
  lastUrl(): string | null;
}

type Handler = (ev: SttSocketEvent) => void;

interface MockSocket extends Omit<SttWebSocketLike, "readyState"> {
  readyState: number;
  __handlers: Record<string, Handler[]>;
  __chunkCount: number;
}

/**
 * Construct a mock factory. The returned `ctor` can be passed directly
 * to `createRealtimeSttClient({ webSocketCtor: ... })`.
 */
export function createMockElevenLabsWs(
  opts: MockElevenLabsOptions,
): MockElevenLabsServer {
  let currentSocket: MockSocket | null = null;
  let lastUrl: string | null = null;
  let chunkCountTotal = 0;

  const ctor: SttWebSocketCtor = (url: string) => {
    lastUrl = url;
    const handlers: Record<string, Handler[]> = {
      open: [],
      close: [],
      message: [],
      error: [],
    };

    const socket: MockSocket = {
      __handlers: handlers,
      __chunkCount: 0,
      readyState: 0,
      addEventListener(event, handler) {
        const list = handlers[event];
        if (list) {
          list.push(handler);
        }
      },
      removeEventListener(event, handler) {
        const list = handlers[event];
        if (!list) {
          return;
        }
        const idx = list.indexOf(handler);
        if (idx >= 0) {
          list.splice(idx, 1);
        }
      },
      send(data: string) {
        try {
          const parsed = JSON.parse(data) as {
            type?: string;
            audio?: string;
          };
          if (parsed.type === "input_audio_chunk") {
            socket.__chunkCount += 1;
            chunkCountTotal += 1;
          }
        } catch {
          // Non-JSON payload — ignored by the mock.
        }
      },
      close(code = 1000) {
        if (socket.readyState === 3) {
          return;
        }
        socket.readyState = 3;
        emit("close", { type: "close", code });
      },
    };

    function emit(event: keyof typeof handlers, ev: SttSocketEvent): void {
      const list = handlers[event];
      if (!list) return;
      for (const handler of list.slice()) {
        handler(ev);
      }
    }

    // Open the mock socket on the next microtask so callers can attach
    // event listeners synchronously after construction.
    Promise.resolve().then(() => {
      // Pre-roll: emit a `session_started` envelope so the wrapper can
      // observe the documented Scribe v2 lifecycle.
      socket.readyState = 1;
      emit("open", { type: "open" });
      emit("message", {
        type: "message",
        data: JSON.stringify({ type: "session_started" }),
      });
    });

    currentSocket = socket;
    return socket;
  };

  function flushCommit(): void {
    if (!currentSocket) {
      throw new Error(
        "mock-elevenlabs-server: flushCommit called before any client connected",
      );
    }
    const socket = currentSocket;
    const handlers = socket.__handlers;
    function fire(ev: SttSocketEvent): void {
      const eventName = ev.type;
      const list = handlers[eventName];
      if (!list) return;
      for (const handler of list.slice()) {
        handler(ev);
      }
    }
    fire({
      type: "message",
      data: JSON.stringify({
        type: "partial_transcript",
        text: "achilles",
        confidence: 0.85,
      }),
    });
    fire({
      type: "message",
      data: JSON.stringify({
        type: "committed_transcript",
        text: opts.transcript,
        duration_ms: 4500,
      }),
    });
  }

  return {
    ctor,
    flushCommit,
    receivedChunkCount(): number {
      return chunkCountTotal;
    },
    lastUrl(): string | null {
      return lastUrl;
    },
  };
}

/**
 * Build a generic stub WebSocket that lets the test control the
 * lifecycle precisely (open, close codes, server messages). Returned
 * factory exposes a `current()` accessor for tests that need to drive
 * the most recently constructed socket directly.
 */
export interface ControllableStubWs extends Omit<SttWebSocketLike, "readyState"> {
  readyState: number;
  __fire(ev: SttSocketEvent): void;
  __sent: string[];
}

export interface StubWsControl {
  ctor: SttWebSocketCtor;
  instances(): ControllableStubWs[];
  current(): ControllableStubWs | null;
  lastUrl(): string | null;
  lastProtocols(): string | string[] | undefined;
  constructionCount(): number;
}

/**
 * Constructor that returns a hand-controllable WebSocket each time it
 * is invoked. Tests use this to drive close codes, reconnect timing,
 * and 429-style server errors without setTimeouts of their own.
 */
export function createStubWebSocket(): StubWsControl {
  const instances: ControllableStubWs[] = [];
  let lastUrl: string | null = null;
  let lastProtocols: string | string[] | undefined;

  const ctor: SttWebSocketCtor = (url, protocols) => {
    lastUrl = url;
    lastProtocols = protocols;
    const handlers: Record<string, Handler[]> = {
      open: [],
      close: [],
      message: [],
      error: [],
    };
    const sent: string[] = [];
    const inst: ControllableStubWs = {
      readyState: 1,
      addEventListener(event, handler) {
        const list = handlers[event];
        if (list) list.push(handler);
      },
      removeEventListener(event, handler) {
        const list = handlers[event];
        if (!list) return;
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      },
      send(data) {
        sent.push(data);
      },
      close(_code) {
        // Tests fire close events explicitly via __fire().
        void _code;
      },
      __fire(ev) {
        const list = handlers[ev.type];
        if (!list) return;
        for (const handler of list.slice()) {
          handler(ev);
        }
      },
      __sent: sent,
    };
    instances.push(inst);
    return inst;
  };

  return {
    ctor,
    instances() {
      return instances;
    },
    current() {
      return instances.length > 0
        ? (instances[instances.length - 1] ?? null)
        : null;
    },
    lastUrl() {
      return lastUrl;
    },
    lastProtocols() {
      return lastProtocols;
    },
    constructionCount() {
      return instances.length;
    },
  };
}
