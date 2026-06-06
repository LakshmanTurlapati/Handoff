/**
 * Synchronous `claude --version` probe + semver compare (Plan 10-02,
 * Task 2).
 *
 * Pitfall #24 owner: before Plan 10-02 spawns the streaming `claude`
 * child, it calls {@link runVersionCheck} to confirm the installed CLI
 * is at least {@link MIN_CLAUDE_VERSION}. The probe is intentionally
 * synchronous (`spawnSync`) so the streaming spawn never starts when the
 * version is too low. The version check is bypassed when
 * {@link SKIP_VERSION_CHECK_ENV_VAR} is set to "1" in the effective
 * environment; this escape hatch is the documented test/dev knob and is
 * exercised by both the unit tests and the Phase 12 integration tests.
 *
 * Test injection: the {@link runVersionCheck} signature accepts
 * {@link spawnSyncImpl} and {@link env} parameters so unit tests can
 * simulate every scenario (skip, success, version-too-low, signal,
 * non-zero status) without spawning a real process. Production callers
 * omit these parameters and receive the real
 * {@link import("node:child_process").spawnSync} + `process.env` from
 * the imports below.
 */

import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";

import { MIN_CLAUDE_VERSION, SKIP_VERSION_CHECK_ENV_VAR } from "./constants.js";
import { ClaudeVersionError } from "./errors.js";

/** Regex for a strict semver triple at the start of an input. Used by
 * {@link compareSemverStrings} on each comparator. Tighter than the loose
 * search regex below because compare wants to reject "invalid" inputs
 * rather than scan for an embedded version. */
const STRICT_SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)/;

/** Regex for finding the first dotted triple anywhere in a string. Used
 * by {@link parseVersionFromOutput} on the stdout of `claude --version`,
 * which can be either a naked version or a "Claude Code 2.0.5 (sha ...)"
 * line. */
const LOOSE_SEMVER_REGEX = /(\d+\.\d+\.\d+)/;

/** Default timeout for the `claude --version` probe. Five seconds is
 * generous for a CLI that responds in milliseconds normally; the upper
 * bound exists only to bound startup latency on a misbehaving binary. */
const DEFAULT_VERSION_PROBE_TIMEOUT_MS = 5_000;

/**
 * Compare two semver strings.
 *
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 * @throws when either input does not start with a dotted triple.
 */
export function compareSemverStrings(a: string, b: string): -1 | 0 | 1 {
  const left = parseTriple(a);
  const right = parseTriple(b);
  for (let i = 0; i < 3; i++) {
    const lv = left[i] as number;
    const rv = right[i] as number;
    if (lv < rv) return -1;
    if (lv > rv) return 1;
  }
  return 0;
}

function parseTriple(input: string): [number, number, number] {
  const m = STRICT_SEMVER_REGEX.exec(input);
  if (m === null) {
    throw new Error(`Invalid semver: ${input}`);
  }
  return [
    Number.parseInt(m[1] as string, 10),
    Number.parseInt(m[2] as string, 10),
    Number.parseInt(m[3] as string, 10),
  ];
}

/**
 * Extract a semver triple from the raw stdout of `claude --version`.
 *
 * Accepts both naked versions ("2.0.5\n") and longer banners ("Claude
 * Code 2.0.5 (sha 1234abcd)"). Returns the first dotted triple found.
 *
 * @throws when no dotted triple is present in the first 200 chars of
 *         the output (the slice keeps the error log bounded).
 */
export function parseVersionFromOutput(output: string): string {
  const m = LOOSE_SEMVER_REGEX.exec(output);
  if (m === null) {
    throw new Error(
      `No version found in claude --version output: ${output.slice(0, 200)}`,
    );
  }
  return m[1] as string;
}

/**
 * Options for {@link runVersionCheck}. All fields are optional; sensible
 * defaults are wired from imports above so production callers can invoke
 * `runVersionCheck()` with no arguments.
 */
export interface RunVersionCheckOptions {
  /** Name of the env variable that, when set to "1", skips the probe.
   * Defaults to {@link SKIP_VERSION_CHECK_ENV_VAR}. */
  skipEnvVar?: string;
  /** Effective environment to read the skip variable from. Defaults to
   * `process.env`. Tests pass an empty / customised object to control
   * the skip path deterministically. */
  env?: NodeJS.ProcessEnv;
  /** Injection seam for {@link import("node:child_process").spawnSync}.
   * Defaults to the real `spawnSync`. Tests pass a vi.fn() stub. */
  spawnSyncImpl?: (
    command: string,
    args: readonly string[],
    options: Parameters<typeof spawnSync>[2],
  ) => SpawnSyncReturns<string>;
  /** Minimum acceptable CLI version. Defaults to {@link MIN_CLAUDE_VERSION}. */
  minVersion?: string;
}

export interface RunVersionCheckResult {
  /** True when the skip env var triggered the bypass. When true,
   * {@link actualVersion} is undefined and no probe was attempted. */
  skipped: boolean;
  /** Detected CLI version, set only when `skipped === false`. */
  actualVersion?: string;
}

/**
 * Run `claude --version` synchronously and verify the detected version
 * meets {@link minVersion} (or {@link MIN_CLAUDE_VERSION} by default).
 *
 * @throws {@link ClaudeVersionError} when the detected version is older
 *         than the minimum required.
 * @throws Error (generic) when the probe itself failed (timeout, signal,
 *         non-zero exit status, or no parseable version in the output).
 */
export function runVersionCheck(
  opts?: RunVersionCheckOptions,
): RunVersionCheckResult {
  const skipEnvVar = opts?.skipEnvVar ?? SKIP_VERSION_CHECK_ENV_VAR;
  const env = opts?.env ?? process.env;
  const spawnImpl = opts?.spawnSyncImpl ?? spawnSync;
  const minVersion = opts?.minVersion ?? MIN_CLAUDE_VERSION;

  if (env[skipEnvVar] === "1") {
    return { skipped: true };
  }

  const result = spawnImpl("claude", ["--version"], {
    encoding: "utf8",
    timeout: DEFAULT_VERSION_PROBE_TIMEOUT_MS,
  });

  if (result.error != null) {
    throw new Error(
      `Failed to probe claude --version: ${result.error.message}`,
    );
  }
  if (result.signal != null) {
    throw new Error(
      `Failed to probe claude --version: killed by signal ${result.signal}`,
    );
  }
  if (result.status === null) {
    throw new Error(
      "Failed to probe claude --version: process exited without status",
    );
  }
  if (result.status !== 0) {
    throw new Error(`claude --version exited with status ${result.status}`);
  }

  const actualVersion = parseVersionFromOutput(result.stdout);
  if (compareSemverStrings(actualVersion, minVersion) === -1) {
    throw new ClaudeVersionError(actualVersion, minVersion);
  }
  return { skipped: false, actualVersion };
}
