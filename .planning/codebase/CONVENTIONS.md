# Coding Conventions

**Analysis Date:** 2026-04-06

## Naming Patterns

**Files:**
- Treat `resources/gsd-2/` as the implementation root. Most source files under `resources/gsd-2/src`, `resources/gsd-2/packages/*/src`, `resources/gsd-2/web/components`, and `resources/gsd-2/vscode-extension/src` use kebab-case filenames such as `resources/gsd-2/src/web/bridge-service.ts`, `resources/gsd-2/packages/daemon/src/project-scanner.ts`, `resources/gsd-2/web/components/gsd/app-shell.tsx`, and `resources/gsd-2/vscode-extension/src/file-decorations.ts`.
- Keep framework-reserved names unchanged in Next and Electron entrypoints: `resources/gsd-2/web/app/layout.tsx`, `resources/gsd-2/web/app/page.tsx`, `resources/gsd-2/web/app/api/boot/route.ts`, `resources/gsd-2/studio/src/main/index.ts`, and `resources/gsd-2/studio/src/renderer/src/App.tsx`.
- Use `__tests__` directories only where the surrounding code already does so, such as `resources/gsd-2/packages/native/src/__tests__` and `resources/gsd-2/packages/pi-tui/src/components/__tests__`. Elsewhere, keep tests colocated as `*.test.ts` beside the source file.

**Functions:**
- Use camelCase for functions and helpers. Examples: `parseCliArgs` in `resources/gsd-2/src/cli.ts`, `getErrorMessage` in `resources/gsd-2/packages/pi-coding-agent/src/utils/error.ts`, `collectBootPayload` in `resources/gsd-2/src/web/bridge-service.ts`, and `buildProjectPath` in `resources/gsd-2/web/lib/project-url.ts`.
- Prefer verb-first names for actions and service methods: `scanForProjects`, `scheduleShutdown`, `cancelShutdown`, `resolveProjectCwd`, `createMcpServer`.

**Variables:**
- Use camelCase for locals and React state, and UPPER_SNAKE_CASE for module constants. Examples: `KNOWN_VIEWS` in `resources/gsd-2/web/components/gsd/app-shell.tsx`, `RESPONSE_TIMEOUT_MS` in `resources/gsd-2/src/web/bridge-service.ts`, and `LEVEL_ORDER` in `resources/gsd-2/packages/daemon/src/logger.ts`.
- React state follows descriptive `[value, setValue]` pairs, as seen throughout `resources/gsd-2/web/components/gsd/app-shell.tsx`.

**Types:**
- Prefer `interface` and string-literal unions over `enum` in application code. See `resources/gsd-2/web/lib/gsd-workspace-store.tsx`, `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.ts`, and `resources/gsd-2/src/web/bridge-service.ts`.
- `enum` is mostly confined to native-binding type definitions such as `resources/gsd-2/packages/native/src/text/types.ts` and `resources/gsd-2/packages/native/src/image/types.ts`.

## Code Style

**Formatting:**
- No repo-wide Prettier or Biome config was detected under `resources/gsd-2/`. The rule is to preserve the local dialect of the package or app you are editing rather than normalize the entire repository.
- `resources/gsd-2/packages/pi-coding-agent` and `resources/gsd-2/packages/pi-tui` use tabs, semicolons, double quotes, and `.js` import specifiers from TypeScript source. Examples: `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.ts` and `resources/gsd-2/packages/pi-tui/src/components/__tests__/loader.test.ts`.
- `resources/gsd-2/src`, `resources/gsd-2/packages/daemon`, and `resources/gsd-2/packages/mcp-server` use two-space indentation and semicolons. `resources/gsd-2/src/cli.ts` and `resources/gsd-2/packages/daemon/src/logger.ts` lean single-quote; `resources/gsd-2/src/web/bridge-service.ts` leans double-quote.
- `resources/gsd-2/web` and `resources/gsd-2/studio` use two-space indentation and generally omit semicolons. Match the file you are touching: `resources/gsd-2/web/components/gsd/*.tsx` skews double-quote, while `resources/gsd-2/web/components/ui/*.tsx`, `resources/gsd-2/web/app/layout.tsx`, and `resources/gsd-2/studio/src/main/index.ts` skew single-quote.
- Large service files are commonly partitioned with divider comments like `// ---------------------------------------------------------------------------` in `resources/gsd-2/src/cli.ts` and `resources/gsd-2/packages/mcp-server/src/server.ts`.

**Linting:**
- Strict TypeScript is the main hard gate. See `resources/gsd-2/tsconfig.json`, `resources/gsd-2/tsconfig.extensions.json`, `resources/gsd-2/packages/*/tsconfig.json`, `resources/gsd-2/web/tsconfig.json`, `resources/gsd-2/studio/tsconfig.node.json`, `resources/gsd-2/studio/tsconfig.web.json`, and `resources/gsd-2/vscode-extension/tsconfig.json`.
- Web linting is isolated to `resources/gsd-2/web/eslint.config.mjs` and `resources/gsd-2/web/package.json`. It uses Next.js Core Web Vitals and Next TypeScript presets; there is no equivalent top-level ESLint config for the Node packages.
- CI enforces quality with scripts instead of a universal formatter. See `resources/gsd-2/.github/workflows/ci.yml` and `resources/gsd-2/scripts/require-tests.sh` for test gating, secret scans, and docs prompt-injection scans.

## Import Organization

**Order:**
1. External packages or `node:` builtins first.
2. Related `import type` lines near the runtime import they support instead of in a separate global type-only block.
3. Relative or alias-based local imports last.

**Path Aliases:**
- Use `@/*` inside the Next app via `resources/gsd-2/web/tsconfig.json`. Examples: `resources/gsd-2/web/components/gsd/app-shell.tsx` and `resources/gsd-2/web/components/ui/button.tsx`.
- Use `@/*` inside the studio renderer via `resources/gsd-2/studio/tsconfig.web.json`.
- Use relative imports everywhere else.

**Specifier rules:**
- Source that compiles through `Node16` or `NodeNext` keeps `.js` suffixes in TypeScript imports. Examples: `resources/gsd-2/src/cli.ts`, `resources/gsd-2/packages/pi-coding-agent/src/index.ts`, and `resources/gsd-2/vscode-extension/src/extension.ts`.
- Source executed directly with `--experimental-strip-types` or bridged through Next route handlers imports `.ts` files directly. Examples: `resources/gsd-2/src/web/bridge-service.ts`, `resources/gsd-2/web/app/api/boot/route.ts`, and `resources/gsd-2/tests/fixtures/run.ts`.

## Error Handling

**Patterns:**
- Catch values as `unknown` and convert them to readable messages before surfacing them. `resources/gsd-2/packages/pi-coding-agent/src/utils/error.ts` is the minimal shared example.
- Throw `new Error(...)` with explicit context when a missing dependency or invalid lifecycle state should stop execution. Examples: `resources/gsd-2/packages/daemon/src/daemon.ts`, `resources/gsd-2/src/headless-answers.ts`, and `resources/gsd-2/web/lib/gsd-workspace-store.tsx`.
- Use bare `catch {}` only for clearly best-effort paths such as local storage access, optional cleanup, and feature detection. Examples: `resources/gsd-2/web/components/gsd/app-shell.tsx`, `resources/gsd-2/packages/pi-tui/src/terminal.ts`, and `resources/gsd-2/vscode-extension/src/extension.ts`.
- Next route handlers translate failures into `Response.json(...)` payloads instead of leaking stack traces. Follow the pattern in `resources/gsd-2/web/app/api/boot/route.ts` and other files under `resources/gsd-2/web/app/api/**/route.ts`.

## Logging

**Framework:** mixed
- `resources/gsd-2/packages/daemon/src/logger.ts` is the only shared structured logger. It writes JSONL to disk and can mirror entries to stderr.
- CLI/bootstrap code writes directly to `process.stderr` and `process.stdout`, often with `chalk`, as in `resources/gsd-2/src/cli.ts`.
- Web infrastructure code uses direct `console.debug`, `console.warn`, and `console.log` with stable prefixes. Examples: `resources/gsd-2/web/lib/pty-chat-parser.ts`, `resources/gsd-2/web/lib/pty-manager.ts`, and `resources/gsd-2/web/lib/image-utils.ts`.
- The VS Code extension reports operational errors through UI primitives like `vscode.window.showErrorMessage` in `resources/gsd-2/vscode-extension/src/extension.ts` instead of a reusable logger.
- Studio currently uses plain `console.log` in `resources/gsd-2/studio/src/main/index.ts` and `resources/gsd-2/studio/src/preload/index.ts`.

## Comments

**When to Comment:**
- Comment platform quirks, bundler/runtime edge cases, security gates, and regression context. Good examples live in `resources/gsd-2/src/cli.ts`, `resources/gsd-2/src/web/bridge-service.ts`, and `resources/gsd-2/web/proxy.ts`.
- Keep comments sparse in straightforward helpers and JSX; the codebase generally avoids explaining obvious assignments or control flow.

**JSDoc/TSDoc:**
- Public managers, utilities, and fixture helpers often use block comments or JSDoc-like summaries. Examples: `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.ts`, `resources/gsd-2/packages/daemon/src/logger.ts`, and `resources/gsd-2/tests/fixtures/provider.ts`.
- Tests frequently capture regression IDs and intent in file headers instead of inline assertion comments. See `resources/gsd-2/packages/pi-coding-agent/src/core/retry-handler.test.ts` and `resources/gsd-2/src/resources/extensions/gsd/tests/integration/e2e-workflow-pipeline-integration.test.ts`.

## Function Design

**Size:**
- Small pure helpers live in dedicated modules such as `resources/gsd-2/packages/pi-coding-agent/src/utils/error.ts` and `resources/gsd-2/web/lib/utils.ts`.
- Long-lived state and orchestration logic is usually kept in manager or service classes rather than aggressively split apart. Match the existing pattern in `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.ts`, `resources/gsd-2/src/web/bridge-service.ts`, and `resources/gsd-2/web/lib/gsd-workspace-store.tsx`.

**Parameters:**
- Prefer options objects once a function has several optional toggles or environment-specific settings. Examples: `resources/gsd-2/packages/daemon/src/logger.ts`, `resources/gsd-2/packages/daemon/src/daemon.ts`, and the MCP tool handlers in `resources/gsd-2/packages/mcp-server/src/server.ts`.
- Keep literal unions and small helper types adjacent to the feature instead of centralizing them in a generic enum file.

**Return Values:**
- Query helpers often return typed objects, booleans, or `null` for absence. Examples: `resources/gsd-2/web/lib/auth.ts`, `resources/gsd-2/web/lib/project-url.ts`, and `resources/gsd-2/src/web/bridge-service.ts`.
- Mutating or lifecycle-sensitive APIs throw on unrecoverable invalid state. Examples: `resources/gsd-2/packages/daemon/src/daemon.ts#getSessionManager` and the guard methods inside `resources/gsd-2/web/lib/gsd-workspace-store.tsx`.

## Module Design

**Exports:**
- Prefer named exports for utilities, types, classes, and React helpers.
- Reserve default exports for framework entrypoints and extension registration modules. Current examples are `resources/gsd-2/web/app/layout.tsx`, `resources/gsd-2/web/app/page.tsx`, `resources/gsd-2/studio/src/renderer/src/App.tsx`, and `resources/gsd-2/src/resources/extensions/gsd/index.ts`.

**Barrel Files:**
- Barrel files are used at package boundaries and selected feature roots, not everywhere. Examples: `resources/gsd-2/packages/pi-coding-agent/src/index.ts`, `resources/gsd-2/packages/pi-tui/src/index.ts`, and `resources/gsd-2/packages/mcp-server/src/readers/index.ts`.
- Inside a feature folder, imports usually target concrete siblings directly rather than routing every dependency through a barrel.

---

*Convention analysis: 2026-04-06*
