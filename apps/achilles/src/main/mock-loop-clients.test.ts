/**
 * Behaviour tests for the Plan 12-04 deterministic-fake clients.
 *
 * These cover the contract the session.ts orchestrator AND the
 * MOCK_LOOP=1 integration test depend on:
 *
 *   - createMockStt — pre-configured commit fixture, partial gating
 *   - createMockClaude — synthesises a session_init → assistant_text_delta(ack)
 *     → assistant_text_delta(<spoken-summary>) → assistant_text_done →
 *     optional tool_result(is_error:true) → process_exit stream and
 *     populates `outcome` via deriveOutcome
 *   - createMockTts — chunks emitted with monotonically increasing seq;
 *     the appendText test seam records the strings the orchestrator
 *     routes to TTS
 */
import { describe, expect, it } from "vitest";
import {
  createMockClaude,
  createMockStt,
  createMockTts,
} from "./mock-loop-clients.js";
import type { ClaudeBridgeEvent } from "@achilles/claude-code-bridge";

describe("createMockStt — committed transcripts", () => {
  it("commit() pops the next pre-configured transcript and pushes a committed event", async () => {
    const stt = createMockStt({
      committedTranscripts: [
        { id: "uuid-1", text: "first", committedAt: 100 },
        { id: "uuid-2", text: "second", committedAt: 200 },
      ],
    });
    const events: Array<{ type: string; text?: string }> = [];
    const iter = stt.events$[Symbol.asyncIterator]();
    stt.commit();
    const r1 = await iter.next();
    events.push(r1.value as { type: string; text?: string });
    expect(events[0]?.type).toBe("committed");
    expect((events[0] as { text?: string }).text).toBe("first");
    stt.commit();
    const r2 = await iter.next();
    expect((r2.value as { text?: string }).text).toBe("second");
  });

  it("emitPartials true causes commit() to emit a partial THEN a committed event", async () => {
    const stt = createMockStt({
      committedTranscripts: [{ id: "u", text: "hi", committedAt: 0 }],
      emitPartials: true,
    });
    stt.commit();
    const iter = stt.events$[Symbol.asyncIterator]();
    const r1 = await iter.next();
    const r2 = await iter.next();
    expect((r1.value as { type: string }).type).toBe("partial");
    expect((r2.value as { type: string }).type).toBe("committed");
  });

  it("emitFrame increments frameCount but does NOT push events", () => {
    const stt = createMockStt({ committedTranscripts: [] });
    expect(stt.frameCount).toBe(0);
    stt.emitFrame(new Int16Array(320));
    stt.emitFrame(new Int16Array(320));
    expect(stt.frameCount).toBe(2);
  });
});

describe("createMockClaude — session synthesis", () => {
  it("send() pushes session_init → assistant_text_delta(ack) → ... → process_exit", async () => {
    const claude = createMockClaude({
      ackText: "Looking now.",
      spokenSummaryBody: "Done.",
      exitCode: 0,
      sessionId: "sid-001",
    });
    claude.send("wrapped transcript");
    const events: ClaudeBridgeEvent[] = [];
    for await (const ev of claude.events$) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session_init");
    expect(types).toContain("assistant_text_delta");
    expect(types).toContain("assistant_text_done");
    expect(types[types.length - 1]).toBe("process_exit");
    expect(claude.sessionId).toBe("sid-001");
    expect(claude.outcome).toEqual({ kind: "success" });
  });

  it("exitCode != 0 produces a failure outcome with reason 'exit_code'", async () => {
    const claude = createMockClaude({
      ackText: "Looking.",
      spokenSummaryBody: "Lying about success.",
      exitCode: 1,
    });
    claude.send("wrapped");
    // Drain.
    for await (const _ev of claude.events$) {
      // no-op
      void _ev;
    }
    expect(claude.outcome?.kind).toBe("failure");
    expect(claude.outcome?.reason).toBe("exit_code");
  });

  it("toolErrors > 0 produces a failure outcome with reason 'tool_error'", async () => {
    const claude = createMockClaude({
      ackText: "Looking.",
      spokenSummaryBody: "Done.",
      exitCode: 0,
      toolErrors: 2,
    });
    claude.send("wrapped");
    for await (const _ev of claude.events$) {
      void _ev;
    }
    expect(claude.outcome?.kind).toBe("failure");
    expect(claude.outcome?.reason).toBe("tool_error");
  });

  it("cancel() sets outcome.reason='cancelled' even when exitCode would have been 0", async () => {
    const claude = createMockClaude({
      ackText: "Looking.",
      spokenSummaryBody: "Done.",
      exitCode: 0,
    });
    const exit = await claude.cancel();
    expect(exit.type).toBe("process_exit");
    expect(claude.outcome?.kind).toBe("failure");
    expect(claude.outcome?.reason).toBe("cancelled");
  });

  it("capturedSends records every send() call in order", () => {
    const claude = createMockClaude({
      ackText: "Looking.",
      spokenSummaryBody: "Done.",
      exitCode: 0,
    });
    claude.send("first wrapped");
    expect(claude.capturedSends.length).toBe(1);
    expect(claude.capturedSends[0]).toBe("first wrapped");
  });
});

describe("createMockTts — chunk synthesis", () => {
  it("appendText emits chunksPerSegment events with monotonically increasing seq", async () => {
    const tts = createMockTts({ chunksPerSegment: 3 });
    await tts.open();
    tts.appendText("Hello.");
    const seqs: number[] = [];
    const iter = tts.events$[Symbol.asyncIterator]();
    for (let i = 0; i < 3; i++) {
      const r = await iter.next();
      const ev = r.value as { type: string; chunk?: { seq: number; isFinal: boolean } };
      if (ev.type === "chunk") {
        seqs.push(ev.chunk!.seq);
      }
    }
    expect(seqs).toEqual([0, 1, 2]);
  });

  it("the last chunk in each segment is marked isFinal:true", async () => {
    const tts = createMockTts({ chunksPerSegment: 2 });
    await tts.open();
    tts.appendText("A");
    const iter = tts.events$[Symbol.asyncIterator]();
    const r1 = await iter.next();
    const r2 = await iter.next();
    expect((r1.value as { chunk: { isFinal: boolean } }).chunk.isFinal).toBe(
      false,
    );
    expect((r2.value as { chunk: { isFinal: boolean } }).chunk.isFinal).toBe(
      true,
    );
  });

  it("appendedTexts captures every appendText call in order", () => {
    const tts = createMockTts({ chunksPerSegment: 1 });
    tts.appendText("first");
    tts.appendText("second");
    expect(tts.appendedTexts).toEqual(["first", "second"]);
  });

  it("chunk bytes are deterministic (same seq -> same bytes)", async () => {
    const tts1 = createMockTts({ chunksPerSegment: 2 });
    const tts2 = createMockTts({ chunksPerSegment: 2 });
    tts1.appendText("X");
    tts2.appendText("X");
    const iter1 = tts1.events$[Symbol.asyncIterator]();
    const iter2 = tts2.events$[Symbol.asyncIterator]();
    const e1 = (await iter1.next()).value as { chunk: { bytes: ArrayBuffer } };
    const e2 = (await iter2.next()).value as { chunk: { bytes: ArrayBuffer } };
    const a = new Uint8Array(e1.chunk.bytes);
    const b = new Uint8Array(e2.chunk.bytes);
    expect(a.length).toBe(b.length);
    // Compare as plain arrays so the Uint8Array element undefined gap
    // under noUncheckedIndexedAccess is widened defensively.
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("flush emits a 'complete' event then ends the stream", async () => {
    const tts = createMockTts({ chunksPerSegment: 1 });
    tts.appendText("Hi");
    await tts.flush();
    // Drain remaining events; expect complete event somewhere in the stream.
    const types: string[] = [];
    for await (const ev of tts.events$) {
      types.push(ev.type);
    }
    expect(types).toContain("complete");
  });
});
