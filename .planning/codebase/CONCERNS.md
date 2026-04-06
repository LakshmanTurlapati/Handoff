# Codebase Concerns

**Analysis Date:** 2026-04-06

## Tech Debt

**Web browser state orchestration is concentrated in a single store:**
- Issue: `resources/gsd-2/web/lib/gsd-workspace-store.tsx` is 5,344 lines and owns transport, SSE/live invalidation, onboarding, session browser state, git/recovery/diagnostics loaders, and command-surface orchestration for many views.
- Files: `resources/gsd-2/web/lib/gsd-workspace-store.tsx`, `resources/gsd-2/web/components/gsd/command-surface.tsx`, `resources/gsd-2/web/components/gsd/chat-mode.tsx`, `resources/gsd-2/web/components/gsd/dashboard.tsx`, `resources/gsd-2/web/components/gsd/sidebar.tsx`
- Impact: a small state-shape or event change can break several surfaces at once; regression scope is hard to predict.
- Fix approach: split transport, domain slices, and selectors into smaller modules; keep views consuming read-only selectors.

**Web bridge service mixes RPC lifecycle, project detection, session browsing, and caching:**
- Issue: `resources/gsd-2/src/web/bridge-service.ts` is 2,375 lines and also maintains global registries (`projectBridgeRegistry`, `workspaceIndexCache`) plus child-process orchestration and project detection.
- Files: `resources/gsd-2/src/web/bridge-service.ts`, `resources/gsd-2/web/app/api/session/events/route.ts`, `resources/gsd-2/web/app/api/session/manage/route.ts`, `resources/gsd-2/web/app/api/live-state/route.ts`
- Impact: cross-project bugs can leak through shared state; changes are expensive to reason about because transport, discovery, and data shaping are coupled.
- Fix approach: split into `bridge-runtime`, `session-browser`, `project-detection`, and `workspace-index` modules with narrower test seams.

**Interactive TUI mode remains a monolithic class:**
- Issue: `resources/gsd-2/packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts` is 3,888 lines and still owns rendering, key handling, extension UI, retry/compaction flows, bash/editor integration, and session wiring.
- Files: `resources/gsd-2/packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts`, `resources/gsd-2/packages/pi-coding-agent/src/modes/interactive/slash-command-handlers.ts`, `resources/gsd-2/packages/pi-coding-agent/src/modes/interactive/controllers/chat-controller.ts`, `resources/gsd-2/packages/pi-coding-agent/src/modes/interactive/controllers/input-controller.ts`
- Impact: bug fixes in one behavior risk keyboard, rendering, or extension regressions elsewhere; onboarding new contributors is slow.
- Fix approach: continue extracting controller logic until `InteractiveMode` becomes mostly composition.

**Generated model catalog maintenance path is drifted:**
- Issue: `resources/gsd-2/packages/pi-ai/src/models.generated.ts` says to run `npm run generate-models`, but neither `resources/gsd-2/package.json` nor `resources/gsd-2/packages/pi-ai/package.json` defines that script.
- Files: `resources/gsd-2/packages/pi-ai/src/models.generated.ts`, `resources/gsd-2/packages/pi-ai/package.json`, `resources/gsd-2/package.json`
- Impact: model metadata can go stale because the canonical regeneration command is unclear and easy to miss.
- Fix approach: add a single supported generation script and fail CI when the generated file is out of date.

## Known Bugs

**Worktree DB conflict detection does not stop conflicting merges:**
- Symptoms: `reconcileWorktreeDb()` detects row conflicts, but still performs `INSERT OR REPLACE` merges and returns a `conflicts` array that current callers ignore.
- Files: `resources/gsd-2/src/resources/extensions/gsd/gsd-db.ts`, `resources/gsd-2/src/resources/extensions/gsd/auto-worktree.ts`, `resources/gsd-2/src/resources/extensions/gsd/worktree-command.ts`
- Trigger: the same decision, requirement, slice, or task is edited in both main and worktree databases before reconciliation.
- Workaround: manually inspect reconciled `.gsd/gsd.db` state after worktree merges; there is no fail-closed path in the current callers.

## Security Considerations

**VS Code git helpers shell user-controlled strings through `exec()`:**
- Risk: branch names, commit messages, and tracked filenames are interpolated into `exec(\`git ${args}\`)`; current escaping only covers whitespace or `"` characters, not shell metacharacters or hostile filenames.
- Files: `resources/gsd-2/vscode-extension/src/git-integration.ts`
- Current mitigation: branch name validation rejects whitespace; commit messages escape double quotes.
- Recommendations: replace `exec()` with `execFile()` or `spawn()` and pass an argument array; validate branch names with git-safe rules and escape file paths robustly.

**Custom verification still executes workflow-authored shell via `sh -c`:**
- Risk: `shell-command` verification policies are executed through `spawnSync("sh", ["-c", rewrittenCommand])`; the current guard only blocks a small regex of suspicious patterns.
- Files: `resources/gsd-2/src/resources/extensions/gsd/custom-verification.ts`
- Current mitigation: comments document the trust boundary and a minimal regex blocks obvious `$(`, backticks, and some `; rm/curl/wget/...` cases.
- Recommendations: treat imported workflow definitions as untrusted by default, switch to structured command-and-arg execution, and add an allowlist or sandbox for verification commands.

**Web auth tokens are persisted in browser storage and URL query params:**
- Risk: the browser token is cached in `localStorage` and reused in `_token=` query params for SSE and `sendBeacon` flows, increasing exposure to browser extensions, XSS, copied URLs, and local browser logs or history.
- Files: `resources/gsd-2/web/lib/auth.ts`, `resources/gsd-2/web/components/gsd/app-shell.tsx`, `resources/gsd-2/web/proxy.ts`, `resources/gsd-2/src/web-mode.ts`
- Current mitigation: token is random per launch, scoped to a localhost origin, and enforced in `resources/gsd-2/web/proxy.ts`.
- Recommendations: prefer memory-only session state for the browser, rotate tokens more aggressively, and move SSE or shutdown auth away from query parameters when possible.

**Provider credentials are stored as plaintext JSON at rest:**
- Risk: API keys and OAuth refresh or access tokens are written directly to `auth.json`; filesystem permissions help, but there is no OS-backed secret storage or encryption at rest.
- Files: `resources/gsd-2/packages/pi-coding-agent/src/core/auth-storage.ts`, `resources/gsd-2/src/web/web-auth-storage.ts`, `resources/gsd-2/packages/daemon/src/orchestrator.ts`
- Current mitigation: parent directory is created with `0700`, the file is chmodded to `0600`, and writes are lock-protected.
- Recommendations: add a keychain backend for macOS, Windows, and Linux, and keep refresh tokens out of UI-readable plaintext files where possible.

## Performance Bottlenecks

**Session browser scales with full session-file reads and full-text serialization:**
- Problem: `buildSessionInfo()` reads every `.jsonl` file fully, parses every line, counts messages, and concatenates `allMessagesText`; `bridge-service` then serializes the full list through a child process with `maxBuffer: 1024 * 1024`.
- Files: `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.ts`, `resources/gsd-2/src/web/bridge-service.ts`
- Cause: search and sorting rely on in-memory full-text session materialization instead of an index or summary table.
- Improvement path: persist searchable session metadata separately, add pagination or streaming, and remove the fixed 1 MB JSON bridge as the handoff boundary.

**Database access is synchronous and process-global:**
- Problem: `gsd-db.ts` uses sync adapters (`node:sqlite` or `better-sqlite3`), a singleton `currentDb`, global transaction depth, WAL checkpoints on close, and occasional full `VACUUM` recovery.
- Files: `resources/gsd-2/src/resources/extensions/gsd/gsd-db.ts`
- Cause: one synchronous abstraction is shared across planning, worktree, recovery, and dashboard code paths.
- Improvement path: isolate DB work behind a worker or service boundary, or move high-churn operations off the main process thread.

## Fragile Areas

**Auto-worktree lifecycle code has accumulated many bug-specific branches:**
- Files: `resources/gsd-2/src/resources/extensions/gsd/auto-worktree.ts`
- Why fragile: the 2,002-line module mixes git branch operations, filesystem syncing, state copy-back, DB reconciliation, and explicit regressions for issues like `#1738`, `#1886`, `#2684`, and `#2821`.
- Safe modification: change one lifecycle edge at a time and rerun worktree creation, sync, merge, and teardown tests before touching adjacent logic.
- Test coverage: coverage exists in `resources/gsd-2/src/resources/extensions/gsd/tests/integration/auto-worktree.test.ts`, `resources/gsd-2/src/resources/extensions/gsd/tests/worktree-teardown-safety.test.ts`, and `resources/gsd-2/src/resources/extensions/gsd/tests/worktree-sync-overwrite-loop.test.ts`, but the amount of bug-specific logic signals high regression sensitivity.

**Web workspace state fan-out is extremely broad:**
- Files: `resources/gsd-2/web/lib/gsd-workspace-store.tsx`, `resources/gsd-2/web/components/gsd/dashboard.tsx`, `resources/gsd-2/web/components/gsd/chat-mode.tsx`, `resources/gsd-2/web/components/gsd/sidebar.tsx`, `resources/gsd-2/web/components/gsd/settings-panels.tsx`
- Why fragile: many surfaces import the same store and depend on shared derived state, live invalidation events, and command-surface mutations.
- Safe modification: preserve public selectors and actions first, then change internals behind them; avoid direct state-shape changes across multiple views in one patch.
- Test coverage: `resources/gsd-2/web/lib/__tests__/` only contains `dashboard-metrics-fallback.test.ts` and `shutdown-gate.test.ts`; most store coverage lives in source-audit tests like `resources/gsd-2/src/tests/integration/web-state-surfaces-contract.test.ts`.

**SQLite provider bootstrapping mutates global process behavior:**
- Files: `resources/gsd-2/src/resources/extensions/gsd/gsd-db.ts`
- Why fragile: `suppressSqliteWarning()` overrides `process.emit` globally to hide experimental SQLite warnings, so database initialization changes warning behavior for the whole process.
- Safe modification: avoid more global monkey patches; keep provider detection isolated and restore any temporary process-level overrides.
- Test coverage: DB behavior is exercised heavily, but the global warning hook is mostly validated indirectly through provider bootstrapping paths.

## Scaling Limits

**Session browser and project web UI:**
- Current capacity: practical limits are tied to session file count, per-session size, and the 1 MB `execFile()` buffer used when the bridge subprocess returns the session list.
- Limit: many long-running sessions or large session histories will slow browser payload generation and can overflow the buffer boundary.
- Scaling path: indexed session metadata, incremental search, pagination, and a streaming protocol between `bridge-service` and the session manager.

**Generated model registry:**
- Current capacity: `resources/gsd-2/packages/pi-ai/src/models.generated.ts` is 13,848 lines in a single generated module.
- Limit: startup and build cost plus merge-conflict probability grow with every provider or model addition.
- Scaling path: split registry data by provider or lazy-load model catalogs instead of importing one monolith.

## Dependencies at Risk

**`node:sqlite`:**
- Risk: the database layer depends first on experimental `node:sqlite`, then falls back to `better-sqlite3`; the warning-suppression workaround is tightly coupled to Node’s current warning shape.
- Impact: Node runtime changes can affect startup, warning visibility, or provider selection in `resources/gsd-2/src/resources/extensions/gsd/gsd-db.ts`.
- Migration plan: prefer a stable provider path, feature-gate experimental backends, and scope warning filtering without overriding `process.emit`.

## Missing Critical Features

**OS-native secret storage:**
- Problem: the project handles multiple API keys and OAuth refresh tokens, but there is no keychain integration for desktop or web onboarding flows.
- Blocks: stronger local threat protection and enterprise or compliance-friendly credential handling.
- Files: `resources/gsd-2/packages/pi-coding-agent/src/core/auth-storage.ts`, `resources/gsd-2/src/web/web-auth-storage.ts`, `resources/gsd-2/packages/daemon/src/orchestrator.ts`

## Test Coverage Gaps

**VS Code git command safety:**
- What's not tested: shell escaping and argument handling for `commitAgentChanges()`, `createAgentBranch()`, and tracked filenames.
- Files: `resources/gsd-2/vscode-extension/src/git-integration.ts`
- Risk: command injection or broken git flows can slip through without automated detection.
- Priority: High

**Runtime behavior of the web workspace store:**
- What's not tested: state transition behavior inside `resources/gsd-2/web/lib/gsd-workspace-store.tsx` under real SSE and live invalidation sequences.
- Files: `resources/gsd-2/web/lib/gsd-workspace-store.tsx`, `resources/gsd-2/src/tests/integration/web-state-surfaces-contract.test.ts`, `resources/gsd-2/src/tests/integration/web-session-parity-contract.test.ts`
- Risk: source or regex assertions can stay green while event ordering, stale invalidation, or selector updates regress at runtime.
- Priority: High

**Interactive mode class-level regressions:**
- What's not tested: no dedicated `interactive-mode.test.*` file was detected for the main `InteractiveMode` class despite its size and mixed responsibilities.
- Files: `resources/gsd-2/packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts`
- Risk: keyboard handling, overlay lifecycle, and extension UI bugs can hide behind indirect controller coverage.
- Priority: Medium

---

*Concerns audit: 2026-04-06*
