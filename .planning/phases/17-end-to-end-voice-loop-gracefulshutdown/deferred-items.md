# Phase 17 — Deferred Items

Items discovered during plan execution that are OUT OF SCOPE for the plan that found them. Tracked here per the GSD scope-boundary rule (Rule 3 excludes pre-existing failures in unrelated files).

## Lint debt from Plan 17-01 (independently flagged by Plans 17-02 and 17-03 executors)

Plan 17-01's `circuit-breaker.ts`, `tests/circuit-breaker.test.ts`, and `tests/structured-logger.test.ts` ship with ~63 ESLint errors under `typescript-eslint recommended-type-checked`. These were present BEFORE Plans 17-02/17-03 began and are NOT introduced by those plans.

Verification: removing 17-02 and 17-03 files and re-running `npm run lint --workspace apps/achilles-terminal` still emits the same errors.

Categories:

- `circuit-breaker.ts:498-588` — `as AttemptFailure | AttemptSuccess<T> | CircuitStatus` casts after `Object.freeze({...})` flagged "unnecessary type assertion" by the type-checked rule. Casts pre-date 17-02/17-03.
- `circuit-breaker.ts:427` — one `eslint-disable-next-line no-console` comment whose rule is no longer active.
- `tests/circuit-breaker.test.ts:89-617` — ~28 `async () => ...` blocks without `await` flagged by `require-await`. Deliberate test setup arrow functions; cleanup is a multi-line refactor unrelated to 17-02/17-03.
- `tests/structured-logger.test.ts:63-207` — `Unsafe assignment / member access of an any value` triggered by `JSON.parse()` result reads. Adding type guards would be a separate Plan 17-01 cleanup.

These should be cleaned up in a dedicated late-Phase-17 plan OR rolled into Phase 19 (hardening / GATE-04 lint enforcement) where the lint config also gains the `no-restricted-syntax` rule for the `stdio:"ignore"` gate.

17-02 and 17-03 modules (tts-playback, stt-bridge, claude-bridge, sandwich-defence, normalisation, watchdogs) lint clean with zero errors under the same config.
