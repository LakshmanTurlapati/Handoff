# Codebase Structure

**Analysis Date:** 2026-04-06

## Directory Layout

```text
Codex-Mobile/
├── .planning/codebase/            # Generated mapper documents for this wrapper repo
└── resources/gsd-2/               # Actual application source tree
    ├── src/                       # Product bootstrap, CLI routing, headless, web bridge, bundled resources
    ├── packages/                  # Reusable workspace packages used by the product runtime
    ├── web/                       # Next.js browser UI
    ├── studio/                    # Electron desktop shell
    ├── vscode-extension/          # VS Code extension host
    ├── native/                    # Rust crates and platform packaging for native helpers
    ├── scripts/                   # Build, dev, release, validation, and packaging scripts
    ├── tests/                     # Smoke, fixtures, live, and repro harnesses
    ├── docs/                      # Product docs and ADR-style reference material
    └── pkg/                       # Packaging shim for `piConfig` branding and published layout
```

## Directory Purposes

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src`:**
- Purpose: Product-specific runtime bootstrap and adapters.
- Contains: `loader.ts`, `cli.ts`, `headless.ts`, `web-mode.ts`, `cli-web-branch.ts`, `mcp-server.ts`, `resource-loader.ts`, onboarding/setup helpers, and `src/web/*` bridge services.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/loader.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/headless.ts`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources`:**
- Purpose: Bundled runtime assets that get synced into the managed agent directory.
- Contains: Built-in extensions under `src/resources/extensions/`, built-in skills under `src/resources/skills/`, agent prompt/persona files under `src/resources/agents/`, and workflow markdown such as `src/resources/GSD-WORKFLOW.md`.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/index.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/GSD-WORKFLOW.md`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd`:**
- Purpose: The main product extension. Most GSD workflow behavior lands here.
- Contains: Bootstrap modules under `bootstrap/`, slash-command handlers under `commands/`, auto-mode and workflow modules such as `auto.ts`, `workflow-engine.ts`, `parallel-orchestrator.ts`, persistence/state files such as `state.ts` and `gsd-db.ts`, plus templates/docs/tests.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-extension.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-hooks.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/commands.ts`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages`:**
- Purpose: Reusable workspace libraries and secondary binaries.
- Contains: `pi-agent-core`, `pi-ai`, `pi-coding-agent`, `pi-tui`, `native`, `rpc-client`, `mcp-server`, and `daemon`.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/agent-session.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-agent-core/src/agent.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/mcp-server/src/server.ts`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web`:**
- Purpose: Browser-based workspace UI and API host.
- Contains: Next.js App Router files in `web/app/`, product components in `web/components/gsd/`, shared UI primitives in `web/components/ui/`, and client/server utilities in `web/lib/`.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/app/page.tsx`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/components/gsd/app-shell.tsx`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/lib/pty-manager.ts`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio`:**
- Purpose: Electron desktop shell.
- Contains: Main process under `studio/src/main/`, preload bridge under `studio/src/preload/`, and React renderer under `studio/src/renderer/src/`.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/src/main/index.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/src/preload/index.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/src/renderer/src/App.tsx`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension`:**
- Purpose: VS Code integration layer.
- Contains: Extension activation, chat/sidebar providers, SCM/decorations, terminal bridge, diagnostics, and session tooling.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/src/extension.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/src/gsd-client.ts`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/native`:**
- Purpose: Rust implementation and platform packaging for native helpers.
- Contains: Cargo workspace, crates under `native/crates/`, build scripts, and per-platform npm package metadata under `native/npm/`.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/native/Cargo.toml`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/native/scripts/build.js`

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/tests`:**
- Purpose: Higher-level smoke/live/fixture/repro harnesses that sit outside the `src/tests` unit/integration cluster.
- Contains: `smoke/`, `fixtures/`, `live/`, `live-regression/`, and isolated repro folders.
- Key files: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/tests/smoke/run.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/tests/live/run.ts`

## Key File Locations

**Entry Points:**
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/loader.ts`: Published CLI loader and environment bootstrap.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts`: Main command router after loader bootstrap.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/headless.ts`: Headless automation entry.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/app/page.tsx`: Browser app entry.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/src/main/index.ts`: Electron main-process entry.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/src/extension.ts`: VS Code activation entry.

**Configuration:**
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/package.json`: Workspace root, scripts, and published CLI binaries.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/tsconfig.json`: Root TypeScript config for `src/`.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/tsconfig.json`: Next.js config with `@/*` alias.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/package.json`: Electron/Vite package config.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/package.json`: VS Code contribution metadata.

**Core Logic:**
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/agent-session.ts`: Shared session abstraction.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts`: Generic resource discovery.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/extensions/loader.ts`: Generic extension loading.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-extension.ts`: GSD-specific registration root.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/bridge-service.ts`: Browser-to-runtime bridge.

**Testing:**
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/tests/`: Product-level unit/integration tests for `src/`.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/tests/` and package-local `*.test.*`: Package-specific tests.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/tests/`: Smoke, fixture, live, and regression harnesses.

## Naming Conventions

**Files:**
- Use lowercase kebab-case for most TypeScript modules in `src/` and `packages/`: `resource-loader.ts`, `web-mode.ts`, `project-sessions.ts`.
- Keep extension folders aligned with extension IDs or feature names under `src/resources/extensions/`: `gsd`, `bg-shell`, `browser-tools`, `google-search`.
- Use kebab-case React component filenames in `web/components/gsd/` and `web/components/ui/`, even when the exported component is PascalCase: `app-shell.tsx`, `status-bar.tsx`, `alert-dialog.tsx`.
- Keep package entry files conventional: `src/index.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/cli.ts`.

**Directories:**
- Put shared runtime concerns in noun-based folders under `packages/pi-coding-agent/src/core/`: `extensions`, `tools`, `compaction`, `export-html`.
- Put GSD feature clusters in subdirectories under `src/resources/extensions/gsd/`: `bootstrap/`, `commands/`, `auto/`, `safety/`, `templates/`, `watch/`.
- Keep UI directories surface-specific instead of cross-surface: `web/`, `studio/`, `vscode-extension/`.

## Where to Add New Code

**New Product Command Or Bootstrap Behavior:**
- Primary code: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/`
- Use this area for CLI argument routing, resource sync, onboarding, web launcher decisions, headless orchestration, or environment bootstrapping.

**New GSD Workflow Feature Or Slash Command:**
- Primary code: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/`
- Register it from `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-extension.ts` or the relevant `commands/` bootstrap module.
- Tests: Co-locate with extension tests under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/tests/` when the behavior is extension-specific.

**New Generic Agent Runtime Capability:**
- Implementation: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/` or another appropriate workspace package under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/`
- Use this area only when the capability is not GSD-specific and should be reusable across surfaces.

**New Built-In Extension That Is Not GSD-Specific:**
- Implementation: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/<extension-name>/`
- Follow the manifest/entry pattern already used by `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/browser-tools/` and `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/bg-shell/`.

**New Browser UI Work:**
- Page/API entry: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/app/`
- Feature components: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/components/gsd/`
- Shared UI primitives: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/components/ui/`
- Client/server utilities and stores: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/lib/`

**New Desktop Or Editor Surface Work:**
- Electron: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/src/`
- VS Code: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/src/`

**Utilities:**
- Shared product utilities: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/` for web-bridge services, or `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/` for general bootstrap/runtime helpers.
- Shared runtime utilities: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/utils/`

## Special Directories

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/.planning/codebase`:**
- Purpose: Generated reference docs for orchestration agents.
- Generated: Yes
- Committed: Not implied by structure; treat as generated workspace output.

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/pkg`:**
- Purpose: Packaging shim that supplies `piConfig` branding and published layout metadata.
- Generated: No
- Committed: Yes

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources`:**
- Purpose: Canonical bundled resources that are copied into the managed agent directory at runtime.
- Generated: No
- Committed: Yes

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/native/npm`:**
- Purpose: Per-platform npm package metadata for native artifacts.
- Generated: No
- Committed: Yes

**`/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/dist`:**
- Purpose: Build output consumed by the published CLI and staged web host when the workspace has been built.
- Generated: Yes
- Committed: Packaging output may exist locally; do not place source edits here.

---

*Structure analysis: 2026-04-06*
