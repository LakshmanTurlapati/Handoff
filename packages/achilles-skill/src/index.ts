/**
 * @achilles/achilles-skill
 *
 * Embedded companion system prompt for the Achilles voice loop. This
 * package owns the SINGLE source of truth for the prompt body that
 * drives the spoken acknowledgement + `<spoken-summary>` block
 * contract. PROMPT-01 mandates that the npm-CLI launch path and the
 * Phase 13 Claude Code skill body reference the same file — both
 * consumers go through the resolved absolute path strings exported
 * below.
 *
 * Consumers (planned):
 *
 *   - Plan 12-04 orchestrator at apps/achilles/src/main/session.ts
 *     passes `companionPromptPath` to `claude -p` via
 *     `--append-system-prompt-file <companionPromptPath>` so the
 *     subprocess loads the embedded contract at launch time
 *   - Phase 13 install-skill CLI symlinks `companionPromptPath` into
 *     `~/.claude/skills/achilles/prompts/companion.md` so Claude Code's
 *     skill discovery picks up the same body
 *   - Phase 13 SKILL.md body references the file at the same path so a
 *     CI diff check fails on drift (T-12-04 mitigation)
 *
 * Contract references:
 *
 *   - REQUIREMENTS.md PROMPT-01 — single source of truth for the embedded
 *     system prompt
 *   - REQUIREMENTS.md PROMPT-02 — <=12-word spoken acknowledgement
 *     emitted BEFORE any tool calls
 *   - REQUIREMENTS.md PROMPT-03 — <=40-word `<spoken-summary>` block as
 *     the final assistant action, no paths/code/symbols/ANSI
 *   - REQUIREMENTS.md PROMPT-04 — only the ack and the spoken-summary
 *     are routed to TTS; everything else is silent (visible in terminal)
 *   - REQUIREMENTS.md PROMPT-05 — when work fails, the spoken summary
 *     MUST begin with the phrase "I ran into a problem"
 *
 * Notes on purity:
 *
 *   - No module-level mutable state (the two exports are `const`)
 *   - No console.* logging
 *   - No clock or RNG reads
 *   - Path resolution happens once at module-load time and is stable for
 *     the lifetime of the process
 *
 * Path-resolution strategy:
 *
 *   - We resolve relative to the compiled artifact's location at runtime
 *     via `import.meta.url` + `fileURLToPath`, then walk up to the
 *     package root with `..` and into `skill/prompts/`. The layout is
 *     mirrored between `src/` (Vitest source resolution path) and
 *     `dist/` (built artifact path): both sit ONE level below the
 *     package root, so the same `..` walk lands on the package root
 *     whichever consumption mode is active.
 *
 * No runtime dependencies. The package surface is data (resolved
 * strings) plus the markdown file shipped under `skill/prompts/`.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Absolute filesystem path to the directory containing this module at
 * runtime. Used as the anchor for the path walk to the skill prompts
 * directory.
 *
 * - When loaded from `dist/index.js` (built artifact path), HERE resolves
 *   to `<package-root>/dist/`
 * - When loaded from `src/index.ts` via Vitest source resolution, HERE
 *   resolves to `<package-root>/src/`
 *
 * Both paths sit one level below the package root, so `..` walks up to
 * `<package-root>/` in either case.
 */
const HERE: string = fileURLToPath(new URL(".", import.meta.url));

/**
 * Absolute resolved filesystem path to the directory shipping the
 * embedded prompt assets. No trailing slash. Phase 13's install-skill
 * subcommand uses this as the symlink source for the
 * `~/.claude/skills/achilles/prompts/` install target.
 *
 * Layout:
 *
 *   <package-root>/skill/prompts/companion.md
 *
 * @public
 */
export const SKILL_PROMPTS_DIR: string = resolve(
  HERE,
  "..",
  "skill",
  "prompts",
);

/**
 * Absolute resolved filesystem path to the embedded companion system
 * prompt body. PROMPT-01's single source of truth. This is the file
 * passed to `claude -p --append-system-prompt-file <companionPromptPath>`
 * by Plan 12-04's orchestrator at runtime.
 *
 * Always equal to `path.resolve(SKILL_PROMPTS_DIR, "companion.md")` —
 * the path-resolution-consistency invariant is asserted by the
 * package's unit tests.
 *
 * @public
 */
export const companionPromptPath: string = resolve(
  SKILL_PROMPTS_DIR,
  "companion.md",
);
