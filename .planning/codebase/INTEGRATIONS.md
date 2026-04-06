# External Integrations

**Analysis Date:** 2026-04-06

## APIs & External Services

**LLM providers and model backends:**
- Anthropic - Direct Claude API access is handled in `resources/gsd-2/packages/pi-ai/src/providers/anthropic.ts`, `resources/gsd-2/packages/pi-ai/src/env-api-keys.ts`, and `resources/gsd-2/packages/daemon/src/orchestrator.ts`.
  - SDK/Client: `@anthropic-ai/sdk`
  - Auth: `ANTHROPIC_API_KEY` or `ANTHROPIC_OAUTH_TOKEN`
- Anthropic on Vertex AI - Vertex routing is implemented in `resources/gsd-2/packages/pi-ai/src/providers/anthropic-vertex.ts`.
  - SDK/Client: `@anthropic-ai/vertex-sdk`
  - Auth: `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT`, and `GOOGLE_CLOUD_LOCATION` or `CLOUD_ML_REGION`
- OpenAI - Shared client creation and browser/web validation live in `resources/gsd-2/packages/pi-ai/src/providers/openai-shared.ts`, `resources/gsd-2/packages/pi-coding-agent/src/core/model-discovery.ts`, and `resources/gsd-2/src/web/onboarding-service.ts`.
  - SDK/Client: `openai`
  - Auth: `OPENAI_API_KEY`
- Azure OpenAI - Azure Responses API support is implemented in `resources/gsd-2/packages/pi-ai/src/providers/azure-openai-responses.ts`.
  - SDK/Client: `openai` (`AzureOpenAI`)
  - Auth: `AZURE_OPENAI_API_KEY`, plus `AZURE_OPENAI_BASE_URL` or `AZURE_OPENAI_RESOURCE_NAME`, and optional `AZURE_OPENAI_API_VERSION`
- Google Gemini and Vertex AI - API-key and ADC-based flows are implemented in `resources/gsd-2/packages/pi-ai/src/providers/google.ts`, `resources/gsd-2/packages/pi-ai/src/providers/google-vertex.ts`, `resources/gsd-2/packages/pi-ai/src/env-api-keys.ts`, and `resources/gsd-2/src/resources/extensions/google-search/index.ts`.
  - SDK/Client: `@google/genai`
  - Auth: `GEMINI_API_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`
- Amazon Bedrock - Bedrock streaming support and auth fallback logic live in `resources/gsd-2/packages/pi-ai/src/providers/amazon-bedrock.ts`, with auth-refresh assistance in `resources/gsd-2/src/resources/extensions/aws-auth/index.ts`.
  - SDK/Client: `@aws-sdk/client-bedrock-runtime`
  - Auth: `AWS_PROFILE`, `AWS_ACCESS_KEY_ID` with `AWS_SECRET_ACCESS_KEY`, `AWS_BEARER_TOKEN_BEDROCK`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_CONTAINER_CREDENTIALS_FULL_URI`, or `AWS_WEB_IDENTITY_TOKEN_FILE`
- Additional provider catalog - The repo ships model definitions for OpenRouter, Groq, xAI, Cerebras, Hugging Face Router, Kimi, Minimax, Mistral, GitHub Copilot, Google Cloud Code Assist, and other OpenAI-compatible endpoints in `resources/gsd-2/packages/pi-ai/src/models.generated.ts`, with env-var mapping in `resources/gsd-2/packages/pi-ai/src/env-api-keys.ts`.
  - SDK/Client: mostly `openai`-compatible transport, plus `@mistralai/mistralai` where applicable
  - Auth: `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`, `CEREBRAS_API_KEY`, `HF_TOKEN`, `KIMI_API_KEY`, `MINIMAX_API_KEY`, `MINIMAX_CN_API_KEY`, `OLLAMA_API_KEY`, `CUSTOM_OPENAI_API_KEY`, and related provider-specific env vars

**Search, docs, and web-research tools:**
- Google Search grounding - The native `google_search` tool uses Gemini grounding and Cloud Code Assist fallback in `resources/gsd-2/src/resources/extensions/google-search/index.ts`.
  - SDK/Client: `@google/genai` plus direct `fetch`
  - Auth: `GEMINI_API_KEY` or stored Google OAuth credentials
- Context7 docs lookup - Library search and doc fetch are implemented in `resources/gsd-2/src/resources/extensions/context7/index.ts`.
  - SDK/Client: direct `fetch`
  - Auth: `CONTEXT7_API_KEY`
- Web search provider selection - Brave, Tavily, and Ollama search preferences are resolved in `resources/gsd-2/src/resources/extensions/search-the-web/provider.ts`.
  - SDK/Client: direct `fetch`
  - Auth: `BRAVE_API_KEY`, `TAVILY_API_KEY`, `OLLAMA_API_KEY`
- Page extraction - Jina Reader and direct-page fallback are wired in `resources/gsd-2/src/resources/extensions/search-the-web/tool-fetch-page.ts`.
  - SDK/Client: direct `fetch`
  - Auth: optional `JINA_API_KEY`

**Collaboration and messaging:**
- Discord - The daemon, remote questions setup, and release notifications all talk to Discord through `resources/gsd-2/packages/daemon/src/*.ts`, `resources/gsd-2/src/resources/extensions/remote-questions/remote-command.ts`, and `.github/workflows/pipeline.yml`.
  - SDK/Client: `discord.js` in the daemon, direct `fetch` for remote-question setup, `curl` in release automation
  - Auth: `DISCORD_BOT_TOKEN`, `DISCORD_CHANGELOG_WEBHOOK`
- Slack - Remote questions setup uses Slack Web API calls in `resources/gsd-2/src/resources/extensions/remote-questions/remote-command.ts` and onboarding in `resources/gsd-2/src/onboarding.ts`.
  - SDK/Client: direct `fetch`
  - Auth: `SLACK_BOT_TOKEN`
- Telegram - Remote questions setup uses Telegram Bot API calls in `resources/gsd-2/src/resources/extensions/remote-questions/remote-command.ts` and onboarding in `resources/gsd-2/src/onboarding.ts`.
  - SDK/Client: direct `fetch`
  - Auth: `TELEGRAM_BOT_TOKEN`

**Developer platform integrations:**
- MCP server exposure - GSD can act as an MCP server via `resources/gsd-2/src/mcp-server.ts` and the separately packaged server in `resources/gsd-2/packages/mcp-server`.
  - SDK/Client: `@modelcontextprotocol/sdk`
  - Auth: no built-in SaaS auth; external clients launch it over stdio
- MCP client consumption - Project-local MCP servers are loaded from `.mcp.json` or `.gsd/mcp.json` in `resources/gsd-2/src/resources/extensions/mcp-client/index.ts`.
  - SDK/Client: `@modelcontextprotocol/sdk`
  - Auth: env-expanded headers and optional OAuth blocks from MCP config files
- Repo-specific MCP config - `resources/gsd-2/.mcp.json` points at a local `repowise` MCP server via stdio. This is a developer-local mapping, not a portable production dependency.

**Local tooling with network-backed bootstrap:**
- Managed RTK binary - Downloaded from GitHub Releases in `resources/gsd-2/src/rtk.ts` and `resources/gsd-2/scripts/postinstall.js`.
  - SDK/Client: direct `fetch`, `extract-zip`, system `tar`
  - Auth: none
- Managed `fd` and `rg` binaries - Downloaded from GitHub Releases via `resources/gsd-2/packages/pi-coding-agent/src/utils/tools-manager.ts`.
  - SDK/Client: direct `fetch`
  - Auth: none
- Playwright browser install - `resources/gsd-2/scripts/postinstall.js` runs `npx playwright install chromium` unless disabled.
  - SDK/Client: Playwright CLI
  - Auth: none

## Data Storage

**Databases:**
- Local-only SQLite-style storage via `sql.js` is used for the memory subsystem in `resources/gsd-2/packages/pi-coding-agent/src/resources/extensions/memory/storage.ts`.
  - Connection: none; it is an embedded local file/in-memory database, not a hosted service
  - Client: `sql.js`
- A checked-in local analysis artifact `resources/gsd-2/repowise.db` exists, but no runtime code was found connecting to a remote database service.

**File Storage:**
- Local filesystem only. GSD stores state, auth, preferences, sessions, logs, and MCP config on disk via code in `resources/gsd-2/src/app-paths.ts`, `resources/gsd-2/src/onboarding.ts`, `resources/gsd-2/packages/daemon/src/config.ts`, and `resources/gsd-2/src/resources/extensions/mcp-client/index.ts`.

**Caching:**
- In-process caches are common: search/doc caches in `resources/gsd-2/src/resources/extensions/context7/index.ts`, page caches in `resources/gsd-2/src/resources/extensions/search-the-web/tool-fetch-page.ts`, and model-discovery TTL caches in `resources/gsd-2/packages/pi-coding-agent/src/core/model-discovery.ts`.
- Update-check cache is stored locally in `resources/gsd-2/src/update-check.ts`.

## Authentication & Identity

**Auth Provider:**
- There is no end-user SaaS auth provider for the product itself. The system authenticates outward to model providers, messaging APIs, and MCP servers using env vars or tokens stored in local auth files.
  - Implementation: onboarding and key management write to `~/.gsd/agent/auth.json` through flows implemented in `resources/gsd-2/src/onboarding.ts`, `resources/gsd-2/src/resources/extensions/gsd/key-manager.ts`, and `resources/gsd-2/src/web/onboarding-service.ts`

**Local web auth:**
- The web UI uses a locally generated bearer token, passed via URL fragment and enforced in `resources/gsd-2/web/lib/auth.ts` and `resources/gsd-2/web/proxy.ts`.
  - Implementation: random token at launch, stored in browser storage, validated on `/api/*`

## Monitoring & Observability

**Error Tracking:**
- No hosted error tracker such as Sentry, Bugsnag, or Rollbar was detected in the runtime code or manifests.

**Logs:**
- Daemon logs are file-based and configured in `resources/gsd-2/packages/daemon/src/config.ts` with a default path under `~/.gsd/daemon.log`.
- Session, cost, and workflow state are kept locally; the docs describe these behaviors in `resources/gsd-2/README.md` and `resources/gsd-2/docs/web-interface.md`.

## CI/CD & Deployment

**Hosting:**
- npm registry distribution is the primary delivery channel, defined by `resources/gsd-2/package.json` and published through `resources/gsd-2/.github/workflows/pipeline.yml`.
- Docker runtime images are published to GHCR from `resources/gsd-2/Dockerfile` and `resources/gsd-2/.github/workflows/pipeline.yml`.
- Native platform binaries are published as separate npm packages from `resources/gsd-2/native/npm/*/package.json` through `resources/gsd-2/.github/workflows/build-native.yml`.
- The browser UI is locally hosted by the CLI using the standalone Next.js build from `resources/gsd-2/web`.

**CI Pipeline:**
- GitHub Actions is the CI/CD system. The main workflows are `resources/gsd-2/.github/workflows/ci.yml`, `resources/gsd-2/.github/workflows/pipeline.yml`, and `resources/gsd-2/.github/workflows/build-native.yml`.
- The documented promotion model is Dev -> Test -> Prod using npm dist-tags and GHCR, described in `resources/gsd-2/docs/ci-cd-pipeline.md`.

## Environment Configuration

**Required env vars:**
- Core model auth: `ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `AZURE_OPENAI_API_KEY`
- Cloud auth: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `ANTHROPIC_VERTEX_PROJECT_ID`, `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- Search/docs tools: `CONTEXT7_API_KEY`, `JINA_API_KEY`, `BRAVE_API_KEY`, `TAVILY_API_KEY`, `OLLAMA_API_KEY`
- Messaging: `DISCORD_BOT_TOKEN`, `SLACK_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`
- Web host: `GSD_WEB_AUTH_TOKEN`, `GSD_WEB_HOST`, `GSD_WEB_PORT`, `GSD_WEB_ALLOWED_ORIGINS`, `GSD_WEB_PROJECT_CWD`
- Tooling/bootstrap: `GSD_RTK_DISABLED`, `GSD_SKIP_RTK_INSTALL`, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, `PI_OFFLINE`

**Secrets location:**
- Stored credentials are managed in local files under `~/.gsd`, especially `~/.gsd/agent/auth.json`, `~/.gsd/PREFERENCES.md`, and `~/.gsd/daemon.yaml`, as referenced by `resources/gsd-2/src/onboarding.ts`, `resources/gsd-2/src/resources/extensions/remote-questions/store.ts`, and `resources/gsd-2/packages/daemon/src/config.ts`.
- Example docker env configuration exists at `resources/gsd-2/docker/.env.example`, but the file contents were intentionally not read.

## Webhooks & Callbacks

**Incoming:**
- Not detected as public webhooks. The product mainly initiates outbound API calls or uses stdio/JSON-RPC. MCP traffic is handled over stdio in `resources/gsd-2/src/mcp-server.ts` and `resources/gsd-2/packages/mcp-server/README.md`.
- OAuth-capable flows exist for some providers in the onboarding service at `resources/gsd-2/src/web/onboarding-service.ts`, but no always-on public callback server was identified in the analyzed code.

**Outgoing:**
- npm registry requests for update checks and publishing are wired in `resources/gsd-2/src/update-check.ts` and `.github/workflows/pipeline.yml`.
- GitHub API and release downloads are used by `resources/gsd-2/packages/pi-coding-agent/src/utils/tools-manager.ts`, `resources/gsd-2/src/rtk.ts`, and `resources/gsd-2/scripts/postinstall.js`.
- LLM traffic fans out to provider endpoints declared in `resources/gsd-2/packages/pi-ai/src/models.generated.ts`.
- Slack, Discord, Telegram, Jina, Context7, Brave, Tavily, OpenRouter, Google, and Groq traffic is initiated from the extension and onboarding files listed above.

## Absences That Matter

- No hosted application database, payment gateway, analytics SDK, or customer identity platform was detected.
- No React Native, Expo, iOS, or Android runtime surface was detected in `/Users/lakshmanturlapati/Documents/Codes/Codex-Mobile`; the codebase being mapped is the `resources/gsd-2/` monorepo.
- No private package registry configuration was confirmed. The shipped CI and update code reference `registry.npmjs.org` and `ghcr.io`, while `resources/gsd-2/.npmrc` exists but was intentionally not read.

---

*Integration audit: 2026-04-06*
