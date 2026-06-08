/**
 * Phase 17, Plan 03, Task 2 — claude-bridge wrapper around
 * `@achilles/claude-code-bridge.createClaudeSession`.
 *
 * Owns the orchestration spine for LOOP-01 (claude half) + LOOP-03 (TTS
 * routes only ack and summary) + LOOP-04 (failure-override authoritative
 * from exit-code / tool_result.is_error, NEVER from LLM narration) +
 * LOOP-07 (claude subprocess detached into its own process group via
 * `{ detached: true }` in the spawnImpl wrapper — workaround for
 * anthropics/claude-code#45717).
 *
 * The @achilles/claude-code-bridge package stays byte-for-byte unchanged
 * (LOOP-02). All Phase 17 customisation — sandwich-wrap envelope,
 * ack / spoken-summary extraction, failure-override emission, detached
 * spawn — lives in this wrapper which only consumes the package's
 * public surface (createClaudeSession + extractAck + extractSpokenSummary
 * + deriveOutcome + ClaudeOutcome).
 *
 * Public surface:
 *
 *   - FAILURE_OVERRIDE_PHRASE: "I ran into a problem"
 *       Top-level const with NO trailing period. Phase 20 asciicasts
 *       grep for the exact string `grep -F "I ran into a problem"
 *       dist/achilles`; a trailing period would split the grep into a
 *       false-negative when a regex-escaped variant is used downstream.
 *   - buildFailureSummary(outcome: ClaudeOutcome): string
 *       Maps the 3 failure reasons (exit_code / tool_error / cancelled)
 *       to the locked spoken-summary form. Exported for testing —
 *       Plan 03 Task 2's claude-bridge.test.ts asserts the 3 mappings
 *       byte-for-byte.
 *   - createClaudeBridge(deps): ClaudeBridgeHandle
 *       Returns a handle exposing send / consume / cancel / dispose.
 *
 * The handle is single-use: one createClaudeBridge call per claude
 * subprocess invocation. Re-issuing send() before consume() resolves
 * is rejected. cancel() and dispose() delegate to the bridge's existing
 * SIGINT-SIGTERM-SIGKILL escalation chain in
 * packages/claude-code-bridge/src/cancellation.ts (NOT re-implemented
 * here — LOOP-02).
 *
 * Threat model ties:
 *   - T-17-11 mitigation: wrapTranscript envelopes user input before
 *     bridge.send. Plan 03 Task 1 ported the wrapper byte-for-byte from
 *     v1.2. Test 2 in claude-bridge.test.ts asserts the wrap.
 *   - T-17-12 mitigation: normaliseForTts strips paths / secrets / fenced
 *     code / ANSI from ack + summary text before emit. Test 3 + Test 4
 *     assert the normalised text is the payload of claude_ack /
 *     claude_summary events.
 *   - T-17-13 mitigation: buildFailureSummary is reachable only from
 *     outcome.kind === "failure"; the LLM's narration of "I ran into a
 *     problem" inside assistant_text_delta does NOT trigger
 *     claude_failed. Test 7 asserts the invariant.
 *   - T-17-14 mitigation: spawnImpl adapter wraps caller-provided
 *     spawnImpl (or node:child_process.spawn) to inject `detached: true`
 *     so the subprocess lives in its own process group. Test 1 asserts
 *     the option reaches the inner spawn.
 *   - T-17-15 mitigation (inherited from Plan 03 Task 1): manipulation
 *     token detection report carries pattern-name identifiers only;
 *     logger emits the warning without the matched fragment. Test 10
 *     asserts the unmodified wrapped transcript reaches bridge.send.
 *
 * No emojis (CLAUDE.md global). No top-level static imports of
 * voice-* runtime functions — Phase 17 lifts the LOOP-02 import rule
 * for claude-code-bridge but keeps voice-* imports off the top-level
 * surface to preserve INIT-07 (no static voice import in cli.ts).
 */

import type {
  ClaudeOutcome,
  ProcessExitEvent,
} from "@achilles/claude-code-bridge";
import {
  createClaudeSession,
  extractAck,
  extractSpokenSummary,
} from "@achilles/claude-code-bridge";
import { spawn as nodeSpawn } from "node:child_process";
import type {
  SpawnOptions,
  ChildProcess,
  StdioOptions,
} from "node:child_process";

import { wrapTranscript, detectManipulationTokens } from "../sandwich-defence.js";
import { normaliseForTts } from "../normalisation.js";
import type { SessionEvent } from "../session-events.js";
import type { StructuredLogger } from "../structured-logger.js";

/**
 * LOOP-04 + Phase 20 asciicast invariant. The exact ASCII bytes Phase 20
 * RBS asciicasts grep for: `grep -F "I ran into a problem" dist/achilles`.
 * The const has NO trailing period — `buildFailureSummary` appends the
 * period + reason suffix in one go, but a downstream grep for the locked
 * prefix succeeds against both the const declaration and the spoken
 * summary regardless of suffix wording.
 *
 * Locked at "I ran into a problem" with no period. A future contributor
 * who adds a period here will fail Plan 03 Task 2's Test 8
 * (`expect(FAILURE_OVERRIDE_PHRASE.endsWith(".")).toBe(false)`) AND the
 * verification grep `grep -cF 'FAILURE_OVERRIDE_PHRASE = "I ran into a
 * problem"' apps/achilles-terminal/src/audio/claude-bridge.ts`.
 *
 * @public
 */
export const FAILURE_OVERRIDE_PHRASE = "I ran into a problem";

/**
 * Maps a ClaudeOutcome (kind="failure") to the spoken-summary form.
 *
 *   exit_code  -> "I ran into a problem. exit_code: <code|unknown>"
 *   tool_error -> "I ran into a problem. tool_error"
 *   cancelled  -> "I ran into a problem. cancelled"
 *
 * For a kind="success" input (defensive — callers must branch first),
 * returns the bare FAILURE_OVERRIDE_PHRASE.
 *
 * The mapping mirrors v1.2 session.ts lines 786-811 (the
 * buildFailureSummary helper) byte-for-byte except the prefix is the
 * no-period const instead of the v1.2 "I ran into a problem." literal.
 * Both forms speak identically through TTS — the const form makes the
 * Phase 20 grep robust to suffix-wording refactors.
 *
 * Exported for testing.
 *
 * @public
 */
export function buildFailureSummary(outcome: ClaudeOutcome): string {
  if (outcome.kind !== "failure") {
    return FAILURE_OVERRIDE_PHRASE;
  }
  if (outcome.reason === "exit_code") {
    const code =
      outcome.exitCode === null || outcome.exitCode === undefined
        ? "unknown"
        : String(outcome.exitCode);
    return `${FAILURE_OVERRIDE_PHRASE}. exit_code: ${code}`;
  }
  if (outcome.reason === "tool_error") {
    return `${FAILURE_OVERRIDE_PHRASE}. tool_error`;
  }
  if (outcome.reason === "cancelled") {
    return `${FAILURE_OVERRIDE_PHRASE}. cancelled`;
  }
  return FAILURE_OVERRIDE_PHRASE;
}

/**
 * Internal type alias for the spawn function shape. node:child_process's
 * `spawn` is overloaded; this alias picks the variant whose argv +
 * options match our usage.
 *
 * @internal
 */
type SpawnLike = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

/**
 * Test-injection seam for the createClaudeSession factory. Production
 * callers omit; tests inject a recording stub so the spawn-wrapper +
 * send-flow + consume-flow assertions can run without spawning a real
 * claude subprocess.
 *
 * @internal
 */
type CreateSessionLike = typeof createClaudeSession;

/**
 * Construction-time dependencies for createClaudeBridge. All external
 * surfaces (spawnImpl, createSession, emit, logger) are injected so the
 * test surface can record + assert without monkey-patching imports.
 *
 * @public
 */
export interface CreateClaudeBridgeDeps {
  /**
   * Absolute filesystem path to the embedded companion.md system prompt
   * body. Forwarded to the bridge via `--append-system-prompt-file
   * <systemPromptFile>`. Resolved by Plan 01's
   * resolveCompanionPromptPath() at runVoice() entry.
   */
  readonly systemPromptFile: string;
  /**
   * Optional Claude session_id to resume. When supplied the bridge
   * appends `--resume <sid>` to the argv; when omitted the bridge
   * starts a new session.
   */
  readonly resumeSessionId?: string;
  /**
   * Optional spawn override. Defaults to node:child_process.spawn.
   * Tests inject a recording stub to assert the LOOP-07 detached:true
   * option reaches the inner spawn call.
   */
  readonly spawnImpl?: SpawnLike;
  /**
   * Optional createClaudeSession override. Defaults to the real factory
   * from @achilles/claude-code-bridge. Tests inject a stub returning a
   * fake ClaudeSession so the send / consume flow can be exercised
   * deterministically.
   */
  readonly createSession?: CreateSessionLike;
  /**
   * SessionEvent emitter — the per-invocation session emitter from Plan
   * 04's runVoice(). The wrapper emits claude_ack, claude_partial,
   * claude_summary, claude_done, claude_failed via this callback. Only
   * ack + summary carry TTS-bound text (LOOP-03 invariant).
   */
  readonly emit: (event: SessionEvent) => void;
  /**
   * Optional structured-logger handle. Used to log manipulation-token
   * warnings without stripping the transcript (the v1.2 contract: log +
   * warn, do NOT silently strip). When undefined, manipulation
   * detections are silently observed.
   */
  readonly logger?: StructuredLogger;
}

/**
 * Public handle returned by createClaudeBridge. Single-use per claude
 * subprocess invocation.
 *
 * @public
 */
export interface ClaudeBridgeHandle {
  /**
   * Apply the SAFE-04 sandwich-wrap envelope around the raw STT
   * transcript and write the wrapped bytes to the claude subprocess
   * stdin. Idempotent re-send rejects with an Error to prevent
   * accidental double-send. Manipulation-token detection runs on the
   * unwrapped transcript; on detected:true the wrapper logs a warning
   * via deps.logger but passes the wrapped transcript unchanged to
   * the bridge (do NOT silently strip — the v1.2 contract).
   */
  send(rawTranscript: string): Promise<void>;
  /**
   * Drive the for-await loop over bridge.events$. Emits claude_ack on
   * the first non-null extractAck delta, claude_summary +
   * claude_failed (failure) + claude_done on process_exit. Tool calls
   * (tool_use, tool_result) are observed for failure-override
   * accumulation but never produce TTS-bound emissions (LOOP-03).
   *
   * Returns once the bridge stream ends (process_exit yielded).
   */
  consume(): Promise<void>;
  /**
   * Delegate to bridge.cancel() which runs the SIGINT-SIGTERM-SIGKILL
   * chain from packages/claude-code-bridge/src/cancellation.ts (NOT
   * re-implemented here — LOOP-02). Resolves with the
   * ProcessExitEvent.
   */
  cancel(): Promise<ProcessExitEvent>;
  /**
   * Graceful shutdown — delegates to bridge.close() (SIGTERM-then-
   * SIGKILL after 5s grace, the v1.2 default). Resolves once the
   * subprocess has exited.
   */
  dispose(): Promise<void>;
}

/**
 * Word-cap fallback used when extractSpokenSummary returns null/empty.
 * Splits on whitespace, takes the first `n` words, joins with a
 * single space. Mirrors v1.2 session.ts lines 1151-1155 byte-for-byte.
 *
 * @internal
 */
function capWords(text: string, n: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= n) return text.trim();
  return words.slice(0, n).join(" ");
}

/**
 * Wrap a spawnImpl to inject `detached: true` (LOOP-07 workaround for
 * anthropics/claude-code#45717). Every claude subprocess invocation
 * through this wrapper lives in its own process group, so a SIGTERM
 * sent to the Achilles parent (e.g. Claude Code's Bash-tool timeout)
 * does NOT propagate transitively into the claude subprocess and
 * truncate the audio mid-stream.
 *
 * The adapter forwards every other spawn option unchanged. stdio
 * defaults to `["pipe","pipe","pipe"]` per CONTEXT.md `<specifics>`
 * (Pitfall #7 — `claude -p` is non-interactive so pipes are correct).
 *
 * @internal
 */
function wrapSpawnWithDetach(inner: SpawnLike): SpawnLike {
  return (command, args, options) => {
    const stdio: StdioOptions =
      options?.stdio ?? (["pipe", "pipe", "pipe"] as const);
    const detachedOptions: SpawnOptions = {
      ...options,
      detached: true,
      stdio,
    };
    return inner(command, args, detachedOptions);
  };
}

/**
 * Construct the claude-bridge handle. Wires the LOOP-01 / LOOP-03 /
 * LOOP-04 / LOOP-07 invariants on top of the unchanged
 * @achilles/claude-code-bridge package.
 *
 * Lifecycle:
 *   1. Wrap spawnImpl to inject detached:true (LOOP-07).
 *   2. Call createClaudeSession (or test override) to spawn the
 *      claude subprocess.
 *   3. Return a handle whose send() wraps the transcript with the
 *      SAFE-04 envelope before writing to bridge.send.
 *   4. consume() drives the event stream — ack on first delta with a
 *      sentence terminator, summary + failed on process_exit, done
 *      always last.
 *   5. cancel() / dispose() delegate to bridge.cancel() / close().
 *
 * @public
 */
export function createClaudeBridge(deps: CreateClaudeBridgeDeps): ClaudeBridgeHandle {
  // Resolve injection seams. nodeSpawn has multiple overloads; the
  // SpawnLike alias picks the variant we use. TypeScript's overload
  // resolution narrows nodeSpawn to a compatible signature in this
  // assignment context, so an explicit cast would be redundant.
  const baseSpawn: SpawnLike = deps.spawnImpl ?? nodeSpawn;
  const wrappedSpawn = wrapSpawnWithDetach(baseSpawn);
  const sessionFactory: CreateSessionLike =
    deps.createSession ?? createClaudeSession;

  // Spawn the claude subprocess via the bridge. The bridge owns the
  // version check + argv composition + stream-json parsing; the
  // wrappedSpawn injects detached:true (LOOP-07) on every spawn call.
  // The spawnImpl seam in @achilles/claude-code-bridge accepts the
  // standard node:child_process.spawn signature.
  const sessionOpts: {
    systemPromptFile: string;
    resumeSessionId?: string;
  } = { systemPromptFile: deps.systemPromptFile };
  if (deps.resumeSessionId !== undefined) {
    sessionOpts.resumeSessionId = deps.resumeSessionId;
  }
  const session = sessionFactory(
    sessionOpts,
    {
      spawnImpl: wrappedSpawn as unknown as typeof nodeSpawn,
    },
  );

  // Single-use guard for send().
  let sendCalled = false;

  // Track tool errors observed during the turn — the bridge's outcome
  // derivation already does this internally, but a defective bridge
  // that fails to populate outcome would otherwise leave the
  // failure-override path silent. Mirrors v1.2 session.ts observedToolErrors
  // (line 1015).
  const observedToolErrors: string[] = [];

  function send(rawTranscript: string): Promise<void> {
    if (sendCalled) {
      return Promise.reject(
        new Error("claude-bridge: send() may only be called once"),
      );
    }
    sendCalled = true;

    // Manipulation-token detection on the UNWRAPPED transcript — the
    // detector pattern is signature-based and matches the body the
    // user actually spoke, not the wrapped envelope. We log the
    // pattern-name identifiers but never strip the body.
    const detection = detectManipulationTokens(rawTranscript);
    if (detection.detected && deps.logger !== undefined) {
      deps.logger.warn("manipulation_tokens_detected", {
        patterns: [...detection.matchedPatterns],
      });
    }

    // SAFE-04 sandwich-wrap. Throws on empty / delimiter-collision
    // inputs (the wrapper enforces both). Phase 17's claude-bridge
    // surface treats those throws as fatal — runVoice's caller maps
    // them to a session `error` event. We catch the synchronous
    // throw and surface it as a rejected Promise so the send()
    // signature stays Promise<void> even on validation failure.
    try {
      const wrapped = wrapTranscript(rawTranscript);
      session.send(wrapped);
      return Promise.resolve();
    } catch (err) {
      // wrapTranscript throws Error instances (empty / delimiter
      // collision / non-string). Wrap unknown shapes defensively so
      // the rejection always carries an Error per the
      // prefer-promise-reject-errors lint rule.
      const wrapped =
        err instanceof Error ? err : new Error(String(err));
      return Promise.reject(wrapped);
    }
  }

  async function consume(): Promise<void> {
    let ackEmitted = false;
    let accumulatedText = "";
    let outcomeEmitted = false;

    for await (const ev of session.events$) {
      const now = Date.now();

      if (ev.type === "assistant_text_delta") {
        accumulatedText += ev.text;
        if (!ackEmitted) {
          const ack = extractAck(accumulatedText);
          if (ack !== null) {
            ackEmitted = true;
            const norm = normaliseForTts(ack);
            deps.emit({
              type: "claude_ack",
              payload: { text: norm.normalised },
              timestamp: now,
            });
          }
        }
      } else if (ev.type === "tool_use") {
        // LOOP-03: tool calls are observed but do NOT produce
        // TTS-bound emissions. Plan 02's stuck-thinking-watchdog
        // (Phase 17 wave 2) consumes tool_use as a progress heartbeat
        // — that wiring is upstream of this wrapper.
      } else if (ev.type === "tool_result") {
        // LOOP-03 + LOOP-04: tool_result with is_error feeds the
        // failure-override accumulator. The bridge's own outcome
        // derivation also accumulates this list; the local copy
        // exists as a defence-in-depth fallback for the process_exit
        // branch.
        if (ev.is_error === true) {
          observedToolErrors.push(ev.tool_use_id);
        }
      } else if (ev.type === "process_exit") {
        // Authoritative outcome path. The bridge sets session.outcome
        // synchronously inside its exit listener before pushing the
        // process_exit event — so the read below is non-null in the
        // common case.
        const outcome: ClaudeOutcome = session.outcome ?? {
          kind:
            ev.exit_code === 0 && observedToolErrors.length === 0
              ? "success"
              : "failure",
          ...(ev.exit_code !== 0
            ? { reason: "exit_code" as const, exitCode: ev.exit_code }
            : observedToolErrors.length > 0
              ? { reason: "tool_error" as const }
              : {}),
        };

        let summaryBody: string;
        if (outcome.kind === "failure") {
          summaryBody = buildFailureSummary(outcome);
          // LOOP-04: the claude_failed event fires authoritatively
          // from outcome.kind === "failure" — derived from exit_code
          // or tool_result.is_error, NEVER from LLM narration. The
          // reason field carries the human-readable enum value the UI
          // status row surfaces.
          deps.emit({
            type: "claude_failed",
            payload: { reason: outcome.reason ?? "unknown" },
            timestamp: now,
          });
        } else {
          // success: extract spoken-summary from the bridge's
          // authoritative lastTurnText. The bridge documents
          // assistant_text_done.full_text as the canonical accumulated
          // string and updates lastTurnText synchronously before
          // process_exit (v1.2 WR-05).
          const extracted = extractSpokenSummary(session.lastTurnText);
          if (extracted !== null && extracted.length > 0) {
            summaryBody = extracted;
          } else {
            // Marker absent — fall back to the lastTurnText capped at
            // 40 words (v1.2 fallback for an LLM that forgot the
            // marker contract on a success run).
            summaryBody = capWords(session.lastTurnText, 40);
          }
        }

        const norm = normaliseForTts(summaryBody);
        deps.emit({
          type: "claude_summary",
          payload: { text: norm.normalised },
          timestamp: now,
        });
        deps.emit({
          type: "claude_done",
          payload: { outcome },
          timestamp: now,
        });
        outcomeEmitted = true;
      }
      // session_init, assistant_text_done, permission_request,
      // assistant_done, parse_error, unknown_event are observed but
      // not emitted on the session EventEmitter — Plan 02's
      // stuck-thinking-watchdog consumes them as progress heartbeats
      // upstream; here we just pass-through.
    }

    // Defensive: if the bridge ended without a process_exit (unusual
    // shape that should not happen in production), still emit done so
    // the session-level state machine does not hang. The outcome is
    // synthesised as failure / exit_code:null.
    if (!outcomeEmitted) {
      const defensiveOutcome: ClaudeOutcome = {
        kind: "failure",
        reason: "exit_code",
        exitCode: null,
      };
      const summaryBody = buildFailureSummary(defensiveOutcome);
      const norm = normaliseForTts(summaryBody);
      deps.emit({
        type: "claude_failed",
        payload: { reason: "exit_code" },
        timestamp: Date.now(),
      });
      deps.emit({
        type: "claude_summary",
        payload: { text: norm.normalised },
        timestamp: Date.now(),
      });
      deps.emit({
        type: "claude_done",
        payload: { outcome: defensiveOutcome },
        timestamp: Date.now(),
      });
    }
  }

  function cancel(): Promise<ProcessExitEvent> {
    return session.cancel();
  }

  function dispose(): Promise<void> {
    return session.close();
  }

  return { send, consume, cancel, dispose };
}
