// @vitest-environment jsdom
/**
 * TranscriptOverlay component tests (TO1-TO6).
 *
 * Verifies the LOOP-02 contract: opacity rules, max-visible cap,
 * auto-fade after 15s idle, fade-timer reset on new commits,
 * speaking-hide after 1s into 'speaking' state, and the empty-partial
 * suppression rule.
 *
 * Uses fake timers so the time-based tests are deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { CommittedTranscriptEntry } from "../state/useAchillesState.js";
import { TranscriptOverlay } from "./TranscriptOverlay.js";

const T0 = 1_000_000_000_000;

function makeCommitted(
  id: string,
  text: string,
  offset: number,
): CommittedTranscriptEntry {
  return {
    id: `00000000-0000-4000-8000-${id.padStart(12, "0")}`,
    text,
    committedAt: T0 + offset,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TranscriptOverlay — TO1: committed lines render newest at the bottom", () => {
  it("TO1: with committed=[first, second], DOM order is first, second", () => {
    const committed = [
      makeCommitted("1", "first", 0),
      makeCommitted("2", "second", 10),
    ];
    const { getAllByTestId } = render(
      <TranscriptOverlay state="listening" partial="" committed={committed} />,
    );
    const lines = getAllByTestId("transcript-committed");
    expect(lines.map((l) => l.textContent)).toEqual(["first", "second"]);
  });
});

describe("TranscriptOverlay — TO2: max 3 visible lines", () => {
  it("TO2: with 5 committed entries, only the last 3 render", () => {
    const committed = [
      makeCommitted("1", "1", 0),
      makeCommitted("2", "2", 10),
      makeCommitted("3", "3", 20),
      makeCommitted("4", "4", 30),
      makeCommitted("5", "5", 40),
    ];
    const { getAllByTestId } = render(
      <TranscriptOverlay state="listening" partial="" committed={committed} />,
    );
    const lines = getAllByTestId("transcript-committed");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.textContent)).toEqual(["3", "4", "5"]);
  });
});

describe("TranscriptOverlay — TO3: idle 15s auto-fade", () => {
  it("TO3: after state==='idle' for 15000ms+, every committed line gains 'fading'", async () => {
    const committed = [
      makeCommitted("1", "line a", 0),
      makeCommitted("2", "line b", 100),
    ];
    const { getAllByTestId } = render(
      <TranscriptOverlay state="idle" partial="" committed={committed} />,
    );
    // Before the 15s threshold, NO fading class.
    {
      const lines = getAllByTestId("transcript-committed");
      for (const l of lines) {
        expect(l.className).not.toMatch(/\bfading\b/);
      }
    }
    // Advance virtual time past the threshold. The interval-driven
    // setNow updates schedule re-renders; we wrap in act() and call
    // advanceTimersByTimeAsync so React processes them. The interval
    // (FADE_CHECK_INTERVAL_MS = 1000ms) fires 15+ times during this
    // advance, the last firing reads Date.now() === T0 + 15001 and
    // setNow propagates after the act block.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    // Flush any deferred React work
    await act(async () => {
      await Promise.resolve();
    });
    const lines = getAllByTestId("transcript-committed");
    for (const l of lines) {
      expect(l.className).toMatch(/\bfading\b/);
    }
    // After a further 1500ms (the keyframe duration), the class
    // STILL persists — the animation drives opacity to 0 via the
    // keyframe forwards fill, not class removal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    for (const l of getAllByTestId("transcript-committed")) {
      expect(l.className).toMatch(/\bfading\b/);
    }
  });
});

describe("TranscriptOverlay — TO4: new commit resets the fade timer", () => {
  it("TO4: a line committed within the last 15s is NOT marked fading", async () => {
    const oldLine = makeCommitted("1", "old", 0);
    const { getAllByTestId, rerender } = render(
      <TranscriptOverlay state="idle" partial="" committed={[oldLine]} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });
    expect(getAllByTestId("transcript-committed")[0]!.className).toMatch(
      /\bfading\b/,
    );
    // Append a fresh commit AT the current virtual time.
    const newLine = makeCommitted("2", "new", 15_001);
    rerender(
      <TranscriptOverlay
        state="idle"
        partial=""
        committed={[oldLine, newLine]}
      />,
    );
    const lines = getAllByTestId("transcript-committed");
    // The OLD line still fades; the NEW line should NOT have 'fading'
    // because it was committed within the last 15s.
    expect(lines[0]!.className).toMatch(/\bfading\b/);
    expect(lines[1]!.className).not.toMatch(/\bfading\b/);
  });
});

describe("TranscriptOverlay — TO5: speaking-hide after 1s", () => {
  it("TO5: state==='speaking' for >1000ms applies 'speaking-hide' to the container", async () => {
    const committed = [makeCommitted("1", "saved", 0)];
    const { getByTestId } = render(
      <TranscriptOverlay
        state="speaking"
        partial="in flight"
        committed={committed}
      />,
    );
    // BEFORE the 1s threshold — no speaking-hide.
    expect(getByTestId("transcript-overlay").className).not.toMatch(
      /\bspeaking-hide\b/,
    );
    // Advance virtual time past the threshold.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(getByTestId("transcript-overlay").className).toMatch(
      /\bspeaking-hide\b/,
    );
  });

  it("TO5b: leaving speaking state clears the speaking-hide flag immediately", async () => {
    const committed = [makeCommitted("1", "saved", 0)];
    const { getByTestId, rerender } = render(
      <TranscriptOverlay
        state="speaking"
        partial=""
        committed={committed}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });
    expect(getByTestId("transcript-overlay").className).toMatch(
      /\bspeaking-hide\b/,
    );
    // State transitions to idle — speaking-hide should clear at once.
    rerender(
      <TranscriptOverlay
        state="idle"
        partial=""
        committed={committed}
      />,
    );
    expect(getByTestId("transcript-overlay").className).not.toMatch(
      /\bspeaking-hide\b/,
    );
  });
});

describe("TranscriptOverlay — TO6: empty partial renders no partial element", () => {
  it("TO6a: empty string → no [data-testid='transcript-partial']", () => {
    const { queryByTestId } = render(
      <TranscriptOverlay state="listening" partial="" committed={[]} />,
    );
    expect(queryByTestId("transcript-partial")).toBeNull();
  });

  it("TO6b: non-empty string → partial element renders with the text", () => {
    const { getByTestId } = render(
      <TranscriptOverlay
        state="listening"
        partial="hello wor"
        committed={[]}
      />,
    );
    const partial = getByTestId("transcript-partial");
    expect(partial.textContent).toBe("hello wor");
    expect(partial.className).toMatch(/\btranscript-partial\b/);
  });
});
