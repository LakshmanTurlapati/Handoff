// @vitest-environment jsdom
/**
 * Analyser binding tests — A1..A5.
 *
 * The tests use a structural mock AudioContext that returns a mock
 * AnalyserNode shape-matching `AnalyserLike`. There is NO real
 * AudioContext anywhere in this test file.
 */
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createAnalyserBinding } from "./analyser-binding.js";
import type { AnalyserLike } from "../components/MockAnalyser.js";

interface MockAnalyserNode {
  fftSize: number;
  frequencyBinCount: number;
  getByteFrequencyData: (buf: Uint8Array) => void;
  getByteTimeDomainData: (buf: Uint8Array) => void;
  connect: (target: AudioNode) => AudioNode;
  disconnect: (target?: AudioNode) => void;
}

interface MockAudioContextShape {
  createAnalyser: () => MockAnalyserNode;
  // The analyser instance the mock returns (single instance per ctx).
  _analyser: MockAnalyserNode;
}

function createMockAnalyserNode(): MockAnalyserNode {
  return {
    fftSize: 0,
    frequencyBinCount: 128,
    getByteFrequencyData(buf: Uint8Array): void {
      buf.fill(128);
    },
    getByteTimeDomainData(buf: Uint8Array): void {
      buf.fill(128);
    },
    connect: vi.fn().mockImplementation((target: AudioNode) => target),
    disconnect: vi.fn(),
  };
}

function createMockAudioContext(): {
  ctx: AudioContext;
  shape: MockAudioContextShape;
} {
  const analyser = createMockAnalyserNode();
  const shape: MockAudioContextShape = {
    _analyser: analyser,
    createAnalyser: vi.fn(() => analyser),
  };
  return {
    ctx: shape as unknown as AudioContext,
    shape,
  };
}

function makeMockSource(label: string): {
  node: AudioNode;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  const connect = vi.fn();
  const disconnect = vi.fn();
  const node = { _label: label, connect, disconnect } as unknown as AudioNode;
  return { node, connect, disconnect };
}

describe("analyser-binding (A1..A5)", () => {
  it("A1: createAnalyserBinding returns an AnalyserNode with default fftSize 256 + the AnalyserLike-shape methods", () => {
    const { ctx, shape } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    expect(shape.createAnalyser).toHaveBeenCalledTimes(1);
    expect(binding.analyser.fftSize).toBe(256);
    expect(typeof binding.analyser.frequencyBinCount).toBe("number");
    expect(typeof binding.analyser.getByteFrequencyData).toBe("function");
    expect(typeof binding.analyser.getByteTimeDomainData).toBe("function");
  });

  it("A2: setMicSource + setMode('listening') wires the mic source into the analyser", () => {
    const { ctx } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    const mic = makeMockSource("mic");
    binding.setMicSource(mic.node);
    // Still idle — no connection yet.
    expect(mic.connect).not.toHaveBeenCalled();
    binding.setMode("listening");
    expect(binding.mode).toBe("listening");
    expect(mic.connect).toHaveBeenCalledWith(binding.analyser);
  });

  it("A3: setMode swaps mic/playback/idle and connects the matching source", () => {
    const { ctx } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    const mic = makeMockSource("mic");
    const playback = makeMockSource("playback");
    binding.setMicSource(mic.node);
    binding.setPlaybackSource(playback.node);

    binding.setMode("listening");
    expect(mic.connect).toHaveBeenCalledWith(binding.analyser);
    expect(playback.connect).not.toHaveBeenCalled();

    binding.setMode("speaking");
    // mic should have been disconnected before playback was connected.
    expect(mic.disconnect).toHaveBeenCalledWith(binding.analyser);
    expect(playback.connect).toHaveBeenCalledWith(binding.analyser);

    binding.setMode("idle");
    expect(playback.disconnect).toHaveBeenCalledWith(binding.analyser);
  });

  it("A4: setMode disconnects the previous source BEFORE connecting the new one (no double-routing)", () => {
    const { ctx } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    const mic = makeMockSource("mic");
    const playback = makeMockSource("playback");
    binding.setMicSource(mic.node);
    binding.setPlaybackSource(playback.node);

    binding.setMode("listening");
    // Order: only mic should be connected so far.
    expect(mic.connect).toHaveBeenCalledTimes(1);
    expect(playback.connect).not.toHaveBeenCalled();

    binding.setMode("speaking");
    // mic.disconnect must have been invoked before playback.connect.
    // vi.fn().mock.invocationCallOrder tracks global call ordering.
    const micDisconnectOrder = mic.disconnect.mock.invocationCallOrder[0]!;
    const playbackConnectOrder = playback.connect.mock.invocationCallOrder[0]!;
    expect(micDisconnectOrder).toBeLessThan(playbackConnectOrder);
  });

  it("A5: the returned AnalyserNode is structurally assignable to AnalyserLike (Phase 11 Waveform contract)", () => {
    const { ctx } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    // Compile-time + runtime structural check that the analyser shape
    // satisfies the prop type the Waveform component reads.
    expectTypeOf(binding.analyser).toMatchTypeOf<AnalyserLike>();
    const asLike: AnalyserLike = binding.analyser;
    expect(typeof asLike.frequencyBinCount).toBe("number");
    expect(typeof asLike.getByteFrequencyData).toBe("function");
    expect(typeof asLike.getByteTimeDomainData).toBe("function");
  });

  it("setMode is a no-op when the next mode equals the current mode", () => {
    const { ctx } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    const mic = makeMockSource("mic");
    binding.setMicSource(mic.node);
    binding.setMode("listening");
    expect(mic.connect).toHaveBeenCalledTimes(1);
    binding.setMode("listening");
    expect(mic.connect).toHaveBeenCalledTimes(1);
  });

  it("destroy disconnects and nulls the references", () => {
    const { ctx } = createMockAudioContext();
    const binding = createAnalyserBinding({ audioContext: ctx, mode: "idle" });
    const mic = makeMockSource("mic");
    binding.setMicSource(mic.node);
    binding.setMode("listening");
    expect(mic.connect).toHaveBeenCalledWith(binding.analyser);
    binding.destroy();
    expect(mic.disconnect).toHaveBeenCalledWith(binding.analyser);
  });
});
