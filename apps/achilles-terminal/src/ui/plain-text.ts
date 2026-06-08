/**
 * TUI-06 substrate — plain-text fallback emitter (Phase 16, Plan 03, Task 3).
 *
 * Emits ANSI-free log lines of the form `[ISO][state] transcript` when
 * `process.stdout.isTTY === false` OR the `--plain` flag is set. Plan 04
 * wires the runtime activation; Plan 03 ships the emitter as a pure
 * formatter plus the long-running event-loop seam.
 *
 * Pure-function module — NO Ink import, NO React import, NO chalk import.
 * The output must contain NO ANSI escape codes per CONTEXT.md TUI-06 row.
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge /
 * achilles-skill / ink / react.
 *
 * No emojis (CLAUDE.md global).
 */

import type { AchillesState } from "../state/constants.js";

/**
 * Input shape for {@link formatPlainLine}. The timestamp is a JS Date so
 * the caller can substitute a fake clock in tests; the formatter renders
 * it via toISOString() so the wire format is `[2026-06-08T12:00:00.000Z]`.
 */
export interface PlainLineInput {
  timestamp: Date;
  state: AchillesState;
  transcript: string;
}

/**
 * Render a plain log line. Format: `[ISO][state] transcript`.
 *
 *   `[2026-06-08T12:00:00.000Z] [listening] hello`
 *
 * NO chalk. NO ANSI escapes. The transcript is written as-is (newlines are
 * preserved verbatim; the caller is responsible for any truncation).
 */
export function formatPlainLine(input: PlainLineInput): string {
  const iso = input.timestamp.toISOString();
  return "[" + iso + "] [" + input.state + "] " + input.transcript;
}

/**
 * Subscriptions Plan 04 will wire to drive plain-mode log emission. The
 * shape is a duck-typed handle so Plan 16 can stay LOOP-02-clean (no
 * @achilles/voice-protocol type import at runtime).
 */
export interface PlainModeEvents {
  onStateChange: (cb: (s: AchillesState) => void) => () => void;
  onTranscriptPartial: (cb: (t: string) => void) => () => void;
  getState: () => AchillesState;
  getTranscript: () => string;
}

/**
 * Long-running emitter for `--plain` mode. Subscribes to state-change +
 * transcript-partial events and writes a plain log line on each. Uses the
 * write-with-callback form per PITFALLS.md §5 (Bun stdout flush) — the
 * function never calls process.exit; Plan 04's signal handlers terminate
 * the process.
 *
 * Returns a teardown function for symmetry with Plan 04's lifecycle hooks.
 */
export function startPlainMode(events: PlainModeEvents): () => void {
  const writeLine = (line: string): void => {
    process.stdout.write(line + "\n", () => {
      // No callback action — fire-and-forget; we are long-running so
      // there is no process.exit to coordinate with.
    });
  };

  const writeSnapshot = (): void => {
    writeLine(
      formatPlainLine({
        timestamp: new Date(),
        state: events.getState(),
        transcript: events.getTranscript(),
      }),
    );
  };

  const unsubscribeState = events.onStateChange(() => {
    writeSnapshot();
  });
  const unsubscribeTranscript = events.onTranscriptPartial(() => {
    writeSnapshot();
  });

  return (): void => {
    unsubscribeState();
    unsubscribeTranscript();
  };
}
