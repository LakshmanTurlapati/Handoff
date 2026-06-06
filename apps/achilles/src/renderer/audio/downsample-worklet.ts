/**
 * AudioWorklet downsample — 48 kHz Float32 → 16 kHz Int16 PCM.
 *
 * Pin contract (PITFALLS #1, REQUIREMENTS.md LOOP-01):
 *   The renderer feeds `@achilles/voice-stt`'s `write(frame: Int16Array)`
 *   contract verbatim. The contract is 16 kHz mono Int16 PCM at 20 ms
 *   granularity (320 samples per frame). This module is the single
 *   source of truth for the resampling math and frame size.
 *
 *   Locked constants (also pinned at the IPC trust boundary in
 *   `shared/ipc-schemas.ts` via `MicFramePayloadSchema`'s `z.literal(...)`
 *   validators):
 *     TARGET_SAMPLE_RATE = 16000
 *     FRAME_SAMPLES      = 320       (20 ms at 16 kHz)
 *     SOURCE_SAMPLE_RATE = 48000     (Chromium AudioContext default)
 *     FRAME_SAMPLES_48K  = 960       (20 ms at 48 kHz)
 *     FRAME_DURATION_MS  = 20
 *
 * Module shape — TWO halves:
 *   (A) PURE helper `downsample48kTo16kInt16(input: Float32Array)` —
 *       fully testable in vitest's node environment; no AudioWorklet
 *       runtime required.
 *   (B) Factory `createDownsampleWorklet(audioContext)` — the
 *       AudioWorklet wrapper. The processor source is embedded as an
 *       inline string + dynamically constructed Blob URL because
 *       electron-vite does not yet pipe a separate worklet bundle.
 *       The factory accepts AudioContext as an injection seam so tests
 *       can pass a mock. The runtime path is exercised end-to-end by
 *       Plan 12-04's integration smoke test under MOCK_LOOP=1.
 *
 * Note: the pure `downsample48kTo16kInt16` function lives in BOTH the
 * surrounding module scope AND embedded in the inline processor source
 * — duplication is intentional because the worklet runs in a separate
 * JS realm without module imports. The unit test only exercises the
 * surrounding-scope function.
 */

// ─────────────────────────────────────────────────────────────────────
// Locked sample-rate + frame-size constants. PITFALLS #1 pin.
// ─────────────────────────────────────────────────────────────────────

export const TARGET_SAMPLE_RATE = 16000;
export const FRAME_DURATION_MS = 20;
export const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 320
export const SOURCE_SAMPLE_RATE = 48000;
export const FRAME_SAMPLES_48K =
  (SOURCE_SAMPLE_RATE * FRAME_DURATION_MS) / 1000; // 960
export const DOWNSAMPLE_WORKLET_NAME = "achilles-downsample-processor";

// ─────────────────────────────────────────────────────────────────────
// (A) Pure helper — downsample48kTo16kInt16
// ─────────────────────────────────────────────────────────────────────

/**
 * Decimate a 48 kHz Float32Array frame (960 samples, 20 ms) into a
 * 16 kHz Int16Array frame (320 samples, 20 ms).
 *
 * Implementation:
 *   The decimation ratio is exactly 3 (48000 / 16000). For each output
 *   sample, we apply a simple 3-tap box-filter — the average of three
 *   consecutive input samples — which is a low-pass implementation good
 *   enough for the Scribe v2 model. A future plan (Phase 14 hardening)
 *   can swap in a biquad anti-alias filter if pitch artefacts appear
 *   under load.
 *
 *   Float32 [-1, 1] → Int16 [-32767, +32767] via `Math.round(v * 32767)`.
 *   The asymmetric -32768 edge is the CD-audio standard but pushes a
 *   1 LSB DC offset; using ±32767 keeps the conversion symmetric.
 *
 *   Values outside [-1, 1] are clamped before scaling (a single-sample
 *   spike in the source would otherwise wrap around the Int16 range).
 *
 * Throws TypeError if `input.length !== FRAME_SAMPLES_48K`. Input
 * length is a hard contract — the AudioWorklet wrapper guarantees this
 * by buffering samples until a full 960-sample frame accumulates.
 */
export function downsample48kTo16kInt16(input: Float32Array): Int16Array {
  if (input.length !== FRAME_SAMPLES_48K) {
    throw new TypeError(
      `expected Float32Array length ${FRAME_SAMPLES_48K} (FRAME_SAMPLES_48K); got ${input.length}`,
    );
  }
  const out = new Int16Array(FRAME_SAMPLES);
  for (let i = 0; i < FRAME_SAMPLES; i++) {
    const j = i * 3;
    // noUncheckedIndexedAccess is on; we know j+2 < input.length because
    // FRAME_SAMPLES * 3 === FRAME_SAMPLES_48K. The non-null assertions
    // surface the contract to the typechecker.
    const v = (input[j]! + input[j + 1]! + input[j + 2]!) / 3;
    const clamped = Math.max(-1, Math.min(1, v));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// (B) AudioWorklet wrapper — createDownsampleWorklet
// ─────────────────────────────────────────────────────────────────────

/**
 * Handle returned by `createDownsampleWorklet`. The renderer wires
 * `node` into the audio graph (source → node → optional fanout) and
 * registers `setOnFrame` to receive each downsampled 16 kHz Int16
 * frame. Call `destroy` to disconnect and tear down.
 */
export interface DownsampleWorkletHandle {
  readonly node: AudioWorkletNode;
  readonly outputSampleRate: number;
  readonly samplesPerFrame: number;
  setOnFrame(handler: (frame: Int16Array) => void): void;
  destroy(): void;
}

/**
 * Inline processor source. Loaded into the worklet realm via a Blob URL
 * because the electron-vite renderer config does not yet pipe a
 * separate worklet bundle (a future plan can lift it out).
 *
 * The processor:
 *   1. Reads `inputs[0][0]` (mono input).
 *   2. Buffers samples until FRAME_SAMPLES_48K accumulate.
 *   3. Calls a copy of `downsample48kTo16kInt16` (duplicated here
 *      because the worklet realm has no module imports).
 *   4. Posts `{ type: 'frame', pcm: Int16Array }` via `this.port`.
 *   5. Returns true to keep the audio graph alive.
 *
 * The constants `FRAME_SAMPLES_48K`, `FRAME_SAMPLES`, and the
 * processor name are templated in at factory-construction time so a
 * future rename of `DOWNSAMPLE_WORKLET_NAME` propagates correctly.
 */
function buildProcessorSource(): string {
  return `
    const FRAME_SAMPLES_48K = ${FRAME_SAMPLES_48K};
    const FRAME_SAMPLES = ${FRAME_SAMPLES};
    function downsample(input) {
      const out = new Int16Array(FRAME_SAMPLES);
      for (let i = 0; i < FRAME_SAMPLES; i++) {
        const j = i * 3;
        const v = (input[j] + input[j + 1] + input[j + 2]) / 3;
        const clamped = Math.max(-1, Math.min(1, v));
        out[i] = Math.round(clamped * 32767);
      }
      return out;
    }
    class AchillesDownsampleProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this._buffer = new Float32Array(FRAME_SAMPLES_48K);
        this._offset = 0;
      }
      process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (!channel || channel.length === 0) {
          return true;
        }
        let read = 0;
        while (read < channel.length) {
          const remaining = FRAME_SAMPLES_48K - this._offset;
          const take = Math.min(remaining, channel.length - read);
          this._buffer.set(channel.subarray(read, read + take), this._offset);
          this._offset += take;
          read += take;
          if (this._offset === FRAME_SAMPLES_48K) {
            const frame = downsample(this._buffer);
            this.port.postMessage({ type: 'frame', pcm: frame }, [frame.buffer]);
            this._offset = 0;
          }
        }
        return true;
      }
    }
    registerProcessor(${JSON.stringify(DOWNSAMPLE_WORKLET_NAME)}, AchillesDownsampleProcessor);
  `;
}

/**
 * Creates the AudioWorkletNode that downsamples 48 kHz Float32 frames
 * to 16 kHz Int16 frames. The factory:
 *
 *   1. Builds the inline processor source as a Blob URL.
 *   2. Calls `audioContext.audioWorklet.addModule(blobUrl)`.
 *   3. Revokes the Blob URL (the module is now registered).
 *   4. Constructs `new AudioWorkletNode(audioContext, DOWNSAMPLE_WORKLET_NAME)`.
 *   5. Wires `node.port.onmessage` to invoke the registered handler.
 *
 * The runtime path is NOT exercised by unit tests (jsdom has no
 * AudioWorklet runtime). Plan 12-04's integration smoke test under
 * MOCK_LOOP=1 covers the end-to-end behaviour.
 */
export async function createDownsampleWorklet(
  audioContext: AudioContext,
): Promise<DownsampleWorkletHandle> {
  const source = buildProcessorSource();
  // Browsers + Electron renderer have URL.createObjectURL; jsdom does
  // not. The factory is not exercised under jsdom in unit tests.
  const blob = new Blob([source], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await audioContext.audioWorklet.addModule(blobUrl);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const node = new AudioWorkletNode(audioContext, DOWNSAMPLE_WORKLET_NAME);
  let handler: ((frame: Int16Array) => void) | null = null;
  node.port.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; pcm?: Int16Array } | undefined;
    if (data === undefined || data.type !== "frame" || data.pcm === undefined) {
      return;
    }
    if (handler !== null) {
      handler(data.pcm);
    }
  };
  return {
    node,
    outputSampleRate: TARGET_SAMPLE_RATE,
    samplesPerFrame: FRAME_SAMPLES,
    setOnFrame(next: (frame: Int16Array) => void): void {
      handler = next;
    },
    destroy(): void {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        // disconnect can throw if the node is already detached; safe to swallow.
      }
    },
  };
}
