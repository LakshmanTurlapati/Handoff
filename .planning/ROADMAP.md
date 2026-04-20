# Roadmap: Codex Mobile

## Archived Milestones

- [x] [v1.0 Codex Mobile MVP](./milestones/v1.0-ROADMAP.md) - 6 phases, 21 plans, shipped 2026-04-18, archived with accepted verification gaps

## Current Milestone

- [ ] **v1.1 Handoff Install & Launch** - Phases 6-8.1, in progress

## Phase Details

### Phase 6: npm Distribution & Local Bootstrap
**Goal**: Turn Handoff into a distributable npm install experience with a stable local bootstrap path outside the monorepo
**Depends on**: v1.0 archived baseline
**Requirements**: DIST-01, DIST-02, DIST-03, LAUNCH-04
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. A developer can install Handoff from npm without cloning this repository
  2. The installed package exposes a usable local `handoff` CLI or equivalent `npx` path
  3. Starting Handoff no longer requires manual `CODEX_MOBILE_USER_ID` or `CODEX_MOBILE_DEVICE_SESSION_ID` env setup
  4. The local bootstrap path still preserves an outbound-only bridge model
**Plans**: 3 plans

Plans:
- [ ] 06-01: Package the local bridge/runtime into a distributable npm CLI surface
- [ ] 06-02: Add install-time or first-run bootstrap for local runtime state and bridge prerequisites
- [ ] 06-03: Replace manual daemon credential wiring with install-safe local bootstrap and launch orchestration

### Phase 7: Codex-Native `/handoff` Command
**Goal**: Make remote continuation start from inside Codex instead of from a separate local bridge command
**Depends on**: Phase 6
**Requirements**: CMD-01, CMD-02, SAFE-01
**UI hint**: no
**Success Criteria** (what must be TRUE):
  1. Codex exposes `/handoff` as the user-facing command after install
  2. `/handoff` starts from the active session/thread context rather than forcing later generic selection
  3. The new command path preserves Codex approval and sandbox semantics instead of widening them
  4. The local handoff entrypoint reuses the packaging/bootstrap work from Phase 6 rather than introducing a parallel path
**Plans**: 3 plans

Plans:
- [x] 07-01: Add the Codex-facing command/plugin surface for `/handoff`
- [x] 07-02: Capture active-session context and handoff metadata at command invocation time
- [x] 07-03: Validate the command path against approval, sandbox, and bridge-boundary constraints

### Phase 8: Hosted Launch & Active-Session Handoff
**Goal**: Complete the user-facing handoff launch so the generated URL opens the Fly-hosted site, pairs the device, and lands on the active session
**Depends on**: Phase 7
**Requirements**: LAUNCH-01, LAUNCH-02, LAUNCH-03, SAFE-02, DX-01
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. `/handoff` generates a single-use Fly-hosted URL and terminal QR code
  2. Opening the URL routes through the hosted sign-in and pairing flow rather than a local-only surface
  3. After pairing, the phone lands on the active session that initiated `/handoff`
  4. Public install and usage docs match the real npm-plus-Codex flow
**Plans**: 3 plans

Plans:
- [ ] 08-01: Generate hosted handoff launch URLs and QR output from the active-session flow
- [ ] 08-02: Consume launch metadata on the web side and deep-link into the active session after pairing
- [ ] 08-03: Publish install and usage docs for npm install plus Codex `/handoff`

### Phase 08.1: Authless Hosted Launch (INSERTED)
**Goal**: Remove hosted GitHub OAuth from the handoff path so the short-lived `/launch/[publicId]` URL can establish or reuse a trusted device session and land on the active session directly
**Depends on**: Phase 8
**Requirements**: LAUNCH-02, LAUNCH-03, SAFE-02, DX-01
**UI hint**: yes
**Success Criteria** (what must be TRUE):
  1. Opening a valid `/launch/[publicId]` URL on Fly no longer redirects through GitHub sign-in
  2. The hosted app can establish or reuse a 7-day `cm_device_session` from the launch URL and handoff metadata alone
  3. Device, session, and relay browser flows use the durable device session as the browser principal instead of Auth.js
  4. Hosted docs and operators no longer need GitHub OAuth configuration for the Fly handoff flow
**Plans**: 3 plans

Plans:
- [ ] 08.1-01: Add the hosted `/launch/[publicId]` entrypoint and launch-claim device session flow
- [ ] 08.1-02: Replace Auth.js browser identity checks with device-session principals in the live/session APIs
- [ ] 08.1-03: Remove GitHub OAuth runtime surfaces and update tests/docs for the authless Fly launch

## Progress

**Execution Order:**
Phases execute in numeric order: 6 -> 7 -> 8 -> 08.1

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 6. npm Distribution & Local Bootstrap | v1.1 | 3/3 | Complete | 2026-04-19 |
| 7. Codex-Native `/handoff` Command | v1.1 | 0/3 | Not started | - |
| 8. Hosted Launch & Active-Session Handoff | v1.1 | 0/3 | Not started | - |
| 08.1. Authless Hosted Launch | v1.1 | 0/3 | Ready to execute | - |
