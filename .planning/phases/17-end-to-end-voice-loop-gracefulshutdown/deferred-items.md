# Phase 17 — Deferred Items

Items discovered during plan execution that are OUT OF SCOPE for the plan that found them. Tracked here per the GSD scope-boundary rule (Rule 3 excludes pre-existing failures in unrelated files).

## Lint debt from Plan 01 (logged during 17-02 execution)

Plan 01's circuit-breaker.ts, tests/circuit-breaker.test.ts, and tests/structured-logger.test.ts ship with 63 ESLint errors under `typescript-eslint recommended-type-checked`. These were present BEFORE 17-02 began and are NOT introduced by 17-02's modules.

Verification: removing all four 17-02 files (tts-playback.ts, stt-bridge.ts, tts-playback.test.ts, stt-bridge.test.ts) and re-running `npm run lint --workspace apps/achilles-terminal` still emits the same 63 errors.

Categories:

- `circuit-breaker.ts:498-588` — `as AttemptFailure | AttemptSuccess<T> | CircuitStatus` casts after `Object.freeze({...})` are flagged "unnecessary type assertion" by the type-checked rule. The casts pre-date 17-02.
- `circuit-breaker.ts:427` — one `eslint-disable-next-line no-console` comment whose rule is no longer active.
- `tests/circuit-breaker.test.ts:89-617` — 28 `async () => ...` blocks without `await` flagged by `require-await`. These are deliberate test setup arrow functions; the cleanup is a multi-line refactor unrelated to 17-02.
- `tests/structured-logger.test.ts:63-207` — `Unsafe assignment / member access of an any value` triggered by JSON.parse() result reads. Adding type guards would be a separate Plan-01 cleanup.

These should be cleaned up in a dedicated Plan 17-XX or rolled into Plan 19 (hardening / GATE-04 lint enforcement) where the lint config also gains the `no-restricted-syntax` rule for the stdio:"ignore" gate.

17-02's modules (`apps/achilles-terminal/src/audio/tts-playback.ts`, `apps/achilles-terminal/src/audio/stt-bridge.ts`, and both new test files) lint clean with zero errors and zero warnings under the same config.
