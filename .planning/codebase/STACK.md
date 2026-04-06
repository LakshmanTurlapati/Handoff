# Technology Stack

**Analysis Date:** 2026-04-06

## Languages

**Primary:**
- TypeScript and modern ESM JavaScript - The main application, CLI, extensions, web host, Electron studio, and workspace packages live under `resources/gsd-2/src`, `resources/gsd-2/packages`, `resources/gsd-2/web`, `resources/gsd-2/studio`, and `resources/gsd-2/vscode-extension`.
- JSON, YAML, and Markdown configuration - Package manifests, workflows, MCP config, docs, and runtime preferences are defined in files such as `resources/gsd-2/package.json`, `resources/gsd-2/.mcp.json`, `resources/gsd-2/.github/workflows/ci.yml`, and `resources/gsd-2/docs/providers.md`.

**Secondary:**
- Rust 2021 - Native performance-sensitive functionality is implemented in `resources/gsd-2/native/Cargo.toml`, `resources/gsd-2/native/crates/engine/Cargo.toml`, `resources/gsd-2/native/crates/grep/Cargo.toml`, and `resources/gsd-2/native/crates/ast/Cargo.toml`.
- Python 3 - Speech recognition support is implemented as a spawned helper in `resources/gsd-2/src/resources/extensions/voice/speech-recognizer.py`.
- Shell and PowerShell - Release, verification, recovery, and scanning scripts live in `resources/gsd-2/scripts/*.sh` and `resources/gsd-2/scripts/*.ps1`.

## Runtime

**Environment:**
- Node.js `>=22.0.0` is the baseline runtime in `resources/gsd-2/package.json`, `resources/gsd-2/packages/daemon/package.json`, `resources/gsd-2/packages/mcp-server/package.json`, and `resources/gsd-2/packages/rpc-client/package.json`.
- The packaged Docker runtime uses `node:24-slim` in `resources/gsd-2/Dockerfile`.
- The web host is a local Next.js server launched by the CLI from `resources/gsd-2/src/web-mode.ts`.
- The desktop app is Electron 41 via `resources/gsd-2/studio/package.json` and `resources/gsd-2/studio/electron.vite.config.ts`.
- The VS Code integration runs inside the VS Code extension host per `resources/gsd-2/vscode-extension/package.json`.

**Package Manager:**
- npm `10.9.3` is pinned in `resources/gsd-2/package.json`.
- Lockfiles present: `resources/gsd-2/package-lock.json`, `resources/gsd-2/web/package-lock.json`, and `resources/gsd-2/vscode-extension/package-lock.json`.
- npm workspaces are enabled for `packages/*` and `studio` in `resources/gsd-2/package.json`.

## Frameworks

**Core:**
- GSD CLI on top of the Pi SDK stack - The root app describes itself as a standalone agent built on Pi in `resources/gsd-2/README.md`, while vendored Pi packages live in `resources/gsd-2/packages/pi-ai`, `resources/gsd-2/packages/pi-agent-core`, `resources/gsd-2/packages/pi-coding-agent`, and `resources/gsd-2/packages/pi-tui`.
- Next.js `16.1.6` with React `19.2.4` - The browser UI is defined by `resources/gsd-2/web/package.json` and configured in `resources/gsd-2/web/next.config.mjs`.
- Electron `41.0.3` with `electron-vite` `5.0.0` and React `19.2.0` - The desktop studio lives in `resources/gsd-2/studio/package.json` and `resources/gsd-2/studio/electron.vite.config.ts`.
- VS Code extension host - Editor integration is packaged from `resources/gsd-2/vscode-extension/package.json` and documented in `resources/gsd-2/vscode-extension/README.md`.
- Rust N-API addon - Native modules are exposed through `resources/gsd-2/packages/native/package.json` and built from `resources/gsd-2/native/crates/engine/Cargo.toml`.

**Testing:**
- Node built-in test runner is the default test harness. Root scripts in `resources/gsd-2/package.json` use `node --test` and `--experimental-strip-types`.
- Playwright `1.58.2` is used for browser-tool and web-mode integration coverage in `resources/gsd-2/package.json` and `resources/gsd-2/src/resources/extensions/browser-tools/index.ts`.
- `c8` `11.0.0` provides coverage via `npm run test:coverage` in `resources/gsd-2/package.json`.

**Build/Dev:**
- TypeScript `5.4+` is the primary compiler at the root and across workspaces in `resources/gsd-2/package.json`, `resources/gsd-2/packages/*/package.json`, and `resources/gsd-2/web/package.json`.
- Next.js build output is `standalone`, with webpack forced for NodeNext import aliasing in `resources/gsd-2/web/next.config.mjs`.
- Tailwind CSS v4 is used in both web and studio via `resources/gsd-2/web/postcss.config.mjs` and `resources/gsd-2/studio/electron.vite.config.ts`.
- Cargo builds the native engine workspace from `resources/gsd-2/native/Cargo.toml`.

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk`, `openai`, `@google/genai`, `@aws-sdk/client-bedrock-runtime`, `@anthropic-ai/vertex-sdk`, and `@mistralai/mistralai` are the core LLM-provider SDKs wired in `resources/gsd-2/packages/pi-ai/src/providers/*.ts`.
- `@modelcontextprotocol/sdk` underpins both the embedded MCP server in `resources/gsd-2/src/mcp-server.ts` and the client extension in `resources/gsd-2/src/resources/extensions/mcp-client/index.ts`.
- `playwright` powers browser automation under `resources/gsd-2/src/resources/extensions/browser-tools/index.ts`.
- `node-pty` backs the web terminal bridge in `resources/gsd-2/web/lib/pty-manager.ts` and is explicitly externalized in `resources/gsd-2/web/next.config.mjs`.
- `sql.js` is used for the memory store in `resources/gsd-2/packages/pi-coding-agent/src/resources/extensions/memory/storage.ts`.

**Infrastructure:**
- `discord.js` powers the daemon and remote-control bot in `resources/gsd-2/packages/daemon/src/discord-bot.ts` and related files.
- `sharp` and `@silvia-odwyer/photon-node` support image and screenshot processing in `resources/gsd-2/package.json` and `resources/gsd-2/packages/pi-coding-agent/package.json`.
- `proxy-agent` and `undici` provide network/proxy handling in `resources/gsd-2/packages/pi-ai/src/providers/amazon-bedrock.ts` and `resources/gsd-2/packages/pi-coding-agent/src/cli.ts`.
- `extract-zip` is part of managed binary installation in `resources/gsd-2/src/rtk.ts`, `resources/gsd-2/scripts/postinstall.js`, and `resources/gsd-2/packages/pi-coding-agent/src/utils/tools-manager.ts`.

## Configuration

**Environment:**
- The analyzed repository root is mostly a wrapper. The actual product code is under `resources/gsd-2/`; no top-level `package.json`, Expo config, or React Native runtime files are present in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile`.
- Root runtime configuration lives in `resources/gsd-2/package.json`, `resources/gsd-2/tsconfig.json`, `resources/gsd-2/tsconfig.extensions.json`, `resources/gsd-2/tsconfig.resources.json`, and `resources/gsd-2/tsconfig.test.json`.
- Web-specific configuration lives in `resources/gsd-2/web/package.json`, `resources/gsd-2/web/tsconfig.json`, `resources/gsd-2/web/next.config.mjs`, `resources/gsd-2/web/postcss.config.mjs`, and `resources/gsd-2/web/eslint.config.mjs`.
- Studio-specific configuration lives in `resources/gsd-2/studio/package.json`, `resources/gsd-2/studio/tsconfig*.json`, and `resources/gsd-2/studio/electron.vite.config.ts`.
- Native build configuration lives in `resources/gsd-2/native/Cargo.toml` and `resources/gsd-2/native/.cargo`.
- `.npmrc` is present at `resources/gsd-2/.npmrc`, but its contents were intentionally not read.
- An example environment file exists at `resources/gsd-2/docker/.env.example`; it was noted but not read.

**Build:**
- Main build: `npm run build` from `resources/gsd-2/package.json`.
- Web host build: `npm run build:web-host` from `resources/gsd-2/package.json`.
- Native build: `npm run build:native` and `npm run build:native:dev` from `resources/gsd-2/package.json` and `resources/gsd-2/packages/native/package.json`.
- Typecheck extensions: `npm run typecheck:extensions` from `resources/gsd-2/package.json`.
- Test entrypoints: `npm run test`, `npm run test:unit`, `npm run test:integration`, `npm run test:coverage`, `npm run test:smoke`, `npm run test:fixtures`, and `npm run test:live` from `resources/gsd-2/package.json`.

## Platform Requirements

**Development:**
- Node.js 22+ and npm are required by manifests in `resources/gsd-2/package.json` and workspace package manifests.
- Git is required for core workflows and the Docker runtime explicitly installs it in `resources/gsd-2/Dockerfile`.
- Rust stable is required to build native modules according to `resources/gsd-2/native/README.md` and `resources/gsd-2/.github/workflows/build-native.yml`.
- Playwright Chromium may be installed during `postinstall` unless `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` is set, per `resources/gsd-2/scripts/postinstall.js`.

**Production:**
- The primary distributable is the npm package `gsd-pi`, defined in `resources/gsd-2/package.json` and published through `.github/workflows/pipeline.yml`.
- A Docker runtime image is built from `resources/gsd-2/Dockerfile` and published to `ghcr.io/gsd-build/gsd-pi` in `resources/gsd-2/.github/workflows/pipeline.yml`.
- Platform-native addon packages are published from `resources/gsd-2/native/npm/*/package.json` and assembled by `resources/gsd-2/.github/workflows/build-native.yml`.

---

*Stack analysis: 2026-04-06*
