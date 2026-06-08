/**
 * React adapter — useSyncExternalStore hooks (Phase 16, Plan 04, Task 1).
 *
 * The Session EventEmitter (Plan 04 src/session.ts) is the source of truth.
 * React subscribes to the four event channels via three hooks:
 *
 *   useAchillesState(session) -> AchillesState   (state-change subscription)
 *   useAmplitude(session)     -> number          (amplitude subscription)
 *   useRingBuffer(session)    -> { ring, writeIndex }  (rms-sample subscription)
 *
 * Pattern source: 16-RESEARCH.md §"Pattern 4: useSyncExternalStore for
 * orchestrator -> React state projection" lines 391-406 (verbatim shape).
 *
 * Snapshot referential equality (useRingBuffer):
 *   React's useSyncExternalStore re-renders when the snapshot returned by
 *   getSnapshot is referentially distinct from the previous snapshot. The
 *   Session caches a stable { ring, writeIndex } object reference and only
 *   constructs a new one when writeIndex advances, so consumers see a
 *   stable reference across non-amplitude ticks.
 *
 * LOOP-02 invariant: zero imports from the four voice runtime packages,
 * the claude bridge package, or the achilles skill package. Only react +
 * the local Session type.
 *
 * No emojis (CLAUDE.md global).
 */
import { useSyncExternalStore } from "react";
import type { AchillesState } from "../state/constants.js";
import type { Session } from "../session.js";

/**
 * Subscribe to session.state-change. Returns the current AchillesState.
 *
 * Verbatim shape from 16-RESEARCH.md §"Pattern 4" lines 391-406.
 */
export function useAchillesState(session: Session): AchillesState {
  return useSyncExternalStore(
    (cb) => {
      session.on("state-change", cb);
      return () => {
        session.off("state-change", cb);
      };
    },
    () => session.currentState,
    () => session.currentState,
  );
}

/**
 * Subscribe to session.amplitude. Returns the latest scalar amplitude (drives
 * the Blob component's amplitude prop in non-idle/non-processing states).
 */
export function useAmplitude(session: Session): number {
  return useSyncExternalStore(
    (cb) => {
      session.on("amplitude", cb);
      return () => {
        session.off("amplitude", cb);
      };
    },
    () => session.currentAmplitude,
    () => session.currentAmplitude,
  );
}

/**
 * Subscribe to session.rms-sample. Returns the stable { ring, writeIndex }
 * object reference cached by the session — referential equality is
 * preserved across non-write ticks so React skips re-renders unless the
 * cursor advanced.
 */
export function useRingBuffer(session: Session): {
  ring: Float32Array;
  writeIndex: number;
} {
  return useSyncExternalStore(
    (cb) => {
      session.on("rms-sample", cb);
      return () => {
        session.off("rms-sample", cb);
      };
    },
    () => session.currentRingBuffer,
    () => session.currentRingBuffer,
  );
}
