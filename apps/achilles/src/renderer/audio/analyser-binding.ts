/**
 * Analyser binding — mode-switching AnalyserNode for the Waveform.
 *
 * Phase 11 shipped a MockAnalyser test seam (apps/achilles/src/renderer/
 * components/MockAnalyser.ts) that shape-matches the Web Audio API's
 * AnalyserNode. The Waveform component types its `analyser` prop as
 * `AnalyserLike | null` so a real `AnalyserNode` (production) and the
 * mock (tests) are both assignable.
 *
 * This binding is the production replacement: it owns a single
 * AnalyserNode and switches which upstream source feeds it based on
 * the current mode:
 *
 *   - 'listening' → mic source (the MediaStreamAudioSourceNode from
 *                    mic-capture.ts)
 *   - 'speaking'  → playback source (the AudioBufferSourceNode chain
 *                    from playback-queue.ts)
 *   - 'idle'      → disconnected (the Waveform renders flat baseline)
 *
 * The binding is the only production producer of the AnalyserNode that
 * flows through the React tree as the Waveform's `analyser` prop;
 * Phase 11's MockAnalyser stays as the test seam for the headless
 * Playwright renderer specs.
 *
 * Half-duplex note: switching modes via `setMode` disconnects the
 * previous source before connecting the new one — there is never a
 * window where both the mic and TTS playback feed the analyser
 * simultaneously. The Phase 11 component contract is preserved
 * verbatim (the Waveform only reads `fftSize`, `frequencyBinCount`,
 * `getByteFrequencyData`, `getByteTimeDomainData`).
 */

export type AnalyserMode = "idle" | "listening" | "speaking";

/**
 * Handle returned by `createAnalyserBinding`. The renderer feeds
 * `analyser` directly into the Waveform's `analyser` prop. Sources
 * are set independently via `setMicSource` / `setPlaybackSource` so
 * the orchestrator (Plan 12-04) can wire them at composition time
 * without re-creating the binding.
 */
export interface AnalyserBindingHandle {
  readonly analyser: AnalyserNode;
  setMicSource(node: AudioNode | null): void;
  setPlaybackSource(node: AudioNode | null): void;
  setMode(mode: AnalyserMode): void;
  readonly mode: AnalyserMode;
  destroy(): void;
}

export interface CreateAnalyserBindingOptions {
  audioContext: AudioContext;
  mode?: AnalyserMode;
  /**
   * Defaults to 256 — matches Phase 11's MockAnalyser default and
   * UI-SPEC §1 (32 bars × bin curve at 256 bins keeps the Waveform
   * structurally identical to the e2e fixture expectations).
   */
  fftSize?: number;
}

const DEFAULT_FFT_SIZE = 256;

export function createAnalyserBinding(
  opts: CreateAnalyserBindingOptions,
): AnalyserBindingHandle {
  const analyser = opts.audioContext.createAnalyser();
  analyser.fftSize = opts.fftSize ?? DEFAULT_FFT_SIZE;

  let micSource: AudioNode | null = null;
  let playbackSource: AudioNode | null = null;
  let currentMode: AnalyserMode = opts.mode ?? "idle";
  // The source currently connected to the analyser. Tracking this
  // separately from micSource / playbackSource lets the binding
  // disconnect cleanly when either reference is swapped out from
  // under the active connection.
  let connectedSource: AudioNode | null = null;

  function sourceForMode(mode: AnalyserMode): AudioNode | null {
    if (mode === "listening") return micSource;
    if (mode === "speaking") return playbackSource;
    return null;
  }

  function applyMode(): void {
    const desired = sourceForMode(currentMode);
    if (desired === connectedSource) return;
    if (connectedSource !== null) {
      try {
        connectedSource.disconnect(analyser);
      } catch {
        // disconnect can throw if the source was not connected;
        // swallow because the post-condition (no longer connected)
        // is what we want.
      }
    }
    connectedSource = desired;
    if (desired !== null) {
      desired.connect(analyser);
    }
  }

  // Connect immediately for the initial mode if a source is already
  // available. In practice the orchestrator constructs the binding
  // before sources are known and then calls setMicSource / setMode
  // when ready.
  applyMode();

  return {
    analyser,
    get mode(): AnalyserMode {
      return currentMode;
    },
    setMicSource(node: AudioNode | null): void {
      micSource = node;
      if (currentMode === "listening") {
        applyMode();
      }
    },
    setPlaybackSource(node: AudioNode | null): void {
      playbackSource = node;
      if (currentMode === "speaking") {
        applyMode();
      }
    },
    setMode(next: AnalyserMode): void {
      if (next === currentMode) return;
      currentMode = next;
      applyMode();
    },
    destroy(): void {
      if (connectedSource !== null) {
        try {
          connectedSource.disconnect(analyser);
        } catch {
          // already detached
        }
      }
      connectedSource = null;
      micSource = null;
      playbackSource = null;
    },
  };
}
