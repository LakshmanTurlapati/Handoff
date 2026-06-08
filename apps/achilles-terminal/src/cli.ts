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
 * across Phase 15, Phase 16, Phase 17, and Phase 18. Any addition would
 * regress INIT-07 and is rejected by tests/cli.test.ts T8 and
 * tests/integration/init-07-invariant.test.ts.
 *
 * Phase 18 Plan 04 adds the `init`, `config`, `transcripts`, and
 * `latency` (migrated to runLatencyReport) subcommand branches. The
 * `voice` branch acquires the single-instance lock (SAFE-04) via
 * acquireLock() BEFORE the session.ts dynamic import so the conflict
 * message fires before any pipeline boots. Every new subcommand uses
 * `await import("./...")` dynamic gates inside main() so INIT-07's
 * top-level static-import budget remains exactly
 * { node:fs/promises, node:url, node:path }.
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

  // Phase 18 Plan 04 / Phase 17 Plan 04: `latency` subcommand dynamic-import
  // gate. Phase 18 migrates the import target from latency-probe.js to
  // latency-report.js (Plan 03 wrapper) so cli.ts depends on a stable
  // consumer surface instead of Phase 17's internal implementation path.
  // INIT-07 invariant preserved — the static top-level imports continue to
  // be exactly { node:fs/promises, node:url, node:path } (this branch uses
  // ONLY dynamic imports).
  if (argv[0] === "latency") {
    const sub = argv[1];
    if (sub === "--report" || sub === "report") {
      const { runLatencyReport } = await import("./latency-report.js");
      const report = await runLatencyReport();
      process.stdout.write(report, () => process.exit(0));
      return;
    }
    process.stderr.write(
      "achilles latency: unknown subcommand. Try --report.\n",
    );
    process.exit(1);
    return;
  }

  // Phase 18 Plan 04: `init` subcommand dynamic-import gate.
  // Invokes the Plan 03 @clack/prompts linear wizard via runInitWizard().
  // On wizard completion: exit 0.
  // On user cancel (Ctrl-C): print "achilles init: cancelled." + exit 130.
  // On any other failure: exit 1.
  // INIT-07: runInitWizard and all of its transitive @clack/prompts /
  // @napi-rs/keyring / @stablelib/nacl imports load ONLY inside this branch.
  if (argv[0] === "init") {
    const { runInitWizard } = await import("./init/wizard.js");
    const outcome = await runInitWizard();
    if (outcome.completed) {
      process.exit(0);
      return;
    } else if (outcome.cancelled) {
      process.stderr.write("achilles init: cancelled.\n");
      process.exit(130);
      return;
    } else {
      process.exit(1);
      return;
    }
  }

  // Phase 18 Plan 04: `config` subcommand dynamic-import gate.
  // Invokes the Plan 03 @clack/prompts settings menu via runConfigMenu().
  // Exits 0 on save or cancel (the menu handles both without an error code
  // distinction — the user chose to exit). The session-level exit is always
  // clean because runConfigMenu catches all prompts.
  if (argv[0] === "config") {
    const { runConfigMenu } = await import("./config-menu.js");
    await runConfigMenu();
    process.exit(0);
    return;
  }

  // Phase 18 Plan 04: `transcripts` subcommand dynamic-import gate.
  // list  -> transcriptsList()  — prints ~/.achilles/transcripts/ contents.
  // purge -> transcriptsPurge() — interactive delete menu.
  // else  -> stderr + exit 1.
  // INIT-07: transcripts/cli.js and its @clack/prompts import load only here.
  if (argv[0] === "transcripts") {
    const sub = argv[1];
    if (sub === "list") {
      const { transcriptsList } = await import("./transcripts/cli.js");
      await transcriptsList();
      process.exit(0);
      return;
    }
    if (sub === "purge") {
      const { transcriptsPurge } = await import("./transcripts/cli.js");
      await transcriptsPurge();
      process.exit(0);
      return;
    }
    process.stderr.write("achilles transcripts: try list or purge.\n");
    process.exit(1);
    return;
  }

  // Phase 16 + Phase 18 Plan 04: `voice` subcommand dynamic-import gate.
  // Phase 18 wraps the existing gate with SAFE-04 lock acquisition:
  //   1. acquireLock() from lock-file.js BEFORE session.js dynamic import.
  //   2. On { ok: false }, print the explicit conflict message + exit 1.
  //   3. On { ok: true }, proceed to runVoice() as in Phase 16/17.
  // releaseLock is NOT called here — graceful-shutdown.ts registers a
  // process.once("exit") unlink so calling releaseLock() here would race.
  // INIT-07: session.js and its transitive ink + react + chalk + sox + VAD
  // imports load LAZILY so `achilles --version` never pays the cost
  // of any of those modules.
  if (argv[0] === "voice") {
    const { acquireLock } = await import("./lock-file.js");
    const lockState = acquireLock();
    if (!lockState.ok) {
      process.stderr.write(
        `Another achilles voice session is running (pid ${lockState.runningPid}). Press Ctrl-C in that terminal first.\n`,
      );
      process.exit(1);
      return;
    }
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
