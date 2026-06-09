/**
 * CAP-01 — sox child process wrapper (Phase 16, Plan 01, Task 1).
 *
 * Spawns the per-platform sox child producing 16k mono s16le raw PCM frames
 * over stdout and surfaces non-zero exits + stderr to the caller. The factory
 * accepts a `spawnImpl` injection seam plus a `platformOverride` so the
 * surface is fully unit-testable without touching a real microphone.
 *
 * PITFALLS.md §1 silent-launch defence:
 * - `stdio` is HARD-CODED to `["ignore", "pipe", "pipe"]`. NEVER `"ignore"`
 *   on stdout or stderr — that is the structural failure shape this codebase
 *   exists to prevent (apps/achilles-cli/src/commands/launch.ts:155 is the
 *   v1.2 anti-pattern). Phase 19 GATE-04 lint rule will enforce this with
 *   AST-level no-restricted-syntax; Phase 16 already complies.
 * - Every `exit` event surfaces both the exit code AND the captured stderr
 *   buffer via `onExit(code, stderr)`. There is no silent-swallow path.
 * - Respawn-on-device-died is OUT OF SCOPE for Phase 16. Phase 19 ERR-03
 *   owns the cap-3-in-10s watchdog. Phase 16's job is to FAIL VISIBLY.
 *
 * Frame extraction:
 * - 16kHz mono s16le = 32000 bytes/sec = 640 bytes per 20ms frame.
 * - sox may deliver chunks of any size; a Buffer accumulator pairs partial
 *   chunks until 640 bytes are buffered, at which point a zero-copy
 *   Int16Array view (length 320) is emitted via `onFrame`.
 * - `new Int16Array(buffer, byteOffset, length)` shares the underlying
 *   ArrayBuffer — no allocation per frame.
 */
import { EventEmitter } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess, spawn as spawnFn } from "node:child_process";

/**
 * 20ms of 16kHz mono s16le PCM = 640 bytes per frame.
 */
const FRAME_BYTES = 640;

/** Public handle returned by {@link createMicSox}. */
export interface MicSoxHandle {
  /**
   * Sends SIGTERM to the child and resolves once the child's `exit` event
   * fires. Idempotent: calling stop() twice is safe (the second call still
   * resolves after the same exit signal).
   */
  stop(): Promise<void>;
  /**
   * Reflects the underlying child status. `"running"` until the child emits
   * `exit`; `"exited"` thereafter.
   */
  readonly currentStatus: "running" | "exited";
  /**
   * Phase 19 Plan 02 Task 2 (ERR-03): the underlying sox child process,
   * exposed as a narrow ChildProcessExitLike surface so the dual-arm
   * createChildExitWatchdog can attach its on("exit") listener. The
   * watchdog never reads stdout/stderr/stdin from this reference; it only
   * observes the exit edge. Phase 17's child-exit-watchdog.ts owns the
   * 3-in-10s sliding-window cap; session.ts constructs the watchdog and
   * passes this child reference at wireAudioBridges() time.
   */
  readonly child: ChildProcess;
}

/** Options accepted by {@link createMicSox}. */
export interface MicSoxOptions {
  /**
   * Called for every 640-byte (320-sample) PCM frame. The Int16Array is a
   * zero-copy view over the accumulated Buffer slice — callers must not
   * retain references past the synchronous handler. Compute RMS or copy
   * before returning.
   */
  onFrame: (frame: Int16Array) => void;
  /**
   * Called once when the child exits. `code` is the exit code (or null for
   * signal-terminated). `stderr` is the full accumulated stderr text — empty
   * string if the child wrote nothing to stderr.
   */
  onExit: (code: number | null, stderr: string) => void;
  /**
   * Deterministic spawn seam for unit tests. Production callers leave this
   * undefined and the factory imports `node:child_process` at module load.
   */
  spawnImpl?: typeof spawnFn;
  /**
   * Overrides `process.platform` for testing the win32 vs POSIX argv branch
   * without actually running on Windows.
   */
  platformOverride?: NodeJS.Platform;
}

/**
 * Spawns sox (`rec` on POSIX, `sox.exe` on win32) and produces 640-byte PCM
 * frames over stdout. See module-level doc-comment for invariants.
 */
export function createMicSox(options: MicSoxOptions): MicSoxHandle {
  const platform = options.platformOverride ?? process.platform;
  const cmd = platform === "win32" ? "sox.exe" : "rec";
  const args =
    platform === "win32"
      ? [
          "-q",
          "-d",
          "-t",
          "raw",
          "-r",
          "16000",
          "-b",
          "16",
          "-e",
          "signed",
          "-c",
          "1",
          "-",
        ]
      : [
          "-q",
          "-t",
          "raw",
          "-r",
          "16000",
          "-b",
          "16",
          "-e",
          "signed",
          "-c",
          "1",
          "-",
        ];

  // Resolve the spawn implementation. Production callers leave spawnImpl
  // undefined and we use the statically-imported node:child_process.spawn.
  // Tests inject a deterministic spy via spawnImpl to avoid spawning a real
  // sox child.
  const doSpawn: typeof spawnFn = options.spawnImpl ?? nodeSpawn;

  // stdio MUST be ["ignore", "pipe", "pipe"] — see PITFALLS.md §1.
  const proc = doSpawn(cmd, args, {
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcess;

  let currentStatus: "running" | "exited" = "running";
  let stderrCapture = "";
  // Buffer accumulator for partial chunks. We use a single growing Buffer
  // because node:Buffer.concat is O(n) per call, but the per-tick chunk size
  // from sox is bounded (~few KB max), so the amortized cost is fine.
  //
  // The widened `Buffer` (no generic parameter) is intentional — Buffer.concat
  // returns Buffer<ArrayBufferLike> which is not assignable to the narrower
  // Buffer<ArrayBuffer> default inferred from Buffer.alloc. We do not need the
  // narrower type because the Int16Array view below accesses .buffer via the
  // ArrayBufferLike interface in any case.
  let pending: Buffer = Buffer.alloc(0);

  // Listeners attached IMMEDIATELY after spawn so no exit can be missed.
  // Using EventEmitter null-check below to satisfy strictNullChecks under
  // the ChildProcess type; in practice with stdio:"pipe" both pipes exist.
  const stdout = proc.stdout;
  if (stdout) {
    stdout.on("data", (chunk: Buffer) => {
      // Append to pending buffer, then emit complete 640-byte frames.
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= FRAME_BYTES) {
        const slice = pending.subarray(0, FRAME_BYTES);
        // Zero-copy Int16Array view over the slice. Note: slice.buffer is the
        // underlying ArrayBuffer of the larger pending Buffer; the byteOffset
        // + length together restrict the view to just the 640 frame bytes.
        const frame = new Int16Array(
          slice.buffer,
          slice.byteOffset,
          slice.byteLength / 2,
        );
        options.onFrame(frame);
        pending = pending.subarray(FRAME_BYTES);
      }
    });
  }

  const stderr = proc.stderr;
  if (stderr) {
    stderr.on("data", (chunk: Buffer) => {
      stderrCapture += chunk.toString("utf8");
    });
  }

  (proc as unknown as EventEmitter).on("exit", (code: number | null) => {
    currentStatus = "exited";
    options.onExit(code, stderrCapture);
  });

  return {
    stop(): Promise<void> {
      return new Promise<void>((resolve) => {
        (proc as unknown as EventEmitter).once("exit", () => resolve());
        proc.kill("SIGTERM");
      });
    },
    get currentStatus(): "running" | "exited" {
      return currentStatus;
    },
    // Phase 19 Plan 02 Task 2 (ERR-03): expose the child reference so
    // the watchdog can attach its exit listener.
    get child(): ChildProcess {
      return proc;
    },
  };
}
