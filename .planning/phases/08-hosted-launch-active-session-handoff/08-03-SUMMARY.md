---
phase: 08-hosted-launch-active-session-handoff
plan: 03
subsystem: docs
tags: [docs, readme, install, codex-skill, dx]

requires:
  - phase: 07.1
    plan: 03
    provides: docs and web copy sweep moving the user-facing surface from `/handoff` to `$handoff`
  - phase: 6
    provides: npm package `remote-handoff` and the `handoff` global CLI
  - phase: 08-01
    provides: certified runtime contract that the docs describe

provides:
  - Verified install + usage docs at `README.md` and `apps/bridge/README.md` matching the real npm + Codex `$handoff` flow
  - Confirmed `handoff --help` orders `install-codex-skill` ahead of the deprecated `install-codex-command` alias
  - Confirmed the hosted launch error copy points the user back to `$handoff`

affects:
  - First-run user onboarding for v1.1 install

tech-stack:
  added: []
  patterns:
    - User-facing copy references skill invocation (`$handoff`) and skill discovery (`/skills`); legacy `/handoff` references are scoped to changelogs and archived planning context only

key-files:
  created: []
  modified: []

key-decisions:
  - "Docs sweep is verification-only; copy was already updated in phases 07.1 and 08.1. No further edits required for this plan"
  - "Historical references inside `.planning/phases/07-*` and earlier archive context were left untouched (matches D-10 and 07.1-03 sweep policy)"

patterns-established:
  - "Docs verification: grep `{README.md, apps/**/*.{ts,tsx,md}, packages/**/*.{ts,tsx}}` for `/handoff` and confirm every remaining match is either a package name (`@codex-mobile/handoff`), a Fly hostname (`handoff-web.fly.dev`), or scoped archival prose"

requirements-completed:
  - DX-01

duration: ~15min
completed: 2026-05-12
---

# Phase 08-03: Install + Usage Docs Verification

**Confirmed that `README.md`, `apps/bridge/README.md`, the hosted launch error page, and `handoff --help` all describe the real npm-install-plus-Codex `$handoff` flow with no live references to the legacy `/handoff` slash command.**

## Performance

- **Duration:** ~15 minutes
- **Started:** 2026-05-12
- **Completed:** 2026-05-12
- **Tasks:** 1 (verification sweep)
- **Files modified:** 0 (docs already aligned by prior phases)

## Accomplishments

- Confirmed `README.md` "Hosted Handoff Launch" section describes the `$handoff` flow and the `/launch/<publicId>` redirect to `/session/<sessionId>` without secondary GitHub OAuth.
- Confirmed `apps/bridge/README.md` documents `npm install --global remote-handoff`, `handoff install-codex-skill`, and `$handoff` invocation in Codex CLI; `install-codex-command` appears only as a deprecated alias.
- Confirmed `apps/bridge/src/cli.ts::printUsage` orders `install-codex-skill` ahead of `install-codex-command` and labels the latter "Deprecated alias for install-codex-skill".
- Confirmed `apps/web/app/launch/error/page.tsx` remediation copy points the user back to `$handoff` for every error code.

## Task Commits

- Plan and Summary docs only — no code or doc commits required for this plan.

## Files Created/Modified

No files modified.

### Verified (read-only)

- `README.md` — "Hosted Handoff Launch" section (lines 196-203): five-step flow describes `$handoff` invocation, the hosted `/launch/<publicId>` URL, no GitHub OAuth, device session establishment, and redirect to `/session/<sessionId>`
- `apps/bridge/README.md` — Install (lines 9-19), Codex Setup (lines 21-32), Commands (lines 34-41): canonical install + `$handoff` flow with `install-codex-command` flagged deprecated
- `apps/bridge/src/cli.ts` — `printUsage` (lines 26-45): skill-first command ordering with deprecation note
- `apps/web/app/launch/error/page.tsx` — `ERROR_COPY` (lines 3-20): every error message references running `$handoff` from the active Codex thread

## Verification (must_haves mapped to evidence)

- "Top-level `README.md` and `apps/bridge/README.md` describe the install path as `npm install --global remote-handoff` followed by `handoff install-codex-skill`."
  - Evidence: `apps/bridge/README.md` lines 9-32; `README.md` references the install package and Codex flow in the "Hosted Handoff Launch" section.

- "User-facing docs describe the runtime path as: run `$handoff` from the active Codex thread, then open the printed URL or scan the QR on the phone to land on the active session."
  - Evidence: `README.md` lines 196-203 (five-step flow); `apps/bridge/README.md` lines 30-32 ($handoff invocation); `apps/web/app/launch/error/page.tsx` remediation copy.

- "Docs no longer present `/handoff` as a supported Codex slash command; legacy `/handoff` references are scoped to historical or archival context only."
  - Evidence: phase 07.1-03 sweep (commit `f60de7b`); confirmed during this plan that no live user-facing copy in `README.md` / `apps/**/*.{ts,tsx,md}` / `packages/**/*.{ts,tsx}` presents `/handoff` as the supported slash command. Remaining hits are package names or Fly hostnames.

- "`handoff --help` lists `install-codex-skill` first and marks `install-codex-command` as a deprecated alias."
  - Evidence: `apps/bridge/src/cli.ts` lines 34-35.

## Build / Test Results

- No build or test changes; no regression risk to verify in this plan.
- Plan 08-01 and 08-02 already exercised the relevant suites (22/22 + 7/7 passing).
- Pre-existing unrelated failures in `apps/bridge/tests/unit/event-relay.test.ts` are out of scope.

## Deviations from PLAN

- None. Plan executed as a verification sweep with no doc changes required.

## Cross-References to Prior Phases

- **Docs and web copy sweep moving the user-facing surface from `/handoff` to `$handoff`** — phase 07.1-03 (`f60de7b` docs(07.1): summarize skill migration verification), building on the copy changes shipped in `3b2f288` feat(08.1) and `16d6948` fix(handoff).
- **`handoff` global CLI executable bin** — phase 08.1 (`4cd14a4` fix(handoff): ship an executable cli bin).
- **`install-codex-skill` packaging and the `install-codex-command` deprecation alias** — phase 07.1-01.

---
*Phase: 08-hosted-launch-active-session-handoff*
*Completed: 2026-05-12*
