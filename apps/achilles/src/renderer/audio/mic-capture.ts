/**
 * Mic capture — composition root that wires getUserMedia + the
 * AudioWorklet downsample + a real AnalyserNode for amplitude
 * reporting.
 *
 * Composition:
 *   getUserMedia({audio: {sampleRate:16000, channelCount:1, ...}})
 *     → MediaStreamAudioSourceNode
 *     → DownsampleWorkletNode (48k → 16k Int16, 320-sample frames)
 *
 *   The MediaStreamAudioSourceNode is also fed into the analyser
 *   binding's mic source so the Waveform reflects live mic amplitude
 *   during 'listening'.
 *
 * Half-duplex contract (PITFALLS #2 / CONTEXT.md):
 *   `pauseFrameDelivery()` drops frames at the AudioWorklet message
 *   port boundary — NOT at the MediaStreamTrack level. Closing the
 *   track triggers an OS-visible permission re-prompt on some
 *   platforms (macOS in particular), which would surface a visible
 *   mic-indicator flicker every turn. Gating at the worklet boundary
 *   keeps the mic indicator stable but ensures no frames are
 *   delivered to STT during TTS playback.
 *
 *   The amplitude tick continues during pause so the Waveform UI
 *   reflects the mic visually — the gate is about preventing frame
 *   delivery to STT (the self-trigger pitfall), not visualisation.
 *   The orchestrator (Plan 12-04) is free to mask the visual via the
 *   state-changed broadcast if desired.
 *
 * Permission gate (CONTEXT.md UI-07):
 *   getUserMedia denial surfaces as a rejected `start()` promise.
 *   The handle's `state` flips to 'errored' and subsequent `start()`
 *   calls return the cached rejection so the renderer cannot
 *   re-trigger the OS prompt by accident. Plan 11's PermissionOverlay
 *   path handles the user-facing remediation.
 */
import type { AnalyserBindingHandle } from "./analyser-binding.js";
import { AMPLITUDE_TICK_MS } from "../../shared/constants.js";
import {
  createDownsampleWorklet,
} from "./downsample-worklet.js";
import type { DownsampleWorkletHandle } from "./downsample-worklet.js";

export type MicCaptureState = "idle" | "running" | "paused" | "errored";

export interface MicCaptureOptions {
  audioContext: AudioContext;
  analyserBinding: AnalyserBindingHandle;
  onFrame: (frame: Int16Array) => void;
  onAmplitude: (rms: number) => void;
  /**
   * Injection seam for tests. Defaults to
   * `navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)`.
   * Tests pass a stub returning a fake MediaStream.
   */
  getUserMediaImpl?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  /**
   * Injection seam for tests. Defaults to the real
   * `createDownsampleWorklet` factory. Tests pass a stub that returns
   * a fake handle whose `setOnFrame` callback can be invoked
   * synchronously to simulate frame delivery.
   */
  createWorkletImpl?: (
    audioContext: AudioContext,
  ) => Promise<DownsampleWorkletHandle>;
  /**
   * Optional override for the amplitude tick cadence. Defaults to
   * AMPLITUDE_TICK_MS (50 ms / 20 fps per UI-SPEC §1).
   */
  amplitudeTickMs?: number;
  /**
   * Plan 14-04 SAFE-06 — injection seam for the mediaDevices reference
   * the renderer subscribes to for the devicechange event. Defaults to
   * `navigator.mediaDevices`. Tests pass a fake matching the
   * `addEventListener('devicechange', ...)` shape so the worklet can
   * verify the subscription is registered without requiring jsdom to
   * expose the real MediaDevices.
   */
  mediaDevicesRef?: {
    addEventListener(
      event: "devicechange",
      listener: () => void,
    ): void;
    removeEventListener(
      event: "devicechange",
      listener: () => void,
    ): void;
  };
}

/**
 * Plan 14-04 SAFE-06 — device-change notification kind reported to
 * the onDeviceChange callback. 'device-switch' is the default; the
 * orchestrator routes to a soft re-acquire (pause + resume the
 * worklet). 'hfp-downgrade' is informational — the renderer logs a
 * warning but the orchestrator's re-acquire path is identical.
 */
export type MicDeviceChangeKind = "device-switch" | "hfp-downgrade";

export interface MicCaptureHandle {
  start(): Promise<void>;
  stop(): void;
  pauseFrameDelivery(): void;
  resumeFrameDelivery(): void;
  /**
   * Plan 14-04 SAFE-06 (MC4) — re-acquire the underlying mic stream
   * against the OS-reported default device. The method stops the
   * existing capture (closes the MediaStream tracks, destroys the
   * worklet, clears the analyser source) and starts a fresh one
   * (getUserMedia with the same constraints, new worklet, new
   * analyser source binding). The handle's surface is preserved —
   * consumers do not need to swap references.
   *
   * Idempotent — re-acquiring while errored is a no-op (the cached
   * rejection from a denied getUserMedia is preserved); the caller
   * must call stop() before reacquireStream() if a clean restart is
   * required.
   */
  reacquireStream(): Promise<void>;
  /**
   * Plan 14-04 SAFE-06 (MC5) — subscribe to the
   * navigator.mediaDevices.ondevicechange event. The callback receives
   * a payload describing the change kind. The handle returns the
   * unsubscribe function so callers can detach the listener at app
   * teardown.
   */
  onDeviceChange(
    callback: (event: { kind: MicDeviceChangeKind }) => void,
  ): () => void;
  readonly state: MicCaptureState;
}

/**
 * Locked constraints — `sampleRate:16000`, `channelCount:1`, AEC + NS +
 * AGC on. CONTEXT.md + ARCHITECTURE.md + STACK.md all converge on this
 * shape. Chromium does not always honour every constraint (PITFALLS
 * #1 escape hatch); the downsample worklet enforces the 16 kHz
 * contract regardless of what the OS hands back.
 */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export function createMicCapture(opts: MicCaptureOptions): MicCaptureHandle {
  const getUserMediaImpl =
    opts.getUserMediaImpl ??
    ((constraints) =>
      navigator.mediaDevices.getUserMedia(constraints));
  const createWorkletImpl = opts.createWorkletImpl ?? createDownsampleWorklet;
  const tickMs = opts.amplitudeTickMs ?? AMPLITUDE_TICK_MS;

  let stream: MediaStream | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let worklet: DownsampleWorkletHandle | null = null;
  let paused = false;
  let tickHandle: ReturnType<typeof setInterval> | null = null;
  let cachedRejection: Promise<void> | null = null;
  let status: MicCaptureState = "idle";

  function startAmplitudeTick(): void {
    if (tickHandle !== null) return;
    const buffer = new Uint8Array(opts.analyserBinding.analyser.frequencyBinCount);
    tickHandle = setInterval(() => {
      opts.analyserBinding.analyser.getByteFrequencyData(buffer);
      // Compute RMS over the byte-domain frequency bins normalised to
      // [0, 1] (each byte is 0..255). Matches the Plan 11
      // mock-amplitude RMS shape.
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = buffer[i]! / 255;
        sumSquares += v * v;
      }
      const rms = buffer.length === 0 ? 0 : Math.sqrt(sumSquares / buffer.length);
      opts.onAmplitude(rms);
    }, tickMs);
  }

  function stopAmplitudeTick(): void {
    if (tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
    }
  }

  async function start(): Promise<void> {
    if (cachedRejection !== null) {
      return cachedRejection;
    }
    if (status === "running" || status === "paused") {
      return;
    }
    try {
      stream = await getUserMediaImpl(MIC_CONSTRAINTS);
      sourceNode = opts.audioContext.createMediaStreamSource(stream);
      worklet = await createWorkletImpl(opts.audioContext);
      sourceNode.connect(worklet.node);
      worklet.setOnFrame((frame: Int16Array) => {
        if (paused) return;
        opts.onFrame(frame);
      });
      opts.analyserBinding.setMicSource(sourceNode);
      startAmplitudeTick();
      paused = false;
      status = "running";
    } catch (err) {
      status = "errored";
      const rejection = Promise.reject(err);
      // Prevent unhandled-rejection warnings from the cached promise
      // that we hand back on subsequent start() calls; the caller's
      // catch attaches to the original `err`.
      rejection.catch(() => undefined);
      cachedRejection = rejection;
      throw err;
    }
  }

  function stop(): void {
    stopAmplitudeTick();
    if (worklet !== null) {
      worklet.destroy();
      worklet = null;
    }
    if (sourceNode !== null) {
      try {
        sourceNode.disconnect();
      } catch {
        // already detached
      }
      sourceNode = null;
    }
    if (stream !== null) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = null;
    }
    opts.analyserBinding.setMicSource(null);
    paused = false;
    if (status !== "errored") {
      status = "idle";
    }
  }

  function pauseFrameDelivery(): void {
    if (status !== "running") return;
    paused = true;
    status = "paused";
  }

  function resumeFrameDelivery(): void {
    if (status !== "paused") return;
    paused = false;
    status = "running";
  }

  /**
   * Plan 14-04 SAFE-06 (MC4): tear down the existing capture and
   * re-acquire from the OS-reported default device. The method
   * preserves the MicCaptureHandle surface — consumers do not swap
   * references — but the underlying MediaStream, worklet, and
   * analyser source are all replaced.
   */
  async function reacquireStream(): Promise<void> {
    if (cachedRejection !== null) {
      // Errored state — do NOT attempt to re-acquire. The caller must
      // call stop() first to clear the cached rejection.
      return;
    }
    // Stop the existing capture cleanly. We do NOT touch
    // cachedRejection here — a successful prior start has it as null,
    // and a clean stop drops everything else.
    stop();
    // start() re-runs the full acquisition pipeline (getUserMedia +
    // worklet + analyser binding) against the OS-reported default
    // device. The MediaStream the OS returns reflects the new default;
    // we do NOT pin to a specific deviceId because Chromium's
    // getUserMedia honours the OS preference when no deviceId
    // constraint is supplied.
    await start();
  }

  /**
   * Plan 14-04 SAFE-06 (MC5): subscribe to the
   * navigator.mediaDevices.ondevicechange event. Returns the
   * unsubscribe function so callers can detach the listener at app
   * teardown.
   */
  function onDeviceChange(
    callback: (event: { kind: MicDeviceChangeKind }) => void,
  ): () => void {
    const ref =
      opts.mediaDevicesRef ??
      (typeof navigator !== "undefined"
        ? (navigator as Navigator).mediaDevices
        : undefined);
    if (ref === undefined) {
      // No mediaDevices surface available (e.g., the test environment
      // lacks navigator); the subscription is a no-op and the
      // unsubscribe is also a no-op.
      return () => undefined;
    }
    const listener = (): void => {
      // The renderer does not classify HFP vs device-switch here — the
      // main-side device-change-handler handles the classification with
      // the device labels. We always report 'device-switch' from the
      // renderer; the orchestrator's response is identical.
      callback({ kind: "device-switch" });
    };
    ref.addEventListener("devicechange", listener);
    return (): void => {
      ref.removeEventListener("devicechange", listener);
    };
  }

  return {
    start,
    stop,
    pauseFrameDelivery,
    resumeFrameDelivery,
    reacquireStream,
    onDeviceChange,
    get state(): MicCaptureState {
      return status;
    },
  };
}
