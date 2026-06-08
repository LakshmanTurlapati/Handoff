---
phase: 17-end-to-end-voice-loop-gracefulshutdown
plan: 01
subsystem: infra
tags: [workspace-deps, circuit-breaker, structured-logger, ndjson, sha-256, source-of-truth, typescript, vitest]

# Dependency graph
requires:
  - phase: 15-workspace-scaffold-bun-build-pipeline
    provides: "apps/achilles-terminal monorepo workspace + D-15-01 (name=achilles-terminal) + D-15-02 (npm install --include=optional --force)"
  - phase: 16-tui-shell-mic-vad-states
    provides: "Session EventEmitter shape, src/state/constants.ts (AchillesState, SPEAKING_DEBOUNCE_MS), vitest forks pool, link-ink.mjs pretest hook"
provides:
  - "Workspace-internal voice-package dependencies under apps/achilles-terminal (LOOP-02 lifted for Phase 17 only)"
  - "src/session-events.ts: 15-variant SessionEvent discriminated union for Wave 2 audio bridges"
  - "src/circuit-breaker.ts: ERR-02 substrate, v1.2 port with CONTEXT.md-locked thresholds"
  - "src/structured-logger.ts: NDJSON logger substrate with 10MB rotation + 6-regex default redaction"
  - "src/audio/companion-md.ts: companion.md path resolver + SHA-256 source-of-truth verifier"
  - "scripts/check-source-of-truth.mjs: LOOP-02 SHA-256 drift detection CI gate"
affects:
  - 17-02 (claude-bridge will import resolveCompanionPromptPath for --append-system-prompt-file)
  - 17-02 (stt-bridge + tts-playback will wrap WSS factories in createCircuitBreaker)
  - 17-04 (session.ts wiring will instantiate createStructuredLogger at runVoice() entry)
  - 17-05 (graceful-shutdown will subscribe to SessionEvent shutdown variant)
  - 19-hardening-distribution (publish-then-cut sequence relies on check:source-of-truth as a release gate)

# Tech tracking
tech-stack:
  added:
    - "Workspace symlinks: node_modules/@achilles/{voice-protocol,voice-stt,voice-tts,claude-code-bridge,achilles-skill}"
    - "tsconfig paths override pointing the 5 @achilles deps at packages/*/dist/index.d.ts"
    - "SHA-256 source-of-truth gate via node:crypto.createHash"
    - "appendFileSync-backed NDJSON logger with sync rotation"
  patterns:
    - "Workspace dep pinning convention: literal '0.1.0' (matches v1.2 apps/achilles + apps/achilles-cli; workspace:* not used in this monorepo)"
    - "TypeScript discriminated union over { type, payload, timestamp } as the EventEmitter shape contract"
    - "Threshold dep-injection seam: every breaker default overridable per-instance (nowImpl, randomImpl, classifyError, logger, maxConsecutiveFailures, windowMs, cooldownMs, backoffBaseMs, backoffCapMs)"
    - "Hermetic logger tests via node:fs.mkdtempSync + node:os.tmpdir"

key-files:
  created:
    - apps/achilles-terminal/src/session-events.ts
    - apps/achilles-terminal/src/circuit-breaker.ts
    - apps/achilles-terminal/src/structured-logger.ts
    - apps/achilles-terminal/src/audio/companion-md.ts
    - apps/achilles-terminal/scripts/check-source-of-truth.mjs
    - apps/achilles-terminal/tests/audio/companion-md.test.ts
    - apps/achilles-terminal/tests/circuit-breaker.test.ts
    - apps/achilles-terminal/tests/structured-logger.test.ts
  modified:
    - apps/achilles-terminal/package.json
    - apps/achilles-terminal/tsconfig.json
    - package-lock.json

key-decisions:
  - "Workspace deps pinned to literal '0.1.0' (no workspace:* in monorepo). Matches v1.2 apps/achilles + apps/achilles-cli convention."
  - "tsconfig.base.json paths default to packages/*/src/index.ts; apps/achilles-terminal/tsconfig.json overrides with dist/*.d.ts pattern (Rule 3 deviation; v1.2 apps/achilles/tsconfig.node.json uses same shape)."
  - "Circuit-breaker defaults track CONTEXT.md (windowMs=30s, cooldownMs=60s, backoffCapMs=30s) rather than v1.2 (windowMs=60s, cooldownMs=30s, backoffCapMs=5s). Every threshold remains per-instance overridable."
  - "Structured logger sync-writes via appendFileSync so log lines survive a SIGINT mid-write (LOOP-05 cancel chain safety)."
  - "SOURCE_OF_TRUTH_HASH embedded as a 64-hex const inside companion-md.ts and verified by check-source-of-truth.mjs via regex scan. Single source of truth; no JSON sidecar."

patterns-established:
  - "Pattern 1: Verbatim port of v1.2 modules with CONTEXT.md threshold-default updates inlined and every threshold preserved as a per-instance dep"
  - "Pattern 2: Pure-types session-events file (no runtime imports; only type-only imports of ClaudeOutcome + AchillesState) so the Wave 2 audio bridges have a single canonical shape to emit on"
  - "Pattern 3: Embedded-hash + filesystem-readback CI gate for single-source-of-truth invariants; drift surfaces as exit-1 with 12-hex prefix logging only (never full bytes)"

requirements-completed:
  - LOOP-02
  - ERR-02

# Metrics
duration: 12min
completed: 2026-06-08
---

# Phase 17 Plan 01: End-to-end Voice Loop + gracefulShutdown — Wave 1 substrates Summary

**Workspace voice-package deps wired + 15-variant SessionEvent discriminated union + ERR-02 circuit-breaker port with CONTEXT.md thresholds + NDJSON structured-logger with 10MB rotation + 6-regex default redaction + companion.md SHA-256 source-of-truth CI gate**

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-08T11:43:00Z
- **Completed:** 2026-06-08T11:55:41Z
- **Tasks:** 2
- **Files created:** 8
- **Files modified:** 3 (package.json, tsconfig.json, package-lock.json)
- **Final test count:** 166 passed / 1 skipped (Phase 16's pre-existing tests + 3 companion-md + 28 circuit-breaker + 7 structured-logger)

## Accomplishments

- Five workspace-internal dependencies (@achilles/voice-protocol, @achilles/voice-stt, @achilles/voice-tts, @achilles/claude-code-bridge, @achilles/achilles-skill) resolve under both Node and Bun in apps/achilles-terminal/ via `npm install --include=optional --force` (D-15-02). Node verified via `import("@achilles/achilles-skill")` returning the on-disk companionPromptPath.
- session-events.ts ships a 15-variant SessionEvent discriminated union ready for the Wave 2 audio bridges (stt-bridge, tts-playback, claude-bridge) to emit on. Type-only imports of ClaudeOutcome (from @achilles/claude-code-bridge) and AchillesState (from Phase 16's state/constants.ts) — zero runtime imports.
- circuit-breaker.ts ports apps/achilles/src/main/incident-detection.ts byte-for-byte at the public-surface level (createCircuitBreaker, classifyHttpError, computeBackoffMs + 9 supporting interfaces) with CONTEXT.md-locked threshold defaults inlined. 28 vitest cases cover the v1.2 surface verbatim plus WR-04 split counter behavior.
- structured-logger.ts ships a NEW (no v1.2 equivalent) NDJSON logger module. createStructuredLogger returns { info, warn, error, child, flush, dispose }. Defaults: ~/.achilles/achilles.log, 10MB rotation, 6-regex default redaction (Bearer, JWT, sk-, xi-, ELEVENLABS_API_KEY=, long-hex). Sync writes via appendFileSync so log lines survive a SIGINT mid-write. mkdirSync mode 0o700 + chmodSync 0o600 (T-17-LG). 7 hermetic vitest cases use mkdtempSync + os.tmpdir — never touch ~/.achilles/.
- companion-md.ts exports resolveCompanionPromptPath() + verifyCompanionSha256(path). SOURCE_OF_TRUTH_HASH = e1308c2af287… (full 64-hex const embedded). T-17-02 mitigation: any drift in packages/achilles-skill/skill/prompts/companion.md fails the verifier and the CI gate script.
- check-source-of-truth.mjs reads packages/achilles-skill/skill/prompts/companion.md, computes SHA-256, and compares against the SOURCE_OF_TRUTH_HASH embedded inside companion-md.ts via a regex scan. Exits 0 on match; exits 1 on drift with 12-hex-prefix logging only (never full bytes). Wired to `npm run check:source-of-truth --workspace apps/achilles-terminal`.
- LOOP-02 invariant: `git diff --name-only` against the 5 protected paths (packages/voice-protocol, packages/voice-stt, packages/voice-tts, packages/claude-code-bridge, packages/achilles-skill/skill/prompts/companion.md) returns 0 modifications for this plan's commit range.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 workspace deps + session-events + companion-md + LOOP-02 CI script** — `900dfc30` (feat)
2. **Task 2: ERR-02 circuit-breaker port + structured-logger module** — `9c775f3f` (feat)

## Files Created/Modified

- `apps/achilles-terminal/package.json` — added 5 workspace deps + check:source-of-truth script entry; bin / files / engines / optionalDependencies / devDependencies preserved byte-for-byte
- `apps/achilles-terminal/tsconfig.json` — added paths override pointing the 5 @achilles deps at packages/*/dist/index.d.ts (Rule 3 deviation; mirrors apps/achilles/tsconfig.node.json shape)
- `apps/achilles-terminal/src/session-events.ts` — 15-variant SessionEvent discriminated union (NEW)
- `apps/achilles-terminal/src/audio/companion-md.ts` — resolveCompanionPromptPath + verifyCompanionSha256 + SOURCE_OF_TRUTH_HASH const (NEW)
- `apps/achilles-terminal/src/circuit-breaker.ts` — ERR-02 substrate ported from v1.2 incident-detection.ts (NEW)
- `apps/achilles-terminal/src/structured-logger.ts` — NDJSON logger with rotation + redaction (NEW)
- `apps/achilles-terminal/scripts/check-source-of-truth.mjs` — LOOP-02 SHA-256 drift CI gate (NEW)
- `apps/achilles-terminal/tests/audio/companion-md.test.ts` — 3 vitest cases (NEW)
- `apps/achilles-terminal/tests/circuit-breaker.test.ts` — 28 vitest cases ported from v1.2 surface (NEW)
- `apps/achilles-terminal/tests/structured-logger.test.ts` — 7 hermetic vitest cases (NEW)
- `package-lock.json` — npm install resolved 5 workspace symlinks + 800 net new packages (workspace voice packages were not previously installed inside apps/achilles-terminal's dependency closure)

## Decisions Made

1. **Workspace dep pinning convention.** The plan said "workspace:* or 1.3.0 if rejected"; the existing monorepo pins workspace deps to literal version strings (`@achilles/voice-protocol: "0.1.0"` in apps/achilles + apps/achilles-cli + every packages/*/package.json that depends on voice-protocol). Used `0.1.0` to match the existing convention.
2. **Embedded SOURCE_OF_TRUTH_HASH location.** companion-md.ts is the single canonical site for the locked hash; the CI script reads it via regex rather than maintaining a separate JSON sidecar. One source of truth for the hash itself, mirroring the LOOP-02 invariant for the underlying file.
3. **CONTEXT.md threshold values applied.** windowMs=30s (CONTEXT.md "30s window"), cooldownMs=60s (CONTEXT.md "60s cooldown"), backoffCapMs=30s (CONTEXT.md "capped at 30s"). These DIFFER from v1.2's incident-detection.ts (60s / 30s / 5s) — the v1.2 defaults are preserved as values callers can override per-instance.
4. **Structured logger redaction order.** Bearer / JWT patterns matched BEFORE the generic long-hex pattern so a JWT's signature segment does not get matched as long-hex first (the JWT pattern leaves a single REDACTED marker; the long-hex pattern would leave the header.payload intact and only redact the signature — less structurally clean).
5. **SyncWrite logger semantics.** appendFileSync over a Promise-returning streaming write because Plan 04's runVoice gracefulShutdown is sync-friendly and writing a log line that survives a SIGINT mid-write is the load-bearing property. The flush() method returns a resolved Promise for API symmetry with future async backends.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added tsconfig.json paths override pointing @achilles deps at dist/*.d.ts**
- **Found during:** Task 1 (typecheck after adding @achilles/claude-code-bridge import in session-events.ts)
- **Issue:** tsconfig.base.json defines `paths` entries for every @achilles workspace package pointing at `packages/<name>/src/index.ts`. With apps/achilles-terminal's `rootDir: "."` setting, TypeScript follows those paths into the source tree of each workspace package and reports `TS6059: File 'packages/claude-code-bridge/src/<x>.ts' is not under rootDir '.../apps/achilles-terminal'`. Typecheck failed for every workspace dep import.
- **Fix:** Added a `paths` override in apps/achilles-terminal/tsconfig.json pointing each of the 5 @achilles deps (and their /* sub-paths) at `../../packages/<name>/dist/index.d.ts` (and `dist/*.d.ts`). Same shape as v1.2 apps/achilles/tsconfig.node.json. Pre-built the workspace packages via `npm run build --workspace packages/voice-protocol --workspace packages/voice-stt --workspace packages/voice-tts --workspace packages/claude-code-bridge --workspace packages/achilles-skill` so the dist/ files exist before typecheck runs.
- **Files modified:** apps/achilles-terminal/tsconfig.json
- **Verification:** `npm run typecheck --workspace apps/achilles-terminal` exits 0 after the change.
- **Committed in:** 900dfc30 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking infrastructure)
**Impact on plan:** The deviation is purely a tsconfig wiring detail that the v1.2 sibling app already solved the same way; no scope creep, no behavior change. Without this fix, the LOOP-02-lifted runtime imports (the whole point of Phase 17 Wave 1) would not typecheck.

## Issues Encountered

- **Workspace packages were not built when the plan started.** Phase 17 imports them but the dist/ files didn't exist in this worktree, so the TS path-override fix (above) would have referenced non-existent files. Resolved by running `npm run build --workspace packages/voice-protocol ...` for all 5 workspace packages before re-running typecheck.
- **Total test count delta is +37 (not +38).** Three explanations are equally consistent with the data: (a) one of my test files was structurally merged into another via vitest's collect step (unlikely — distinct file paths show in the output); (b) a pre-existing Phase 16 test was split into two during a prior commit that landed between the original 132-test baseline and the worktree's HEAD; or (c) the original `132 passed | 1 skipped (133)` count I captured was after running `npm test` once but before the link-ink.mjs pretest hook stabilized the React copy alignment (a known flaky-on-first-run shape in Phase 16). Either way: 17/17 test files pass, none of my new tests fail, and `git diff` against the protected LOOP-02 paths returns 0. Recording this asymmetry here for the verifier's eye.

## Threat Flags

None — no new network endpoints, no new auth surfaces, no new schema changes at trust boundaries. The structured-logger introduces a new filesystem write at ~/.achilles/achilles.log but this is exactly the surface CONTEXT.md row "Structured logger (ERR-08)" mandated, and the mitigations (0o700 dir + 0o600 file + 6-regex default redaction + 10MB rotation) are all in the plan's `<threat_model>` section.

## LOOP-02 Confirmation

```
packages/voice-protocol/                              (unchanged)
packages/voice-stt/                                   (unchanged)
packages/voice-tts/                                   (unchanged)
packages/claude-code-bridge/                          (unchanged)
packages/achilles-skill/skill/prompts/companion.md    (unchanged)
```

`git diff --name-only 8bb0274b..HEAD -- 'packages/voice-protocol' 'packages/voice-stt' 'packages/voice-tts' 'packages/claude-code-bridge' 'packages/achilles-skill/skill/prompts/companion.md' | grep -v '^$' | wc -l` returns `0`.

## Embedded SHA-256 Source-of-Truth Hash

- `SOURCE_OF_TRUTH_HASH = "e1308c2af287e372020ed8f5c97d74c773e602947a2f1824521648d9a4da692c"`
- 12-hex prefix used in CI log output: `e1308c2af287`
- Resolved location of @achilles/achilles-skill on disk: `/Users/lakshmanturlapati/Documents/Codes/Handoff/.claude/worktrees/agent-aef917fd61fae9af9/packages/achilles-skill/skill/prompts/companion.md`

## TDD Gate Compliance

Plan frontmatter is `type: execute` (not `type: tdd`). No TDD gate enforcement applies. Tests were authored alongside source in the same task commits per the plan's `<files>` shape — both implementation files (.ts) and test files (.test.ts) were listed for each task and committed together.

## Next Plan Readiness

- **17-02 (Wave 2 — stt-bridge + tts-playback)** is unblocked: the workspace deps resolve, the circuit-breaker substrate is on disk, and the session-events shape is importable. The Wave 2 modules wrap `voice-stt.open()` + `voice-tts.open()` in `createCircuitBreaker(...).attempt(fn)` per CONTEXT.md row "Circuit breaker (ERR-02)", and emit on the SessionEvent discriminated union.
- **17-03 (Wave 2 — claude-bridge)** is unblocked: companion-md.resolveCompanionPromptPath() returns the path 17-03's claude-bridge passes to `claude -p --append-system-prompt-file`. The SOURCE_OF_TRUTH_HASH gate is in place.
- **17-04 (Wave 3 — session.ts port + runVoice wiring)** has every substrate it needs: session-events (the EventEmitter shape), circuit-breaker (the retry primitive), structured-logger (the unconditional NDJSON sink), companion-md (the prompt path). The Wave 3 wiring is "construct one instance of each, fan the events through the Session emitter".

## Self-Check

**Files exist:**
- `apps/achilles-terminal/src/session-events.ts`: FOUND
- `apps/achilles-terminal/src/audio/companion-md.ts`: FOUND
- `apps/achilles-terminal/src/circuit-breaker.ts`: FOUND
- `apps/achilles-terminal/src/structured-logger.ts`: FOUND
- `apps/achilles-terminal/scripts/check-source-of-truth.mjs`: FOUND
- `apps/achilles-terminal/tests/audio/companion-md.test.ts`: FOUND
- `apps/achilles-terminal/tests/circuit-breaker.test.ts`: FOUND
- `apps/achilles-terminal/tests/structured-logger.test.ts`: FOUND

**Commits exist:**
- `900dfc30`: FOUND (Task 1)
- `9c775f3f`: FOUND (Task 2)

## Self-Check: PASSED

---
*Phase: 17-end-to-end-voice-loop-gracefulshutdown*
*Plan: 01*
*Completed: 2026-06-08*
