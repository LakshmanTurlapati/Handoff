/**
 * @vitest-environment jsdom
 *
 * Plan 14-03 — Behaviour tests for IncidentStatus (SAFE-05 health dot).
 *
 *   IS1a: both 'ok' -> green dot (status='ok')
 *   IS1b: one 'degraded' / one 'ok' -> yellow dot (status='degraded')
 *   IS1c: one 'failed' / one 'ok' -> yellow dot (status='degraded')
 *   IS1d: both 'failed' -> red dot (status='failed')
 *   IS1e: any 'failed' paired with 'degraded' -> red dot (status='failed')
 *   IS2:  hover tooltip via title attribute carries per-surface state
 *   IS3:  testid stable + role='status' for a11y
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { composeIncidentStatus, IncidentStatus } from "./IncidentStatus.js";

afterEach(() => {
  cleanup();
});

describe("IncidentStatus — IS1a both 'ok' renders green dot", () => {
  it("data-status='ok' AND className contains 'incident-status-ok'", () => {
    render(<IncidentStatus sttHealth="ok" ttsHealth="ok" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("ok");
    expect(dot.className).toContain("incident-status-ok");
  });
});

describe("IncidentStatus — IS1b one degraded + one ok renders degraded dot", () => {
  it("sttHealth='degraded', ttsHealth='ok' -> degraded", () => {
    render(<IncidentStatus sttHealth="degraded" ttsHealth="ok" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("degraded");
    expect(dot.className).toContain("incident-status-degraded");
  });

  it("sttHealth='ok', ttsHealth='degraded' -> degraded", () => {
    render(<IncidentStatus sttHealth="ok" ttsHealth="degraded" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("degraded");
  });
});

describe("IncidentStatus — IS1c one failed + one ok renders degraded dot", () => {
  it("sttHealth='failed', ttsHealth='ok' -> degraded (one surface still functional)", () => {
    render(<IncidentStatus sttHealth="failed" ttsHealth="ok" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("degraded");
  });

  it("sttHealth='ok', ttsHealth='failed' -> degraded", () => {
    render(<IncidentStatus sttHealth="ok" ttsHealth="failed" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("degraded");
  });
});

describe("IncidentStatus — IS1d both failed renders failed dot", () => {
  it("data-status='failed' AND className contains 'incident-status-failed'", () => {
    render(<IncidentStatus sttHealth="failed" ttsHealth="failed" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("failed");
    expect(dot.className).toContain("incident-status-failed");
  });
});

describe("IncidentStatus — IS1e any failed paired with degraded renders failed dot", () => {
  it("sttHealth='failed', ttsHealth='degraded' -> failed", () => {
    render(<IncidentStatus sttHealth="failed" ttsHealth="degraded" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("failed");
  });

  it("sttHealth='degraded', ttsHealth='failed' -> failed", () => {
    render(<IncidentStatus sttHealth="degraded" ttsHealth="failed" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("data-status")).toBe("failed");
  });
});

describe("IncidentStatus — IS2 hover tooltip carries per-surface state", () => {
  it("title attribute reads 'STT: <sttHealth>; TTS: <ttsHealth>'", () => {
    render(<IncidentStatus sttHealth="degraded" ttsHealth="ok" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("title")).toBe("STT: degraded; TTS: ok");
  });

  it("aria-label mirrors the title for assistive tech", () => {
    render(<IncidentStatus sttHealth="failed" ttsHealth="failed" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("aria-label")).toBe("STT: failed; TTS: failed");
  });
});

describe("IncidentStatus — IS3 testid stable + role='status'", () => {
  it("declares role='status' for assistive tech", () => {
    render(<IncidentStatus sttHealth="ok" ttsHealth="ok" />);
    const dot = screen.getByTestId("incident-status-dot");
    expect(dot.getAttribute("role")).toBe("status");
  });
});

describe("composeIncidentStatus — pure helper truth table", () => {
  it("returns the composition kinds for every cell of the 3x3 matrix", () => {
    expect(composeIncidentStatus("ok", "ok")).toBe("ok");
    expect(composeIncidentStatus("ok", "degraded")).toBe("degraded");
    expect(composeIncidentStatus("ok", "failed")).toBe("degraded");
    expect(composeIncidentStatus("degraded", "ok")).toBe("degraded");
    expect(composeIncidentStatus("degraded", "degraded")).toBe("degraded");
    expect(composeIncidentStatus("degraded", "failed")).toBe("failed");
    expect(composeIncidentStatus("failed", "ok")).toBe("degraded");
    expect(composeIncidentStatus("failed", "degraded")).toBe("failed");
    expect(composeIncidentStatus("failed", "failed")).toBe("failed");
  });
});
