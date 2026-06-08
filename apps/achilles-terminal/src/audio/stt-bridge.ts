/**
 * Phase 17, Plan 02, Task 1 — LOOP-01 STT half: voice-stt realtime
 * client bridge.
 *
 * The thinnest possible adapter over @achilles/voice-stt's existing
 * webSocketCtor + getToken DI seams. Plan 04's session.ts wires this
 * via constructor injection — the STT bridge does NOT modify any file
 * under packages/voice-stt/ (LOOP-02 invariant).
 *
 * Responsibilities:
 *
 *   1. Construct a RealtimeSttClient via the injected sttFactory
 *      (which delegates to createRealtimeSttClient in production and
 *      to a MOCK_LOOP fake in tests). The factory accepts the
 *      injected webSocketCtor seam so the bridge can plumb it
 *      through without re-implementing the createRealtimeSttClient
 *      surface.
 *   2. Route the mintToken() call through the circuit-breaker dep
 *      when provided. mintToken is the auth surface — it can fail
 *      with auth/rate_limit kinds that the breaker classifies as
 *      `exhausted: true` and opens the circuit immediately.
 *   3. Forward Int16Array frames from the mic-sox layer to
 *      sttClient.write(frame). The bridge does NOT inspect the bytes
 *      (T-17-08 mitigation — the logger sees frame counts only,
 *      never audio bytes).
 *   4. Map voice-stt's events$ (partial / committed / error) onto
 *      the SessionEvent discriminated union and emit via deps.emit.
 *
 * The bridge does NOT consume sttClient.events$ on its own — that is
 * the caller's job (Plan 04's session.ts) so the consumer-loop's
 * single-consumer contract (voice-stt's WR-03 invariant) lives at
 * exactly one place.
 *
 * Threat model:
 *
 *   - T-17-08 mitigation: the logger receives frame counts and event
 *     classifications only — never the Int16Array bytes, never the
 *     partial/committed text content. The session emitter carries
 *     the text content; the logger surface is intentionally narrower.
 *   - T-17-09 mitigation: auth/rate-limit failures route through the
 *     circuit breaker's classifyHttpError seam; the bridge surfaces
 *     them as SessionEvent{type:"error", classification:<kind>} with
 *     the original ClassifiedErrorKind preserved.
 *
 * No emojis (CLAUDE.md global).
 */

import type {
  CreateRealtimeSttClientOptions,
  RealtimeSttClient,
  SttEvent,
  SttWebSocketCtor,
} from "@achilles/voice-stt";
import type {
  CircuitBreaker,
  ClassifiedErrorKind,
} from "../circuit-breaker.js";
import type {
  SessionEvent,
  SessionErrorClassification,
} from "../session-events.js";
import type { StructuredLogger } from "../structured-logger.js";

/**
 * Public handle returned by createSttBridge. Lifecycle:
 *
 *   1. start() — mints the STT token (optionally through the circuit
 *      breaker), constructs the realtime client, starts the WSS
 *      connect. Throws on circuit-exhausted; resolves on a successful
 *      start.
 *   2. write(frame) — forwards Int16Array PCM frames to the realtime
 *      client. No-op before start() resolves.
 *   3. commit() — sends the end-of-utterance commit signal so the
 *      server emits the final committed_transcript.
 *   4. stop() — closes the WSS gracefully.
 *   5. events$() — returns the async iterable of upstream SttEvents
 *      (partial / committed / error) so Plan 04's session.ts can
 *      consume them. The bridge also fans out the same events on
 *      deps.emit synchronously before returning them from the
 *      iterator (so the structured logger and the UI see the same
 *      events at the same time).
 *
 * @public
 */
export interface SttBridgeHandle {
  start(): Promise<void>;
  write(frame: Int16Array): void;
  commit(): void;
  stop(): Promise<void>;
  events$(): AsyncIterable<SttEvent>;
}

/**
 * Construction-time dependencies for createSttBridge.
 *
 * @public
 */
export interface CreateSttBridgeDeps {
  /**
   * Factory that constructs the underlying RealtimeSttClient. The
   * factory accepts the resolved getToken callback + the injected
   * webSocketCtor — the bridge owns the composition. In production
   * this maps directly to createRealtimeSttClient; in tests it maps
   * to a deterministic fake.
   */
  readonly sttFactory: (
    opts: Pick<CreateRealtimeSttClientOptions, "getToken" | "webSocketCtor">,
  ) => RealtimeSttClient;
  /**
   * Auth seam — mints a fresh single-use STT token. The bridge calls
   * this exactly once during start() (the underlying realtime client
   * has its own internal getToken re-call on reconnect — that path
   * goes back to mintToken via the closure below).
   */
  readonly mintToken: () => Promise<{ token: string; expiresAt: string }>;
  /**
   * WebSocket constructor seam. Production wires `globalThis.WebSocket`
   * indirectly via the realtime client's defaultWebSocketCtor; tests
   * inject a deterministic fake.
   */
  readonly webSocketCtor?: SttWebSocketCtor;
  /**
   * Optional circuit breaker — wraps mintToken so auth/rate-limit
   * failures don't burn through repeated network attempts. When the
   * breaker is exhausted, start() rejects AND emits a SessionEvent
   * error variant.
   */
  readonly circuitBreaker?: CircuitBreaker;
  /**
   * Required emit sink. The bridge fans out:
   *   - stt_partial — on partial transcript events
   *   - stt_committed — on committed transcript events
   *   - error — on circuit-breaker-exhausted or stt error events
   */
  readonly emit: (event: SessionEvent) => void;
  /**
   * Optional structured logger sink. Logs:
   *   - stt_start_failed (error, fields: classification)
   *   - stt_event (info, fields: type — partial/committed/error)
   *   - stt_stop (info, no fields)
   */
  readonly logger?: StructuredLogger;
  /**
   * Clock seam — Date.now() default.
   */
  readonly nowImpl?: () => number;
}

/**
 * Map a circuit-breaker ClassifiedErrorKind to the SessionEvent
 * SessionErrorClassification union. The two unions are intentionally
 * not identical — Session adds `mic_unavailable`, `playback_lost`,
 * `claude_failed` on top of the breaker's network/auth/rate_limit/
 * server/unknown set. The bridge only emits the breaker subset.
 */
function classifiedToSessionKind(
  kind: ClassifiedErrorKind,
): SessionErrorClassification {
  // The two unions overlap on these 5 kinds; TypeScript treats the
  // assignment as safe via the structural-typing rules.
  return kind;
}

/**
 * Construct an STT bridge handle. The bridge is single-use per
 * session — start() can only be called once. stop() is idempotent.
 *
 * @public
 */
export function createSttBridge(deps: CreateSttBridgeDeps): SttBridgeHandle {
  const now = deps.nowImpl ?? ((): number => Date.now());

  // ── mutable state ──────────────────────────────────────────────────
  let sttClient: RealtimeSttClient | null = null;
  let started = false;
  let stopped = false;

  async function start(): Promise<void> {
    if (started) return;
    started = true;

    // The realtime client expects a getToken callback that returns a
    // fresh single-use token per WS open (including reconnects). We
    // wrap mintToken in a closure that routes through the circuit
    // breaker on first call AND on every subsequent reconnect — that
    // way a delayed auth failure during a mid-stream reconnect still
    // surfaces via the breaker rather than burning through retries.
    const breaker = deps.circuitBreaker;
    let firstCallChecked = false;

    const wrappedGetToken: CreateRealtimeSttClientOptions["getToken"] =
      breaker == null
        ? (): Promise<{ token: string; expiresAt: string }> => deps.mintToken()
        : async (): Promise<{ token: string; expiresAt: string }> => {
            const outcome = await breaker.attempt(() => deps.mintToken());
            if ("error" in outcome) {
              // Surface ONCE: the first failed attempt emits the
              // SessionEvent error variant so the UI/logger see it.
              // Subsequent reconnect attempts that hit the same
              // breaker will throw without re-emitting (the breaker
              // itself logs each open via its logger sink).
              if (!firstCallChecked) {
                firstCallChecked = true;
                const classification = classifiedToSessionKind(
                  outcome.error.kind,
                );
                deps.logger?.error("stt_start_failed", { classification });
                deps.emit({
                  type: "error",
                  payload: {
                    classification,
                    message: `stt mintToken failed: ${outcome.error.kind} (attempts=${outcome.attemptCount}, consecutive=${outcome.consecutiveFailures})`,
                  },
                  timestamp: now(),
                });
              }
              throw new Error(
                `stt mintToken exhausted: ${outcome.error.kind}`,
              );
            }
            firstCallChecked = true;
            return outcome.result;
          };

    // Build the realtime client with the breaker-wrapped getToken
    // and the injected webSocketCtor seam. The factory is the
    // single seam Plan 04's session.ts uses to wire the real
    // createRealtimeSttClient or a MOCK_LOOP fake.
    const opts: Pick<
      CreateRealtimeSttClientOptions,
      "getToken" | "webSocketCtor"
    > =
      deps.webSocketCtor !== undefined
        ? { getToken: wrappedGetToken, webSocketCtor: deps.webSocketCtor }
        : { getToken: wrappedGetToken };
    sttClient = deps.sttFactory(opts);

    // Kick off the WSS connect. The realtime client's start() awaits
    // the first connect attempt; reconnect logic is internal.
    try {
      await sttClient.start();
    } catch (startErr) {
      // The realtime client itself does not throw from start() —
      // failures arrive via the events$ stream. But the breaker-
      // wrapped getToken can throw (above) and that propagates here.
      // Re-throw so Plan 04's session.ts catches and transitions to
      // error state.
      throw startErr instanceof Error
        ? startErr
        : new Error(String(startErr));
    }
  }

  function write(frame: Int16Array): void {
    if (stopped) return;
    if (sttClient == null) return;
    sttClient.write(frame);
  }

  function commit(): void {
    // The current voice-stt realtime client does not expose a
    // commit() method directly — the server-side commit is driven by
    // the WSS frame schedule (the server emits committed_transcript
    // on its own VAD signal). The bridge's commit() therefore maps
    // to a no-op call (Plan 04's session.ts decides when to stop
    // writing frames based on the local VAD's vad_speech_end edge).
    //
    // We retain the method on the public surface so a future
    // voice-stt revision that exposes an explicit commit() can wire
    // through without breaking the bridge consumers.
    void sttClient;
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    deps.logger?.info("stt_stop", {});
    if (sttClient != null) {
      try {
        await sttClient.stop();
      } catch {
        // best-effort.
      }
    }
  }

  /**
   * Async iterator wrapper that fans out SessionEvents to deps.emit
   * BEFORE forwarding to the caller. The single-consumer contract
   * (voice-stt WR-03) is upheld because we delegate to the
   * underlying sttClient.events$ exactly once.
   */
  function events$(): AsyncIterable<SttEvent> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<SttEvent> {
        if (sttClient == null) {
          // Yield-nothing iterator — start() was not called.
          return {
            next: (): Promise<IteratorResult<SttEvent>> =>
              Promise.resolve({ value: undefined, done: true }),
          };
        }
        const upstream: AsyncIterator<SttEvent> =
          sttClient.events$[Symbol.asyncIterator]();
        return {
          next: async (): Promise<IteratorResult<SttEvent>> => {
            const result: IteratorResult<SttEvent> = await upstream.next();
            if (result.done === true) {
              return { value: undefined, done: true };
            }
            // Fan the event out on the Session emitter BEFORE yielding
            // to the caller so the UI + logger always observe the
            // same event ordering.
            const ev: SttEvent = result.value;
            deps.logger?.info("stt_event", { type: ev.type });
            if (ev.type === "partial") {
              deps.emit({
                type: "stt_partial",
                payload: { text: ev.text },
                timestamp: now(),
              });
            } else if (ev.type === "committed") {
              deps.emit({
                type: "stt_committed",
                payload: { text: ev.text },
                timestamp: now(),
              });
            } else if (ev.type === "error") {
              // The voice-stt SttErrorEvent code union is
              // { "rate_limit" | "concurrent_limit" | "network" |
              //   "auth" | "unknown" }. We map concurrent_limit ->
              // rate_limit and leave the rest pass-through.
              const code: ClassifiedErrorKind =
                ev.code === "concurrent_limit" ? "rate_limit" : ev.code;
              deps.emit({
                type: "error",
                payload: {
                  classification: classifiedToSessionKind(code),
                  message: ev.message ?? `stt ${ev.code}`,
                },
                timestamp: now(),
              });
            }
            return { value: ev, done: false };
          },
        };
      },
    };
  }

  return { start, write, commit, stop, events$ };
}
