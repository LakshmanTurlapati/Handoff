# Phase 8: Hosted Launch & Active-Session Handoff - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Mode:** Smart-discuss (verification — implementation already shipped across 06/07/07.1/08.1)

<domain>
## Phase Boundary

Verify the user-facing handoff launch path end-to-end: `$handoff` (Codex skill) mints a single-use Fly-hosted `/launch/<publicId>` URL + terminal QR, opening the URL completes the authless launch routing, and the phone lands on the active session that originated the handoff. Confirm public install + usage docs describe the real npm-plus-Codex flow.

**Scope anchor:** verification of the assembled flow and any glue/docs gaps. This phase does not introduce new pairing modes, new command surfaces, or new product capabilities — it certifies the existing launch path as complete and shipped.

**Prior-phase coverage:**
- Launch URL minting + persistence: phase 7 (handoff record), phase 08.1 (hosted resolution)
- QR rendering: phase 6 (`apps/bridge/src/lib/qr.ts`)
- Authless `/launch/<publicId>` resolution + active-session deep-link: phase 08.1
- Codex skill invocation surface: phase 07.1
- Install + bootstrap path: phase 6 + phase 07.1 docs sweep

</domain>

<decisions>
## Implementation Decisions

### Verification Scope

- **D-01:** This phase is a verification + documentation gap-closure pass, not a new build. Plans are expected to ship as verification SUMMARYs with minimal or no code changes.
- **D-02:** Any real gaps surfaced during verification (e.g., missing test coverage on the end-to-end path, missing usage doc section) are closed within this phase via targeted commits.

### Launch URL + QR Contract (success criterion 1)

- **D-03:** The canonical mint path is `POST /api/handoffs` returning `{ publicId, launchUrl, expiresAt, ... }`. `apps/bridge/src/cli/codex-handoff.ts` consumes this and renders the QR for terminal output via `apps/bridge/src/lib/qr.ts`.
- **D-04:** Single-use semantics: subsequent invocations from the same active thread reuse the existing valid handoff record (Phase 7 D-04/D-05). Revocation, expiry, and unauthorized device error paths remain fail-closed (already covered in `07-03-SUMMARY.md`).

### Hosted Routing (success criterion 2)

- **D-05:** Hosted routing flows through the authless `apps/web/app/launch/[publicId]/route.ts` Route Handler (Phase 08.1 D-01). No re-introduction of GitHub OAuth on the launch path.
- **D-06:** The error surface for expired / revoked / unknown launch ids is the authless `/launch/error` page (Phase 08.1).

### Active-Session Deep-Link (success criterion 3)

- **D-07:** After the device session is minted/reused, the route handler redirects to `/session/[sessionId]` for the thread/session bound to the originating `/handoff` call (Phase 08.1).
- **D-08:** Browser principal derivation on `/session/[sessionId]` reads from the durable device session + linked bridge installation only (Phase 08.1).

### Public Docs (success criterion 4)

- **D-09:** Top-level `README.md` and `apps/bridge/README.md` describe the npm-install-plus-Codex flow:
  1. `npm install --global remote-handoff`
  2. `handoff install-codex-skill`
  3. From an active Codex thread, run `$handoff`
  4. Open the printed URL or scan the QR on the phone
  5. Land on the active session
- **D-10:** Any remaining references to the legacy `/handoff` slash command or pre-08.1 GitHub-OAuth launch flow in user-facing docs are corrected. References inside historical notes / changelogs / archived planning docs may remain.

### Tests

- **D-11:** Add a smoke / integration check (unit-level if E2E infra is unavailable) that exercises: launch URL mint → publicId resolution → device-session issuance → session redirect. If equivalent coverage already exists (see `apps/web/tests/unit/handoff-launch-page.test.ts`, `remote-principal.test.ts`), record the cross-reference in the SUMMARY rather than duplicating.

### Claude's Discretion

- The exact split between docs-only verification vs. backed-by-test verification per success criterion, as long as every criterion is explicitly cross-referenced in the corresponding SUMMARY.
- Whether to add a new combined E2E test or simply record the union of existing unit coverage that already proves the flow.

</decisions>

<canonical_refs>
## Canonical References

### Product Scope and Phase Requirements
- `.planning/ROADMAP.md` — Phase 8 goal, requirements (LAUNCH-01, LAUNCH-02, LAUNCH-03, SAFE-02, DX-01), and success criteria
- `.planning/PROJECT.md` — milestone goal
- `.planning/REQUIREMENTS.md` — authoritative requirement acceptance criteria
- `.planning/STATE.md` — current milestone state

### Prior-Phase Artifacts (the implementation that this phase certifies)
- `.planning/phases/06-npm-distribution-local-bootstrap/06-03-SUMMARY.md` — handoff launch daemon seam, QR rendering
- `.planning/phases/07-codex-native-handoff-command/07-02-SUMMARY.md` — thread-bound hosted handoff contract + `codex-handoff` helper
- `.planning/phases/07-codex-native-handoff-command/07-03-SUMMARY.md` — fail-closed error paths
- `.planning/phases/07.1-codex-cli-handoff-skill-migration/07.1-01-SUMMARY.md` through `07.1-03-SUMMARY.md` — skill packaging + docs sweep
- `.planning/phases/08.1-authless-hosted-launch/08.1-01-SUMMARY.md` — authless launch + active-session deep-link

### Integration Seams (read-only references during verification)
- `apps/web/app/api/handoffs/route.ts` — handoff mint endpoint (publicId, launchUrl, expiry)
- `apps/web/lib/handoff-launch.ts` — launch resolution + thread handoff revocation helpers
- `apps/web/app/launch/[publicId]/route.ts` — authless launch resolution + active-session redirect
- `apps/web/app/launch/error/page.tsx` — fail-closed error surface
- `apps/bridge/src/cli/codex-handoff.ts` — Codex-side handoff helper (env-bound to `CODEX_THREAD_ID`)
- `apps/bridge/src/lib/qr.ts` — terminal QR rendering
- `apps/bridge/resources/codex/skills/handoff/SKILL.md` — Codex skill manifest

</canonical_refs>

<code_context>
## Existing Code Insights

### Already Built (no rebuild required)
- Launch URL mint endpoint at `apps/web/app/api/handoffs/route.ts:80` (`publicId` minted via `randomBytes(18).toString("base64url")`) with `launchUrl = ${baseUrl}/launch/${publicId}` at line 106
- `codex-handoff` helper that consumes the mint response and renders QR for terminal output
- Authless `/launch/[publicId]` route handler that issues a device session and redirects to `/session/[sessionId]`
- Codex skill `$handoff` invocation registered through `install-codex-skill`
- README + bridge README updated to describe the npm + `$handoff` flow (Phase 07.1-03)

### Patterns Established
- Single-use, thread-bound, short-lived hosted launch token
- Authless device-session bootstrap from a one-shot publicId
- Fail-closed error surfaces for expired / revoked / unknown launch ids

</code_context>

<specifics>
## Specific Ideas

- Plan split tracks the three ROADMAP stubs:
  1. `08-01` — verify launch URL + QR generation from the active-session flow
  2. `08-02` — verify hosted publicId consumption + active-session deep-link after pairing
  3. `08-03` — verify install + usage docs match the npm + Codex `$handoff` flow

- Every plan SUMMARY must cross-reference the prior-phase artifacts that delivered the underlying capability, and explicitly state which `must_have` truth maps to which existing file / test / commit.

</specifics>

<deferred>
## Deferred Ideas

- Broader v1.0 verification debt sweep (per PROJECT.md "Out of Scope")
- Native iOS/Android app support
- Team / shared-edit sessions

</deferred>
