/**
 * Phase 18, Plan 02, Task 4 — Single-instance lock enforcement (SAFE-04).
 *
 * Enforces the single-instance invariant at startup: only one `achilles voice`
 * session may hold the mic and the ElevenLabs WSS at a time.
 *
 * How it works:
 *   - acquireLock() reads ~/.achilles/voice.lock (the path is LOCK_FILE from
 *     Phase 17's resume-session.ts; we do NOT duplicate the constant).
 *   - If absent: write `{ pid: process.pid, startTime: Date.now() }` at 0o600;
 *     return { ok: true }.
 *   - If present + valid JSON + isPidAlive(pid) true: return { ok: false, runningPid }.
 *   - If present + invalid JSON OR isPidAlive false: stale lock; unlink + retry.
 *   - releaseLock() unlinkSync wrapped in try/catch — idempotent with the
 *     process.once("exit") last-chance unlink in graceful-shutdown.ts.
 *
 * isPidAlive(pid) uses process.kill(pid, 0) (the kill-0 probe):
 *   - No throw  -> process exists (or we lack perms to even probe) -> true
 *   - ESRCH     -> process is dead -> false (stale lock; safe to overwrite)
 *   - EPERM     -> process exists but is not ours -> true (conservative; fail-closed)
 *   - Other     -> default to true (fail-closed on unknown error)
 *
 * Thread model: acquireLock is NOT atomic across processes. There is a short
 * TOCTOU window between existsSync and writeFileSync. For a single-user CLI
 * launched from an interactive terminal this is acceptable — the race requires
 * two concurrent launches timed to the millisecond with identical user accounts.
 *
 * Idempotency with graceful-shutdown.ts:
 *   graceful-shutdown.ts calls unlinkSync(LOCK_FILE) inside process.once("exit").
 *   releaseLock() also calls unlinkSync — whichever runs first "wins"; the second
 *   call catches ENOENT and silently no-ops. This is the correct behaviour.
 *
 * No emojis (CLAUDE.md global).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { LOCK_FILE, ACHILLES_HOME } from "./resume-session.js";

/**
 * Result of acquireLock.
 *
 * @public
 */
export type LockState =
  | { readonly ok: true }
  | { readonly ok: false; readonly runningPid: number; readonly startTime?: number };

/**
 * Dependency injection seam for acquireLock / releaseLock.
 *
 * @public
 */
export interface LockFileDeps {
  /**
   * Override the lock file path. Defaults to LOCK_FILE from resume-session.ts.
   * Tests inject a tmpdir path so they do not touch ~/.achilles/voice.lock.
   */
  lockFilePathImpl?: string;
  /**
   * Override process.kill(pid, 0) — the liveness probe. The function must
   * return true if the process is alive, false if it threw ESRCH.
   * Tests inject a recording fake to exercise the dead-PID / EPERM paths.
   */
  killImpl?: (pid: number, sig: number) => boolean;
  /**
   * Override process.pid. Tests inject a deterministic value.
   */
  pidImpl?: () => number;
  /**
   * Override Date.now. Tests inject a deterministic timestamp.
   */
  clockImpl?: () => number;
}

/**
 * Check whether a process with the given PID is alive.
 *
 * Uses the kill-0 probe: `process.kill(pid, 0)` sends no signal but verifies
 * that the calling process could send a signal to `pid`. Throws ESRCH when the
 * PID is not running.
 *
 * @public
 */
export function isPidAlive(
  pid: number,
  killImpl?: (pid: number, sig: number) => boolean,
): boolean {
  const impl = killImpl ?? ((p: number, sig: number) => {
    process.kill(p, sig);
    return true;
  });

  try {
    return impl(pid, 0);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") {
      // Process is dead — stale lock.
      return false;
    }
    if (code === "EPERM") {
      // Process exists but we lack permission to probe it.
      // Treat as alive (fail-closed).
      return true;
    }
    // Unknown error — fail-closed (assume alive).
    return true;
  }
}

/**
 * Internal lock file payload shape.
 */
interface LockPayload {
  pid: number;
  startTime: number;
}

/**
 * Attempt to acquire the single-instance lock.
 *
 * @public
 */
export function acquireLock(deps: LockFileDeps = {}): LockState {
  const lockPath = deps.lockFilePathImpl ?? LOCK_FILE;
  const killImpl = deps.killImpl;
  const pidImpl = deps.pidImpl ?? (() => process.pid);
  const clockImpl = deps.clockImpl ?? (() => Date.now());

  // Ensure the home directory exists.
  try {
    mkdirSync(ACHILLES_HOME, { recursive: true, mode: 0o700 });
  } catch {
    // best-effort — ACHILLES_HOME may already exist or may not be writable.
  }

  if (existsSync(lockPath)) {
    try {
      const raw = readFileSync(lockPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<LockPayload>;

      if (typeof parsed.pid === "number") {
        if (isPidAlive(parsed.pid, killImpl)) {
          // Live process owns the lock.
          return {
            ok: false,
            runningPid: parsed.pid,
            startTime: parsed.startTime,
          };
        }
        // Process is dead — stale lock; fall through to unlink + retry.
      }
      // Invalid payload — treat as stale.
    } catch {
      // Malformed JSON or read error — treat as stale.
    }

    // Stale lock: remove it.
    try {
      unlinkSync(lockPath);
    } catch {
      // best-effort; file may have been removed by another process.
    }
  }

  // Write a fresh lock.
  const payload: LockPayload = {
    pid: pidImpl(),
    startTime: clockImpl(),
  };
  writeFileSync(lockPath, JSON.stringify(payload), { mode: 0o600 });

  return { ok: true };
}

/**
 * Release the single-instance lock by unlinking the file.
 *
 * Idempotent: ENOENT (file already gone) is silently ignored so this call
 * is safe to invoke even after graceful-shutdown.ts's process.once("exit")
 * last-chance unlink has already run.
 *
 * @public
 */
export function releaseLock(deps: LockFileDeps = {}): void {
  const lockPath = deps.lockFilePathImpl ?? LOCK_FILE;
  try {
    unlinkSync(lockPath);
  } catch {
    // ENOENT is expected when graceful-shutdown.ts already released the lock.
    // Any other error is also silently ignored — best-effort cleanup.
  }
}
