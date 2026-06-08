#!/usr/bin/env node
/**
 * `achilles` CLI seed entry point (Phase 15).
 *
 * INIT-07: the argv parse for --version / -v MUST happen before any
 * dynamic import of pipeline-boot modules (the modules that would touch
 * ELEVENLABS_API_KEY, sox, or ffmpeg). In Phase 15 there are no pipeline
 * imports yet, so the invariant is trivially satisfied — but the
 * structure (top-level static imports of node:fs/promises + node:url +
 * node:path only, argv branch first, ALL other logic gated) must be
 * preserved so Phase 16+ cannot regress it.
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

  // Phase 15 stub: the voice TUI is not implemented yet. Phase 16 ships
  // the real subcommand router and Ink-based UI. Print a real error
  // message rather than silently exiting so users get a clear "this
  // surface is not in this build" signal.
  if (argv[0] === "voice") {
    process.stderr.write(
      "achilles voice: TUI not implemented in Phase 15. Phase 16 ships this.\n",
    );
    process.exit(1);
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
