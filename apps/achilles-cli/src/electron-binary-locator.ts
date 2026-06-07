/**
 * Platform-aware locator for the bundled Electron binary.
 *
 * Plan 13-01 ships the published npm package `achilles`. At
 * `npm install -g` time, the Electron app body lands under
 * `node_modules/achilles/dist/` in one of three platform-specific
 * shapes:
 *
 *   - darwin: `<pkgRoot>/dist/Achilles.app/Contents/MacOS/Achilles`
 *   - win32:  `<pkgRoot>/dist/Achilles.exe`
 *   - linux:  `<pkgRoot>/dist/linux/achilles`
 *
 * Plan 13-04 owns the publish-time build that materialises those paths;
 * Plan 13-01 owns the runtime resolution path. The locator is a pure
 * function over an injected `fileExistsAt` seam so unit tests run
 * without touching the filesystem; the production wiring at
 * apps/achilles-cli/src/cli.ts binds `fileExistsAt` to a synchronous
 * `fs.existsSync` call and `pkgRoot` to the absolute directory two
 * levels above the compiled `dist/cli.js` entrypoint.
 *
 * Errors:
 *
 *   - `ElectronBinaryMissingError` — the platform was recognised but
 *     the expected file does not exist. The launchCommand surfaces this
 *     to the user with a stderr line naming the expected path and the
 *     platform (Plan 13-01 Test LC2).
 *   - Plain `Error("Unsupported platform: <value>")` — the platform
 *     identifier is not one of darwin/win32/linux. There is no Phase 13
 *     remediation for unknown platforms; the user is told their OS is
 *     not supported.
 *
 * Threat model: T-13-02 (information disclosure) — the error messages
 * name only the platform identifier (from `process.platform`) and the
 * expected absolute path under `dist/`. They NEVER read or interpolate
 * environment variables, so a misconfigured shell cannot leak secrets
 * into the locator's diagnostics. Cross-checked by Test LC2 which
 * asserts the stderr line contains only platform + path.
 */

import { join as posixJoin } from "node:path/posix";

/**
 * Thrown when the locator recognises the platform but the expected
 * Electron binary file is not present on disk. Carries the platform
 * identifier and the expected absolute path in the message so the
 * launchCommand can render a remediation-specific stderr line without
 * re-deriving the path. `name` is set explicitly so V8 stack traces
 * print the class identity even after minification.
 *
 * @public
 */
export class ElectronBinaryMissingError extends Error {
  public override readonly name = "ElectronBinaryMissingError";

  public constructor(message: string) {
    super(message);
    // Restore prototype chain after the Error superclass call. This is
    // the standard workaround for TS subclassing of built-in Error per
    // https://github.com/microsoft/TypeScript-wiki/blob/main/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, ElectronBinaryMissingError.prototype);
  }
}

/**
 * Options for the locator. The `fileExistsAt` seam makes the function
 * pure under unit test; production bound to `fs.existsSync` at the
 * cli.ts entry point.
 *
 * @public
 */
export interface LocateElectronBinaryOptions {
  /** Absolute path to the package root (i.e., the directory containing `dist/`). */
  readonly pkgRoot: string;
  /** Platform identifier; pass `process.platform` in production. */
  readonly platform: NodeJS.Platform;
  /** Synchronous file-existence predicate; bound to `fs.existsSync` in production. */
  readonly fileExistsAt: (absolutePath: string) => boolean;
}

/**
 * Relative segments under `dist/` for each supported platform.
 *
 * Why we use POSIX joining uniformly (not `path.win32.join` on win32):
 *
 *   - Modern Windows (Win10+) `fs.existsSync` accepts forward slashes
 *     in absolute paths transparently; the underlying NT object manager
 *     normalises `/` to `\` before resolution.
 *
 *   - The Plan 13-01 Test L2 fixture passes `pkgRoot: "/pkg"` and
 *     expects the locator to return `'/pkg/dist/Achilles.exe'` —
 *     i.e., forward-slash style irrespective of platform — because the
 *     tests run on a developer's host (which may be macOS or Linux)
 *     while exercising the win32 code path. Using `path.win32.join`
 *     would yield `\pkg\dist\Achilles.exe`, breaking the test contract.
 *
 *   - The production runtime feeds `pkgRoot` from `path.resolve(HERE, "..")`
 *     which is platform-native already; concatenating POSIX `dist/...`
 *     under a Windows absolute root (e.g., `C:\Program Files\...`) is
 *     valid because Windows accepts mixed separators in absolute paths.
 *
 * If a future portability bug surfaces because Node's `fs.existsSync`
 * is invoked on a path with mixed separators on a niche Windows
 * configuration, the fix is at the call site (production wiring at
 * cli.ts can pass a POSIX-friendly pkgRoot or a normalising
 * fileExistsAt), not in this pure function.
 */
const relativeBinaryFor = (
  platform: NodeJS.Platform,
): { readonly segments: readonly string[] } => {
  switch (platform) {
    case "darwin":
      return {
        segments: ["dist", "Achilles.app", "Contents", "MacOS", "Achilles"],
      };
    case "win32":
      return { segments: ["dist", "Achilles.exe"] };
    case "linux":
      return { segments: ["dist", "linux", "achilles"] };
    default:
      throw new Error(`Unsupported platform: ${String(platform)}`);
  }
};

/**
 * Resolve the absolute path to the bundled Electron binary for the
 * current platform. Returns the absolute path on success; throws
 * `ElectronBinaryMissingError` when the platform is supported but the
 * file is absent, or a plain `Error("Unsupported platform: ...")` when
 * the platform identifier is not one of darwin/win32/linux.
 *
 * @public
 */
export function locateElectronBinary(
  opts: LocateElectronBinaryOptions,
): string {
  const { pkgRoot, platform, fileExistsAt } = opts;
  const { segments } = relativeBinaryFor(platform);
  const absolutePath = posixJoin(pkgRoot, ...segments);
  if (!fileExistsAt(absolutePath)) {
    throw new ElectronBinaryMissingError(
      `Electron binary not found for platform ${platform} at ${absolutePath}. Did you run \`npm install\`?`,
    );
  }
  return absolutePath;
}
