#!/usr/bin/env node
/**
 * `achilles` CLI entry point (Phase 15 seed + Phase 16 voice subcommand).
 *
 * INIT-07: the argv parse for --version / -v MUST happen before any
 * dynamic import of pipeline-boot modules (the modules that would touch
 * ELEVENLABS_API_KEY, sox, or ffmpeg). The Phase 15 seed kept the
 * invariant trivially (no pipeline imports existed yet); Phase 16
 * extends the `voice` branch from a stub-write-to-stderr-and-exit to a
 * dynamic import of session.ts's runVoice(); the --version / -v /
 * --latency-probe argv-first branches stay at the top of main() so
 * INIT-07 is structurally preserved — Ink, React, chalk, sox, and VAD
 * never load when the user runs --version.
 *
 * The static top-level import budget is therefore locked to exactly
 *   { node:fs/promises, node:url, node:path }
 * across both Phase 15 and Phase 16. Any addition would regress
 * INIT-07 and is rejected by tests/cli.test.ts T8.
 *
 * Pitfall 5 (Bun stdout flush-on-exit): every exit path that writes to
 * stdout uses the explicit write-then-callback form
 * `process.stdout.write(..., () => process.exit(0))` rather than
 * `console.log` to guarantee the buffer flushes before the process
 * terminates. Bun's flush-on-exit semantics differ slightly from Node's
 * and the callback form is portable across both runtimes.
 *
 * Pitfall 1 / v1.2 silent-launch defence: two top-level handlers
 * (uncaughtException + unhandledRejection) are registered BEFORE main()
 * is invoked, and main() carries a top-level .catch(). Any failure path
 * emits a real "achilles: fatal..." line to stderr so the user always
 * sees a real error message instead of the v1.2 "binary launched and
 * nothing happened" shape.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // INIT-07: --version / -v MUST work without API key, sox, ffmpeg.
  // Parse BEFORE any other side-effect-bearing module is imported.
  if (argv.includes("--version") || argv.includes("-v")) {
    // Resolve package.json relative to this file. Under bun --compile
    // (Plan 03), the package.json is embedded as an asset; under the Node
    // fallback, the file is on disk one directory up from dist/cli.js OR
    // src/cli.ts.
    //
    // Layout:
    //   Vitest/tsx source path:  apps/achilles-terminal/src/cli.ts -> ../package.json
    //   Built dist path:         apps/achilles-terminal/dist/cli.js -> ../package.json
    // Both walk one directory up from HERE.
    const pkgPath = join(HERE, "..", "package.json");
    const raw = await readFile(pkgPath, "utf8");
    const pkgJson = JSON.parse(raw) as { version: string };
    // Pitfall 5: explicit callback form ensures stdout flushes before exit
    // under Bun's flush-on-exit semantics.
    process.stdout.write(`${pkgJson.version}\n`, () => process.exit(0));
    return;
  }

  // Cold-start latency probe (Phase 15 manual-capture surface).
  // Phase 18 promotes this to ~/.achilles/latency/ JSON.
  if (argv.includes("--latency-probe")) {
    const t0 = process.hrtime.bigint();
    const elapsedNs = Number(process.hrtime.bigint() - t0);
    process.stdout.write(`${(elapsedNs / 1e6).toFixed(2)}ms\n`, () =>
      process.exit(0),
    );
    return;
  }

  // Phase 16: `voice` subcommand dynamic-import gate. The runVoice
  // function in session.ts owns commander parsing, isTTY routing,
  // Ink mount or plain-text fallback, and the minimum SIGINT handler.
  // The await import gate is the ONLY new import path in cli.ts —
  // session.js (and its transitive ink + react + chalk + sox + VAD
  // imports) loads LAZILY so `achilles --version` never pays the cost
  // of any of those modules (INIT-07 invariant).
  if (argv[0] === "voice") {
    const { runVoice } = await import("./session.js");
    await runVoice(argv.slice(1));
    return;
  }

  process.stderr.write("achilles: unknown command. Try --version.\n");
  process.exit(1);
}

// Pitfall 1 defence: register top-level fatal handlers BEFORE invoking
// main() so any unhandled error path emits a real "achilles: fatal..."
// line to stderr before exit. The v1.2 silent-launch shape (binary
// launched, nothing happened, no error) is structurally prevented by
// these handlers writing the actual error message.
process.on("uncaughtException", (err) => {
  process.stderr.write(`achilles: fatal uncaughtException: ${err.message}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    `achilles: fatal unhandledRejection: ${String(reason)}\n`,
  );
  process.exit(1);
});

main().catch((err: unknown) => {
  process.stderr.write(`achilles: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
