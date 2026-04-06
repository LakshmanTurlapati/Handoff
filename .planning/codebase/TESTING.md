# Testing Patterns

**Analysis Date:** 2026-04-06

## Test Framework

**Runner:**
- The primary runner is Node's built-in `node:test`. It is used across `resources/gsd-2/packages/**`, `resources/gsd-2/src/tests/**`, `resources/gsd-2/src/resources/extensions/**/tests/**`, `resources/gsd-2/web/lib/__tests__`, `resources/gsd-2/studio/test/tokens.test.mjs`, and `resources/gsd-2/packages/native/src/__tests__/**`.
- No Jest, Vitest, Playwright, or Cypress config was detected under `resources/gsd-2/`. Test execution is script-driven from `resources/gsd-2/package.json` and a few package-local `package.json` files.
- TypeScript support is handled in three different ways:
  - `resources/gsd-2/scripts/compile-tests.mjs` compiles selected suites to `dist-test/` for `npm run test:unit`.
  - `resources/gsd-2/scripts/dist-test-resolve.mjs` is imported when running compiled unit tests.
  - `resources/gsd-2/src/resources/extensions/gsd/tests/resolve-ts.mjs` is imported for suites that run TypeScript directly with `--experimental-strip-types`.

**Assertion Library:**
- `node:assert/strict` is the standard assertion library. See `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.test.ts`, `resources/gsd-2/packages/mcp-server/src/mcp-server.test.ts`, and `resources/gsd-2/web/lib/__tests__/shutdown-gate.test.ts`.
- Older tests occasionally use plain `node:assert`, for example `resources/gsd-2/src/tests/marketplace-discovery.test.ts`.

**Run Commands:**
```bash
npm run test                  # Root unit + integration suites
npm run test:unit             # Compile selected TS suites to dist-test/ and run node --test
npm run test:integration      # Run TS integration suites with --experimental-strip-types
npm run test:coverage         # c8 coverage gate for selected root/extension suites
npm run test:packages         # Run compiled pi-coding-agent core tests in packages/pi-coding-agent/dist/core
npm run test:smoke            # Custom smoke harness in tests/smoke/run.ts
npm run test:fixtures         # Replay JSON fixture recordings from tests/fixtures/
npm run test:fixtures:record  # Record new fixture conversations
npm run test:live             # Opt-in live provider tests; requires GSD_LIVE_TESTS=1
npm run test:live-regression  # Installed-binary live regression harness
npm run test:native           # Single native addon grep smoke test
npm test --prefix studio      # Studio token/CSS check only
```

## Test File Organization

**Location:**
- Keep fast unit tests next to the code they cover: `resources/gsd-2/packages/daemon/src/*.test.ts`, `resources/gsd-2/packages/pi-coding-agent/src/core/*.test.ts`, `resources/gsd-2/packages/rpc-client/src/rpc-client.test.ts`, and `resources/gsd-2/src/resources/extensions/async-jobs/*.test.ts`.
- Keep higher-level application and contract tests in `resources/gsd-2/src/tests/*.test.ts` and `resources/gsd-2/src/tests/integration/*.test.ts`.
- Keep extension-heavy integration tests under `resources/gsd-2/src/resources/extensions/gsd/tests` and `resources/gsd-2/src/resources/extensions/gsd/tests/integration`.
- Use `resources/gsd-2/tests/` for custom harness runners instead of `node:test` discovery. Examples: `resources/gsd-2/tests/smoke/run.ts`, `resources/gsd-2/tests/fixtures/run.ts`, `resources/gsd-2/tests/live/run.ts`, and `resources/gsd-2/tests/live-regression/run.ts`.

**Naming:**
- Standard naming is `*.test.ts`, `*.test.mjs`, or `*.test.cjs`.
- A small number of packages use `__tests__` directories instead of colocated files, notably `resources/gsd-2/packages/native/src/__tests__` and `resources/gsd-2/packages/pi-tui/src/components/__tests__`.

**Structure:**
```text
resources/gsd-2/
├── packages/*/src/**/*.test.ts
├── packages/native/src/__tests__/*.test.mjs
├── src/tests/*.test.ts
├── src/tests/integration/*.test.ts
├── src/resources/extensions/*/tests/**/*.test.ts
├── web/lib/__tests__/*.test.ts
├── studio/test/*.test.mjs
└── tests/{smoke,fixtures,live,live-regression}/run.ts
```

**Current inventory from file scan:**
- `resources/gsd-2/packages`: 78 discovered test files.
- `resources/gsd-2/src`: 547 discovered test files.
- `resources/gsd-2/web`: 2 discovered test files.
- `resources/gsd-2/studio`: 1 discovered test file.
- `resources/gsd-2/vscode-extension`: 0 discovered test files.

## Test Structure

**Suite Organization:**
```typescript
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SessionManager usage totals", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("tracks assistant usage incrementally without rescanning entries", () => {
    dir = mkdtempSync(join(tmpdir(), "gsd-session-manager-test-"));
  });
});
```

**Patterns:**
- Import `node:test` and `node:assert/strict` explicitly in each file. See `resources/gsd-2/packages/pi-coding-agent/src/core/session-manager.test.ts`, `resources/gsd-2/packages/daemon/src/project-scanner.test.ts`, and `resources/gsd-2/packages/mcp-server/src/mcp-server.test.ts`.
- Use `describe`/`it` for grouped suites and top-level `test(...)` for smaller single-file contracts. Both styles coexist.
- Prefer explicit teardown. Common patterns are `afterEach(() => rmSync(...))`, cleanup stacks, or per-test `t.after(...)` callbacks. Examples: `resources/gsd-2/packages/daemon/src/project-scanner.test.ts`, `resources/gsd-2/packages/native/src/__tests__/grep.test.mjs`, and `resources/gsd-2/tests/live/run.ts`.
- Assertions favor `assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.throws`, and `assert.rejects`.

## Mocking

**Framework:** `node:test` mock API plus hand-rolled fakes

**Patterns:**
```typescript
function createMockLogger() {
  return {
    debug: mock.fn(() => {}),
    info: mock.fn(() => {}),
    warn: mock.fn(() => {}),
    error: mock.fn(() => {}),
  };
}
```

- Use `mock.fn()` for call tracking and injected behavior. See `resources/gsd-2/packages/daemon/src/event-bridge.test.ts`, `resources/gsd-2/packages/pi-coding-agent/src/core/retry-handler.test.ts`, and `resources/gsd-2/packages/pi-tui/src/components/__tests__/loader.test.ts`.
- Prefer duck-typed fake classes and subclass seams over module-level mocking. `resources/gsd-2/packages/mcp-server/src/mcp-server.test.ts` subclasses `SessionManager` and injects `MockRpcClient` because the suite does not rely on `--experimental-test-module-mocks`.
- Use `EventEmitter`, `PassThrough`, and fake child processes for protocol-level tests. See `resources/gsd-2/src/tests/integration/web-bridge-contract.test.ts` and `resources/gsd-2/packages/rpc-client/src/rpc-client.test.ts`.
- Use direct `globalThis.fetch` replacement plus restore helpers for provider tests. See `resources/gsd-2/src/tests/search-tavily.test.ts` and helper utilities in `resources/gsd-2/src/tests/fetch-test-helpers.ts`.

**What to Mock:**
- RPC clients, Discord clients/channels, timers, child-process stdio, fetch/network boundaries, and optional external executables.
- Environment variables are commonly mutated per test and restored with `t.after(...)` or `afterEach(...)`.

**What NOT to Mock:**
- Temporary filesystem workflows are usually exercised against real directories and files. Examples: `resources/gsd-2/packages/daemon/src/project-scanner.test.ts`, `resources/gsd-2/src/resources/extensions/gsd/tests/integration/e2e-workflow-pipeline-integration.test.ts`, and `resources/gsd-2/src/tests/app-smoke.test.ts`.
- The web contract tests prefer real route modules plus fake subprocess seams instead of a browser DOM test runner. See `resources/gsd-2/src/tests/integration/web-bridge-contract.test.ts`.

## Fixtures and Factories

**Test Data:**
```typescript
function mockFetch(responseBody: unknown, status = 200) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { restore: () => { globalThis.fetch = originalFetch; } };
}
```

**Location:**
- Shared fetch helpers live in `resources/gsd-2/src/tests/fetch-test-helpers.ts`.
- RTK executable fakes live in `resources/gsd-2/src/tests/rtk-test-utils.ts`.
- Conversation fixture recording and replay live in `resources/gsd-2/tests/fixtures/provider.ts`, with runners in `resources/gsd-2/tests/fixtures/run.ts` and `resources/gsd-2/tests/fixtures/record.ts`.
- Some extension-specific suites use their own helper modules, such as `resources/gsd-2/src/resources/extensions/gsd/tests/test-helpers.ts`.

## Coverage

**Requirements:** partial thresholds enforced
- `resources/gsd-2/package.json` sets `c8` thresholds at 40% statements, 40% lines, 20% branches, and 20% functions.
- `npm run test:coverage` excludes `resources/gsd-2/src/resources/extensions/gsd/tests/**`, `resources/gsd-2/src/tests/**`, `resources/gsd-2/scripts/**`, `resources/gsd-2/native/**`, and `node_modules/**`.
- Because of those exclusions, the coverage gate is not a whole-repository signal. It mainly measures a selected subset of root and extension logic.

**View Coverage:**
```bash
npm run test:coverage
open resources/gsd-2/coverage/lcov-report/index.html  # if generated locally
```

## Test Types

**Unit Tests:**
- Colocated logic tests dominate the repository. Examples include `resources/gsd-2/packages/pi-coding-agent/src/core/*.test.ts`, `resources/gsd-2/packages/daemon/src/*.test.ts`, `resources/gsd-2/packages/rpc-client/src/rpc-client.test.ts`, and `resources/gsd-2/src/resources/extensions/*/tests/*.test.ts`.
- These suites focus on parsers, managers, state transitions, filesystem helpers, protocol serialization, and regression fixes.

**Integration Tests:**
- Root integration suites live in `resources/gsd-2/src/tests/integration/*.test.ts`.
- Extension integration suites live in `resources/gsd-2/src/resources/extensions/gsd/tests/integration/*.test.ts`.
- Web integration is primarily contract-style Node testing against route modules and bridge services, not React rendering. Examples: `resources/gsd-2/src/tests/integration/web-bridge-contract.test.ts` and related `web-*.test.ts` files in the same folder.

**E2E Tests:**
- The closest in-tree E2E engine test is `resources/gsd-2/src/resources/extensions/gsd/tests/integration/e2e-workflow-pipeline-integration.test.ts`, which drives real temp directories through the custom workflow engine.
- Installed-binary smoke and live harnesses live outside `node:test` discovery in `resources/gsd-2/tests/smoke/run.ts`, `resources/gsd-2/tests/live/run.ts`, and `resources/gsd-2/tests/live-regression/run.ts`.
- Browser E2E tooling is not used. No Playwright or Cypress config was detected.

## Common Patterns

**Async Testing:**
```typescript
await assert.rejects(() => {
  return native.grep({ pattern: "test", path: "/nonexistent/path" });
});
```

- Use `async` tests with `await`, `assert.rejects`, small tick helpers, and dynamic `import(...)` when module initialization depends on runtime state.
- Representative files: `resources/gsd-2/packages/native/src/__tests__/grep.test.mjs`, `resources/gsd-2/src/tests/integration/web-bridge-contract.test.ts`, and `resources/gsd-2/src/tests/search-tavily.test.ts`.

**Error Testing:**
```typescript
assert.throws(() => {
  native.search(Buffer.from("hello"), { pattern: "[invalid" });
});
```

- Error-path assertions are standard for parser, validation, and transport tests. See `resources/gsd-2/packages/native/src/__tests__/grep.test.mjs`, `resources/gsd-2/packages/mcp-server/src/mcp-server.test.ts`, and `resources/gsd-2/packages/daemon/src/daemon.test.ts`.

## Automation Gaps

**Current gaps:**
- `resources/gsd-2/vscode-extension` has no automated tests, despite a large surface area in files like `resources/gsd-2/vscode-extension/src/extension.ts`.
- `resources/gsd-2/web` has only two utility tests under `resources/gsd-2/web/lib/__tests__`, and the root test scripts in `resources/gsd-2/package.json` do not include those files directly. Most web validation is indirect through `resources/gsd-2/src/tests/integration/web-*.test.ts`.
- `resources/gsd-2/studio` has one test file, `resources/gsd-2/studio/test/tokens.test.mjs`, and `resources/gsd-2/.github/workflows/ci.yml` does not run `npm test --prefix studio`.
- Package-local tests for `resources/gsd-2/packages/daemon`, `resources/gsd-2/packages/mcp-server`, and `resources/gsd-2/packages/rpc-client` exist in their own `package.json` files, but the root CI workflow only runs `npm run test:packages`, which currently targets `resources/gsd-2/packages/pi-coding-agent/dist/core/*.test.js`.
- Additional test files exist in `resources/gsd-2/packages/pi-tui/src/__tests__`, `resources/gsd-2/packages/pi-tui/src/components/__tests__`, `resources/gsd-2/packages/pi-ai/src/**/*.test.ts`, and `resources/gsd-2/packages/pi-agent-core/src/*.test.ts`, but no dedicated root script or CI step was detected for them. `resources/gsd-2/scripts/compile-tests.mjs` explicitly skips `__tests__` and `integration` directories when building `dist-test/`, so those suites are not part of `npm run test:unit`.
- `resources/gsd-2/scripts/require-tests.sh` only enforces source-change test additions for `resources/gsd-2/src` and `resources/gsd-2/packages`, so changes limited to `resources/gsd-2/web`, `resources/gsd-2/studio`, or `resources/gsd-2/vscode-extension` do not hit the same PR gate.

---

*Testing analysis: 2026-04-06*
