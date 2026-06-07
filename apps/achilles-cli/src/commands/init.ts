/**
 * `achilles init` — placeholder.
 *
 * Plan 13-01 ships only the command surface so cli.ts can route to a
 * stable import path. Plan 13-03 REPLACES this file with the real
 * first-run wizard (API key entry, mic permission, smoke round-trip)
 * (REQUIREMENTS.md DIST-04).
 */

import type { WritableSeam } from "./launch.js";

export interface InitDeps {
  readonly stdout: WritableSeam;
  readonly processExitImpl: (code: number) => void;
}

export function initCommand(deps: InitDeps): void {
  deps.stdout.write(
    "[achilles] init: placeholder — Plan 13-03 implements this.\n",
  );
  deps.processExitImpl(1);
}
