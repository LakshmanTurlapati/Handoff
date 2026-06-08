/**
 * TUI-03 + ACC-01 + ACC-02 substrate (Phase 16, Plan 03, Task 2).
 *
 * Locked 5+1-state palette, screen-reader wording table, NO_COLOR/FORCE_COLOR
 * honored via chalk, screen-reader detection with the RESEARCH Assumption A1
 * corrected strict check (`=== "true"` not `"1"`), and the two amplitude
 * envelope helpers Plan 04 will compose into the session tick.
 *
 * Source provenance:
 *   - 16-RESEARCH.md §"NO_COLOR / FORCE_COLOR / INK_SCREEN_READER precedence"
 *     lines 793-852 (verbatim shape)
 *   - 16-CONTEXT.md `<decisions>` Visual surface + Accessibility rows (locked
 *     wording strings)
 *   - 16-RESEARCH.md Assumption Log A1: INK_SCREEN_READER === "true" not "1"
 *
 * LOOP-02 invariant: zero imports from voice-* / claude-code-bridge /
 * achilles-skill. Only chalk + the local AchillesState type.
 *
 * No emojis (CLAUDE.md global).
 */

import chalk from "chalk";
import type { AchillesState } from "../state/constants.js";

/**
 * 5+1-state palette. The 6th key `muted` is locked alongside the AchillesState
 * `muted` substate (CONTEXT.md Mute control row + Plan 02's 6-state tuple).
 * Color names are the chalk getter names so `(chalk as any)[STATE_COLORS[s]]`
 * resolves to the correct chainable color function at call time.
 */
export const STATE_COLORS = {
  idle: "gray",
  listening: "green",
  processing: "yellow",
  speaking: "blue",
  error: "red",
  muted: "redBright",
} as const;

/**
 * Locked screen-reader wording per CONTEXT.md `<decisions>` Accessibility row.
 * These strings are spoken verbatim by the screen reader on each state change
 * (with the 200ms debounce implemented in ScreenReader.tsx).
 */
export const SCREEN_READER_WORDING = {
  idle: "Achilles ready.",
  listening: "Achilles listening.",
  processing: "Achilles processing your request.",
  speaking: "Achilles speaking.",
  error: "Achilles encountered an error.",
  muted: "Achilles muted.",
} as const;

/**
 * Apply the state's chalk color to the given text. chalk natively respects
 * NO_COLOR (returns the plain text) and FORCE_COLOR (emits ANSI even when
 * !isTTY). Phase 16 does NO extra env-var detection — chalk owns ACC-01.
 *
 * The `(chalk as any)` cast is a deliberate escape hatch: chalk's typings do
 * not expose a single union over all color names, but every value in
 * STATE_COLORS is a real chainable property on the default chalk instance.
 */
export function colorize(state: AchillesState | "muted", text: string): string {
  const colorName = STATE_COLORS[state];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
  return (chalk as any)[colorName](text);
}

/**
 * Resolve screen-reader mode at startup, BEFORE Ink mounts. Strict equality
 * with the literal string "true" — matches Ink 7's documented default
 * (`process.env['INK_SCREEN_READER'] === 'true'`). RESEARCH Assumption A1
 * corrects CONTEXT.md's earlier "1" value: setting `INK_SCREEN_READER=1` does
 * NOT activate screen-reader mode. Only "true" does.
 */
export function isScreenReaderActive(): boolean {
  return process.env["INK_SCREEN_READER"] === "true";
}

/**
 * Idle breathing envelope per CONTEXT.md `<decisions>` Visual surface row:
 * amplitude = 0.3 + 0.1 * sin(t/600). Period 1.2s, range [0.2, 0.4]. Plan 04's
 * session.ts feeds this scalar to Blob's amplitude prop when state === "idle".
 */
export function idleBreathingAmplitude(tickMs: number): number {
  return 0.3 + 0.1 * Math.sin(tickMs / 600);
}

/**
 * Processing pulse envelope per CONTEXT.md `<decisions>` Visual surface row:
 * amplitude = 0.5 + 0.3 * sin(t/200). Period 0.4s, range [0.2, 0.8]. Plan 04
 * feeds this to Blob when state === "processing".
 */
export function processingPulseAmplitude(tickMs: number): number {
  return 0.5 + 0.3 * Math.sin(tickMs / 200);
}
