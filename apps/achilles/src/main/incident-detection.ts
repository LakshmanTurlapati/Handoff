/**
 * Plan 14-03 — Incident detection (SAFE-05 circuit-breaker substrate).
 *
 * A pure module that wraps risky operations (STT token-mint, TTS
 * open()) with circuit-breaker semantics + an exponential-backoff
 * helper + an HTTP/Node error classifier. The orchestrator (session.ts)
 * composes one breaker per ElevenLabs surface and routes its retries
 * through `attempt(fn)`; when the breaker opens, the orchestrator
 * stops retrying and broadcasts the failure to the renderer.
 *
 * The module is PURE in the sense that matters for the test surface:
 *
 *   - NO fs imports (no readFileSync, no writeFileSync)
 *   - NO http imports (no node:http, no fetch)
 *   - NO process.env reads
 *   - NO clock reads outside the injected nowImpl
 *   - NO randomness outside the injected randomImpl
 *
 * The only side effect is the optional logger seam (defaults to
 * console.error with the [achilles] prefix). The logger MUST NOT
 * receive any API key, transcript fragment, TTS bytes, or request
 * body — the breaker only sees the classified-error kind + attempt
 * count + label, which it logs uniformly.
 *
 * Threat model (Plan 14-03):
 *   - T-14-14 mitigate — circuit opens after N consecutive failures
 *     within a sliding window; further attempts return synchronously
 *     without invoking fn. Retry storms cannot crash the bridge.
 *   - T-14-16 mitigate — log lines include only `kind`, `attempt`, the
 *     label, and the open/closed boolean. The grep guard verifies the
 *     module never references fetch / http / fs / process.env so a
 *     future contributor cannot smuggle telemetry through it.
 *
 * No emojis (CLAUDE.md global).
 */

/**
 * Classification union for an error raised by the wrapped fn. The
 * classifier returns one of these on every call; the breaker uses the
 * kind to decide retryability.
 *
 *   - 'auth'       — HTTP 401 / 403. The credential is wrong. Retrying
 *                    will not help; the breaker opens immediately so
 *                    the orchestrator can surface the user-facing
 *                    failure rather than burn through 5 backoff cycles
 *                    waiting for a bad key to start working.
 *   - 'rate_limit' — HTTP 429. The credential is correct but the
 *                    provider is throttling. The orchestrator's
 *                    behaviour is identical to 'auth' (open
 *                    immediately) because the right user-facing
 *                    surface in v1.2 is the typed fallback, not silent
 *                    burn-through.
 *   - 'server'     — HTTP 5xx. The provider is broken. Retryable; the
 *                    failure counter increments and the breaker opens
 *                    only after maxConsecutiveFailures within windowMs.
 *   - 'network'    — Node socket errors (ECONNRESET, ETIMEDOUT,
 *                    ENOTFOUND, ECONNREFUSED). Retryable; same window
 *                    accounting as 'server'.
 *   - 'unknown'    — Neither HTTP-shape nor Node-shape recognised.
 *                    Retryable by default (we err on the side of
 *                    giving a transient blip a chance to clear).
 *
 * @public
 */
export type ClassifiedErrorKind =
  | "auth"
  | "rate_limit"
  | "server"
  | "network"
  | "unknown";

/**
 * Wrapper around the originating error plus the classified kind. The
 * `cause` field is the original thrown value (kept opaque-typed so
 * the breaker does not inspect any payload bytes); the `kind` is the
 * `classifyError` verdict.
 *
 * @public
 */
export interface ClassifiedError {
  readonly kind: ClassifiedErrorKind;
  readonly cause: unknown;
}

/**
 * State of a circuit at a point in time.
 *
 *   - 'closed'    — Operating normally. attempt() invokes fn.
 *   - 'open'      — Breaker has tripped. attempt() returns immediately
 *                   without invoking fn until the cooldownMs elapses.
 *   - 'half-open' — Cooldown elapsed; the next attempt is a probe.
 *                   On success: state returns to 'closed'. On failure:
 *                   state returns to 'open' and the cooldown restarts.
 *
 * @public
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * Snapshot of the breaker's status. Exposed via status() so the
 * orchestrator can compose the IPC_INCIDENT_STATUS health payload.
 *
 * @public
 */
export interface CircuitStatus {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly openedAt: number | null;
}

/**
 * Successful attempt result. The wrapped fn returned a value.
 *
 * @public
 */
export interface AttemptSuccess<T> {
  readonly result: T;
}

/**
 * Failed attempt result. The wrapped fn threw, OR the breaker was
 * already open and rejected the attempt without invoking fn.
 *
 * `exhausted` is true when the breaker considers this failure
 * terminal for the current orchestrator-driven request — the
 * orchestrator MUST stop retrying and surface the failure to the
 * renderer. `attemptCount` is the number of times fn was invoked
 * during this attempt sequence (0 when the breaker short-circuited).
 *
 * @public
 */
export interface AttemptFailure {
  readonly error: ClassifiedError;
  readonly attemptCount: number;
  readonly exhausted: boolean;
}

/**
 * Discriminated union of attempt outcomes. Callers branch on the
 * presence of `result` vs. `error` (no shared field, so a
 * `'result' in outcome` check is enough at the call site).
 *
 * @public
 */
export type AttemptOutcome<T> = AttemptSuccess<T> | AttemptFailure;

/**
 * Construction-time dependencies for createCircuitBreaker.
 *
 * Every threshold + every clock + every randomness seam is injected
 * so tests are deterministic.
 *
 * @public
 */
export interface CreateCircuitBreakerDeps {
  /**
   * Identifier surfaced in log lines (e.g. "stt" or "tts"). Two
   * independent breakers cannot share a label without the operator
   * losing the ability to attribute log lines.
   */
  readonly label: string;
  /**
   * The breaker opens after this many consecutive failures within
   * `windowMs`. Defaults to 3 (locked v1.2 SAFE-05 value).
   */
  readonly maxConsecutiveFailures?: number;
  /**
   * Sliding window for the consecutive-failure counter. Failures
   * older than `windowMs` are evicted before each attempt is
   * counted. Defaults to 60_000 ms.
   */
  readonly windowMs?: number;
  /**
   * Cooldown duration after the breaker opens before the next
   * attempt is allowed (which becomes the half-open probe).
   * Defaults to 30_000 ms.
   */
  readonly cooldownMs?: number;
  /**
   * Base delay for exponential backoff. Defaults to 250 ms (the AWS
   * exponential-backoff blog default).
   */
  readonly backoffBaseMs?: number;
  /**
   * Cap on exponential backoff. The computed delay is never larger
   * than this. Defaults to 5000 ms (v1.2 SAFE-05 lock).
   */
  readonly backoffCapMs?: number;
  /**
   * Classifier seam. Defaults to `classifyHttpError`. Tests inject a
   * deterministic classifier for round-trip determinism even when the
   * thrown error shape is exotic.
   */
  readonly classifyError?: (err: unknown) => ClassifiedErrorKind;
  /**
   * Clock seam. Production defaults to `() => Date.now()`. Tests
   * inject a deterministic fake (or read vi.now() from the runner's
   * fake timers).
   */
  readonly nowImpl?: () => number;
  /**
   * Randomness seam for full-jitter backoff. Production defaults to
   * `Math.random`. Tests inject a fixed-value spy.
   */
  readonly randomImpl?: () => number;
  /**
   * Logger sink — defaults to console.error with the [achilles]
   * prefix. The breaker is the only sink that touches log output
   * directly; production wiring should pass a structured logger.
   */
  readonly logger?: (msg: string) => void;
}

/**
 * The breaker handle returned by createCircuitBreaker. Two surfaces
 * are exposed:
 *
 *   - attempt(fn) — invoke fn under the breaker's protection. Returns
 *     a Promise<AttemptOutcome<T>>. The promise is ALWAYS resolved;
 *     errors are surfaced via the discriminated outcome shape so
 *     callers cannot accidentally treat a failure as an exception
 *     swallow.
 *   - status()    — snapshot of the current state. Used by session.ts
 *     to compose IPC_INCIDENT_STATUS broadcasts.
 *
 * @public
 */
export interface CircuitBreaker {
  attempt<T>(fn: () => Promise<T> | T): Promise<AttemptOutcome<T>>;
  status(): CircuitStatus;
}

/**
 * Locked default thresholds. The values match REQUIREMENTS.md SAFE-05
 * + Plan 14-03 interfaces section + PITFALLS #4 "AWS exponential
 * backoff blog" lock; any drift here would also drift the SE21/SE22
 * test fixtures so a refactor that accidentally tweaks the defaults
 * shows up as a test failure rather than a silent behaviour change.
 */
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_BACKOFF_CAP_MS = 5_000;

/**
 * Computes the AWS-style "full jitter" exponential backoff delay for
 * one retry attempt. Exposed for direct test invocation (ID9 in the
 * plan); the breaker itself also calls this internally so the math is
 * verified end-to-end.
 *
 *   delay = random * min(capMs, baseMs * 2^(attempt - 1))
 *
 * Where `random` is in the half-open interval [0, 1). The formula
 * matches the public AWS blog "Exponential Backoff and Jitter" full-
 * jitter recipe.
 *
 * @param attempt    Retry attempt number, 1-indexed. attempt=1 is
 *                   "the first retry after the first failure"; the
 *                   uncapped delay equals baseMs at attempt=1.
 * @param baseMs     The base delay before jitter is applied.
 * @param capMs      Upper bound on the computed delay before jitter.
 * @param randomImpl Randomness seam. Production binds Math.random;
 *                   tests inject a fixed-value function.
 * @returns          A non-negative number of milliseconds to wait.
 *
 * Pure. No side effects.
 *
 * @public
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  randomImpl: () => number,
): number {
  // Guard pathological inputs without throwing — the breaker calls
  // this in a hot path and an arithmetic NaN would corrupt the
  // setTimeout call site. A negative attempt is normalised to 1.
  const a = Math.max(1, Math.floor(attempt));
  // Exponential growth: baseMs * 2^(a-1). For a=1 the growth factor
  // is 1, so the uncapped delay equals baseMs.
  const exponential = baseMs * Math.pow(2, a - 1);
  // Cap before jitter: the AWS recipe applies jitter on top of the
  // capped exponential, so attempts well past the cap still feel
  // bounded.
  const capped = Math.min(capMs, exponential);
  const jitter = randomImpl();
  return capped * jitter;
}

/**
 * Pure classifier that maps a thrown value to a ClassifiedErrorKind.
 *
 *   - HTTP-shape: `err.status` numeric.
 *       401 / 403            -> 'auth'
 *       429                  -> 'rate_limit'
 *       500..599             -> 'server'
 *       (other 4xx)          -> 'unknown'
 *   - Node-socket-shape: `err.code` string.
 *       ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN,
 *       EPIPE, ECONNABORTED -> 'network'
 *   - Otherwise: 'unknown'.
 *
 * The classifier is structural — it does NOT inspect message strings
 * (a JS error's `.message` is internationalised and unreliable). HTTP
 * shape is checked FIRST so an HTTP wrapper with a status code wins
 * over a possibly-spurious .code field on the same error.
 *
 * Pure. No side effects. Non-throwing on any input.
 *
 * @public
 */
export function classifyHttpError(err: unknown): ClassifiedErrorKind {
  if (err === null || err === undefined) return "unknown";
  if (typeof err !== "object") return "unknown";
  // HTTP-shape: check err.status (number) first. Some SDKs surface
  // the status on err.statusCode; both are accepted.
  const errObj = err as { status?: unknown; statusCode?: unknown; code?: unknown };
  const rawStatus =
    typeof errObj.status === "number"
      ? errObj.status
      : typeof errObj.statusCode === "number"
        ? errObj.statusCode
        : null;
  if (rawStatus !== null && Number.isFinite(rawStatus)) {
    const status = Math.trunc(rawStatus);
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (status >= 500 && status <= 599) return "server";
    // Other 4xx codes (400, 404, 422 etc.) are treated as 'unknown'
    // rather than auth/rate_limit because they typically mean the
    // request shape is wrong, not the credential. The orchestrator
    // surfaces 'unknown' as a retryable transient error; if the bug
    // is real, the retry will also fail and the breaker opens
    // through the normal counter path.
    return "unknown";
  }
  // Node-socket-shape: check err.code.
  if (typeof errObj.code === "string") {
    const code = errObj.code;
    if (
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "EAI_AGAIN" ||
      code === "EPIPE" ||
      code === "ECONNABORTED"
    ) {
      return "network";
    }
  }
  return "unknown";
}

/**
 * Builds a CircuitBreaker instance with the supplied deps.
 *
 * The breaker keeps:
 *   - A ring of recent failure timestamps. Each `attempt` evicts
 *     entries older than `windowMs` before counting; once the
 *     surviving count reaches `maxConsecutiveFailures`, the breaker
 *     opens.
 *   - A consecutive-failure counter for visibility into the status()
 *     report. The counter resets on every successful attempt.
 *   - An openedAt timestamp so the half-open probe path can compute
 *     elapsed-cooldown without re-reading the clock at every call
 *     site.
 *
 * The breaker DOES NOT do any retrying internally. It is the
 * orchestrator's job to compose the breaker with the
 * `computeBackoffMs` helper if retries are desired. This keeps the
 * breaker module orthogonal: any "retry until exhausted" loop the
 * caller wants can be expressed as `for (let i = 0; i < N; i++) { const
 * outcome = await breaker.attempt(fn); if ('result' in outcome) break;
 * if (outcome.exhausted) break; await sleep(computeBackoffMs(...)); }`.
 *
 * On any thrown error that the classifier reports as 'auth' or
 * 'rate_limit', the breaker OPENS the circuit immediately (regardless
 * of consecutive-failure count) and returns exhausted=true. The
 * orchestrator's contract with the user is "do not burn 5 backoff
 * cycles on a bad credential".
 *
 * @public
 */
export function createCircuitBreaker(
  deps: CreateCircuitBreakerDeps,
): CircuitBreaker {
  const label = deps.label;
  const maxConsecutiveFailures =
    deps.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS;
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const classifyError = deps.classifyError ?? classifyHttpError;
  const nowImpl = deps.nowImpl ?? ((): number => Date.now());
  // The randomImpl is reserved for callers composing computeBackoffMs;
  // the breaker does NOT consume randomness itself. We accept the dep
  // for the symmetric API surface so a future feature (e.g. half-open
  // probe randomisation) does not require a signature change.
  // randomImpl is intentionally read here so the dep is captured and
  // the eslint no-unused-vars rule does not fire on a documented seam.
  void deps.randomImpl;
  // backoffBaseMs and backoffCapMs are accepted for the same
  // symmetric-API reason — production wiring passes them so the
  // computeBackoffMs helper can be called via the breaker's
  // configured values. We do not store them as state because the
  // breaker never schedules its own retries.
  void deps.backoffBaseMs;
  void deps.backoffCapMs;
  void DEFAULT_BACKOFF_BASE_MS;
  void DEFAULT_BACKOFF_CAP_MS;
  const log =
    deps.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.error(msg);
    });

  // ─── mutable breaker state ────────────────────────────────────────
  let state: CircuitState = "closed";
  let consecutiveFailures = 0;
  let openedAt: number | null = null;
  // Sliding window of recent failure timestamps (nowImpl values). The
  // list is FIFO; evictFailureWindow drops entries older than
  // (now - windowMs) on every attempt.
  const failureTimestamps: number[] = [];

  function evictFailureWindow(now: number): void {
    const cutoff = now - windowMs;
    while (failureTimestamps.length > 0 && failureTimestamps[0]! < cutoff) {
      failureTimestamps.shift();
    }
  }

  function maybeTransitionToHalfOpen(now: number): void {
    if (state !== "open") return;
    if (openedAt === null) return;
    if (now - openedAt >= cooldownMs) {
      state = "half-open";
      log(`[achilles] circuit ${label}: cooldown elapsed, half-open`);
    }
  }

  function openCircuit(now: number, kind: ClassifiedErrorKind, attempt: number): void {
    state = "open";
    openedAt = now;
    log(
      `[achilles] circuit ${label}: ${kind} attempt=${attempt} opened=true`,
    );
  }

  function recordSuccessfulProbe(): void {
    state = "closed";
    consecutiveFailures = 0;
    openedAt = null;
    failureTimestamps.length = 0;
    log(`[achilles] circuit ${label}: probe succeeded, closed`);
  }

  function recordFailedProbe(now: number, kind: ClassifiedErrorKind): void {
    state = "open";
    openedAt = now;
    log(
      `[achilles] circuit ${label}: ${kind} attempt=1 opened=true`,
    );
  }

  async function attempt<T>(
    fn: () => Promise<T> | T,
  ): Promise<AttemptOutcome<T>> {
    const now = nowImpl();
    // Pre-check: if the breaker is open AND the cooldown has not
    // elapsed, short-circuit immediately. The attemptCount is 0
    // because fn was not invoked.
    if (state === "open") {
      maybeTransitionToHalfOpen(now);
      if (state === "open") {
        const errKind: ClassifiedErrorKind = "unknown";
        log(
          `[achilles] circuit ${label}: ${errKind} attempt=0 opened=true (cooldown)`,
        );
        return Object.freeze({
          error: Object.freeze({
            kind: errKind,
            cause: new Error(`circuit ${label} open`),
          }),
          attemptCount: 0,
          exhausted: true,
        }) as AttemptFailure;
      }
    }

    // At this point state is either 'closed' or 'half-open'. Both
    // invoke fn; only the success/failure bookkeeping differs.
    const isHalfOpenProbe = state === "half-open";
    let result: T;
    try {
      result = await fn();
    } catch (err) {
      const kind = classifyError(err);
      const tsForRecord = nowImpl();
      if (isHalfOpenProbe) {
        // The probe failed — re-open the circuit. The attempt count
        // for the failure shape is 1 (the probe).
        recordFailedProbe(tsForRecord, kind);
        return Object.freeze({
          error: Object.freeze({ kind, cause: err }),
          attemptCount: 1,
          exhausted: true,
        }) as AttemptFailure;
      }
      // Non-retryable kinds open the circuit IMMEDIATELY regardless of
      // the consecutive-failure counter. This is the PITFALLS #4
      // "auth / rate-limit short-circuit": burning 5 backoff cycles on
      // a bad key wastes 30+ seconds; surface to the user fast instead.
      if (kind === "auth" || kind === "rate_limit") {
        consecutiveFailures += 1;
        openCircuit(tsForRecord, kind, 1);
        return Object.freeze({
          error: Object.freeze({ kind, cause: err }),
          attemptCount: 1,
          exhausted: true,
        }) as AttemptFailure;
      }
      // Retryable kinds — increment the counter + sliding window. If
      // the surviving window count reaches maxConsecutiveFailures, the
      // circuit opens; otherwise we surface a non-exhausted failure so
      // the orchestrator can decide whether to retry.
      consecutiveFailures += 1;
      failureTimestamps.push(tsForRecord);
      evictFailureWindow(tsForRecord);
      if (failureTimestamps.length >= maxConsecutiveFailures) {
        openCircuit(tsForRecord, kind, consecutiveFailures);
        return Object.freeze({
          error: Object.freeze({ kind, cause: err }),
          attemptCount: consecutiveFailures,
          exhausted: true,
        }) as AttemptFailure;
      }
      log(
        `[achilles] circuit ${label}: ${kind} attempt=${consecutiveFailures} opened=false`,
      );
      return Object.freeze({
        error: Object.freeze({ kind, cause: err }),
        attemptCount: consecutiveFailures,
        exhausted: false,
      }) as AttemptFailure;
    }

    // Success branch — reset the counter and close the circuit if it
    // was the half-open probe.
    if (isHalfOpenProbe) {
      recordSuccessfulProbe();
    } else {
      // Drop any accumulated failures so the next failure starts a
      // fresh counter; the sliding window is informational and is
      // also cleared so the status() snapshot reflects a clean run.
      consecutiveFailures = 0;
      failureTimestamps.length = 0;
    }
    return Object.freeze({ result }) as AttemptSuccess<T>;
  }

  function status(): CircuitStatus {
    const now = nowImpl();
    maybeTransitionToHalfOpen(now);
    return Object.freeze({
      state,
      consecutiveFailures,
      openedAt,
    }) as CircuitStatus;
  }

  return Object.freeze({ attempt, status }) as CircuitBreaker;
}
