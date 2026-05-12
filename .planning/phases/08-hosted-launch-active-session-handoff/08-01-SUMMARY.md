---
phase: 08-hosted-launch-active-session-handoff
plan: 01
subsystem: handoff
tags: [codex-skill, handoff, mint, qr, launch-url, vitest]

requires:
  - phase: 7
    provides: thread-bound hosted handoff contract (`POST /api/handoffs`) and bridge-side `codex-handoff` helper
  - phase: 07.1
    provides: packaged `$handoff` Codex skill that invokes `handoff codex-handoff --format json`
  - phase: 6
    provides: terminal QR renderer (`apps/bridge/src/lib/qr.ts`) consumed by the launch surface

provides:
  - Verified single-use Fly-hosted launch URL plus QR text contract from the active-session flow
  - Verified env-derived (`CODEX_THREAD_ID` / `CODEX_SESSION_ID`) thread binding with no session-picker fallback
  - Cross-reference map from must_have truths to the existing prior-phase artifacts and tests that prove them

affects:
  - Plan 08-02 (hosted launch consumption) consumes the verified mint contract
  - Plan 08-03 (docs) consumes the verified runtime path described here

tech-stack:
  added: []
  patterns:
    - Hosted handoff mint-or-reuse keyed on (user, bridge installation, thread, session) with a short-lived `publicId` minted via `randomBytes(18).toString("base64url")`
    - Codex skill returns only the launch URL, QR text, expiry, reuse state, and repair guidance

key-files:
  created: []
  modified: []

key-decisions:
  - "Verification-only pass: every must_have truth maps to existing code or tests shipped in phases 6/7/07.1 — no new code was required"
  - "QR rendering for the active-session flow is fed by `qrText` (the launchUrl string) returned by the helper; Codex CLI presents the QR text to the user via the skill output rather than the bridge spawning a terminal renderer in the codex-handoff path"

patterns-established:
  - "Verification cross-reference: each truth in must_haves names the implementing file plus the test file/case that proves it"

requirements-completed:
  - LAUNCH-01
  - SAFE-02

duration: ~30min
completed: 2026-05-12
---

# Phase 08-01: Hosted Launch URL + QR Generation Verification

**Verified that `$handoff` (via `handoff codex-handoff --format json`) mints a single-use Fly-hosted `/launch/<publicId>` URL and QR text from the active Codex thread context, reusing the existing valid record on repeated same-thread invocations and failing closed when the thread context is absent.**

## Performance

- **Duration:** ~30 minutes
- **Started:** 2026-05-12
- **Completed:** 2026-05-12
- **Tasks:** 1 (verification pass)
- **Files modified:** 0 (no implementation changes required; the implementation shipped in prior phases)

## Accomplishments

- Cross-referenced every must_have truth against the existing implementation files and unit tests shipped in phases 6, 7, and 07.1.
- Confirmed the mint endpoint and bridge helper still emit the expected `{ threadId, sessionId, launchUrl, qrText, expiresAt, reused }` shape with `launchUrl = ${baseUrl}/launch/${publicId}`.
- Confirmed env-derived thread binding remains fail-closed (no picker fallback) and that the Codex skill manifest still routes invocations through `handoff codex-handoff --format json`.

## Task Commits

- Plan and Summary docs only — no code commits required for this plan.

## Files Created/Modified

No code or resource files modified.

### Verified (read-only)

- `apps/web/app/api/handoffs/route.ts` (lines 80, 106-111) — `publicId` mint, `launchUrl` + `qrText` assembly, short-lived `expiresAt`, fail-closed branches for missing bootstrap, revoked installation, user mismatch, and revoked row
- `apps/bridge/src/cli/codex-handoff.ts` (lines 74-92, 135-149) — `readContextValue` chain (`options > CODEX_THREAD_ID > CODEX_SESSION_ID`) and the `missing_active_thread_context` fail-closed path
- `apps/bridge/src/cli.ts` (lines 100-117) — `codex-handoff` case forwards env values and `--thread-id` / `--session-id` flag overrides; failures emit `message` plus `guidance` on stderr
- `apps/bridge/resources/codex/skills/handoff/SKILL.md` — invocation contract: run `handoff codex-handoff --format json`, return launch URL + QR text + expiry + reuse state, no session picker
- `apps/bridge/src/lib/qr.ts` — `renderTerminalQr` available for QR consumption (used by `pair`; the active-session flow returns `qrText` so Codex CLI renders the QR)

## Verification (must_haves mapped to evidence)

- "`POST /api/handoffs` mints a single-use Fly-hosted `/launch/<publicId>` URL bound to the active Codex thread and returns a short-lived expiry."
  - Implementation: `apps/web/app/api/handoffs/route.ts` (publicId at line 80, launchUrl at 106, expiry via `HANDOFF_TTL_MS = 15 * 60 * 1000`)
  - Tests: `apps/web/tests/unit/handoff-route.test.ts` — "returns a fresh handoff descriptor for a valid bridge bootstrap token", "returns a replacement handoff when the previous row is expired", plus fail-closed cases (`missing_bridge_bootstrap_token`, `handoff_not_authorized` on revoked installation / user mismatch, `handoff_revoked` on revoked row)

- "`handoff codex-handoff --format json` returns the hosted descriptor with `launchUrl` and `qrText`, derived from the active thread context only."
  - Implementation: `apps/bridge/src/cli/codex-handoff.ts` `runCodexHandoffCommand` lines 84-163
  - Tests: `apps/bridge/tests/unit/codex-handoff-command.test.ts` — "falls back to CODEX_THREAD_ID when explicit ids are omitted", "prefers CODEX_SESSION_ID over CODEX_THREAD_ID for session binding", "creates a fresh handoff and returns clean JSON with daemon_started", "fails with missing_active_thread_context"

- "Repeated invocations from the same active thread reuse the existing valid handoff record rather than minting a new public id."
  - Implementation: `apps/web/app/api/handoffs/route.ts` lines 72-95 (`createOrReuseThreadHandoff` returns `{ handoff, reused }`)
  - Tests: `apps/web/tests/unit/handoff-route.test.ts` "returns reused true when the same thread already has a valid handoff" and `apps/bridge/tests/unit/codex-handoff-safety.test.ts` "returns reused true for the same thread when the hosted handoff is reused" and "does not reuse a previous handoff across different thread ids"

## Build / Test Results

- `apps/bridge` `npm run build`: clean
- `npx vitest run apps/web/tests/unit/handoff-route.test.ts apps/bridge/tests/unit/codex-handoff-command.test.ts apps/bridge/tests/unit/codex-handoff-safety.test.ts apps/bridge/tests/unit/codex-command-install.test.ts`: 22/22 passing
- Pre-existing unrelated failures in `apps/bridge/tests/unit/event-relay.test.ts` are out of scope for this phase (noted previously in 07.1-03 summary).

## Deviations from PLAN

- None. Plan executed as a verification pass with no code changes required.

## Cross-References to Prior Phases

- **Mint endpoint and bridge helper** — shipped in phase 7:
  - `add2367` feat(07-02): add thread-bound handoff contract
  - `ac970d2` feat(07-02): add hosted handoff minting route
  - `93b80b2` feat(07-02): add codex handoff helper
  - `6c95d8d` fix(07-03): fail closed in codex handoff helper
  - `ec55e36` fix(07-03): harden hosted handoff authorization
  - `b72a521` test(07-03): add handoff safety regressions
- **Skill packaging and env binding** — shipped/verified in phase 07.1:
  - `16d6948` fix(handoff): install slash prompt for current codex builds
  - `3b2f288` feat(08.1): remove github oauth from handoff launch (env wiring in cli.ts)
  - `4cd14a4` fix(handoff): ship an executable cli bin
- **Terminal QR renderer** — established in phase 01-02 and reused via packaging in phase 6 (`apps/bridge/src/lib/qr.ts::renderTerminalQr`).

---
*Phase: 08-hosted-launch-active-session-handoff*
*Completed: 2026-05-12*
