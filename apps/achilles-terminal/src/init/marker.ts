/**
 * Phase 18, Plan 02, Task 3 — Init marker module (INIT-04 + INIT-05 substrate).
 *
 * Writes and reads ~/.achilles/init.json so that `achilles voice` can skip the
 * wizard on subsequent runs (INIT-04: "writes a marker at the end of the wizard
 * flow") and the wizard itself can read existing defaults for idempotent re-runs
 * (INIT-05: "re-running achilles init reads existing config for 'keep current'
 * defaults").
 *
 * The marker file is a small JSON object with:
 *   - `initializedAt`: ISO timestamp of first init run
 *   - `version`: achilles-terminal package version at init time
 *   - `apiKeySource`: which tier of the three-tier resolver was used
 *
 * File is written at 0o600 with the parent directory at 0o700 (T-18-13).
 *
 * No emojis (CLAUDE.md global).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync as nodeMkdirSync,
  chmodSync as nodeChmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The shape of the init marker file.
 *
 * @public
 */
export interface InitMarker {
  /** ISO 8601 timestamp when the init wizard completed. */
  readonly initializedAt: string;
  /** achilles-terminal npm package version at init time. */
  readonly version: string;
  /** Which tier of the three-tier API key resolver was used to store the key. */
  readonly apiKeySource: "env" | "keychain" | "encrypted-file";
}

/**
 * Dependency injection seam for testing. Tests inject homedirImpl to point
 * at a tmpdir, chmodSyncImpl to assert the call, and mkdirSyncImpl to spy.
 *
 * @public
 */
export interface MarkerDeps {
  /**
   * Override os.homedir(). Tests inject a tmpdir path.
   */
  homedirImpl?: () => string;
  /**
   * Override chmodSync for assertions. Defaults to node:fs.chmodSync.
   */
  chmodSyncImpl?: (path: string, mode: number) => void;
  /**
   * Override mkdirSync for assertions. Defaults to node:fs.mkdirSync.
   */
  mkdirSyncImpl?: (
    path: string,
    opts: { recursive: boolean; mode: number },
  ) => void;
}

/**
 * Resolved path to the init marker file.
 * Uses the real homedir at module load time — tests should pass deps instead
 * of relying on this constant.
 *
 * @public
 */
export const INIT_MARKER_PATH: string = join(homedir(), ".achilles", "init.json");

/**
 * Resolve the marker path from deps (or fall back to the module-level constant).
 */
function markerPath(deps: MarkerDeps = {}): string {
  const homedirImpl = deps.homedirImpl ?? homedir;
  return join(homedirImpl(), ".achilles", "init.json");
}

/**
 * Return true iff ~/.achilles/init.json exists.
 *
 * @public
 */
export function hasInitMarker(deps: MarkerDeps = {}): boolean {
  return existsSync(markerPath(deps));
}

/**
 * Read and parse the init marker. Returns null if the file is absent or
 * contains unparseable JSON.
 *
 * @public
 */
export function readInitMarker(deps: MarkerDeps = {}): InitMarker | null {
  const path = markerPath(deps);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as InitMarker;
  } catch {
    return null;
  }
}

/**
 * Write the init marker to disk at 0o600. Creates the parent directory
 * (~/.achilles) at 0o700 if it does not yet exist.
 *
 * @public
 */
export function writeInitMarker(
  marker: InitMarker,
  deps: MarkerDeps = {},
): void {
  const path = markerPath(deps);
  const achillesDir = join(path, "..");
  const chmodSyncImpl = deps.chmodSyncImpl ?? nodeChmodSync;
  const mkdirSyncImpl = deps.mkdirSyncImpl ?? nodeMkdirSync;

  mkdirSyncImpl(achillesDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(marker, null, 2), { mode: 0o600 });
  chmodSyncImpl(path, 0o600);
}
