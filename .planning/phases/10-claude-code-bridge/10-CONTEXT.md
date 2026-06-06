# Phase 10: Claude Code Bridge - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (auto-optimized) — phase classified as infrastructure-only

<domain>
## Phase Boundary

Delivers one new package — `@achilles/claude-code-bridge` — that wraps Anthropic Claude Code as a controllable child process for Achilles. Exposes a single primary API:

```ts
createClaudeSession({ systemPromptFile, resumeSessionId? }): {
  send(text: string): void
  events$: AsyncIterable<ClaudeBridgeEvent>
  cancel(): Promise<void>  // sends SIGINT, drains events$
  close(): Promise<void>
  sessionId: string | null  // populated from first session_init event
}
```

The bridge spawns `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <companion.md> --resume <sid>`, reads the streaming NDJSON stdout, parses each line, normalises into typed `ClaudeBridgeEvent` union members, and emits them on `events$`. The bridge owns:

- LDJSON line buffer with a watchdog (per-line cap to prevent unbounded memory growth on malformed streams)
- Authoritative success/failure signal derived from process exit code + `tool_result` events (NOT from LLM narration — pitfall #17)
- Spoken-acknowledgement and `<spoken-summary>` extractor scaffolding (the prompt that drives those markers ships in Phase 12; this phase ships the extractor pattern that finds them in `assistant_text_delta` events)
- Session-resume primitive (persist session_id from `session_init`; pass on subsequent `--resume`)
- Cancellation primitive (SIGINT to child + best-effort fast-exit; pitfall #10 re-utterance race owner)
- Claude Code version check on spawn (`claude --version`) with minimum-version constant (pitfall #24)

Out of scope for Phase 10:
- Embedded companion system prompt itself (Phase 12 — prompt + extractor are co-designed)
- Half-duplex turn-taking against TTS playback (Phase 12)
- Sandwich-defence transcript wrapping (Phase 12)
- Pre-TTS string normalisation (Phase 12)
- Voice clients (Phase 09 — already shipped)
- Electron app / UI (Phase 11)
- Skill body / npm CLI / installers (Phase 13)
- Stuck-thinking timeout, suspend/resume (Phase 14)

</domain>

<decisions>
## Implementation Decisions

### Locked by REQUIREMENTS.md (do not reopen)
- Claude Code integration default: Subprocess `claude -p --output-format stream-json` is the spine. NOT the Agent SDK. NOT MCP. NOT hooks.
- Local Claude Code only in v1.2 (cloud routing deferred to v1.3)
- Subprocess flags locked: `claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <path> --resume <sid>`

### Package layout
- Name: `@achilles/claude-code-bridge`
- Location: `packages/claude-code-bridge`
- Follows the same skeleton as `packages/voice-protocol` (mirror its `package.json` shape, ESM, `tsconfig.json` extending `tsconfig.base.json`, `outDir: "dist"`, `rootDir: "src"`, exclude `**/*.test.ts` from build per the Phase 09 fix CR-06)
- Exports a single barrel `src/index.ts`. No multi-subpath exports needed in v1.2

### Process control
- Uses Node `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']` — NOT a PTY. The `-p` flag is non-interactive, so pipes are correct and avoid the Ink stdin-newline gotcha (pitfall #7, anthropics/claude-code#15553)
- The transcript text is passed via the `--prompt` argument equivalent / the prompt body for `claude -p`. The actual mechanism: `claude -p "<prompt text>"` accepts the prompt as a positional argument. Verify in Phase 10 research-by-execution; if not, alternative is to pipe the prompt body to stdin and immediately close stdin to signal end-of-input for `-p` mode. The bridge accepts a string and chooses the mechanism that the installed Claude version supports.
- Child working directory: inherits from parent (Achilles main process cwd)
- Environment: inherits from parent; allow caller to merge additional env vars via options
- Process kill: `SIGINT` first, after 1 s grace `SIGTERM`, after 2 s `SIGKILL` (defensive)

### NDJSON parsing
- Line buffer is a simple `Buffer` accumulator, split on `\n`, with a `MAX_LINE_BYTES = 1_048_576` (1 MiB) cap. Lines exceeding the cap emit a `parse_error` event and the bridge discards the buffer up to the next `\n`
- Each parsed line is validated against a Zod schema union (`ClaudeStreamEventSchema`) before emission
- Unknown event types emit a `unknown_event` warning but do not fatal
- Partial JSON (an incomplete last line at process exit) is tolerated: best-effort one final parse attempt, otherwise emit `parse_error` and proceed to close

### Event shapes (typed unions)
- `session_init` — `{ type: "session_init", session_id: string, model: string, claude_code_version: string }`
- `assistant_text_delta` — `{ type: "assistant_text_delta", text: string }` (these are the chunks that feed the ack + spoken-summary extractor)
- `assistant_text_done` — `{ type: "assistant_text_done", full_text: string }`
- `tool_use` — `{ type: "tool_use", id: string, name: string, input: unknown }`
- `tool_result` — `{ type: "tool_result", tool_use_id: string, content: string, is_error?: boolean }`
- `permission_request` — `{ type: "permission_request", id: string, action: string, ... }` (Achilles auto-decline in v1.2 — return a `denied` permission_response and emit `permission_denied`)
- `assistant_done` — `{ type: "assistant_done" }`
- `parse_error` — `{ type: "parse_error", error: string, raw_line?: string }`
- `unknown_event` — `{ type: "unknown_event", raw: unknown }`
- `process_exit` — `{ type: "process_exit", exit_code: number | null, signal: string | null }`

Note: these are Achilles-side names. Map from Claude Code's actual stream-json field names in the bridge. The bridge's job is to normalise the wire format into Achilles' stable event vocabulary.

### Ack + spoken-summary extractor
- The extractor lives in `src/extractor.ts` and exposes:
  - `extractAck(streamText: string): string | null` — returns the first sentence emitted by the assistant up to the first sentence terminator, capped at 120 chars (corresponds to the <=12-word ack contract from PROMPT-02; v1.2 ships the extractor pattern even though the prompt itself ships in Phase 12)
  - `extractSpokenSummary(streamText: string): string | null` — finds `<spoken-summary>...</spoken-summary>` markers and returns the inner text; null if not present
- The extractor is a pure function over accumulated text; it does NOT call ElevenLabs. Wiring to TTS happens in Phase 12.
- The bridge accumulates `assistant_text_delta.text` into a per-turn buffer and exposes it as `lastTurnText` on the bridge instance so Phase 12 can pull it without re-parsing

### Authoritative success/failure (pitfall #17)
- `bridge.outcome` (after `assistant_done` or `process_exit`) returns:
  - `success` when exit_code is 0 AND no `tool_result.is_error === true` was observed in this turn
  - `failure` otherwise; failure event carries `{ reason: "exit_code" | "tool_error", details: ... }`
- This is the source of truth Phase 12 uses to decide which spoken completion to play (honest "I ran into a problem" override per PROMPT-05)
- The bridge MUST NOT trust the LLM's narration to determine success

### Cancellation (pitfall #10 — re-utterance race)
- `cancel()` is idempotent
- Sends `SIGINT` to child; after 1 s sends `SIGTERM`; after 2 s sends `SIGKILL`
- Waits for `process_exit` event before resolving
- All buffered stdout that arrives after cancel() but before process_exit is parsed and emitted (so listeners see what Claude wrote up to the interruption point)

### Version check (pitfall #24)
- On `createClaudeSession`, before spawning the streaming child, run `claude --version` synchronously (or via a quick spawn with timeout)
- Compare against `MIN_CLAUDE_VERSION = "2.0.0"` constant (pinned in `constants.ts`)
- If lower, throw a typed `ClaudeVersionError` with the actual version, the required version, and an install-or-upgrade hint
- Skip the check if env var `ACHILLES_SKIP_CLAUDE_VERSION_CHECK=1` is set (for testing)

### Testing strategy (no live Claude calls)
- Vitest 2.1.8 (already in devDependencies)
- Golden NDJSON fixtures: `packages/claude-code-bridge/test/fixtures/`
  - `simple-turn.ndjson` — session_init + a few assistant_text_deltas + assistant_text_done + assistant_done + process_exit (success)
  - `tool-error.ndjson` — session_init + tool_use + tool_result(is_error=true) + assistant_text_delta + assistant_done + process_exit (failure)
  - `partial-json.ndjson` — a line split across two read events
  - `cancel-mid-stream.ndjson` — session_init + partial assistant_text + SIGINT-induced abrupt close
  - `unknown-event.ndjson` — an event type Claude added in a future version
  - `spoken-summary.ndjson` — assistant text that includes `<spoken-summary>...</spoken-summary>`
- A `MockClaudeProcess` test helper plays a fixture as if it were the child's stdout. NOT a real subprocess.
- A separate integration test (gated behind `ACHILLES_LIVE_CLAUDE=1` env var, NOT run in CI default) spawns a real `claude -p` with a deterministic prompt and asserts the event shape. Optional; CI default is fixture-driven.

### Logging
- `console.error(...)` for unrecoverable errors with stable prefix `[claude-code-bridge]`
- Never log the prompt body (could contain sensitive transcripts)
- Permit logging the assistant text length and event counts

### Build pipeline
- TypeScript NodeNext, strict, no `any`
- `outDir: "dist"`, `rootDir: "src"`, exclude `**/*.test.ts`, `test/**`
- `tsc -b` for build; no bundler
- `src/.gitignore` with the same defensive ignore pattern Phase 09 added (`*.js`, `*.d.ts`, `*.map`)

### Claude's Discretion
- Whether to use a small state machine class or a coroutine-style accumulator
- Internal event-emitter implementation (native EventEmitter, AsyncIterable adapter, or both — pick whatever is cleanest for the `events$` API)
- Whether to expose `bridge.lastTurnText` as a getter or a method
- File partitioning inside the package (single-file vs multi-file split — split when files exceed ~300 lines)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/voice-protocol/package.json` — analog shape, mirror it (`type: "module"`, exports map, `files: ["dist"]`, `publishConfig.access: "public"`, no test files in dist after CR-06)
- `packages/voice-protocol/tsconfig.json` — analog tsconfig with the Phase 09 fix already in place (exclude `**/*.test.ts`, `test/**`, explicit `rootDir`/`outDir`)
- `packages/voice-protocol/src/.gitignore` — defensive ignore against compiled-artifact pollution (CR-07 fix); the new bridge package should ship the same file
- `tsconfig.base.json` — already has `@achilles/claude-code-bridge` is NOT yet listed; Phase 10 will add it (one path + one path-with-wildcard, same shape as voice-* additions)
- `vitest.workspace.ts` — already has `phase-09-unit` project; Phase 10 will add `phase-10-unit` covering `packages/claude-code-bridge/src/**/*.test.ts`

### Established Patterns (from `.planning/codebase/CONVENTIONS.md` and Phase 09 output)
- Files: kebab-case
- Functions: camelCase, verb-first
- Types: `interface` and string-literal unions
- Exports: named only
- Error handling: catch as `unknown`, convert, throw with context
- Import order: external/`node:` first, related `import type` near runtime imports, local imports last
- Module resolution: NodeNext with `.js` import specifiers in TS source
- Tests: colocated as `*.test.ts` beside source files
- Build output: `dist/` only; never pollute `src/` (Phase 09 CR-07 defence)

### Integration Points (downstream phases)
- Phase 11 (UI Shell) does not import this package directly; the bridge is main-process only
- Phase 12 (End-to-End Integration) is the primary consumer — `apps/achilles/src/main/session.ts` will wire `createClaudeSession` next to the voice clients and the embedded prompt
- Phase 13 (Distribution) bundles this package into the npm CLI tarball
- Phase 14 (Hardening) consumes `bridge.outcome` and the parse_error/process_exit events for the stuck-thinking timeout + graceful degradation

</code_context>

<specifics>
## Specific Ideas

- The Claude Code subprocess interface (`claude -p --output-format stream-json --include-partial-messages --append-system-prompt-file <path> --resume <sid>`) is documented in the project research's STACK.md and verified against `code.claude.com/docs/en/headless`. Plans should reference STACK.md when picking flag specifics.
- `assistant_text_delta` is what `--include-partial-messages` enables. Without that flag, only `assistant_text_done` appears, which prevents streaming TTS in Phase 12.
- The `MIN_CLAUDE_VERSION` constant should be conservative — pick the lowest version known to support all the flags we use. Don't pin to a bleeding-edge version unless v1.2 features require it.
- The bridge should be designed so a future Phase 12 task can ALSO consume `bridge.lastTurnText` synchronously after `assistant_done` to extract the spoken summary even if the live stream extractor missed it (defensive double-read).

</specifics>

<deferred>
## Deferred Ideas

- Hot-swap Claude Code version mid-session — v2+
- Multi-session pool (multiple concurrent Claude children) — v2+
- Telemetry surface (event counts, latency per stage) — Phase 14 owns latency probe
- Agent SDK as alternative integration path behind a flag — v1.3 (CC-02 in REQUIREMENTS.md v2/future)
- Status-line surfacing of tool activity in the UI — v1.3 (CC-01)

</deferred>
