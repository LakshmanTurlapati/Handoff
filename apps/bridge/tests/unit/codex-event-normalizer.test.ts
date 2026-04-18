import { describe, expect, it } from "vitest";
import {
  buildSessionHistoryPayload,
  normalizeCodexServerEvent,
} from "../../src/daemon/codex-event-normalizer.js";

describe("codex event normalizer", () => {
  it("maps assistant deltas into live assistant activities", () => {
    const event = normalizeCodexServerEvent({
      sessionId: "thr_alpha",
      cursor: 4,
      message: {
        method: "item/agentMessage/delta",
        params: {
          turnId: "turn_assistant",
          delta: "Bridge is wiring the live transport",
          timestamp: "2026-04-18T08:00:00.000Z",
        },
      },
    });

    expect(event).not.toBeNull();
    expect(event?.kind).toBe("activity.appended");
    if (!event || event.kind !== "activity.appended") {
      return;
    }
    expect(event.activity.kind).toBe("assistant");
    expect(event.activity.preview).toContain("Bridge is wiring");
  });

  it("maps command approval requests into inline approval cards", () => {
    const event = normalizeCodexServerEvent({
      sessionId: "thr_alpha",
      cursor: 7,
      message: {
        method: "item/commandExecution/requestApproval",
        id: 42,
        params: {
          turnId: "turn_approval",
          command: "npm install",
          reason: "Installing bridge dependencies",
          availableDecisions: ["approved", "denied", "abort"],
          timestamp: "2026-04-18T08:01:00.000Z",
        },
      },
    });

    expect(event).not.toBeNull();
    expect(event?.kind).toBe("activity.appended");
    if (!event || event.kind !== "activity.appended") {
      return;
    }
    expect(event.activity.kind).toBe("approval");
    if (event.activity.kind !== "approval") {
      return;
    }
    expect(event.activity.requestId).toBe(42);
    expect(event.activity.actions.map((action) => action.label)).toEqual([
      "Approve",
      "Deny",
      "Abort",
    ]);
  });

  it("maps terminal thread endings into session.ended", () => {
    const event = normalizeCodexServerEvent({
      sessionId: "thr_alpha",
      cursor: 9,
      message: {
        method: "thread/ended",
        params: {
          reason: "process_exit",
          timestamp: "2026-04-18T08:02:00.000Z",
        },
      },
    });

    expect(event).toEqual({
      kind: "session.ended",
      sessionId: "thr_alpha",
      cursor: 9,
      occurredAt: "2026-04-18T08:02:00.000Z",
      reason: "process_exit",
    });
  });

  it("builds session.history payloads from thread/read results", () => {
    const history = buildSessionHistoryPayload({
      sessionId: "thr_history",
      cursor: 12,
      readResult: {
        thread: {
          turns: [
            {
              id: "turn_history",
              status: "completed",
              items: [
                {
                  type: "assistant_message",
                  text: "Earlier bridge summary",
                },
              ],
            },
          ],
        },
      },
    });

    expect(history.sessionId).toBe("thr_history");
    expect(history.cursor).toBe(12);
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0]?.turnId).toBe("turn_history");
    expect(history.turns[0]?.assistantPreview).toContain("Earlier bridge summary");
  });
});
