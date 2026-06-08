/**
 * Phase 17, Plan 02, Task 1 — unit tests for tts-playback.ts.
 *
 * 5 tests:
 *
 *   1. spawn ffplay with the locked FFPLAY_ARGS tuple
 *   2. writes MP3 chunks to ffplay stdin in order; calls stdin.end()
 *      after the events$ `complete` event
 *   3. emits exactly one tts_drained SessionEvent after iterator
 *      complete + ffplay child exit
 *   4. EPIPE on stdin.write surfaces as an error SessionEvent with
 *      classification="playback_lost"; the consumer iterator exits
 *      cleanly rather than crashing
 *   5. cancel() sends stdin.end() immediately + SIGTERMs the child
 *      after FFPLAY_KILL_GRACE_MS (200ms)
 *
 * Hermetic: every test injects a spawnImpl that returns a fake child;
 * the voice-tts ttsFactory is also a recording fake that synthesises
 * a deterministic events$ async iterable. NO real ffplay process is
 * launched; NO real voice-tts WSS is constructed.
 *
 * No emojis (CLAUDE.md global). No application launches.
 */
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { TtsEvent, TtsStreamClient } from "@achilles/voice-tts";
import {
  createTtsPlayback,
  FFPLAY_ARGS,
} from "../../src/audio/tts-playback.js";
import type { SessionEvent } from "../../src/session-events.js";

/**
 * Build a fake ChildProcess that satisfies the narrow ChildProcessLike
 * surface tts-playback.ts consumes. EventEmitter satisfies the on()
 * contract; stdin is a recording writer; kill is a vitest spy.
 */
function makeFakeChild(): {
  child: EventEmitter & {
    stdin: {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    stderr: NodeJS.ReadableStream | null;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  writes: Buffer[];
  endWrite: (chunkIndex: number, err?: Error) => void;
} {
  const writes: Buffer[] = [];
  const callbacks: Array<(err?: Error | null) => void> = [];
  const child = new EventEmitter() as EventEmitter & {
    stdin: {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    stderr: NodeJS.ReadableStream | null;
    kill: ReturnType<typeof vi.fn>;
    pid: number;
  };
  const writeFn = vi.fn(
    (chunk: Buffer, cb: (err?: Error | null) => void): boolean => {
      writes.push(chunk);
      callbacks.push(cb);
      return true;
    },
  );
  child.stdin = {
    write: writeFn,
    end: vi.fn(),
  };
  child.stderr = null;
  child.kill = vi.fn(() => true);
  child.pid = 12345;
  return {
    child,
    writes,
    endWrite: (chunkIndex: number, err?: Error): void => {
      const cb = callbacks[chunkIndex];
      if (cb) cb(err ?? null);
    },
  };
}

/**
 * Build a mock TtsStreamClient with a controllable events$ async
 * iterable. The test drives the iterable by pushing events onto the
 * `events` array and resolving the in-flight `next` promise.
 */
function makeFakeTtsClient(): {
  client: TtsStreamClient;
  pushEvent: (ev: TtsEvent) => void;
  endStream: () => void;
  closeSpy: ReturnType<typeof vi.fn>;
  appendTextSpy: ReturnType<typeof vi.fn>;
  flushSpy: ReturnType<typeof vi.fn>;
} {
  const queue: TtsEvent[] = [];
  let resolver: (() => void) | null = null;
  let ended = false;

  const events$: AsyncIterable<TtsEvent> = {
    [Symbol.asyncIterator](): AsyncIterator<TtsEvent> {
      return {
        async next(): Promise<IteratorResult<TtsEvent>> {
          while (queue.length === 0 && !ended) {
            await new Promise<void>((resolve) => {
              resolver = resolve;
            });
          }
          if (queue.length > 0) {
            const value = queue.shift()!;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };

  const closeSpy = vi.fn(() => Promise.resolve());
  const appendTextSpy = vi.fn();
  const flushSpy = vi.fn();

  const client: TtsStreamClient = {
    events$,
    appendText: appendTextSpy,
    flush: flushSpy,
    close: closeSpy,
  };

  return {
    client,
    pushEvent: (ev: TtsEvent): void => {
      queue.push(ev);
      if (resolver !== null) {
        const r = resolver;
        resolver = null;
        r();
      }
    },
    endStream: (): void => {
      ended = true;
      if (resolver !== null) {
        const r = resolver;
        resolver = null;
        r();
      }
    },
    closeSpy,
    appendTextSpy,
    flushSpy,
  };
}

/**
 * Build a recording spawn impl + return both the fake child + the
 * captured spawn-call arguments.
 */
function makeRecordingSpawn(fakeChild: ReturnType<typeof makeFakeChild>): {
  spawnImpl: ReturnType<typeof vi.fn>;
} {
  const spawnImpl = vi.fn(() => fakeChild.child as unknown);
  return { spawnImpl };
}

// Helper: build a TtsChunk event with the given audio bytes. Cast
// through `unknown` because TypeScript 5.7's stricter Uint8Array
// generic narrows the schema's `audio: Uint8Array<ArrayBuffer>` to
// the strict-ArrayBuffer parameterisation; tests need to pass through
// the wider runtime shape.
function chunkEvent(seq: number, bytes: Uint8Array): TtsEvent {
  return {
    type: "chunk",
    sequence: seq,
    audio: bytes as unknown as Uint8Array<ArrayBuffer>,
    mimeType: "audio/mpeg",
  };
}

function completeEvent(): TtsEvent {
  return { type: "complete", totalChunks: 1, durationMs: 100 };
}

describe("createTtsPlayback — Test 1: spawns ffplay with the locked FFPLAY_ARGS tuple", () => {
  it("invokes spawnImpl exactly once with command='ffplay' + the CONTEXT.md locked argv set + -f mp3 + pipe:0", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();
    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit: vi.fn(),
    });
    await handle.start();
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const call = spawnImpl.mock.calls[0]!;
    expect(call[0]).toBe("ffplay");
    expect(call[1]).toEqual([...FFPLAY_ARGS]);
    expect((call[2] as { stdio: unknown }).stdio).toEqual([
      "pipe",
      "ignore",
      "pipe",
    ]);
  });

  it("exports FFPLAY_ARGS containing -f mp3 + -i pipe:0 (PITFALLS auto-detect override)", () => {
    expect(FFPLAY_ARGS).toContain("-f");
    expect(FFPLAY_ARGS).toContain("mp3");
    expect(FFPLAY_ARGS).toContain("-i");
    expect(FFPLAY_ARGS).toContain("pipe:0");
    expect(FFPLAY_ARGS[0]).toBe("-loglevel");
    expect(FFPLAY_ARGS[1]).toBe("quiet");
  });
});

describe("createTtsPlayback — Test 2: writes MP3 chunks to ffplay stdin in order", () => {
  it("forwards each TtsChunk's audio bytes to stdin.write in arrival order; calls stdin.end on complete", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();
    const emit = vi.fn<(event: SessionEvent) => void>();
    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit,
    });
    await handle.start();

    const chunk1 = new Uint8Array([1, 2, 3, 4]);
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const chunk3 = new Uint8Array([9, 10, 11, 12]);

    fakeTts.pushEvent(chunkEvent(0, chunk1));
    // The consumer awaits the write callback before iterating the
    // next event — so we resolve the callbacks one at a time after
    // each push.
    await new Promise((r) => setImmediate(r));
    fakeChild.endWrite(0);

    fakeTts.pushEvent(chunkEvent(1, chunk2));
    await new Promise((r) => setImmediate(r));
    fakeChild.endWrite(1);

    fakeTts.pushEvent(chunkEvent(2, chunk3));
    await new Promise((r) => setImmediate(r));
    fakeChild.endWrite(2);

    fakeTts.pushEvent(completeEvent());
    fakeTts.endStream();
    // Wait for the iterator drain
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    // Assert: 3 writes, in order, with the right bytes.
    expect(fakeChild.writes.length).toBe(3);
    expect(Array.from(fakeChild.writes[0]!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(fakeChild.writes[1]!)).toEqual([5, 6, 7, 8]);
    expect(Array.from(fakeChild.writes[2]!)).toEqual([9, 10, 11, 12]);
    // stdin.end called after the complete event
    expect(fakeChild.child.stdin.end).toHaveBeenCalled();
  });
});

describe("createTtsPlayback — Test 3: emits exactly one tts_drained after iterator + child exit", () => {
  it("tts_drained fires once after both events$ complete AND ffplay exit", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();
    const captured: SessionEvent[] = [];
    const emit = (ev: SessionEvent): void => {
      captured.push(ev);
    };
    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit,
      nowImpl: () => 1_700_000_000_000,
    });
    await handle.start();

    // tts_ready emitted on start
    expect(captured.some((e) => e.type === "tts_ready")).toBe(true);

    // No tts_drained until both edges fire
    fakeTts.pushEvent(completeEvent());
    fakeTts.endStream();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // Iterator complete but child still alive — no drain yet
    expect(captured.filter((e) => e.type === "tts_drained").length).toBe(0);

    // Now ffplay exits with code 0
    fakeChild.child.emit("exit", 0);
    await new Promise((r) => setImmediate(r));

    const drained = captured.filter((e) => e.type === "tts_drained");
    expect(drained.length).toBe(1);
    expect(drained[0]?.timestamp).toBe(1_700_000_000_000);
  });

  it("tts_drained does NOT fire if only the child exits (iterator must complete too)", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();
    const captured: SessionEvent[] = [];
    const emit = (ev: SessionEvent): void => {
      captured.push(ev);
    };
    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit,
    });
    await handle.start();

    // child exits BEFORE iterator drains — drain edge waits for the
    // iterator. (Iterator-complete also requires events$ to end; we
    // verify it does NOT fire until that happens.)
    fakeChild.child.emit("exit", 0);
    await new Promise((r) => setImmediate(r));
    // iterator still hangs because no events arrived
    expect(captured.filter((e) => e.type === "tts_drained").length).toBe(0);
  });
});

describe("createTtsPlayback — Test 4: EPIPE on stdin.write surfaces as error with classification=playback_lost", () => {
  it("emits error SessionEvent + terminates the consumer iterator on stdin.write EPIPE", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();
    const captured: SessionEvent[] = [];
    const emit = (ev: SessionEvent): void => {
      captured.push(ev);
    };
    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit,
    });
    await handle.start();

    const chunk1 = new Uint8Array([1, 2, 3]);
    fakeTts.pushEvent(chunkEvent(0, chunk1));
    await new Promise((r) => setImmediate(r));
    // Simulate EPIPE by rejecting the first write callback.
    fakeChild.endWrite(0, Object.assign(new Error("EPIPE"), { code: "EPIPE" }));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const errors = captured.filter((e) => e.type === "error");
    expect(errors.length).toBe(1);
    const err = errors[0] as SessionEvent & { type: "error" };
    expect(err.payload.classification).toBe("playback_lost");
    expect(err.payload.message).toContain("EPIPE");
  });
});

describe("createTtsPlayback — Test 5: cancel sends stdin.end + SIGTERMs after FFPLAY_KILL_GRACE_MS", () => {
  it("cancel() closes voice-tts WSS, calls stdin.end immediately, then SIGTERM after 200ms", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();

    // Fake timer scheduler — advance manually.
    const pending: Array<{ cb: () => void; ms: number }> = [];
    const setTimeoutImpl = (cb: () => void, ms: number): unknown => {
      pending.push({ cb, ms });
      return pending.length - 1;
    };
    const clearTimeoutImpl = (token: unknown): void => {
      const idx = token as number;
      if (idx >= 0 && idx < pending.length) {
        pending[idx] = { cb: (): void => undefined, ms: 0 };
      }
    };

    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit: vi.fn(),
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    await handle.start();

    // Trigger cancel BEFORE child exits.
    const cancelP = handle.cancel();

    // close() and stdin.end() should fire immediately.
    expect(fakeTts.closeSpy).toHaveBeenCalledTimes(1);
    await new Promise((r) => setImmediate(r));
    expect(fakeChild.child.stdin.end).toHaveBeenCalled();
    // kill not yet called — waiting on the FFPLAY_KILL_GRACE_MS timer
    expect(fakeChild.child.kill).not.toHaveBeenCalled();

    // Fire the timer (last queued was the 200ms grace).
    const last = pending[pending.length - 1]!;
    expect(last.ms).toBe(200);
    last.cb();

    await cancelP;
    expect(fakeChild.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("cancel() does NOT SIGTERM if the child already exited before the grace timer", async () => {
    const fakeChild = makeFakeChild();
    const { spawnImpl } = makeRecordingSpawn(fakeChild);
    const fakeTts = makeFakeTtsClient();
    const pending: Array<{ cb: () => void; ms: number }> = [];
    const setTimeoutImpl = (cb: () => void, ms: number): unknown => {
      pending.push({ cb, ms });
      return pending.length - 1;
    };
    const handle = createTtsPlayback({
      ttsFactory: () => fakeTts.client,
      voiceId: "voice_test",
      spawnImpl: spawnImpl as never,
      emit: vi.fn(),
      setTimeoutImpl,
      clearTimeoutImpl: () => undefined,
    });
    await handle.start();

    const cancelP = handle.cancel();
    await new Promise((r) => setImmediate(r));
    // Child exits before the grace timer fires
    fakeChild.child.emit("exit", 0);
    await new Promise((r) => setImmediate(r));
    // Fire the grace timer
    const last = pending[pending.length - 1]!;
    last.cb();
    await cancelP;
    expect(fakeChild.child.kill).not.toHaveBeenCalled();
  });
});
