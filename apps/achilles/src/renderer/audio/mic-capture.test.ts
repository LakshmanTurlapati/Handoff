// @vitest-environment jsdom
/**
 * Mic capture tests — M1..M7.
 *
 * Structural mocks for AudioContext, MediaStream, MediaStreamTrack,
 * and the downsample worklet. No real getUserMedia is ever called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AMPLITUDE_TICK_MS } from "../../shared/constants.js";
import { createAnalyserBinding } from "./analyser-binding.js";
import type { DownsampleWorkletHandle } from "./downsample-worklet.js";
import { createMicCapture } from "./mic-capture.js";

interface MockSourceNode {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

interface MockAnalyserNode {
  fftSize: number;
  frequencyBinCount: number;
  getByteFrequencyData: (buf: Uint8Array) => void;
  getByteTimeDomainData: (buf: Uint8Array) => void;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeMockAudioContext(): {
  ctx: AudioContext;
  source: MockSourceNode;
  analyser: MockAnalyserNode;
} {
  const source: MockSourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const analyser: MockAnalyserNode = {
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
  const ctx = {
    currentTime: 0,
    createAnalyser: () => analyser,
    createMediaStreamSource: vi.fn(() => source),
  } as unknown as AudioContext;
  return { ctx, source, analyser };
}

function makeMockStream(): MediaStream {
  const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

interface MockWorkletControl {
  handle: DownsampleWorkletHandle;
  emitFrame: (frame: Int16Array) => void;
  destroy: ReturnType<typeof vi.fn>;
}

function makeMockWorklet(): MockWorkletControl {
  let onFrameHandler: ((frame: Int16Array) => void) | null = null;
  const destroy = vi.fn();
  const node = { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioWorkletNode;
  const handle: DownsampleWorkletHandle = {
    node,
    outputSampleRate: 16000,
    samplesPerFrame: 320,
    setOnFrame(handler: (frame: Int16Array) => void): void {
      onFrameHandler = handler;
    },
    destroy,
  };
  return {
    handle,
    destroy,
    emitFrame(frame: Int16Array): void {
      onFrameHandler?.(frame);
    },
  };
}

describe("mic-capture (M1..M7)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("M1: createMicCapture returns a handle with start/stop/pause/resume + initial state 'idle'", () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude: vi.fn(),
      getUserMediaImpl: () => Promise.resolve(stream),
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    expect(typeof handle.start).toBe("function");
    expect(typeof handle.stop).toBe("function");
    expect(typeof handle.pauseFrameDelivery).toBe("function");
    expect(typeof handle.resumeFrameDelivery).toBe("function");
    expect(handle.state).toBe("idle");
  });

  it("M2: start() calls getUserMediaImpl with the locked 16 kHz mono + AEC/NS/AGC constraints", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    const getUserMediaImpl = vi.fn().mockResolvedValue(stream);
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude: vi.fn(),
      getUserMediaImpl,
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    await handle.start();
    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);
    expect(getUserMediaImpl).toHaveBeenCalledWith({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(handle.state).toBe("running");
  });

  it("M3: emitted worklet frames are forwarded to onFrame verbatim", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    const onFrame = vi.fn();
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame,
      onAmplitude: vi.fn(),
      getUserMediaImpl: () => Promise.resolve(stream),
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    await handle.start();
    const frame = new Int16Array(320);
    frame[0] = 12345;
    worklet.emitFrame(frame);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(frame);
  });

  it("M4: pauseFrameDelivery drops frames at the worklet boundary; MediaStreamTrack stays open", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    const onFrame = vi.fn();
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame,
      onAmplitude: vi.fn(),
      getUserMediaImpl: () => Promise.resolve(stream),
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    await handle.start();

    // Pre-pause frame: forwarded.
    const frameA = new Int16Array(320);
    worklet.emitFrame(frameA);
    expect(onFrame).toHaveBeenCalledTimes(1);

    handle.pauseFrameDelivery();
    expect(handle.state).toBe("paused");

    // Post-pause frame: dropped.
    const frameB = new Int16Array(320);
    worklet.emitFrame(frameB);
    expect(onFrame).toHaveBeenCalledTimes(1);

    // MediaStreamTrack.stop must NOT have been called during pause.
    const track = stream.getTracks()[0]!;
    expect(track.stop).not.toHaveBeenCalled();

    // Resume forwards the next frame.
    handle.resumeFrameDelivery();
    expect(handle.state).toBe("running");
    const frameC = new Int16Array(320);
    worklet.emitFrame(frameC);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it("M5: stop() closes the MediaStreamTracks, destroys the worklet, and clears the binding mic source", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const setMicSourceSpy = vi.spyOn(binding, "setMicSource");
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude: vi.fn(),
      getUserMediaImpl: () => Promise.resolve(stream),
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    await handle.start();
    expect(setMicSourceSpy).toHaveBeenCalled();
    handle.stop();
    const track = stream.getTracks()[0]!;
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(worklet.destroy).toHaveBeenCalledTimes(1);
    // The binding's mic source should have been cleared (called with null).
    const calls = setMicSourceSpy.mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0]).toBeNull();
    expect(handle.state).toBe("idle");
  });

  it("M6: amplitude reporting ticks at AMPLITUDE_TICK_MS via the analyser binding", async () => {
    vi.useFakeTimers();
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    const onAmplitude = vi.fn();
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude,
      getUserMediaImpl: () => Promise.resolve(stream),
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    await handle.start();
    // Advance through 3 ticks; onAmplitude should have fired 3 times.
    vi.advanceTimersByTime(AMPLITUDE_TICK_MS * 3 + 1);
    expect(onAmplitude.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Every emitted RMS is in [0, 1].
    for (const call of onAmplitude.mock.calls) {
      const rms = call[0] as number;
      expect(rms).toBeGreaterThanOrEqual(0);
      expect(rms).toBeLessThanOrEqual(1);
    }
    handle.stop();
    vi.useRealTimers();
  });

  it("M7: getUserMedia denial transitions state to 'errored' and caches the rejection on subsequent start() calls", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const denial = new Error("NotAllowedError: Permission denied");
    denial.name = "NotAllowedError";
    const getUserMediaImpl = vi.fn().mockRejectedValue(denial);
    const worklet = makeMockWorklet();
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude: vi.fn(),
      getUserMediaImpl,
      createWorkletImpl: () => Promise.resolve(worklet.handle),
    });
    await expect(handle.start()).rejects.toBe(denial);
    expect(handle.state).toBe("errored");
    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);

    // Second start() returns the same rejection WITHOUT re-invoking the stub.
    await expect(handle.start()).rejects.toBe(denial);
    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);
  });

  it("M4 (Plan 14-04 SAFE-06): reacquireStream tears down the existing capture + restarts against new device", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const firstStream = makeMockStream();
    const secondStream = makeMockStream();
    // Build a getUserMedia spy that returns firstStream then
    // secondStream on the second call — simulating a device switch.
    const getUserMediaImpl = vi
      .fn()
      .mockResolvedValueOnce(firstStream)
      .mockResolvedValueOnce(secondStream);
    const firstWorklet = makeMockWorklet();
    const secondWorklet = makeMockWorklet();
    const createWorkletImpl = vi
      .fn()
      .mockResolvedValueOnce(firstWorklet.handle)
      .mockResolvedValueOnce(secondWorklet.handle);
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude: vi.fn(),
      getUserMediaImpl,
      createWorkletImpl,
    });
    await handle.start();
    expect(getUserMediaImpl).toHaveBeenCalledTimes(1);
    expect(firstWorklet.destroy).not.toHaveBeenCalled();

    // Trigger the re-acquisition (device change).
    await handle.reacquireStream();

    // The first worklet was destroyed; the second worklet replaced it.
    expect(firstWorklet.destroy).toHaveBeenCalledTimes(1);
    // getUserMedia was called a second time (with the same locked
    // constraints — Chromium honours the OS-reported default device).
    expect(getUserMediaImpl).toHaveBeenCalledTimes(2);
    // The first stream's track was closed.
    const firstTrack = firstStream.getTracks()[0]!;
    expect(firstTrack.stop).toHaveBeenCalledTimes(1);
    // The handle is back in 'running' state.
    expect(handle.state).toBe("running");
  });

  it("M5 (Plan 14-04 SAFE-06): onDeviceChange subscribes to navigator.mediaDevices.ondevicechange and returns an unsubscribe handle", async () => {
    const { ctx } = makeMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx });
    const stream = makeMockStream();
    const worklet = makeMockWorklet();
    // Fake mediaDevices: add/remove listeners we can verify by count.
    const listeners: Array<() => void> = [];
    const mediaDevicesRef = {
      addEventListener: vi.fn(
        (_event: "devicechange", listener: () => void): void => {
          listeners.push(listener);
        },
      ),
      removeEventListener: vi.fn(
        (_event: "devicechange", listener: () => void): void => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      ),
    };
    const handle = createMicCapture({
      audioContext: ctx,
      analyserBinding: binding,
      onFrame: vi.fn(),
      onAmplitude: vi.fn(),
      getUserMediaImpl: () => Promise.resolve(stream),
      createWorkletImpl: () => Promise.resolve(worklet.handle),
      mediaDevicesRef,
    });
    await handle.start();

    const onDeviceChangeCb = vi.fn();
    const unsubscribe = handle.onDeviceChange(onDeviceChangeCb);
    expect(mediaDevicesRef.addEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.length).toBe(1);

    // Fire the listener manually — simulating a devicechange event.
    listeners[0]!();
    expect(onDeviceChangeCb).toHaveBeenCalledTimes(1);
    const payload = onDeviceChangeCb.mock.calls[0]![0] as {
      kind: "device-switch" | "hfp-downgrade";
    };
    expect(payload.kind).toBe("device-switch");

    // Unsubscribe removes the listener.
    unsubscribe();
    expect(mediaDevicesRef.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.length).toBe(0);
  });
});
