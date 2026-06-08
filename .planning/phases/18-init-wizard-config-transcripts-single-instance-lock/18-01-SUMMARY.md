---
phase: 18-init-wizard-config-transcripts-single-instance-lock
plan: 01
subsystem: auth
tags: [api-key, keychain, libsodium, nacl, secretbox, napi-rs, scrypt, encryption, permissions]

requires:
  - phase: 17-voice-loop-refactor-structured-logger-circuit-breaker-session
    provides: structured-logger pattern (deps injection + logger seam), circuit-breaker typed-error shape, resume-session ACHILLES_HOME constant, ESM module conventions

provides:
  - "@clack/prompts@1.5.1, @napi-rs/keyring@1.3.0, @stablelib/nacl@2.0.1 installed as exact-pinned dependencies"
  - "keychain.ts: @napi-rs/keyring wrapper with KeychainUnavailableError typed fallback"
  - "encrypted-key.ts: XSalsa20-Poly1305 secretBox/openSecretBox read/write at ~/.achilles/key.enc; 0o600 enforcement; machine-id KDF via scryptSync"
  - "api-key.ts: resolveApiKey() env->keychain->encrypted-file resolver + writeApiKey() with env-read-only contract"
  - "25 unit tests across 3 test files (6 keychain + 8 encrypted-key + 11 api-key)"

affects:
  - 18-02-structured-logger-7th-regex (reads DEFAULT_REDACT_PATTERNS; now covers xi- key format)
  - 18-03-init-wizard (imports resolveApiKey + writeApiKey from api-key.ts)
  - 18-04-cli-extension (imports init subcommand which depends on wizard.ts)

tech-stack:
  added:
    - "@clack/prompts@1.5.1 (exact pin)"
    - "@napi-rs/keyring@1.3.0 (exact pin)"
    - "@stablelib/nacl@2.0.1 (exact pin; 24KB vs libsodium-wrappers-sumo 540KB -- 22x smaller)"
  patterns:
    - "deps-injection seam on every new module (homedirImpl, machineIdImpl, randomBytesImpl, keyringImpl, readKeychainImpl, readEncryptedKeyImpl)"
    - "Promise.resolve()/Promise.reject() for sync-internally-but-typed-async functions (avoids @typescript-eslint/require-await)"
    - "typed-error classes (KeychainUnavailableError, EncryptedKeyPermissionsError) for instanceof fall-through in resolver"
    - "secretBox/openSecretBox from @stablelib/nacl (NOT secretbox -- camelCase B per the actual API surface)"

key-files:
  created:
    - apps/achilles-terminal/src/init/keychain.ts (209 LOC)
    - apps/achilles-terminal/src/init/encrypted-key.ts (333 LOC)
    - apps/achilles-terminal/src/init/api-key.ts (270 LOC)
    - apps/achilles-terminal/tests/init/keychain.test.ts
    - apps/achilles-terminal/tests/init/encrypted-key.test.ts
    - apps/achilles-terminal/tests/init/api-key.test.ts
  modified:
    - apps/achilles-terminal/package.json (three new exact-pinned deps)

key-decisions:
  - "@stablelib/nacl chosen over libsodium-wrappers-sumo: 24KB vs 540KB unpacked; same XSalsa20-Poly1305 wire format; five small @stablelib/* subdependencies"
  - "secretBox/openSecretBox function names (camelCase B) -- the actual @stablelib/nacl 2.0.1 API exports; not secretbox.open as NaCl convention docs imply"
  - "writeEncryptedKey and readEncryptedKey are not declared async -- they use synchronous fs APIs internally and return Promise.resolve()/reject() to satisfy the async interface contract without triggering @typescript-eslint/require-await"
  - "KeychainUnavailableError catches only the keyring rejection; any other thrown error re-throws (T-18-04: real bugs not masked)"
  - "EncryptedKeyPermissionsError fall-through returns source=missing (not an error from resolveApiKey's perspective); Plan 03 wizard reads the .mode field for diagnostic display"

patterns-established:
  - "deps-injection seam: every Phase 18 init module accepts an optional deps object; production defaults are all in-module; tests inject everything"
  - "typed-error instanceof fall-through: resolver catches ONLY the typed errors it knows about; unknown errors propagate"
  - "SAFE-01 logger contract: logger seam receives source enum + keyLength only; key bytes are never passed to any logger"

requirements-completed: [INIT-02, SAFE-01]

duration: 45min
completed: 2026-06-08
---

# Phase 18 Plan 01: API Key Foundation (keychain + encrypted-file + resolver) Summary

**Three-tier API key resolver (env->keychain->encrypted-file) with XSalsa20-Poly1305 secretbox at 0o600-enforced ~/.achilles/key.enc; machine-id scrypt KDF; KeychainUnavailableError + EncryptedKeyPermissionsError typed fall-throughs; 25 passing unit tests**

## Performance

- **Duration:** ~45 min (Tasks 3+4 execution; Tasks 1+2 retroactively documented from prior session)
- **Started:** 2026-06-08T13:05:00Z
- **Completed:** 2026-06-08T13:14:00Z
- **Tasks:** 4 (Tasks 1+2 from prior session; Tasks 3+4 this session)
- **Files modified:** 7 (3 source + 3 tests + package.json)

## Accomplishments

- Three exact-pinned Phase 18 Wave 0 dependencies installed: @clack/prompts@1.5.1, @napi-rs/keyring@1.3.0, @stablelib/nacl@2.0.1 (the lighter libsodium alternative at 22x smaller footprint)
- keychain.ts wraps @napi-rs/keyring with KeychainUnavailableError typed fallback for Linux-without-libsecret; hermetic via keyringImpl deps seam
- encrypted-key.ts implements XSalsa20-Poly1305 (NaCl secretBox/openSecretBox via @stablelib/nacl); on-disk format is base64(nonce_24 || ciphertext); 0o600 enforced via explicit chmodSync after write AND verified by statSync before read; machine-id KDF via scryptSync(machineId, salt, 32); EncryptedKeyPermissionsError with .mode field on perms violation; tamper -> null (fail closed)
- api-key.ts implements the three-tier resolver per INIT-02; writeApiKey enforces the env-read-only contract; logger seam receives only source+keyLength, never the key bytes (SAFE-01)
- 25 unit tests across the three test files: 6 keychain + 8 encrypted-key + 11 api-key

## Task Commits

Each task was committed atomically with TDD RED -> GREEN gates:

1. **Task 1: Install Wave 0 dependencies** - committed in prior session (9a107209 + 5b9b6ab9)
2. **Task 2: keychain.ts wrapper** - committed in prior session (9a107209 + 5b9b6ab9)
3. **Task 3: encrypted-key.ts (RED test)** - `d9be1105` (test)
4. **Task 3: encrypted-key.ts (GREEN impl)** - `a7b084c4` (feat)
5. **Task 4: api-key.ts (RED test)** - `f4721d83` (test)
6. **Task 4: api-key.ts (GREEN impl)** - `8d719e0f` (feat)

## Files Created/Modified

- `apps/achilles-terminal/package.json` - Three new exact-pinned dependencies: @clack/prompts@1.5.1, @napi-rs/keyring@1.3.0, @stablelib/nacl@2.0.1
- `apps/achilles-terminal/src/init/keychain.ts` (209 LOC) - @napi-rs/keyring wrapper; KeychainUnavailableError; readKeychain/writeKeychain with keyringImpl injection seam
- `apps/achilles-terminal/src/init/encrypted-key.ts` (333 LOC) - XSalsa20-Poly1305 via @stablelib/nacl secretBox/openSecretBox; 0o600 perms enforcement; machine-id KDF; EncryptedKeyPermissionsError; homedirImpl/randomBytesImpl/machineIdImpl injection seams
- `apps/achilles-terminal/src/init/api-key.ts` (270 LOC) - Three-tier resolver; typed fall-through; writeApiKey with env-read-only contract; logger seam (metadata only, never key bytes)
- `apps/achilles-terminal/tests/init/keychain.test.ts` - 6 tests (happy path, null entry, unavailable error, write path, write error, instanceof check)
- `apps/achilles-terminal/tests/init/encrypted-key.test.ts` - 8 tests (round-trip, null on absent, 0o644 perms error, .mode field, 0o700 dir creation, tamper->null, nonce prefix format, nonce randomness)
- `apps/achilles-terminal/tests/init/api-key.test.ts` - 11 tests (env win, empty-env fall-through, keychain win, encrypted-file win, missing, KeychainUnavailableError fall-through, EncryptedKeyPermissionsError fall-through, logger contract, writeApiKey keychain/encrypted-file/empty-key rejection)

## Decisions Made

- **@stablelib/nacl over libsodium-wrappers-sumo:** 24KB vs 540KB unpacked (22x smaller); same XSalsa20-Poly1305 wire format and security properties; five small @stablelib/* subdeps (poly1305, random, wipe, x25519, xsalsa20) each a few KB. Matters for DIST-05 cold-start budget in Bun-compiled binary.
- **secretBox/openSecretBox naming:** The @stablelib/nacl 2.0.1 package exports `secretBox` (camelCase B) and `openSecretBox` -- NOT `secretbox` as some NaCl convention docs imply. This was discovered at GREEN phase when tests failed with "secretbox is not a function". Fixed by reading the actual source files.
- **Non-async function bodies with Promise return:** writeEncryptedKey and readEncryptedKey use synchronous fs APIs internally. Using `async` triggered @typescript-eslint/require-await. Solution: remove `async` keyword, return `Promise.resolve(value)` or `Promise.reject(error)` explicitly to maintain the async interface contract.
- **Machine-id KDF input chain:** Raw machine id -> SHA-256 hash -> scrypt password. The raw platform fingerprint (ioreg UUID, /etc/machine-id) never reaches scrypt directly -- it is hashed first so the platform fingerprint is not recoverable from the derived key alone.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @stablelib/nacl API name correction (secretBox vs secretbox)**
- **Found during:** Task 3 (GREEN phase -- first test run)
- **Issue:** Plan specified `import { secretbox } from "@stablelib/nacl"` and usage as `secretbox(key, nonce, data)` / `secretbox.open(key, nonce, box)`. The actual @stablelib/nacl 2.0.1 export names are `secretBox` and `openSecretBox` (camelCase B, separate functions). Tests immediately failed with "secretbox is not a function".
- **Fix:** Corrected import to `import { secretBox, openSecretBox } from "@stablelib/nacl"` and updated all call sites accordingly. Also updated docblock and acceptance-criteria grep patterns to reflect the actual API.
- **Files modified:** apps/achilles-terminal/src/init/encrypted-key.ts
- **Verification:** All 8 encrypted-key tests pass; secretBox/openSecretBox grep confirms 2 call sites present
- **Committed in:** a7b084c4

**2. [Rule 1 - Bug] @typescript-eslint/require-await lint error on sync-bodied async functions**
- **Found during:** Task 3 (lint check post-GREEN)
- **Issue:** writeEncryptedKey and readEncryptedKey declared as `async function` but contain only synchronous fs operations. @typescript-eslint/require-await fires with exit 1.
- **Fix:** Removed `async` keyword from both function declarations; added explicit `return Promise.resolve()` / `return Promise.resolve(value)` / `return Promise.reject(error)` statements to maintain the async interface contract. Identical effective behavior; linter satisfied.
- **Files modified:** apps/achilles-terminal/src/init/encrypted-key.ts
- **Verification:** `npx eslint src/init/encrypted-key.ts tests/init/encrypted-key.test.ts` exits 0
- **Committed in:** a7b084c4

**3. [Rule 1 - Bug] Unused mkdirSync import in encrypted-key.test.ts**
- **Found during:** Task 3 (lint check)
- **Issue:** mkdirSync was imported from "node:fs" in the test file but not used (the test verifies directory creation via statSync, not by calling mkdirSync itself).
- **Fix:** Removed mkdirSync from the import list.
- **Files modified:** apps/achilles-terminal/tests/init/encrypted-key.test.ts
- **Verification:** `npx eslint tests/init/encrypted-key.test.ts` exits 0
- **Committed in:** a7b084c4

**4. [Rule 1 - Bug] TypeScript TS2532 on Buffer index access in encrypted-key.test.ts**
- **Found during:** Task 3 (typecheck run)
- **Issue:** `raw[25] = raw[25] ^ 0xff` -- TypeScript reports TS2532 "Object is possibly 'undefined'" because Buffer/Uint8Array indexed access returns `number | undefined` in strict mode.
- **Fix:** Added non-null assertion `raw[25]!` with an eslint-disable comment for the specific line.
- **Files modified:** apps/achilles-terminal/tests/init/encrypted-key.test.ts
- **Verification:** `npm run typecheck 2>&1 | grep encrypted-key` returns nothing (zero errors in new files)
- **Committed in:** 8d719e0f (bundled with api-key GREEN)

---

**Total deviations:** 4 auto-fixed (4x Rule 1 bugs)
**Impact on plan:** All four fixes were necessary for lint-clean, typecheck-clean, correctly-functioning implementation. No scope creep. The secretBox naming correction is a genuine API discovery (plan had wrong function name from convention docs vs actual package); the others are standard TypeScript strictness / ESLint fixes.

## Issues Encountered

- The @stablelib/nacl package is installed at the repo-root node_modules (not the workspace-local node_modules) due to npm workspaces hoisting. vitest resolves it correctly via node module resolution. No action needed.
- Pre-existing typecheck errors in blob.test.tsx, status-row.test.tsx, and src/session.ts (Chalk ChalkInstance / ink module resolution) are Phase 17 deferred debt unrelated to Plan 01 work. Confirmed by git diff showing these files are unchanged.

## Verification Results

All acceptance criteria confirmed:

- 25 tests pass: `npx vitest run tests/init/ --pool=forks` -> 3 test files, 25 tests, 0 failures
- Zero new lint errors: `npx eslint src/init/encrypted-key.ts tests/init/encrypted-key.test.ts src/init/api-key.ts tests/init/api-key.test.ts` -> no output (exit 0)
- Zero typecheck errors in new files: `npm run typecheck 2>&1 | grep -E "encrypted-key|api-key|keychain"` -> empty
- SAFE-01: `grep -v '^ \*' src/init/api-key.ts src/init/encrypted-key.ts | grep "console\."` -> 0 (docblock comments only)
- 0o600 perms: `grep -E "chmodSync.*0o600" src/init/encrypted-key.ts | wc -l` -> 4
- 0o700 dir: `grep -E "0o700" src/init/encrypted-key.ts | wc -l` -> 4
- @stablelib/nacl import: `grep -E 'from "@stablelib/nacl"' src/init/encrypted-key.ts | wc -l` -> 1
- Three dep pins: `grep -c "@stablelib/nacl\|@napi-rs/keyring\|@clack/prompts" apps/achilles-terminal/package.json` -> 3
- D-15-01 honored: `grep '"achilles-terminal"' package.json` present (name unchanged)
- INIT-07 unaffected: cli.ts not in `git diff 5b9b6ab9 --name-only`
- LOOP-02 unaffected: no voice-*, claude-code-bridge, or companion.md in changed files

## User Setup Required

None - no external service configuration required. All new modules use local OS keychain / local filesystem only.

## Next Phase Readiness

- Plan 02 (structured-logger 7th regex): can add the xi_ regex to DEFAULT_REDACT_PATTERNS; resolveApiKey's logger seam is already the correct consumer
- Plan 03 (init wizard): imports resolveApiKey, writeApiKey from src/init/api-key.js; both are exported and tested
- Plan 04 (cli.ts extension): adds init subcommand via dynamic import; api-key.ts is the stable interface
- No blockers for Wave 2 work

## Known Stubs

None - all exported functions have real implementations. The deps injection seams are for testing only; production paths use real OS keychain, real @stablelib/nacl crypto, and real ~/.achilles filesystem.

---
*Phase: 18-init-wizard-config-transcripts-single-instance-lock*
*Completed: 2026-06-08*
