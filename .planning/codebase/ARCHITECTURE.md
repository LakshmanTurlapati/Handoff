# Architecture

**Analysis Date:** 2026-04-06

## Pattern Overview

**Overall:** Nested TypeScript monorepo with a CLI-first agent runtime, a GSD-specific extension/orchestration layer, and multiple adapter surfaces on top of the same session model.

**Key Characteristics:**
- Treat `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/` as the real product root. The repository root only wraps that source tree plus generated planning docs under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/.planning/`.
- Startup is layered: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/loader.ts` prepares the runtime environment, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts` routes commands, and vendored runtime packages under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/` provide the reusable agent/session abstractions.
- Product-specific behavior lives mostly in the bundled GSD extension under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/`, not in the low-level agent packages.
- Web, Electron, VS Code, headless, and MCP entry points reuse the same RPC/session/tooling model instead of duplicating business logic.

## Layers

**Repository Wrapper:**
- Purpose: Holds generated planning output and vendors the upstream GSD source tree.
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/`
- Contains: `.planning/`, `resources/`
- Depends on: Nothing application-specific.
- Used by: Mapping/orchestration tooling; human operators. Do not add product logic here unless it is wrapper-specific.

**Bootstrap And Product Entry Layer:**
- Purpose: Prepare environment variables, validate runtime prerequisites, sync bundled resources, and dispatch to the correct run mode.
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/`
- Contains: CLI loader/router in `src/loader.ts` and `src/cli.ts`, web launcher in `src/cli-web-branch.ts` and `src/web-mode.ts`, headless orchestration in `src/headless.ts`, MCP shim in `src/mcp-server.ts`, onboarding/setup helpers in `src/onboarding.ts`, `src/resource-loader.ts`, and `src/app-paths.ts`.
- Depends on: `@gsd/pi-coding-agent`, the GSD bundled resources under `src/resources/`, and workspace packages under `packages/`.
- Used by: `gsd`, `gsd --web`, `gsd headless`, and secondary automation surfaces.

**Shared Agent Runtime Layer:**
- Purpose: Provide the reusable agent, session, tool, resource, and extension primitives that every surface runs against.
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-agent-core/src/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-ai/src/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-tui/src/`
- Contains: `Agent` in `packages/pi-agent-core/src/agent.ts`, `AgentSession` in `packages/pi-coding-agent/src/core/agent-session.ts`, resource loading in `packages/pi-coding-agent/src/core/resource-loader.ts`, extension runtime in `packages/pi-coding-agent/src/core/extensions/`, and run modes in `packages/pi-coding-agent/src/modes/`.
- Depends on: Model/provider clients from `@gsd/pi-ai`, native helpers from `@gsd/native`, and bundled/project resources discovered at runtime.
- Used by: CLI interactive mode, print mode, RPC mode, web bridge sessions, headless sessions, and extension-driven workflows.

**GSD Extension And Orchestration Layer:**
- Purpose: Convert the generic coding-agent runtime into the GSD workflow engine, command surface, state machine, and safety system.
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/`
- Contains: Extension bootstrap in `src/resources/extensions/gsd/bootstrap/register-extension.ts`, lifecycle hooks in `src/resources/extensions/gsd/bootstrap/register-hooks.ts`, command dispatch in `src/resources/extensions/gsd/commands.ts` and `src/resources/extensions/gsd/commands/`, auto-mode/orchestration modules such as `auto.ts`, `parallel-orchestrator.ts`, `workflow-engine.ts`, state/persistence modules such as `state.ts`, `gsd-db.ts`, and many product tools under `bootstrap/*.ts`.
- Depends on: The `ExtensionAPI` from `@gsd/pi-coding-agent`, project `.gsd/` state, SQLite-backed workflow state, and CLI environment prepared in `src/loader.ts`.
- Used by: Every GSD invocation unless extensions are explicitly disabled.

**Adapter Surfaces:**
- Purpose: Present the shared runtime through different UX shells.
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/mcp-server/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/daemon/`
- Contains: Next.js app/router and API routes, Electron shell, VS Code extension host, standalone MCP server, and background daemon/Discord orchestration package.
- Depends on: The CLI entry resolver in `src/web/cli-entry.ts`, RPC/session contracts from `packages/pi-coding-agent`, and shared project-state readers.
- Used by: Browser users, Electron users, VS Code users, external MCP hosts, and daemon operators.

**Native And Packaging Layer:**
- Purpose: Speed up filesystem/process operations and produce distributable platform artifacts.
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/native/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/native/`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/pkg/`
- Contains: Rust crates and build scripts in `native/`, JS bindings in `packages/native/src/`, platform npm packages in `native/npm/`, and branding/config shim in `pkg/package.json`.
- Depends on: Node build scripts and N-API packaging.
- Used by: Runtime bootstrap, tool execution helpers, and published distributions.

## Data Flow

**CLI Interactive / Print / RPC Flow:**

1. `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/loader.ts` validates Node and `git`, sets `PI_PACKAGE_DIR`, exposes bundled extension paths, links workspace packages, and then imports `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts`.
2. `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts` parses product-level flags, syncs bundled resources via `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resource-loader.ts`, handles web/update/session/onboarding branches, and creates the agent session using `createAgentSession()` from `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/sdk.ts`.
3. `createAgentSession()` constructs `DefaultResourceLoader`, loads extensions, skills, prompts, AGENTS/CLAUDE context files, restores or creates a `SessionManager`, and returns a shared `AgentSession`.
4. `AgentSession` in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/agent-session.ts` binds the low-level `Agent`, session persistence, tools, compaction, retry/fallback behavior, and extension hooks.
5. A run mode such as `InteractiveMode`, `runPrintMode`, or `runRpcMode` in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/modes/` adds the actual I/O surface.

**GSD Orchestration Flow:**

1. The bundled extension entry `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/index.ts` delegates to `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-extension.ts`.
2. `register-extension.ts` registers slash commands, worktree/exit helpers, dynamic tools, DB/query tools, shortcuts, and lifecycle hooks.
3. `register-hooks.ts` enforces state-machine and safety rules around tool calls, session start/switch/end, compaction, quick-task cleanup, queue mode, and protected writes to `.gsd/STATE.md`.
4. Workflow state is read and written through modules under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/` such as `state.ts`, `workflow-engine.ts`, `auto.ts`, `parallel-orchestrator.ts`, `gsd-db.ts`, and `paths.ts`.

**Web Flow:**

1. `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli-web-branch.ts` and `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web-mode.ts` start the Next.js host and track running instances.
2. The browser app boots from `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/app/page.tsx`, which mounts `GSDAppShell` from `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/components/gsd/app-shell.tsx`.
3. API routes under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/app/api/` call bridge/services in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/`.
4. `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/bridge-service.ts` spawns or attaches to RPC-backed GSD sessions, while `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/lib/pty-manager.ts` manages terminal PTYs for live shell views.

**State Management:**
- User-global runtime state lives under `~/.gsd` by default via `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/app-paths.ts`.
- Per-session conversation history is managed through `SessionManager` JSONL files in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.ts`.
- Project workflow state lives in project-local `.gsd/` directories and, when initialized, in SQLite via `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/gsd-db.ts`.
- Bundled resources are mirrored from `src/resources/` or `dist/resources/` into the managed agent directory by `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resource-loader.ts`.

## Key Abstractions

**Agent:**
- Purpose: Provider/tool execution loop with streaming, thinking levels, tool hooks, and retry-related seams.
- Examples: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-agent-core/src/agent.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-agent-core/src/agent-loop.ts`
- Pattern: Thin core loop with configurable transforms and before/after tool hooks.

**AgentSession:**
- Purpose: Durable session facade shared across interactive, print, RPC, and web-driven runs.
- Examples: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/agent-session.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/sdk.ts`
- Pattern: Composition root for tools, resource loading, persistence, compaction, retries, and extension binding.

**DefaultResourceLoader:**
- Purpose: Discover extensions, skills, prompts, themes, AGENTS/CLAUDE context files, and system prompt fragments.
- Examples: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/resource-loader.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resource-loader.ts`
- Pattern: Merge bundled, global, project, and CLI-injected resources before session creation.

**Extension Runtime:**
- Purpose: Register commands, tools, lifecycle hooks, provider registrations, and UI widgets around the base agent runtime.
- Examples: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/extensions/loader.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/extensions/runner.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/extension-discovery.ts`
- Pattern: File-system discovery plus manifest-aware loading, then event-driven execution.

**GSD Extension Bootstrap:**
- Purpose: Centralize product commands, dynamic tool overrides, safety hooks, and workflow-specific behavior.
- Examples: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-extension.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-hooks.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/dynamic-tools.ts`
- Pattern: One extension entry delegates to many focused bootstrap modules.

**Web Bridge:**
- Purpose: Translate Next.js requests into CLI/RPC session operations and live workspace snapshots.
- Examples: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/bridge-service.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/cli-entry.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/lib/pty-manager.ts`
- Pattern: Server-only bridge services and PTY managers isolate process management from React components.

## Entry Points

**Published CLI Loader:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/loader.ts`
- Triggers: `gsd` and `gsd-cli` binaries declared in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/package.json`
- Responsibilities: Prerequisite checks, env/bootstrap wiring, resource path exposure, workspace package linking, then import of `src/cli.ts`.

**Product Command Router:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts`
- Triggers: Every normal CLI invocation after loader bootstrap.
- Responsibilities: Parse flags, route update/web/onboarding/session branches, bootstrap RTK/resources, and launch the correct session mode.

**Headless Orchestrator:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/headless.ts`
- Triggers: `gsd headless ...`
- Responsibilities: Spawn an RPC child, auto-handle extension UI requests, stream progress, restart on crashes, and return machine-meaningful exit codes.

**Browser Host:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli-web-branch.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web-mode.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/app/page.tsx`
- Triggers: `gsd --web`, `gsd web`, or direct Next.js host execution.
- Responsibilities: Launch the web server, bridge HTTP requests to runtime services, and render the React workspace shell.

**Electron Shell:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/studio/src/main/index.ts`
- Triggers: `npm run dev` or `npm run build` within `studio/`
- Responsibilities: Create the desktop window, preload the bridge surface, and mount the renderer.

**VS Code Extension Host:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/vscode-extension/src/extension.ts`
- Triggers: VS Code activation.
- Responsibilities: Start the `GsdClient`, register sidebar/tree/chat/SCM/decorations, and proxy commands to the running agent.

**Standalone MCP And Daemon Packages:**
- Location: `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/mcp-server/src/cli.ts`, `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/daemon/src/index.ts`
- Triggers: `gsd-mcp-server` and `gsd-daemon`
- Responsibilities: Expose project/session operations to external hosts and long-running background automation.

## Error Handling

**Strategy:** Fail fast on startup invariants, but treat optional integrations and long-running orchestration edges as recoverable where possible.

**Patterns:**
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/loader.ts` exits immediately on unsupported Node or missing `git`.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/cli.ts` blocks version/resource skew before starting interactive work.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/bootstrap/register-extension.ts` and `register-hooks.ts` guard against EPIPE/spawn errors, destructive loops, and illegal writes instead of letting raw failures corrupt state.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/headless.ts` translates runtime outcomes into stable exit codes for automation.
- `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web-mode.ts` and `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/web/lib/pty-manager.ts` keep PID/session registries and cleanup hooks to avoid orphaned browser-side processes.

## Cross-Cutting Concerns

**Logging:** Runtime warnings and status messages are emitted from bootstrap files in `src/`, while workflow-specific logs and activity traces are managed under `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/resources/extensions/gsd/` through modules such as `workflow-logger.ts` and `activity-log.ts`.

**Validation:** Startup validation uses `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/startup-model-validation.ts`; extension discovery is manifest-aware in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/extension-discovery.ts`; tool parameters in MCP/query tools are schema-driven with `zod` or `TypeBox`; write guards in `register-hooks.ts` protect `.gsd/STATE.md` and queue-mode invariants.

**Authentication:** Credentials are stored via `AuthStorage` from `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/packages/pi-coding-agent/src/core/auth-storage.ts`; onboarding is handled in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/onboarding.ts`; web auth state is refreshed through `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile/resources/gsd-2/src/web/web-auth-storage.ts` and related onboarding bridge services.

---

*Architecture analysis: 2026-04-06*
