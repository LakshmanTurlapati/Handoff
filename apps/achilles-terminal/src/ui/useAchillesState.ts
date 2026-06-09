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
 * Phase 19, Plan 02, Task 1 extends this module with a fourth hook
 * (useErrorBanner) that maps SessionEvent error variants through the
 * error-classifier into the ClassifiedBanner shape consumed by
 * Banner.tsx. The hook subscribes to the typed "event" channel on the
 * Session (Phase 17 SessionEvent fan-out), classifies any
 * `{type:"error"}` event, and bumps an errorNonce so the Banner's
 * useEffect timer resets cleanly (Pitfall 7). On any non-error event
 * the hook bumps successNonce so the Banner can dismiss early.
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
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AchillesState } from "../state/constants.js";
import type { Session } from "../session.js";
import type { SessionEvent } from "../session-events.js";
import {
  classifyForBanner,
  type ClassifiedBanner,
} from "../error-classifier.js";

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

/**
 * Phase 19, Plan 02, Task 1 — useErrorBanner.
 *
 * Subscribes to the Phase 17 typed `event` channel on Session and
 * derives the three values Banner.tsx consumes:
 *
 *   errorClass    — ClassifiedBanner | null (null until first error)
 *   errorNonce    — bumped on every `{type: "error"}` event so
 *                   Banner's auto-dismiss timer resets cleanly
 *                   (Pitfall 7 guard)
 *   successNonce  — bumped on every NON-error event so Banner can
 *                   dismiss early on the next successful interaction
 *
 * Used by VoiceShell.tsx to wire the Banner into the D-10 layout.
 *
 * @public
 */
export function useErrorBanner(session: Session): {
  errorClass: ClassifiedBanner | null;
  errorNonce: number;
  successNonce: number;
} {
  const [errorClass, setErrorClass] = useState<ClassifiedBanner | null>(null);
  const [errorNonce, setErrorNonce] = useState<number>(0);
  const [successNonce, setSuccessNonce] = useState<number>(0);

  useEffect(() => {
    const onEvent = (ev: SessionEvent): void => {
      if (ev.type === "error") {
        setErrorClass(classifyForBanner(ev.payload.classification));
        setErrorNonce((n) => n + 1);
      } else {
        setSuccessNonce((n) => n + 1);
      }
    };
    session.on("event", onEvent);
    return () => {
      session.off("event", onEvent);
    };
  }, [session]);

  return { errorClass, errorNonce, successNonce };
}
