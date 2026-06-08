/**
 * Phase 17, Plan 04, Task 3 — LOOP-06 lock-file + session-state
 * persistence + --resume <sid> hydration substrate.
 *
 * Implements the file mechanics for the lock + session-state shape;
 * Phase 18 adds the interactive picker UX + lock-conflict resolution
 * UI on top of these primitives.
 *
 * Public surface:
 *
 *   - ACHILLES_HOME  = path.join(os.homedir(), ".achilles")
 *   - SESSION_DIR    = path.join(ACHILLES_HOME, "sessions")
 *   - LOCK_FILE      = path.join(ACHILLES_HOME, "voice.lock")
 *   - createResumeSession(deps?): ResumeSessionHandle
 *
 * Handle methods:
 *   - ensureHome(): void — mkdirSync 0o700 idempotent
 *   - acquireLock(): { ok: true } | { ok: false; runningPid: number }
 *   - releaseLock(): void — unlinkSync idempotent
 *   - persistSessionState(sid, state): void — JSON file 0o600
 *   - hydrateSession(sid): SessionState | null
 *   - listSessions(): SessionSummary[]
 *
 * Threat model ties:
 *   - T-17-17 mitigate — stale-lock detection via kill(-0); stale
 *     PIDs do not block legitimate restart.
 *   - T-17-18 mitigate — 0o700 dir + 0o600 file modes restrict
 *     access to the owning user on POSIX systems.
 *   - T-17-20 mitigate — gracefulShutdown's process.once("exit") +
 *     this module's releaseLock both unlinkSync the file.
 *
 * No emojis (CLAUDE.md global).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { StructuredLogger } from "./structured-logger.js";

/**
 * Resolved ~/.achilles/ directory path.
 *
 * @public
 */
export const ACHILLES_HOME = join(homedir(), ".achilles");

/**
 * Resolved ~/.achilles/sessions/ directory path for persisted
 * session state files (sid.json).
 *
 * @public
 */
export const SESSION_DIR = join(ACHILLES_HOME, "sessions");

/**
 * Resolved ~/.achilles/voice.lock file path. The lock-file content
 * is a single-line JSON object { pid, startTime }.
 *
 * @public
 */
export const LOCK_FILE = join(ACHILLES_HOME, "voice.lock");

/**
 * Persisted session state — the shape written to
 * ~/.achilles/sessions/<sid>.json. Phase 17 captures a minimal set
 * of fields; Phase 18 will extend with the full latency-probe
 * snapshot + circuit-breaker status + transcript-store opt-in.
 *
 * @public
 */
export interface SessionState {
  readonly sid: string;
  readonly status: "active" | "ended";
  readonly startTime: number;
  readonly lastTranscript?: string;
  readonly latencyP50?: number;
  readonly latencyP95?: number;
}

/**
 * Lightweight summary returned by listSessions(). Used by the
 * Phase 18 picker UI.
 *
 * @public
 */
export interface SessionSummary {
  readonly sid: string;
  readonly startTime: number;
  readonly status: "active" | "ended";
}

/**
 * Result of acquireLock(). On success the file is written; on
 * failure the existing live PID is reported back to the caller.
 *
 * @public
 */
export type AcquireLockResult =
  | { ok: true }
  | { ok: false; runningPid: number };

/**
 * Public handle returned by createResumeSession.
 *
 * @public
 */
export interface ResumeSessionHandle {
  ensureHome(): void;
  acquireLock(): AcquireLockResult;
  releaseLock(): void;
  persistSessionState(sid: string, state: Omit<SessionState, "sid">): void;
  hydrateSession(sid: string): SessionState | null;
  listSessions(): SessionSummary[];
}

/**
 * Construction-time options for createResumeSession.
 *
 * @public
 */
export interface CreateResumeSessionDeps {
  /**
   * Override the home directory. Defaults to os.homedir() — tests
   * inject a tmpdir.
   */
  readonly homeDir?: string;
  /**
   * Clock seam — Date.now() default.
   */
  readonly nowImpl?: () => number;
  /**
   * Optional structured logger sink.
   */
  readonly logger?: StructuredLogger;
  /**
   * Override the kill(-0) probe used to detect live PIDs. The
   * default uses process.kill with signal=0. Tests inject a recording
   * fake so the stale-PID path is deterministic.
   */
  readonly killProbe?: (pid: number) => boolean;
  /**
   * Override process.pid for testability. Defaults to process.pid.
   */
  readonly pidImpl?: () => number;
}

/**
 * Internal lock-file payload shape.
 */
interface LockPayload {
  pid: number;
  startTime: number;
}

/**
 * Probe whether a PID is alive via `process.kill(pid, 0)`. The
 * signal=0 form does NOT send a signal; it only verifies the PID is
 * a live process the caller could send to. Throws ESRCH when the
 * PID is dead; we map that to `false`.
 */
function defaultKillProbe(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ESRCH") return false;
    // EPERM means the PID exists but we lack permission — still
    // counts as alive for our purposes.
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Construct a resume-session handle.
 *
 * @public
 */
export function createResumeSession(
  deps: CreateResumeSessionDeps = {},
): ResumeSessionHandle {
  const home = deps.homeDir ?? ACHILLES_HOME;
  const sessionDir = join(home, "sessions");
  const lockFile = join(home, "voice.lock");
  const nowImpl = deps.nowImpl ?? ((): number => Date.now());
  const killProbe = deps.killProbe ?? defaultKillProbe;
  const pidImpl = deps.pidImpl ?? ((): number => process.pid);

  function ensureHome(): void {
    try {
      mkdirSync(home, { recursive: true, mode: 0o700 });
    } catch {
      // best-effort; mkdirSync recursive is idempotent.
    }
    try {
      mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
    } catch {
      // best-effort.
    }
  }

  function acquireLock(): AcquireLockResult {
    ensureHome();
    // Read existing lock if present.
    if (existsSync(lockFile)) {
      try {
        const raw = readFileSync(lockFile, "utf8");
        const parsed = JSON.parse(raw) as Partial<LockPayload>;
        if (typeof parsed.pid === "number" && killProbe(parsed.pid)) {
          // Live process owns the lock.
          return { ok: false, runningPid: parsed.pid };
        }
      } catch {
        // Malformed lock file — treat as stale.
      }
    }
    // Write a fresh lock with the current PID.
    const payload: LockPayload = {
      pid: pidImpl(),
      startTime: nowImpl(),
    };
    writeFileSync(lockFile, JSON.stringify(payload), { mode: 0o600 });
    deps.logger?.info("resume_session_lock_acquired", {
      pid: payload.pid,
    });
    return { ok: true };
  }

  function releaseLock(): void {
    try {
      unlinkSync(lockFile);
      deps.logger?.info("resume_session_lock_released", {});
    } catch {
      // best-effort; ENOENT is expected when graceful-shutdown
      // already unlinked the file.
    }
  }

  function persistSessionState(
    sid: string,
    state: Omit<SessionState, "sid">,
  ): void {
    ensureHome();
    const full: SessionState = { ...state, sid };
    const path = join(sessionDir, `${sid}.json`);
    writeFileSync(path, JSON.stringify(full), { mode: 0o600 });
    deps.logger?.info("resume_session_persisted", { sid });
  }

  function hydrateSession(sid: string): SessionState | null {
    const path = join(sessionDir, `${sid}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionState>;
      if (
        typeof parsed.sid !== "string" ||
        typeof parsed.status !== "string" ||
        typeof parsed.startTime !== "number"
      ) {
        return null;
      }
      return parsed as SessionState;
    } catch {
      return null;
    }
  }

  function listSessions(): SessionSummary[] {
    try {
      ensureHome();
    } catch {
      return [];
    }
    let entries: string[];
    try {
      entries = readdirSync(sessionDir);
    } catch {
      return [];
    }
    const out: SessionSummary[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const sid = entry.slice(0, -".json".length);
      const path = join(sessionDir, entry);
      try {
        const raw = readFileSync(path, "utf8");
        const parsed = JSON.parse(raw) as Partial<SessionState>;
        if (
          typeof parsed.startTime === "number" &&
          (parsed.status === "active" || parsed.status === "ended")
        ) {
          out.push({
            sid,
            startTime: parsed.startTime,
            status: parsed.status,
          });
        }
      } catch {
        // skip malformed
      }
    }
    // Sort by startTime descending (newest first).
    out.sort((a, b) => b.startTime - a.startTime);
    return out;
  }

  return {
    ensureHome,
    acquireLock,
    releaseLock,
    persistSessionState,
    hydrateSession,
    listSessions,
  };
}

/**
 * Convenience helper that delegates to the default handle. Phase
 * 17's Plan 04 Task 1 session.ts uses this from inside runVoice
 * when --resume <sid> is supplied. Phase 18 will rewire to the
 * configured handle when init-wizard onboards.
 *
 * @public
 */
export function statSyncSafe(path: string): { mtimeMs: number } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}
