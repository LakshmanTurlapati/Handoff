/**
 * Typed errors thrown by @achilles/claude-code-bridge.
 *
 * The ClaudeVersionError class ties to Pitfall #24 (skill assumes
 * specific Claude Code version): Plan 10-02 runs `claude --version`
 * synchronously before spawning the streaming child and throws this
 * error when the detected version is older than MIN_CLAUDE_VERSION
 * (see ./constants.ts).
 *
 * Security note: the rendered message is a fixed template that carries
 * only the two version strings. It never embeds environment variables,
 * the caller's cwd, the subprocess argv, the API key, the prompt body,
 * or any other sensitive value. Threat T-10-02 (Information Disclosure
 * via error message) is mitigated by this design and asserted in
 * errors.test.ts.
 */

/**
 * Thrown when the installed Claude Code CLI version is older than the
 * conservative floor pinned in MIN_CLAUDE_VERSION. The error carries
 * the actual and required version strings as readonly fields so
 * callers (Phase 12 wiring, Phase 14 hardening) can render structured
 * UI messages or telemetry without re-parsing `error.message`.
 *
 * Example:
 *
 *   throw new ClaudeVersionError("1.5.3", "2.0.0");
 *   // error.name             === "ClaudeVersionError"
 *   // error.actualVersion    === "1.5.3"
 *   // error.requiredVersion  === "2.0.0"
 *   // error.message          === "Claude Code 2.0.0 or newer is
 *   //                            required, found 1.5.3. Upgrade with:
 *   //                            npm install -g
 *   //                            @anthropic-ai/claude-code"
 */
export class ClaudeVersionError extends Error {
  readonly actualVersion: string;
  readonly requiredVersion: string;

  constructor(actualVersion: string, requiredVersion: string) {
    super(
      `Claude Code ${requiredVersion} or newer is required, found ${actualVersion}. Upgrade with: npm install -g @anthropic-ai/claude-code`,
    );
    this.name = "ClaudeVersionError";
    this.actualVersion = actualVersion;
    this.requiredVersion = requiredVersion;
  }
}
