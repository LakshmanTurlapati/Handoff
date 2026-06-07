// @vitest-environment jsdom
/**
 * Playback queue tests — P1..P7.
 *
 * The tests use a structural mock AudioContext that records every
 * createBufferSource call. The mock AudioBufferSourceNode exposes a
 * `triggerOnEnded` hook so tests can advance the queue between
 * assertions without depending on real audio scheduling.
 *
 * PROMPT-04 enforcement is asserted in P6 — the module's runtime
 * exports are inspected via dynamic import.
 */
import { describe, expect, it, vi } from "vitest";
import { createAnalyserBinding } from "./analyser-binding.js";
import { createPlaybackQueue } from "./playback-queue.js";
import type { PlaybackQueueHandle } from "./playback-queue.js";
import type { TtsChunkPayload } from "../../shared/ipc-schemas.js";

interface MockBufferSource {
  buffer: AudioBuffer | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  triggerEnded: () => void;
}

interface MockCtx {
  ctx: AudioContext;
  sources: MockBufferSource[];
  setCurrentTime: (t: number) => void;
  analyser: {
    fftSize: number;
    frequencyBinCount: number;
    getByteFrequencyData: (buf: Uint8Array) => void;
    getByteTimeDomainData: (buf: Uint8Array) => void;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
}

function makeMockBufferSource(): MockBufferSource {
  const node: MockBufferSource = {
    buffer: null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onended: null,
    triggerEnded(): void {
      if (this.onended !== null) {
        this.onended();
      }
    },
  };
  return node;
}

function makeMockAudioContext(): MockCtx {
  const sources: MockBufferSource[] = [];
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 32,
    getByteFrequencyData(buf: Uint8Array): void {
      buf.fill(128);
    },
    getByteTimeDomainData(buf: Uint8Array): void {
      buf.fill(128);
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  let currentTime = 0;
  const destination = {} as AudioNode;
  // WR-03: the playback-queue now creates a long-lived GainNode mixer
  // at construction time. Provide a minimal createGain stub so the
  // structural mock satisfies the new code path.
  const createGain = (): AudioNode =>
    ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    }) as unknown as AudioNode;
  const ctx = {
    get currentTime() {
      return currentTime;
    },
    destination,
    createAnalyser: () => analyser,
    createBufferSource(): AudioBufferSourceNode {
      const next = makeMockBufferSource();
      sources.push(next);
      return next as unknown as AudioBufferSourceNode;
    },
    createGain,
  } as unknown as AudioContext;
  return {
    ctx,
    sources,
    analyser,
    setCurrentTime(t: number): void {
      currentTime = t;
    },
  };
}

function makeChunk(seq: number, isFinal = false): TtsChunkPayload {
  return {
    seq,
    mime: "audio/mpeg",
    bytes: new ArrayBuffer(16),
    isFinal,
  };
}

function makeDecodedBuffer(duration: number): AudioBuffer {
  return {
    duration,
    length: 1024,
    sampleRate: 16000,
    numberOfChannels: 1,
  } as AudioBuffer;
}

/**
 * Helper to flush the microtask queue. Decode resolves via
 * Promise.resolve in tests; awaiting a setTimeout(0) is the cleanest
 * way to make every pending then-callback run before assertions.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("playback-queue (P1..P7)", () => {
  it("P1: createPlaybackQueue returns a handle with enqueue/flush/queueSize/playing", () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const handle: PlaybackQueueHandle = createPlaybackQueue({
      audioContext: ctx,
      analyserBinding: binding,
      onPlaybackComplete: vi.fn(),
      onDrained: vi.fn(),
      decodeAudioDataImpl: () => Promise.resolve(makeDecodedBuffer(0.1)),
    });
    expect(typeof handle.enqueue).toBe("function");
    expect(typeof handle.flush).toBe("function");
    expect(typeof handle.queueSize).toBe("number");
    expect(typeof handle.playing).toBe("boolean");
  });

  it("P2: in-order enqueue of seq 0,1,2 schedules 3 decodeAudioData + 3 start() calls in monotonic order", async () => {
    const mock = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: mock.ctx });
    const decodeAudioDataImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeDecodedBuffer(0.05)));
    const handle = createPlaybackQueue({
      audioContext: mock.ctx,
      analyserBinding: binding,
      onPlaybackComplete: vi.fn(),
      onDrained: vi.fn(),
      decodeAudioDataImpl,
    });

    handle.enqueue(makeChunk(0));
    handle.enqueue(makeChunk(1));
    handle.enqueue(makeChunk(2));
    await flushMicrotasks();

    expect(decodeAudioDataImpl).toHaveBeenCalledTimes(3);
    expect(mock.sources.length).toBe(3);
    // Each source.start was called exactly once.
    for (const src of mock.sources) {
      expect(src.start).toHaveBeenCalledTimes(1);
    }
    // Start times are monotonically non-decreasing.
    const startTimes = mock.sources.map((s) => s.start.mock.calls[0]![0] as number);
    for (let i = 1; i < startTimes.length; i++) {
      expect(startTimes[i]!).toBeGreaterThanOrEqual(startTimes[i - 1]!);
    }
    // Invocation order: source[0].start before source[1].start before source[2].start.
    const orderA = mock.sources[0]!.start.mock.invocationCallOrder[0]!;
    const orderB = mock.sources[1]!.start.mock.invocationCallOrder[0]!;
    const orderC = mock.sources[2]!.start.mock.invocationCallOrder[0]!;
    expect(orderA).toBeLessThan(orderB);
    expect(orderB).toBeLessThan(orderC);
  });

  it("P3: out-of-order enqueue (1, 2, 0) buffers 1+2 until 0 arrives, then plays 0,1,2 in order", async () => {
    const mock = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: mock.ctx });
    const decodeAudioDataImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeDecodedBuffer(0.05)));
    const handle = createPlaybackQueue({
      audioContext: mock.ctx,
      analyserBinding: binding,
      onPlaybackComplete: vi.fn(),
      onDrained: vi.fn(),
      decodeAudioDataImpl,
    });

    handle.enqueue(makeChunk(1));
    handle.enqueue(makeChunk(2));
    await flushMicrotasks();
    // Nothing should have played yet — seq 0 is missing.
    expect(mock.sources.length).toBe(0);
    expect(handle.queueSize).toBeGreaterThan(0);

    handle.enqueue(makeChunk(0));
    await flushMicrotasks();
    // Now all three should have scheduled.
    expect(mock.sources.length).toBe(3);
    // The very first scheduled buffer must correspond to seq 0 — we
    // assert this by checking the order matches monotonic seq via the
    // start-time ordering.
    const startTimes = mock.sources.map((s) => s.start.mock.calls[0]![0] as number);
    for (let i = 1; i < startTimes.length; i++) {
      expect(startTimes[i]!).toBeGreaterThanOrEqual(startTimes[i - 1]!);
    }
  });

  it("P4: isFinal:true on the last chunk triggers onPlaybackComplete (after its onended fires) then onDrained", async () => {
    const mock = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: mock.ctx });
    const onPlaybackComplete = vi.fn();
    const onDrained = vi.fn();
    const decodeAudioDataImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeDecodedBuffer(0.05)));
    const handle = createPlaybackQueue({
      audioContext: mock.ctx,
      analyserBinding: binding,
      onPlaybackComplete,
      onDrained,
      decodeAudioDataImpl,
    });

    handle.enqueue(makeChunk(0));
    handle.enqueue(makeChunk(1, true));
    await flushMicrotasks();

    expect(mock.sources.length).toBe(2);
    // No completion until the LAST source's onended fires.
    expect(onPlaybackComplete).not.toHaveBeenCalled();

    // Fire onended on the first chunk: still no completion.
    mock.sources[0]!.triggerEnded();
    expect(onPlaybackComplete).not.toHaveBeenCalled();

    // Fire onended on the final chunk: completion + drained fire.
    mock.sources[1]!.triggerEnded();
    expect(onPlaybackComplete).toHaveBeenCalledTimes(1);
    expect(onDrained).toHaveBeenCalledTimes(1);

    // Ordering — onPlaybackComplete BEFORE onDrained.
    const orderComplete = onPlaybackComplete.mock.invocationCallOrder[0]!;
    const orderDrained = onDrained.mock.invocationCallOrder[0]!;
    expect(orderComplete).toBeLessThan(orderDrained);
  });

  it("P5: enqueue throws Error('invalid sequence') for negative or non-integer seq", () => {
    const mock = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: mock.ctx });
    const handle = createPlaybackQueue({
      audioContext: mock.ctx,
      analyserBinding: binding,
      onPlaybackComplete: vi.fn(),
      onDrained: vi.fn(),
      decodeAudioDataImpl: () => Promise.resolve(makeDecodedBuffer(0.05)),
    });
    expect(() => handle.enqueue(makeChunk(-1))).toThrow("invalid sequence");
    expect(() => handle.enqueue({ ...makeChunk(0), seq: 1.5 })).toThrow(
      "invalid sequence",
    );
    expect(() => handle.enqueue({ ...makeChunk(0), seq: Number.NaN })).toThrow(
      "invalid sequence",
    );
  });

  it("P6 (PROMPT-04 enforcement): playback-queue exports EXACTLY one runtime callable — createPlaybackQueue", async () => {
    const module = await import("./playback-queue.js");
    const runtimeKeys = Object.keys(module);
    expect(runtimeKeys).toEqual(["createPlaybackQueue"]);
    expect(typeof module.createPlaybackQueue).toBe("function");
  });

  it("P7: flush() stops the current source, clears the queue, leaves the long-lived playback mixer connected, and fires onDrained (WR-03)", async () => {
    const mock = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: mock.ctx });
    const setPlaybackSourceSpy = vi.spyOn(binding, "setPlaybackSource");
    const onDrained = vi.fn();
    const decodeAudioDataImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(makeDecodedBuffer(0.5)));
    const handle = createPlaybackQueue({
      audioContext: mock.ctx,
      analyserBinding: binding,
      onPlaybackComplete: vi.fn(),
      onDrained,
      decodeAudioDataImpl,
    });
    // WR-03: setPlaybackSource is called EXACTLY once at construction
    // with the long-lived mixer node. Per-chunk reconnects are gone.
    expect(setPlaybackSourceSpy).toHaveBeenCalledTimes(1);
    const constructionCall = setPlaybackSourceSpy.mock.calls[0]!;
    expect(constructionCall[0]).not.toBeNull();

    handle.enqueue(makeChunk(0));
    handle.enqueue(makeChunk(1));
    handle.enqueue(makeChunk(2, true));
    await flushMicrotasks();

    expect(mock.sources.length).toBe(3);
    // Still only the construction-time call — no per-chunk churn.
    expect(setPlaybackSourceSpy).toHaveBeenCalledTimes(1);

    handle.flush();
    // Every scheduled source.stop(0) was called.
    for (const src of mock.sources) {
      expect(src.stop).toHaveBeenCalledWith(0);
    }
    // WR-03: flush() does NOT detach the mixer from the analyser. The
    // next utterance reuses the same connection so the Waveform
    // amplitude reads continuously without flicker.
    expect(setPlaybackSourceSpy).toHaveBeenCalledTimes(1);
    expect(onDrained).toHaveBeenCalledTimes(1);
    expect(handle.queueSize).toBe(0);
    expect(handle.playing).toBe(false);
  });
});
