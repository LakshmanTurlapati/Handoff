/**
 * Unit tests for @achilles/voice-tts/sequence-buffer.
 *
 * The SequenceBuffer is the in-process reorder layer that absorbs
 * out-of-order TTS chunk arrivals (PITFALLS #6). Downstream playback
 * (Phase 11 renderer) MUST receive chunks in strictly monotonic
 * sequence order regardless of the order they arrived on the wire.
 *
 * Tests below cover:
 *   - in-order pushes drain in order
 *   - scrambled pushes drain in monotonic order
 *   - intermediate gap detection
 *   - duplicate dedupe
 *   - negative-sequence rejection (untrusted upstream guard)
 *   - emit callback contract
 *
 * Citations:
 *   - PITFALLS #6 — TTS chunks arriving faster than playback drains or
 *     out of order; pre-buffer + sequence tracking is the fix
 *   - 09-CONTEXT.md — SequenceBuffer is the public utility for this
 */
import { describe, expect, it } from "vitest";

import { SequenceBuffer } from "./sequence-buffer.js";

interface Sequenced {
  sequence: number;
  payload: string;
}

describe("voice-tts/sequence-buffer — monotonic reordering of sequenced chunks", () => {
  it("exposes push, drain, hasGap, nextExpected, onEmit", () => {
    const buf = new SequenceBuffer<Sequenced>();
    expect(typeof buf.push).toBe("function");
    expect(typeof buf.drain).toBe("function");
    expect(typeof buf.hasGap).toBe("function");
    expect(typeof buf.nextExpected).toBe("function");
    expect(typeof buf.onEmit).toBe("function");
  });

  it("in-order pushes [0, 1, 2] drain in [0, 1, 2]; hasGap() is false", () => {
    const buf = new SequenceBuffer<Sequenced>();
    buf.push({ sequence: 0, payload: "a" });
    buf.push({ sequence: 1, payload: "b" });
    buf.push({ sequence: 2, payload: "c" });
    const emitted = buf.drain();
    expect(emitted.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(buf.hasGap()).toBe(false);
    expect(buf.nextExpected()).toBe(3);
  });

  it("scrambled pushes [2, 0, 1] drain in monotonic [0, 1, 2]; gap state tracks correctly", () => {
    const buf = new SequenceBuffer<Sequenced>();
    buf.push({ sequence: 2, payload: "c" });
    // Only seq 2 buffered, head 0 missing -> gap
    expect(buf.hasGap()).toBe(true);
    buf.push({ sequence: 0, payload: "a" });
    // Pushing 0 means the buffer can now drain [0] but still expects 1
    expect(buf.hasGap()).toBe(true);
    buf.push({ sequence: 1, payload: "b" });
    const emitted = buf.drain();
    expect(emitted.map((e) => e.sequence)).toEqual([0, 1, 2]);
    expect(buf.hasGap()).toBe(false);
    expect(buf.nextExpected()).toBe(3);
  });

  it("partial drain [0, 2, 3] yields [0]; nextExpected() is 1; gap is true", () => {
    const buf = new SequenceBuffer<Sequenced>();
    buf.push({ sequence: 0, payload: "a" });
    buf.push({ sequence: 2, payload: "c" });
    buf.push({ sequence: 3, payload: "d" });
    const emitted = buf.drain();
    expect(emitted.map((e) => e.sequence)).toEqual([0]);
    expect(buf.nextExpected()).toBe(1);
    expect(buf.hasGap()).toBe(true);
  });

  it("duplicate sequence pushes are no-ops (no double emit)", () => {
    const buf = new SequenceBuffer<Sequenced>();
    buf.push({ sequence: 0, payload: "a" });
    buf.push({ sequence: 0, payload: "a-duplicate" });
    buf.push({ sequence: 1, payload: "b" });
    const emitted = buf.drain();
    expect(emitted.map((e) => e.sequence)).toEqual([0, 1]);
    expect(emitted.find((e) => e.sequence === 0)?.payload).toBe("a");
  });

  it("negative sequence throws (guard against untrusted upstream)", () => {
    const buf = new SequenceBuffer<Sequenced>();
    expect(() => buf.push({ sequence: -1, payload: "bad" })).toThrowError(
      /sequence must be a non-negative integer/i,
    );
    expect(() => buf.push({ sequence: 0.5, payload: "bad" })).toThrowError(
      /sequence must be a non-negative integer/i,
    );
  });

  it("onEmit callback fires for each emitted item in monotonic order; nothing fires while head is missing", () => {
    const buf = new SequenceBuffer<Sequenced>();
    const seen: number[] = [];
    buf.onEmit((item) => {
      seen.push(item.sequence);
    });
    // Push a higher-sequence item first — should not emit.
    buf.push({ sequence: 1, payload: "b" });
    buf.drain();
    expect(seen).toEqual([]);
    // Now the head — should emit 0 and 1 in order.
    buf.push({ sequence: 0, payload: "a" });
    buf.drain();
    expect(seen).toEqual([0, 1]);
  });
});
