/**
 * Phase 18, Plan 03, Task 1 — Smoke test module (INIT-04).
 *
 * Requirements:
 *   - INIT-04: 1-utterance round-trip exercising the full mic -> STT -> claude ->
 *     TTS -> ffplay path. The test passes when both `claude_done` (success) AND
 *     `tts_drained` events fire within `timeoutMs` (default 30s).
 *
 * CRITICAL (CLAUDE.md no-auto-running rule):
 *   This function is invoked ONLY from the init wizard (wizard.ts) when the
 *   operator runs `achilles init` interactively. It is NEVER called from vitest
 *   directly. All vitest tests use the `sessionFactoryImpl` injection seam to
 *   emit synthetic round-trip events and NEVER spawn a real Phase 17 Session.
 *
 * Implementation:
 *   1. Create a session via sessionFactoryImpl (default: createSession())
 *   2. Race a round-trip listener against a timeout
 *   3. Round-trip listener: subscribe to session "event" channel;
 *      resolve when BOTH "claude_done" with success AND "tts_drained" have fired
 *   4. Timeout: resolves with passed=false, failureReason="timeout_30s"
 *   5. Finally: always call session.dispose()
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import { createSession, type Session } from "../session.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Result of a smoke test run.
 *
 * @public
 */
export interface SmokeTestResult {
  readonly passed: boolean;
  readonly elapsedMs: number;
  readonly failureReason?: string;
}

/**
 * Dependency injection seam for runSmokeTest.
 *
 * @public
 */
export interface SmokeTestDeps {
  /**
   * Factory function that returns a Session instance. Default: createSession().
   *
   * Tests inject a fake EventEmitter-based session that emits synthetic events.
   * NEVER inject a real session in vitest (CLAUDE.md no-auto-running rule).
   */
  sessionFactoryImpl?: () => Session;
  /**
   * Timeout in milliseconds. Defaults to 30000 (INIT-04 spec).
   */
  timeoutMs?: number;
  /**
   * setTimeout seam. Defaults to globalThis.setTimeout.
   */
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /**
   * clearTimeout seam. Defaults to globalThis.clearTimeout.
   */
  clearTimeoutImpl?: (id: ReturnType<typeof setTimeout>) => void;
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Run a 1-utterance smoke test using the Phase 17 session.ts composition root.
 *
 * OPERATOR-ONLY: called from wizard.ts only, never from vitest directly.
 * Tests inject sessionFactoryImpl to avoid spawning real audio processes.
 *
 * @public
 */
export async function runSmokeTest(
  deps: SmokeTestDeps = {},
): Promise<SmokeTestResult> {
  const timeoutMs = deps.timeoutMs ?? 30000;
  const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout;
  const sessionFactoryImpl = deps.sessionFactoryImpl ?? createSession;

  const startMs = Date.now();
  const session = sessionFactoryImpl();

  // Dispose the session in a type-safe way (the Session class has stop() not dispose())
  const disposeSession = async (): Promise<void> => {
    // Check for a synthetic dispose() added by tests, or the real stop() on Session
    const asAny = session as unknown as Record<string, unknown>;
    if (typeof asAny["dispose"] === "function") {
      await (asAny["dispose"] as () => Promise<void>)();
    } else if (typeof asAny["stop"] === "function") {
      await (asAny["stop"] as () => Promise<void>)();
    }
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race<SmokeTestResult>([
      // Round-trip listener
      new Promise<SmokeTestResult>((resolve) => {
        let claudeDoneSuccess = false;
        let ttsDrained = false;

        function checkComplete(): void {
          if (claudeDoneSuccess && ttsDrained) {
            resolve({
              passed: true,
              elapsedMs: Date.now() - startMs,
            });
          }
        }

        session.on("event", (ev: { type: string; payload: Record<string, unknown> }) => {
          if (ev.type === "claude_done") {
            const outcome = ev.payload?.["outcome"] as { kind?: string } | undefined;
            if (outcome?.kind === "success") {
              claudeDoneSuccess = true;
              checkComplete();
            }
          } else if (ev.type === "tts_drained") {
            ttsDrained = true;
            checkComplete();
          }
        });
      }),
      // Timeout
      new Promise<SmokeTestResult>((resolve) => {
        timeoutId = setTimeoutImpl(() => {
          resolve({
            passed: false,
            elapsedMs: Date.now() - startMs,
            failureReason: "timeout_30s",
          });
        }, timeoutMs);
      }),
    ]);

    return result;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeoutImpl(timeoutId);
    }
    await disposeSession();
  }
}
