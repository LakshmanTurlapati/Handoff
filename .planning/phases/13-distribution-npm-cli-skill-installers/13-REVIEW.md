---
phase: 13-distribution-npm-cli-skill-installers
reviewed: 2026-06-06T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - apps/achilles-cli/package.json
  - apps/achilles-cli/src/cli.ts
  - apps/achilles-cli/src/electron-binary-locator.ts
  - apps/achilles-cli/src/skill-symlink.ts
  - apps/achilles-cli/src/commands/launch.ts
  - apps/achilles-cli/src/commands/install-skill.ts
  - apps/achilles-cli/src/commands/init.ts
  - apps/achilles-cli/src/commands/transcripts.ts
  - apps/achilles-cli/scripts/check-source-of-truth.mjs
  - apps/achilles-cli/scripts/check-tarball-no-secrets.mjs
  - apps/achilles/src/main/init-wizard.ts
  - apps/achilles/src/renderer/components/InitWizard.tsx
  - apps/achilles/src/main/index.ts
  - apps/achilles/src/shared/ipc-schemas.ts
  - apps/achilles/src/shared/constants.ts
  - apps/achilles/src/preload/index.ts
  - apps/achilles/build/entitlements.mac.plist
  - apps/achilles/build/Info.plist.fragment
  - apps/achilles/build/README.md
  - apps/achilles/electron-builder.json
  - apps/achilles/package.json
  - packages/achilles-skill/skill/SKILL.md
  - packages/achilles-skill/package.json
findings:
  critical: 4
  warning: 9
  info: 6
  total: 19
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-06-06
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Phase 13 ships the npm CLI (`apps/achilles-cli/`), the first-run init wizard surfaces (`apps/achilles/src/main/init-wizard.ts` plus the InitWizard renderer component), the eight new init-wizard IPC channels with strict Zod schemas, the electron-builder configuration, and the publish-time gates (source-of-truth diff and tarball secret scan). The seams architecture is well-disciplined and the test coverage is thorough; however, adversarial review surfaces four blockers that will prevent the v1.2 release from working as advertised on a fresh user install:

1. The macOS hardened-runtime entitlements file is **missing `com.apple.security.network.client`** — every ElevenLabs STT/TTS call will be killed by Gatekeeper on a signed DMG.
2. The init-wizard renderer is **stuck on a "requesting" spinner** if probePermission returns `not-determined` or `restricted` (Step 2 cannot progress).
3. The `anthropic-sk-` secret-scan regex pattern is **too lax** (matches legitimate strings like CSS class names containing "sk-" prefixes), creating false-positive publish blocks for innocuous code.
4. The cross-platform build scripts (`check-source-of-truth.mjs`, `check-tarball-no-secrets.mjs`) **invoke POSIX `mkdir -p`** which will fail on Windows shells and break the prepublishOnly gate when an operator publishes from a Windows host.

There are also several warnings around concurrency (no install-skill TOCTOU guard between lstatSync and symlinkSync), error handling (init.ts swallows non-ElectronBinaryMissingError errors from locate that should still terminate the wizard), and renderer/preload silent error swallowing that confuses users when payload validation fails.

## Critical Issues

### CR-01: Missing `com.apple.security.network.client` entitlement breaks all outbound HTTPS on signed macOS builds

**File:** `apps/achilles/build/entitlements.mac.plist:4-11`
**Issue:** The entitlements plist declares only `device.audio-input`, `cs.allow-jit`, and `cs.allow-unsigned-executable-memory`. Under `hardenedRuntime: true` (set in `electron-builder.json:20`), macOS requires `com.apple.security.network.client` to be explicitly granted for the app to make any outbound TCP/UDP connections. Without it, the ElevenLabs STT WebSocket connection, the TTS streaming POST, and any STT-token mint round-trip will all be blocked at the kernel level after notarisation. The review priorities document calls this out explicitly ("only what's needed: audio-input + network.client"), but the plist ships only the audio-input half.

This is a release blocker — the smoke test in the init wizard will succeed in dev (where hardened runtime is not active) but fail with an opaque network error on the signed DMG that lands in a user's Downloads folder. The first feedback the user gets is "the smoke test failed" with no remediation path.

**Fix:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.device.audio-input</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
  </dict>
</plist>
```

Then update `apps/achilles/build/entitlements.mac.test.mjs:48-52` to assert all four keys (including `com.apple.security.network.client`).

### CR-02: InitWizard stalls indefinitely on `not-determined` / `restricted` mic permission outcomes

**File:** `apps/achilles/src/renderer/components/InitWizard.tsx:237-245`
**Issue:** The mic-permission result handler only dispatches actions for `granted` and `denied`. For `not-determined` (macOS first-launch before any user response, or after the user dismissed the system prompt without choosing) and `restricted` (MDM-managed devices that block mic globally), the inline comment claims "the user can retry; the reducer keeps the state on Step 2 with status 'requesting'", but the button is wired with `disabled={status === "requesting"}` at line 477. The user lands on Step 2 with a spinner showing "requesting" forever and no way to advance. There is no Skip mic test button rendered until the status flips to `"denied"` (see lines 459-465).

Tracing the underlying call: `probePermission` is invoked with `triggerAskForMediaAccess: true`, but macOS only fires the OS prompt the FIRST time `askForMediaAccess` is called for a given app — subsequent calls just return the cached status. So once the user dismisses the prompt without choosing, every retry returns `not-determined` with no UI escape valve. On MDM-restricted devices, this is permanent.

**Fix:** Either treat `not-determined` and `restricted` as `denied`-equivalents in the reducer (so the user gets the Skip + Open Settings affordances), or add an explicit action that resets the status to `"idle"` so the Request button re-enables. Recommended fix:
```typescript
const unsubscribeMic = bridge.onInitWizardMicPermissionResult((result) => {
  if (result.status === "granted") {
    dispatch({ type: "MIC_GRANTED" });
  } else if (result.status === "denied" || result.status === "restricted") {
    dispatch({ type: "MIC_DENIED" });
  } else {
    // 'not-determined' — re-enable the button so the user can retry, or
    // skip. Without this branch the user is stuck on a "requesting"
    // spinner because the reducer never advances.
    dispatch({ type: "MIC_PROMPT_DISMISSED" });
  }
});
```
Add a corresponding reducer case that flips `status: "idle"` so the Request button re-enables and the Skip button becomes reachable.

### CR-03: `anthropic-sk-` regex pattern produces false positives that will block legitimate publishes

**File:** `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs:70-72`
**Issue:** The pattern `/sk-[A-Za-z0-9_-]{29,}/g` matches ANY `sk-` prefix followed by 29 or more allowed characters, but real Anthropic API keys use the format `sk-ant-api03-...` (≥85 chars total). The current pattern catches innocuous strings like CSS class names (`sk-overlay-component-positioning-fixed`), TypeScript identifiers (`sk-ipped-because-this-is-just-a-test`), and any kebab-case identifier that happens to begin with `sk-` and run for 29+ chars.

Verified by direct regex test:
```
'sk-overlay-component-positioning-fixed'.match(/sk-[A-Za-z0-9_-]{29,}/g)
→ [ 'sk-overlay-component-positioning-fixed' ]
```
On a release where any docstring, comment, or example uses a kebab-case identifier starting with `sk-` and ≥32 chars total (very common in component libraries, design systems, doc files), `prepublishOnly` will abort with a false-positive `SECRET LEAK DETECTED`, blocking the publish and surfacing a misleading failure to the operator.

**Fix:** Tighten to the actual Anthropic key prefix:
```javascript
{
  name: "anthropic-sk-ant",
  regex: /sk-ant-[A-Za-z0-9_-]{29,}/g,
},
```
Add a TNS6.5 self-check test that confirms `sk-overlay-component-positioning-fixed` does NOT match this regex.

### CR-04: `check-source-of-truth.mjs` and `check-tarball-no-secrets.mjs` invoke POSIX `mkdir -p` which breaks on Windows shells

**File:** `apps/achilles-cli/scripts/check-source-of-truth.mjs:115` and `apps/achilles-cli/scripts/check-tarball-no-secrets.mjs:167`
**Issue:** Both scripts call `execFileSync("mkdir", ["-p", extractDir], { stdio: "ignore" })`. On Windows under `cmd.exe`, `mkdir` is a built-in that does not accept the `-p` flag — `execFileSync` will fail with `ENOENT` or `Error: spawn mkdir ENOENT` depending on PATH, and the prepublishOnly chain will abort. The same applies to `execFileSync("tar", ["-xzf", ...])` — Windows 10+ ships `tar.exe`, but the gzip handling is OS-dependent and `-z` may not be honoured on older Windows builds.

These gates run on every `npm publish` invocation (see `prepublishOnly: "node scripts/check-source-of-truth.mjs && node scripts/check-tarball-no-secrets.mjs"` in `apps/achilles-cli/package.json:27`). If the release matrix ever ships from a Windows runner — or if the operator publishes from their Windows workstation — the publish silently fails before npm even uploads, with a confusing error pointing at `mkdir` rather than the underlying portability bug.

**Fix:** Replace the shell-out with Node's stdlib `mkdirSync`:
```javascript
import { mkdirSync } from "node:fs";
// ...
mkdirSync(extractDir, { recursive: true });
```
For `tar`, prefer the Node-native solution: either ship `tar` (npm package, already used by npm internals) as a devDependency and use `tar.x()`, or document that the prepublishOnly gate is Linux/macOS-only and gate the script on `process.platform !== "win32"` with a stderr remediation pointing the operator at a POSIX-shell environment.

## Warnings

### WR-01: install-skill has a TOCTOU race between `lstatSync` and `symlinkSync` on concurrent invocations

**File:** `apps/achilles-cli/src/skill-symlink.ts:210-247`
**Issue:** The function probes `lstatSync(destination)` to decide whether the destination exists, then later calls `fs.symlinkSync` (or `cpSync` on the Windows fallback). If a user runs `achilles install-skill` twice concurrently (or a Claude Code skill discovery scan races with the second invocation), the lstatSync of invocation A may report ENOENT, A proceeds to symlinkSync, and meanwhile invocation B's lstatSync sees the in-flight symlink and routes through the conflict-detection path with `force=false`, throwing `ExistingDestinationConflictError`. Worse: both invocations may attempt `rmSync` then `symlinkSync` concurrently on force=true, leading to an `EEXIST` thrown from B's symlinkSync after A finished.

The plan calls out concurrency as a review priority (#8) but the implementation has no lock file, no atomic rename, and no retry-on-EEXIST.

**Fix:** Either add a lockfile under `~/.claude/skills/.achilles-install.lock` (use `fs.openSync(lockPath, "wx")` to get atomic-create-or-fail semantics) or wrap the symlinkSync in a retry loop that catches EEXIST and re-runs the idempotency check. Recommended:
```typescript
try {
  fs.symlinkSync(source, destination, "dir");
} catch (err) {
  const code = getErrorCode(err);
  if (code === "EEXIST") {
    // Re-probe: another invocation may have already linked the same target.
    const currentTarget = resolve(fs.readlinkSync(destination));
    if (currentTarget === resolve(source)) {
      return { mode: "already-installed" };
    }
  }
  // ... existing Windows fallback + SymlinkNotPermittedError logic
}
```

### WR-02: init.ts swallows non-ElectronBinaryMissingError errors and rethrows, causing unhandled rejection

**File:** `apps/achilles-cli/src/commands/init.ts:114-131`
**Issue:** When `locate()` throws something OTHER than `ElectronBinaryMissingError` (e.g., `Error("Unsupported platform: aix")` from `electron-binary-locator.ts:120`), the function rethrows: `throw err;`. But `initCommand` is invoked from `cli.ts:258-270` via the commander action callback, which has no top-level try/catch wrapper for thrown errors during the synchronous body. The user on an unsupported platform (Solaris, AIX, FreeBSD) sees an unhandled exception stack trace rather than the clean "Unsupported platform: ..." message, and the exit code is 1 from Node's uncaught-exception handler — but only because Node defaults that way. Code paths that ought to be `processExitImpl(1)` are leaking through.

Same pattern in `launch.ts:127`.

**Fix:** Handle the broader error class with a generic stderr write:
```typescript
} catch (err) {
  if (err instanceof ElectronBinaryMissingError) {
    stderr.write(`[achilles] Electron binary not found for the init wizard.\n`);
    stderr.write(`[achilles] ${err.message}\n`);
    stderr.write(`[achilles] Run \`npm install -g achilles\` to repair the install.\n`);
    processExitImpl(1);
    return;
  }
  // Unsupported platform or other locator error — surface message + exit cleanly.
  const detail = err instanceof Error ? err.message : String(err);
  stderr.write(`[achilles] init failed: ${detail}\n`);
  processExitImpl(1);
  return;
}
```

### WR-03: The `subscribe`/`send` preload helpers silently swallow validation errors, hiding contract violations from the user

**File:** `apps/achilles/src/preload/index.ts:53-66, 68-77`
**Issue:** Both functions catch all errors from `parseEnvelope` and drop them without surfacing anything. If the InitWizard ever sends a payload that fails the strict Zod schema (e.g., an empty key string because the user typed and then deleted before the disabled-state guard caught up, or a payload-shape regression), the IPC send is silently no-op'd. The user clicks Next, nothing happens, no error visible, and the inline form-state machine keeps the disabled state. The renderer has no path to discover that its payload was rejected at the trust boundary.

This is defence-in-depth done right at the security layer, but it actively harms diagnostics — a malformed payload from a bug in the renderer disappears into the void.

**Fix:** At minimum, log to console.error in the preload (the renderer's DevTools picks it up):
```typescript
function send(channel: string, payload: unknown): void {
  try {
    const parsed = parseEnvelope(channel, payload);
    ipcRenderer.send(channel, parsed);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[achilles-preload] dropped malformed payload for channel ${channel}: ${(err as Error).message}`,
    );
  }
}
```
Same for `subscribe`. This preserves the security guarantee (the payload never crosses the boundary) while making bugs debuggable.

### WR-04: SKILL.md ships at 1360 words, exceeding the spec's 1250-word budget

**File:** `packages/achilles-skill/skill/SKILL.md`
**Issue:** The review context (`CONTEXT.md`) and the SKILL.md frontmatter both reference a "1250 words" budget. Actual `wc -w` is 1360 — 8.8% over the target. Claude Code's skill-discovery cost model is sensitive to skill body length; an over-budget skill increases the per-session prompt overhead for every Achilles user. The budget is also referenced in `13-04-PLAN.md` as a target so a future maintainer is likely to flag this.

**Fix:** Trim approximately 110 words. Candidates: the "When the run fails" section duplicates content already in `prompts/companion.md`; the "Privacy" section quotes contract names (SAFE-01, SAFE-03) but the user-facing skill body need not. Alternatively, accept the over-budget body and update the spec to 1400 words.

### WR-05: `check-source-of-truth.mjs` does not clean up tmpdir on the rejected-promise path inside `runSourceOfTruthCheck`

**File:** `apps/achilles-cli/scripts/check-source-of-truth.mjs:166-184`
**Issue:** When `fs.readFile(sourcePaths.source)` throws (line 169-176), `processExitImpl(1)` is called and the function returns. But the production wiring's `processExitImpl` closure on line 246 has `if (tmpToClean) rmSync(...)`, so on the explicit-fail path the tmp directory IS cleaned. However, the path on line 251-256 (the outer catch in production wiring) only cleans tmp if it was assigned before the catch — but if `defaultVersions()` (line 236) throws (e.g., the source `apps/achilles/package.json` is missing during a botched workspace setup), `tmpToClean` is still null and `realTarballPathProducer()` may have leaked a tmpdir on its own catch path before throwing back. Actually `realTarballPathProducer` does `rmSync` on its inner catch (line 131), so this is fine; but if the body succeeds in producing the tmpdir, returns it, then the next line throws — there's a narrow window where `tmpToClean` is still null but a tmpdir exists.

The leak is bounded by the test harness — in production the tmpdir name pattern (`achilles-sot-*`) is matchable for periodic OS-level cleanup — so this is a `Warning`, not a `Critical`.

**Fix:** Restructure the production wiring at line 232-257 to use try/finally with the tmpdir assigned eagerly:
```javascript
if (invokedAsScript) {
  let tmpToClean = null;
  try {
    const sourcePaths = defaultSourcePaths();
    const versions = defaultVersions();
    const { tarballPaths, tmpdir: tmp } = realTarballPathProducer();
    tmpToClean = tmp;
    // ... runSourceOfTruthCheck ...
  } finally {
    if (tmpToClean) rmSync(tmpToClean, { recursive: true, force: true });
  }
}
```
Remove the duplicate `rmSync` calls inside `processExitImpl` and the inner catch.

### WR-06: The `setTimeoutImpl` seam in `init-wizard.ts` returns `unknown` and is cast incorrectly when production code path runs

**File:** `apps/achilles/src/main/init-wizard.ts:245-252`
**Issue:** The fallback for `setTimeoutImpl` is:
```typescript
const setT =
  deps.setTimeoutImpl ??
  ((cb: () => void, ms: number) =>
    setTimeout(cb, ms) as unknown);
```
The `as unknown` cast is unnecessary and obscures the fact that the global `setTimeout` returns `NodeJS.Timeout` in Node 22 (the engines target). The `clearT` fallback then does `clearTimeout(token as ReturnType<typeof setTimeout>)`. This works, but the runtime never validates that `token` matches the timer ID type — if a future refactor changes the `setTimeoutImpl` signature to return a string, the cast would silently break.

This is `info` rather than `warning` if you stop here, but the production path's `setTimeoutImpl` never sees the test seam; the test seam uses synthetic numeric IDs while production uses Node's timer objects. There is no path-level guarantee that the same token shape flows.

**Fix:** Tighten the seam type:
```typescript
setTimeoutImpl?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
clearTimeoutImpl?: (token: ReturnType<typeof setTimeout>) => void;
```
Then the production fallback drops the `as unknown` cast.

### WR-07: `init.ts` does not validate that the spawned child actually started before registering the exit listener

**File:** `apps/achilles-cli/src/commands/init.ts:142-156`
**Issue:** If `spawn(binaryPath, [], opts)` throws synchronously (which it does on Node when the binary is non-executable or the path resolves to a directory), the resulting throw is uncaught — there's no try/catch around the spawn call. The exit listener on line 153-155 is never registered, but `processExitImpl` is also never called, so the user gets an uncaught exception and a process termination with code 1 (Node default) but no `[achilles]` line explaining what failed.

`launch.ts:129-134` has the same shape.

**Fix:**
```typescript
let child: AttachedChild;
try {
  child = spawn(binaryPath, [], {
    detached: false,
    stdio: "inherit",
    env: childEnv,
  });
} catch (err) {
  const detail = err instanceof Error ? err.message : String(err);
  stderr.write(`[achilles] failed to spawn Electron binary at ${binaryPath}: ${detail}\n`);
  processExitImpl(1);
  return;
}
child.on("exit", (code: number | null) => {
  processExitImpl(code ?? 1);
});
```

### WR-08: `electron-binary-locator.ts` uses POSIX path joining unconditionally and the resulting path on Windows mixes separators

**File:** `apps/achilles-cli/src/electron-binary-locator.ts:40, 138`
**Issue:** The module imports `join` from `node:path/posix` and uses it for every platform. The module header acknowledges this and claims "modern Windows (Win10+) `fs.existsSync` accepts forward slashes in absolute paths transparently". This is true for `existsSync` and `spawn`, BUT the resulting binary path is then passed verbatim to `nodeSpawn` in `cli.ts:247`. On Windows, `spawn` does forward the path through CreateProcess, which accepts forward slashes — so the runtime works. However, mixed-separator paths can confuse error messages (the `ElectronBinaryMissingError` displays `/pkg/dist/Achilles.exe` to a Windows user, who expects `\` not `/`).

This is cosmetic on Windows but worth flagging as a UX inconsistency. The header explicitly chose this for testability against the L2 test fixture (`pkgRoot: "/pkg"`) so the fix has a tradeoff.

**Fix:** Use platform-native `path.join` in production and `posix.join` only in tests, OR document the forward-slash-on-Windows path in the user-facing error message as expected. Lower priority than the other warnings.

### WR-09: `init-wizard.ts` log function silently routes through `console.error` even though there is project-wide guidance against console.log/error

**File:** `apps/achilles/src/main/init-wizard.ts:253-258`
**Issue:** The default `logger` is:
```typescript
const log =
  deps.logger ??
  ((msg: string): void => {
    // eslint-disable-next-line no-console
    console.error(msg);
  });
```
The `eslint-disable-next-line no-console` suppression confirms there's a project rule. Several callsites then log "[achilles] init wizard: api key persisted" etc — these claims are FALSE in the rejection branch and the warning branch (the bytes were written to safeStorage but the log line says "persisted (warning: unexpected-prefix)" only in one branch). The bigger concern: the comment in the file header says "NO console.log" but the default fallback IS console.error. This is consistent with the disable-line comment, but the contradiction in the module-level docstring is misleading for future maintainers.

**Fix:** Either remove the inline disable and require the caller to provide a logger seam in production (forcing `bootstrap()` to pass `console.error`), or update the docstring to acknowledge that the default fallback uses console.error. The cleaner long-term fix is the former — production should pass an explicit logger so the dependency surface is honest.

## Info

### IN-01: Cleanup the `(ipcMain as never as { on(channel: string, ...) }).on(...)` casts in `main/index.ts`

**File:** `apps/achilles/src/main/index.ts:218-243`
**Issue:** Six repeated casts of the form `(ipcMain as never as { on/removeAllListeners(channel: string): ... }).removeAllListeners(...)` indicate a missing type for `ipcMain` somewhere upstream. The pattern is verbose and error-prone (a typo in any of the channel strings would silently fail to bind the listener). The `removeAllListeners` calls would also remove ANY listener for that channel — including ones registered later by Plan 11/12 if they ever share a channel (none do today, but the safety of `off(channel, listener)` with the specific listener handle is preferred over `removeAllListeners`).

**Fix:** Type the ipcMain reference explicitly:
```typescript
const ipcMainTyped = ipcMain as {
  on(channel: string, listener: (evt: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (evt: unknown, payload: unknown) => void): void;
};
ipcMainTyped.on(IPC_INIT_API_KEY_SUBMIT, onApiKeySubmit);
// ...
app.on("will-quit", () => {
  ipcMainTyped.off(IPC_INIT_API_KEY_SUBMIT, onApiKeySubmit);
  // ...
});
```

### IN-02: The `WritableSeam` interface is duplicated across `cli.ts`, `launch.ts`, `install-skill.ts`, `init.ts`, `transcripts.ts`

**File:** Multiple files in `apps/achilles-cli/src/`
**Issue:** Five files declare an identical `interface WritableSeam { write(chunk: string): boolean; }`. The intent is documented in each file's header ("Captured here so the test seam can be a plain `{ write }` object without pulling in node:stream types"), so this is deliberate, but the duplication still increases the surface area for drift if the seam ever needs a `flush()` or `end()` method.

**Fix:** Hoist to a single `apps/achilles-cli/src/seams.ts` file and re-export from each command module. Or accept the duplication as intentional decoupling. Either is defensible.

### IN-03: `transcripts.ts` exit code 2 for unknown subcommand is undocumented in the user-facing message

**File:** `apps/achilles-cli/src/commands/transcripts.ts:65-68`
**Issue:** The unknown-subcommand branch writes "[achilles] Unknown subcommand: X. Supported: purge." to stdout and exits with code 2. The exit code is "commander's misuse code" per the file header, but a user troubleshooting via shell `$?` will see `2` with no in-message reference to "exit code 2 means usage error". A scripting consumer can't distinguish between a transient failure and a usage error from the stdout content alone.

**Fix:** Either drop the code-2 convention (use 1 like everywhere else in the CLI) or extend the message: "[achilles] Unknown subcommand: X (exit code 2 = usage). Supported: purge."

### IN-04: The `MOCK_LOOP=1` smoke test path always returns `{ status: 'ok' }` regardless of the renderer's audio state

**File:** `apps/achilles/src/main/index.ts:142-173`
**Issue:** The mock loop creates mock STT, Claude, and TTS clients, chains them together, and returns success. There is no verification that the renderer's audio pipeline actually played the TTS chunks — the comment on line 146 explicitly says "the mock TTS chunks are not played back here (the renderer owns the audio surface); the success criterion is that the mocks chain together without throwing." This is fine for a unit-test grade smoke check, but the user sees "You should now hear: Hello from Achilles, I am ready to help." in the wizard UI and hears nothing. Mocked is mocked, but the UI promises an audible event that doesn't happen.

**Fix:** Update the wizard copy in `InitWizard.tsx:67-68` to differentiate the mock case: "Smoke test mode (no audio played). The full audio path is verified on first launch." Or only set the OK status path's `spokenPhrase` to a value that the renderer interprets as "skip the 'you should now hear' framing".

### IN-05: `SKILL.md` description field carries 215 words of frontmatter prose

**File:** `packages/achilles-skill/skill/SKILL.md:3`
**Issue:** Claude Code skill discovery loads the `description` frontmatter into every per-session prompt that may invoke the skill. The current description carries narrative ("Achilles captures microphone audio, transcribes it through ElevenLabs STT, hands the transcript to Claude Code, and reads short spoken summaries back through ElevenLabs TTS. The launch is non-blocking. The achilles CLI must be installed first via npm install -g achilles..."). The description is a SKILL discovery surface, not a user manual — the body of the SKILL.md covers the prerequisites.

**Fix:** Trim the frontmatter description to ~50 words: "Voice companion for Claude Code. Triggered when the developer asks to talk or use voice. Launches the locally installed Achilles Electron app via `achilles launch`. Requires `npm install -g achilles` and an ElevenLabs API key (via `achilles init` or `ELEVENLABS_API_KEY`)."

### IN-06: `electron-builder.json` does not list build/Info.plist.fragment in any consumed-files key

**File:** `apps/achilles/build/Info.plist.fragment` (consumed nowhere) + `apps/achilles/electron-builder.json:25-28`
**Issue:** The `Info.plist.fragment` file is a documentation mirror — the `mac.extendInfo` block in `electron-builder.json` is the actual source used at build time. The fragment is purely for human review (per the comment in the file). However, the drift-prevention test (`Info.plist.test.mjs`) does NOT assert byte-equality between the NSMicrophoneUsageDescription value in the fragment AND the value in `electron-builder.json`. The Info.plist.fragment comment block claims this drift-prevention test exists (line 7: "the drift-prevention test in electron-builder.test.mjs asserts byte equality between the NSMicrophoneUsageDescription value in this file and the matching key in electron-builder.json"), but there is no `electron-builder.test.mjs` file in the `apps/achilles/` directory; only the `entitlements.mac.test.mjs` and `Info.plist.test.mjs` exist, and neither cross-checks the two locations.

**Fix:** Either add the drift-prevention test that the comment claims exists, or remove the misleading comment. The drift test is genuinely valuable: a maintainer who updates one NSMicrophoneUsageDescription value but not the other ships a signed app whose mic prompt says one thing and whose human-review documentation says another.

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
