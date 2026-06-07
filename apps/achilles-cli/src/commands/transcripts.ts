/**
 * `achilles transcripts <subcommand>` — Phase-14-deferred stub.
 *
 * Plan 13-01 ships only the command surface. The real `purge`
 * implementation (delete locally-persisted transcripts under the OS-app
 * data directory) lands in Phase 14 alongside the opt-in
 * `--save-transcripts` flag (REQUIREMENTS.md SAFE-02). The Phase 13
 * stub MUST NOT touch the filesystem — a misfired delete during the
 * scaffolding phase would silently destroy user data the moment Phase
 * 14 lands.
 *
 * Contract (Plan 13-01 Test T1, T2):
 *
 *   - subcommand === "purge": write a one-line message naming "not yet
 *     implemented" AND "Phase 14" to the injected stdout seam; exit 0.
 *     Performs ZERO filesystem operations — this file imports nothing
 *     from `node:fs` (asserted by a grep guard in the verify command).
 *
 *   - any other subcommand: write a one-line "Unknown subcommand"
 *     message to stdout (NOT stderr — invalid usage is informational
 *     while the surface is a stub); exit 2 (commander's misuse code).
 *
 * Threat model: T-13-04 (DoS) — the stub does no IO and returns
 * immediately, so a malicious shell loop calling `achilles transcripts
 * purge` repeatedly cannot exhaust disk or CPU beyond a single stdout
 * line per invocation.
 */

/**
 * Subset of `node:stream` Writable that the stub writes to.
 *
 * @public
 */
export interface WritableSeam {
  write(chunk: string): boolean;
}

/**
 * Injected dependencies for transcriptsCommand.
 *
 * @public
 */
export interface TranscriptsDeps {
  readonly stdout: WritableSeam;
  readonly processExitImpl: (code: number) => void;
}

/**
 * Phase-14-deferred subcommand handler. See file-level contract above.
 *
 * @public
 */
export function transcriptsCommand(
  subcommand: string,
  deps: TranscriptsDeps,
): void {
  const { stdout, processExitImpl } = deps;
  if (subcommand === "purge") {
    stdout.write(
      "[achilles] transcripts purge — not yet implemented (Phase 14 — Hardening, Privacy, Resilience).\n",
    );
    processExitImpl(0);
    return;
  }
  stdout.write(
    `[achilles] Unknown subcommand: ${subcommand}. Supported: purge.\n`,
  );
  processExitImpl(2);
}
