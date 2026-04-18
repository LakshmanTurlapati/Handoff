import { describe, expect, it } from "vitest";
import {
  createInitialLiveSessionState,
  liveSessionReducer,
} from "../../lib/live-session/reducer";

describe("liveSessionReducer", () => {
  it("creates an active turn from the initial history snapshot", () => {
    const state = createInitialLiveSessionState("session-123");

    expect(state.liveTurnId).toBe("session-123-turn-002");
    expect(state.turns).toHaveLength(2);
    expect(state.turns[1]?.collapsed).toBe(false);
    expect(state.turns[0]?.collapsed).toBe(true);
  });

  it("appends typed activities to the correct turn", () => {
    const initial = createInitialLiveSessionState("session-123");

    const next = liveSessionReducer(initial, {
      type: "append_activity",
      activity: {
        kind: "tool",
        activityId: "tool-003",
        turnId: "session-123-turn-002",
        title: "Tool activity",
        preview: "Applied the next structured update.",
        status: "running",
        createdAt: new Date().toISOString(),
      },
      stateLabel: "Running tool",
      actorDetail: "Applying the next structured update",
      isLive: true,
    });

    const liveTurn = next.turns.find((turn) => turn.turnId === next.liveTurnId);
    expect(liveTurn?.activities.at(-1)?.kind).toBe("tool");
    expect(liveTurn?.stateLabel).toBe("Running tool");
  });

  it("pauses and resumes follow mode when Jump to live is triggered", () => {
    const initial = createInitialLiveSessionState("session-123");
    const paused = liveSessionReducer(initial, {
      type: "set_follow_mode",
      followMode: "paused",
    });

    expect(paused.followMode).toBe("paused");

    const resumed = liveSessionReducer(paused, {
      type: "set_follow_mode",
      followMode: "live",
    });

    expect(resumed.followMode).toBe("live");
  });

  it("keeps the turn in pending-stop state until an interrupt completion event arrives", () => {
    const initial = createInitialLiveSessionState("session-123");
    const pending = liveSessionReducer(initial, {
      type: "request_interrupt",
    });

    expect(pending.pendingInterrupt).toBe(true);
    expect(
      pending.turns.find((turn) => turn.turnId === pending.liveTurnId)?.stateLabel,
    ).not.toBe("Interrupted");

    const finished = liveSessionReducer(pending, {
      type: "interrupt_finished",
    });

    expect(finished.pendingInterrupt).toBe(false);
    expect(
      finished.turns.find((turn) => turn.turnId === finished.liveTurnId)?.stateLabel,
    ).toBe("Interrupted");
  });

  it("marks reconnect backfill on the active turn", () => {
    const initial = createInitialLiveSessionState("session-123");
    const next = liveSessionReducer(initial, {
      type: "mark_reconnected",
      activity: {
        kind: "system",
        activityId: "reconnect-003",
        turnId: "session-123-turn-002",
        title: "Reconnected",
        preview: "Missed events were merged back into the live turn.",
        status: "completed",
        createdAt: new Date().toISOString(),
      },
    });

    const liveTurn = next.turns.find((turn) => turn.turnId === next.liveTurnId);
    expect(liveTurn?.hasReconnectMarker).toBe(true);
    expect(liveTurn?.activities.at(-1)?.title).toBe("Reconnected");
  });
});
