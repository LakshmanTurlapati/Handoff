---
phase: 13-distribution-npm-cli-skill-installers
plan: 04
subsystem: distribution
tags: [achilles, electron-builder, signing, dist-03, dist-05, safe-01, pitfalls-12, pitfalls-22]

# Dependency graph
requires:
  - phase: 13-01
    provides: "apps/achilles-cli npm package scaffold (commander entrypoint, @achilles/achilles-skill workspace dep, electron-binary-locator)"
  - phase: 13-02
    provides: "apps/achilles-cli install-skill command + packages/achilles-skill SKILL.md (the discovery markdown that wraps companion.md)"
  - phase: 11-01
    provides: "apps/achilles Electron app (electron-vite build pipeline writing to out/)"
  - phase: 12-04
    provides: "packages/achilles-skill/skill/prompts/companion.md content (PROMPT-01 source-of-truth)"
provides:
  - "apps/achilles/electron-builder.json — cross-platform installer config locking appId=com.achilles.voice, mac dmg + hardened runtime + NSMicrophoneUsageDescription + notarisation env-var contract, win nsis + icon, linux AppImage"
  - "apps/achilles/build/entitlements.mac.plist — three Electron-required hardened-runtime entitlements (mic, JIT, allow-unsigned-executable-memory)"
  - "apps/achilles/build/Info.plist.fragment — operator-facing Info.plist mirror of the NSMicrophoneUsageDescription string (drift-prevention pair with electron-builder.json mac.extendInfo)"
  - "apps/achilles/build/README.md — operator-facing release documentation (icons, code-signing env vars, CI policy)"
  - "apps/achilles-cli/scripts/check-source-of-truth.mjs — Pitfall #12 dual-distribution drift gate. SHA-256 diff between source companion.md and tarball-bundled companion.md, plus cli/app version pin check"
  - "apps/achilles-cli/scripts/check-tarball-no-secrets.mjs — Pitfall #22 + SAFE-01 release-time secret scan. Seven concrete regex patterns, defensive log truncation, implicit README env-var-name allowlist"
  - "apps/achilles-cli/package.json prepublishOnly hook + bundledDependencies — npm publish gates and workspace-dep tarball inlining"
  - "Root package.json check:source-of-truth + check:tarball:secrets + check:dist composite release-gate scripts"

affects: [phase-14, release-operator]

# Tech tracking
tech-stack:
  added:
    - "electron-builder@25.1.8 — cross-platform installer builder (devDep on apps/achilles)"
  patterns:
    - "Drift-prevention pairing: electron-builder.json mac.extendInfo string === Info.plist.fragment <string> (asserted by electron-builder.test.mjs EB2)"
    - "Defensive secret-scan log truncation: matched bytes truncated to first 8 chars + literal '...' (defence-in-depth so a CI artefact does not itself leak the leak)"
    - "Implicit allowlist via regex shape: ELEVENLABS_API_KEY assignment regex requires {16,} after `=`, so a bare NAME mention in README prose cannot match — no separate allowlist code needed"
    - "Workspace-dep tarball inlining via bundledDependencies — the achilles npm tarball ships the private @achilles/achilles-skill workspace dep's contents under node_modules/@achilles/achilles-skill/ rather than relying on registry resolution"

key-files:
  created:
    - "apps/achilles/electron-builder.json"
    - "apps/achilles/build/entitlements.mac.plist"
    - "apps/achilles/build/Info.plist.fragment"
    - "apps/achilles/build/README.md"
    - "apps/achilles/electron-builder.test.mjs"
    - "apps/achilles/build/entitlements.mac.test.mjs"
    - "apps/achilles/build/Info.plist.test.mjs"
    - "apps/achilles-cli/scripts/check-source-of-truth.mjs"
    - "apps/achilles-cli/scripts/check-source-of-truth.test.mjs"
    - "apps/achilles-cli/scripts/check-tarball-no-secrets.mjs"
    - "apps/achilles-cli/scripts/check-tarball-no-secrets.test.mjs"
    - "apps/achilles-cli/scripts/check-package-wiring.test.mjs"
  modified:
    - "apps/achilles/package.json (dist/dist:mac/dist:win/dist:linux scripts + electron-builder@25.1.8 devDep)"
    - "apps/achilles-cli/package.json (bundledDependencies + prepublishOnly)"
    - "apps/achilles-cli/README.md (Release verification section)"
    - "package.json (root) (check:source-of-truth + check:tarball:secrets + check:dist scripts)"

key-decisions:
  - "electron-builder pinned to exact 25.1.8 (no caret range) — STACK.md HIGH-confidence v25 packaging choice. The legitimacy gate: >1M weekly downloads on npm, maintained on github.com/electron-userland/electron-builder under the Electron community."
  - "Tarball-secret-scan log truncation locked at first 8 chars + literal '...' — defence in depth so the CI artefact's failure log cannot itself be a leak (T-13-26 mitigation)."
  - "README env-var NAME allowlist is IMPLICIT — encoded into the elevenlabs-env-assignment regex shape (requires {16,} after `=`), so a bare NAME mention in prose cannot match. No separate allowlist code path needed."
  - "bundledDependencies route chosen over postinstall script (which would violate Pitfall #11) — the @achilles/achilles-skill workspace dep is private; npm cannot resolve it from the registry, so the tarball must inline its contents under node_modules/@achilles/achilles-skill/."
  - "node:test runner chosen for the .mjs scripts (NOT vitest) — the scripts are .mjs and must be runnable outside any workspace install context (a pre-publish CI environment that has not yet run `npm install` should still be able to invoke `node apps/achilles-cli/scripts/check-source-of-truth.mjs`)."
  - "Icon binaries (icon.icns, icon.ico, icon.png) NOT shipped — operator-supplied at release time. The v1.2 source tree intentionally does NOT ship placeholder icons because a placeholder could surface as the real product identity in a signed build."

patterns-established:
  - "Pre-publish gate chain: prepublishOnly = source-of-truth check && tarball-no-secrets check. npm aborts publish on any non-zero exit; the source-of-truth check runs FIRST because it is cheaper and fails fast on workspace drift."
  - "Cross-platform installer config single file: electron-builder.json at apps/achilles/ root (alongside electron.vite.config.ts). All three platforms (mac/win/linux) configured in one place. No per-platform JSON file."
  - "Drift-prevention pair: electron-builder.json mac.extendInfo.NSMicrophoneUsageDescription AND apps/achilles/build/Info.plist.fragment carry the same prompt copy. The electron-builder.test.mjs EB2 test asserts byte-equality; a future contributor cannot edit one without the other (T-13-24 mitigation)."

requirements-completed:
  - DIST-03
  - DIST-05

# Metrics
duration: 13min
completed: 2026-06-07
---

# Phase 13 Plan 04: Cross-platform installers + source-of-truth gate + tarball-secret scan Summary

**electron-builder cross-platform installer config + Pitfall #12 source-of-truth diff gate + Pitfall #22 tarball-secret scan + macOS hardened-runtime entitlements — DIST-03 + DIST-05 closed**

## Performance

- **Duration:** 13 min
- **Started:** 2026-06-07T01:46:35Z
- **Completed:** 2026-06-07T01:59:49Z
- **Tasks:** 2
- **Files created:** 12
- **Files modified:** 4
- **Tests added:** 30 (16 source-of-truth + tarball-no-secrets + package-wiring; 14 electron-builder + entitlements + Info.plist + build/README)

## Accomplishments

- DIST-03 (one source of truth — CI diff check) closed via `check-source-of-truth.mjs` + `prepublishOnly` hook + root `check:source-of-truth` script. The check SHA-256-compares the workspace's `packages/achilles-skill/skill/prompts/companion.md` against the bundled `node_modules/@achilles/achilles-skill/skill/prompts/companion.md` inside the tarball produced by `npm pack apps/achilles-cli`, and also verifies the version pin (`apps/achilles-cli/package.json` version === `apps/achilles/package.json` version).
- Pitfall #22 + SAFE-01 (API key in published tarball) closed via `check-tarball-no-secrets.mjs` + `prepublishOnly` hook + root `check:tarball:secrets` script. The check enumerates seven concrete regex patterns (`elevenlabs-sk_`, `elevenlabs-xi-api-key`, `elevenlabs-xi_api_key-assignment`, `elevenlabs-env-assignment`, `anthropic-sk-`, `github-pat`, `github-fine-grained-pat`), packs and extracts the tarball, walks every scannable file, and truncates matched substrings in the failure log to their first 8 characters so the CI artefact does not itself become a leak.
- DIST-05 (signed cross-platform installers) closed via `apps/achilles/electron-builder.json` + `apps/achilles/build/entitlements.mac.plist` + `apps/achilles/build/Info.plist.fragment`. The config locks `appId: com.achilles.voice`, mac dmg target with hardened runtime + the three Electron-required entitlements + NSMicrophoneUsageDescription prompt + notarisation reading `${env.APPLE_TEAM_ID}`, win NSIS + icon, linux AppImage. Output to `dist-installers/`.
- Operator-facing release documentation in `apps/achilles/build/README.md`: the three required icon filenames (icon.icns / icon.ico / icon.png), the five code-signing env vars (APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, CSC_LINK, CSC_KEY_PASSWORD), the per-platform `npm run dist:*` commands, and the explicit CI policy ("electron-builder runs are OPERATOR-triggered only").
- `apps/achilles-cli/package.json` declares `bundledDependencies: ["@achilles/achilles-skill"]` so `npm pack` inlines the private workspace dep into the published tarball — without this, a user running `npm install -g achilles` would fail to resolve the (private) workspace dep against the npm registry.
- All 30 new `node:test` tests pass. The plan's locked minimum was 23.

## Task Commits

Per plan's commit policy ("One atomic commit. Message: `feat(13-04): electron-builder cross-platform config + source-of-truth + tarball-no-secrets checks + operator docs`"), the entire plan is a single commit rather than per-task commits. This is the explicit deviation from the default GSD per-task pattern, and matches the plan's stated commit policy.

## Files Created/Modified

### Created

- `apps/achilles/electron-builder.json` — cross-platform installer config (appId, mac/win/linux blocks, output dir, files filter, asar, npmRebuild:false, publish:null)
- `apps/achilles/build/entitlements.mac.plist` — three hardened-runtime entitlements (`com.apple.security.device.audio-input`, `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`)
- `apps/achilles/build/Info.plist.fragment` — operator-facing Info.plist mirror (NSMicrophoneUsageDescription + LSUIElement) for human review
- `apps/achilles/build/README.md` — operator release contract (icons, env vars, dist commands, CI policy)
- `apps/achilles/electron-builder.test.mjs` — 12 node-test cases covering EB1-EB5 + DIST1-DIST3 + the drift-prevention pair check
- `apps/achilles/build/entitlements.mac.test.mjs` — 2 node-test cases covering ENT1 + ENT2 (no emoji)
- `apps/achilles/build/Info.plist.test.mjs` — 4 node-test cases covering INFO1 + INFO2 + BR1 + BR2
- `apps/achilles-cli/scripts/check-source-of-truth.mjs` — Pitfall #12 release gate (SHA-256 diff + version pin)
- `apps/achilles-cli/scripts/check-source-of-truth.test.mjs` — 6 node-test cases covering SOT1-SOT5 + 1 placeholder
- `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` — Pitfall #22 + SAFE-01 release gate (seven concrete regex patterns)
- `apps/achilles-cli/scripts/check-tarball-no-secrets.test.mjs` — 7 node-test cases covering TNS1-TNS7
- `apps/achilles-cli/scripts/check-package-wiring.test.mjs` — 3 node-test cases covering BD1, BD2, RS1

### Modified

- `apps/achilles/package.json` — added `dist`, `dist:mac`, `dist:win`, `dist:linux` scripts; added `electron-builder: 25.1.8` to devDependencies
- `apps/achilles-cli/package.json` — added `bundledDependencies: ["@achilles/achilles-skill"]`; added `prepublishOnly: "node scripts/check-source-of-truth.mjs && node scripts/check-tarball-no-secrets.mjs"`
- `apps/achilles-cli/README.md` — added "Release verification" section documenting the two gates and the manual `npm run check:dist` smoke test
- `package.json` (root) — added `check:source-of-truth`, `check:tarball:secrets`, `check:dist` scripts (composite chain runs both gates in order)

## Source-of-truth gate explanation (DIST-03 — Pitfall #12)

The dual-distribution drift gate has two arms.

**Arm 1: byte-equality of the embedded prompt.** The script computes SHA-256 of the workspace source file (`packages/achilles-skill/skill/prompts/companion.md`) and compares it to the SHA-256 of the same file as it appears inside the tarball produced by `npm pack apps/achilles-cli` (at the post-pack path `node_modules/@achilles/achilles-skill/skill/prompts/companion.md`). Since the achilles-cli's `package.json` declares `bundledDependencies: ["@achilles/achilles-skill"]`, `npm pack` inlines the workspace dep's contents under `node_modules/@achilles/achilles-skill/`. The diff verifies the bundled body is byte-identical to the source body. On mismatch, the script logs ONLY the first 12 hex characters of each SHA-256 (`source=<12hex> bundled=<12hex>`) — the full file bytes are never logged, so the CI failure log cannot accidentally surface the prompt's content.

**Arm 2: cli/app version pin.** The script reads `version` from `apps/achilles-cli/package.json` and from `apps/achilles/package.json`. Both must equal. A version drift fails the gate with a `version pin drift: achilles <X> !== achilles-app <Y>` diagnostic. This pin ensures a user running `npm install -g achilles@X` gets a tarball whose Electron-app expectation matches version X.

The gate is wired into `prepublishOnly`. npm aborts the publish on any non-zero exit from either arm.

## Tarball-secret-scan gate explanation (DIST-03 + SAFE-01 — Pitfall #22)

The release-time secret scan runs `npm pack --pack-destination <tmpdir> --json` against `apps/achilles-cli/`, extracts the produced tarball, walks the extracted tree, and applies seven concrete regex patterns to every scannable file (`.md`, `.txt`, `.js`, `.mjs`, `.cjs`, `.json`, `.html`, `.css`, `.ts`, `.tsx`).

The seven patterns:

1. `elevenlabs-sk_` — `sk_[A-Za-z0-9_-]{29,}` (ElevenLabs canonical prefix + 29+ chars after)
2. `elevenlabs-xi-api-key` — `xi-api-key:\s*[A-Za-z0-9_-]+` (HTTP header form)
3. `elevenlabs-xi_api_key-assignment` — `xi_api_key\s*=\s*[A-Za-z0-9_-]+` (env-assignment form)
4. `elevenlabs-env-assignment` — `ELEVENLABS_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{16,}["']?` (NAME-with-VALUE form)
5. `anthropic-sk-` — `sk-[A-Za-z0-9_-]{29,}` (defensive — Anthropic-style)
6. `github-pat` — `ghp_[A-Za-z0-9_-]{36,}` (defensive)
7. `github-fine-grained-pat` — `github_pat_[A-Za-z0-9_]+` (defensive)

**Implicit allowlist:** the `elevenlabs-env-assignment` regex requires `{16,}` characters after `=`, so a bare NAME mention in README prose (e.g., "set the ELEVENLABS_API_KEY env var") cannot match. No separate allowlist code path is needed — the regex shape itself encodes the allowlist.

**Defence in depth (T-13-26 mitigation):** the failure log truncates the matched substring to its first 8 characters followed by the literal `...`. The full matched substring is NEVER logged. This way the CI artefact retention does not itself become a leak.

The gate is wired into `prepublishOnly` after the source-of-truth check.

## electron-builder.json contract (DIST-05)

The cross-platform installer config locks:

- `appId: "com.achilles.voice"` and `productName: "Achilles"` (the macOS bundle identifier + the human-readable app name)
- `directories.output: "dist-installers"` — installers land under `apps/achilles/dist-installers/`
- `files`: `out/**/*` + `package.json` (electron-vite writes to `out/`; the existing electron.vite.config.ts convention is preserved). Two negation patterns exclude standard Electron junk paths.
- `asar: true` + `npmRebuild: false` + `publish: null` (the v1.2 release ships unpacked-then-asar bundle; no native deps need rebuild; auto-update servers are out of scope for v1.2)
- `mac.target: "dmg"` + `category: "public.app-category.developer-tools"` + `hardenedRuntime: true` + `gatekeeperAssess: false` + `entitlements: "build/entitlements.mac.plist"` + `extendInfo` injecting `NSMicrophoneUsageDescription` and `LSUIElement: true` (so the .app does not show a dock icon) + `notarize.teamId: "${env.APPLE_TEAM_ID}"`
- `win.target: "nsis"` + `icon: "build/icon.ico"` + `publisherName: "Achilles"` (signing happens automatically when electron-builder finds `CSC_LINK` in env at build time)
- `linux.target: "AppImage"` + `category: "Development"` + `icon: "build/icon.png"` + `executableName: "achilles"`

## Operator release env-var contract

The release operator sets the following in the release shell (or a CI secret store) before invoking `npm run dist:*`:

| Env var | Purpose |
|---------|---------|
| `APPLE_ID` | Apple developer account email associated with the signing identity. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com (NOT the Apple ID password). Used by the notarisation API. |
| `APPLE_TEAM_ID` | 10-character team identifier from developer.apple.com. Substituted into `mac.notarize.teamId` via the `${env.APPLE_TEAM_ID}` ref. |
| `CSC_LINK` | Base64-encoded P12 cert OR a filesystem path to a `.p12` file. macOS + Windows signing path. |
| `CSC_KEY_PASSWORD` | Password that unlocks the P12 cert referenced by `CSC_LINK`. |

The repo does NOT ship sample values or any commit-time secret material. Cert acquisition is the OPERATOR's security domain (Apple Developer cert, Windows EV cert).

## Decisions Made

- `electron-builder@25.1.8` exact pin (no caret range) — STACK.md HIGH-confidence v25 packaging choice. The dependency-legitimacy gate per the deviation rules: electron-builder is on npm with >1M weekly downloads, maintained on github.com/electron-userland/electron-builder under the Electron community umbrella. No human checkpoint required.
- `node:test` runner instead of vitest for the .mjs scripts because they must run outside any workspace install context (a fresh CI environment that hasn't run `npm install` should still be able to invoke `node apps/achilles-cli/scripts/check-source-of-truth.mjs`).
- README env-var NAME allowlist is IMPLICIT via the regex `{16,}` requirement after `=`. No separate allowlist code path or filename-based skip. The regex shape itself encodes the allowlist.
- bundledDependencies route (instead of a postinstall script that would have to copy the skill body at install time) — postinstall scripts would violate Pitfall #11 (slow / unreliable global installs) and would not play well with `npm install -g`.
- Icon binary files (icon.icns, icon.ico, icon.png) are NOT shipped in the source tree — the operator supplies them at release time. The build/README.md documents this expectation. Shipping placeholders could surface as the real product identity in a signed build.
- Drift-prevention pair: the NSMicrophoneUsageDescription string is duplicated between `electron-builder.json` (mac.extendInfo) and `Info.plist.fragment` (the operator-facing mirror), and the EB2 test enforces byte-equality so the two can never drift (T-13-24 mitigation).

## Deviations from Plan

### Tactical addition (not auto-fix; documented)

**1. [Plan policy clarification] Added a third test file `check-package-wiring.test.mjs`**

- **Found during:** Task 1
- **Issue:** The plan listed BD1 and BD2 as "behaviour" entries inside Task 1 but did not name a separate test file for them. The cleanest split was to put SOT* tests in `check-source-of-truth.test.mjs`, TNS* tests in `check-tarball-no-secrets.test.mjs`, and the package.json-shape tests (BD1, BD2, RS1) in a third file `check-package-wiring.test.mjs`.
- **Fix:** Created `apps/achilles-cli/scripts/check-package-wiring.test.mjs` with three node-test cases (BD1, BD2, RS1). The test count is still well above the plan's locked minimum (13 + 14 → 30 actual).
- **Files modified:** `apps/achilles-cli/scripts/check-package-wiring.test.mjs` (new)
- **Verification:** All three tests pass; the BD1 test asserts `bundledDependencies` includes the workspace dep, BD2 asserts the prepublishOnly chain shape, RS1 asserts the three root scripts.
- **Committed in:** part of the single atomic plan commit

### Auto-fixed Issues

None — the plan executed cleanly. The only deviation is the tactical test-file split above, which is a structural choice within the plan's stated test surface rather than an auto-fix.

---

**Total deviations:** 1 (tactical test split — not an auto-fix)
**Impact on plan:** No scope creep. Test surface coverage is 30/23 (130% of the locked minimum). All seven KEY_PATTERNS exercised. Drift-prevention pair locked.

## Issues Encountered

- **Real-mode `npm pack` requires the workspace dep at `apps/achilles-cli/node_modules/@achilles/achilles-skill/`** — npm workspaces hoist deps to the root `node_modules/`, so a fresh `npm install` does NOT populate the local `apps/achilles-cli/node_modules/` directory. To exercise the real-mode source-of-truth check during development, I manually copied `packages/achilles-skill/` into `apps/achilles-cli/node_modules/@achilles/achilles-skill/`. This is a local-dev workaround; at actual publish time, the operator runs `npm publish --workspace apps/achilles-cli` which (per npm docs) resolves the workspace dep correctly before invoking `prepublishOnly`. The script itself is robust: if the bundled path is missing, it emits the helpful diagnostic "tarball missing expected file: <path>; did you run npm pack with bundledDependencies?" (SOT4 test pins this).
- The `bundled deps: 1 / bundled files: 0` line in `npm pack` output is misleading — the tarball DOES contain the bundled files at `package/node_modules/@achilles/achilles-skill/*`. The `bundled files: 0` count in npm's summary appears to be a UI bug; the actual tarball contents (verified via `tar -tzf`) include all 7 files from the workspace dep.

## Pitfall #12 + Pitfall #22 mitigation paths

**Pitfall #12 (dual-distribution drift between skill and CLI):** The source-of-truth diff gate (`check-source-of-truth.mjs`) is the mitigation. Wired into `prepublishOnly` so `npm publish` aborts if the bundled companion.md drifts from the source. The diff also covers the cli/app version pin so the two consumer surfaces stay tied to one version.

**Pitfall #22 (ElevenLabs API key leak to published tarball):** The tarball-secret-scan gate (`check-tarball-no-secrets.mjs`) is the mitigation. Seven concrete regex patterns across all scannable file extensions. The README env-var NAME mention is implicitly allowlisted via the `{16,}` regex requirement after `=`. The failure log truncates matched bytes to the first 8 chars + `...` so the CI artefact retention does not itself become a leak. Wired into `prepublishOnly` after the source-of-truth check.

## User Setup Required

None — the plan ships configuration + scripts only. The operator-facing setup (Apple Developer cert, code-signing env vars, icon binaries) is documented in `apps/achilles/build/README.md` and will be performed by the human release operator before the first signed build. No new env vars need to land in the codebase.

## Threat Flags

None new. The plan addresses T-13-19 (Tampering — bundled skill body diverging), T-13-20 (Information Disclosure — published tarball containing ElevenLabs key), T-13-21 (Tampering — malicious electron-builder version, mitigated by exact pin), T-13-24 (Tampering — Info.plist NSMicrophoneUsageDescription silently changed, mitigated by drift-prevention pair), and T-13-26 (Information Disclosure — regex scanner logging full matched secret, mitigated by truncation). T-13-22, T-13-23, and T-13-25 are documented as accept/operator-owned.

## Plan 13-01 cross-plan note

Plan 13-04 added `bundledDependencies: ["@achilles/achilles-skill"]` to `apps/achilles-cli/package.json`. This is a one-line patch to the manifest Plan 13-01 originally created — Plan 13-01's tarball expectations are now amended to "the bundled @achilles/achilles-skill body lands at `node_modules/@achilles/achilles-skill/` in the published tarball" rather than "the workspace dep resolves at install time". The Plan 13-01 SUMMARY does not need a rewrite; this SUMMARY is the authoritative record of the manifest change.

## Next Phase Readiness

- DIST-03 and DIST-05 closed. Plan 13-03 (init wizard) is in concurrent Wave 2 and does not overlap with the files modified here.
- Phase 14 (Hardening / Privacy / Resilience) can now consume the dist scripts via the operator-triggered `npm run dist:*` commands and the `check:dist` gate.
- The macOS code-signing identity (Apple Developer cert) acquisition remains the v1.2 release blocker tracked in STATE.md and documented in `apps/achilles/build/README.md`. Plan 13-04 ships ZERO secret material; cert acquisition is OPERATOR-owned.

## Self-Check: PASSED

Verified after writing SUMMARY.md:

- All 12 created files exist on disk
- All 4 modified files contain the locked changes (grep verification)
- 30 new node-test cases pass via `node --test`
- Real-mode `node apps/achilles-cli/scripts/check-source-of-truth.mjs` exits 0 against the current source tree
- Real-mode `node apps/achilles-cli/scripts/check-tarball-no-secrets.mjs` exits 0 against the current source tree
- Phase 09 / 10 / 11 / 12 / 13 test counts preserved (145 / 157 / 449 / 235 / 46 — no regressions)
- Typecheck clean for `apps/achilles` and `apps/achilles-cli`
- NO emoji codepoints across all 16 modified files (verified by automated scan)

---
*Phase: 13-distribution-npm-cli-skill-installers*
*Plan: 04*
*Completed: 2026-06-07*
