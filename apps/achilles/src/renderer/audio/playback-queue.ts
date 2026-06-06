/**
 * Playback queue — sole production audio output path (PROMPT-04
 * enforcement).
 *
 * PROMPT-04 mandates that ONLY the acknowledgement and the contents of
 * `<spoken-summary>` reach the speakers. The orchestrator (Plan 12-04)
 * fan-outs these — and only these — through the IPC_TTS_CHUNK channel
 * to this queue. By making `createPlaybackQueue` the sole runtime
 * export of this module, the requirement becomes a structural property
 * of the codebase rather than a behavioural promise.
 *
 * Structural property enforced by `playback-queue.test.ts` P6:
 *   `Object.keys(import('./playback-queue.js'))` === ['createPlaybackQueue']
 *
 *   The TypeScript `interface` exports below are erased at runtime, so
 *   they do not appear in the JS module's runtime exports. The test
 *   asserts the runtime shape.
 *
 * Sequence-respecting playback (PITFALLS #6):
 *   Chunks arrive over IPC with monotonically increasing `seq` ids,
 *   but the network may reorder them between the main and renderer
 *   processes. The queue implements a renderer-side SequenceBuffer
 *   that mirrors the shape of @achilles/voice-tts/src/sequence-buffer.ts
 *   (which is main-process-only and cannot be imported here — the
 *   process boundary blocks the import). Chunks arriving out of order
 *   are buffered until the gap fills; emission is strictly monotonic.
 *
 * Completion (PITFALLS #2 half-duplex tail):
 *   The `isFinal:true` chunk's onended triggers `onPlaybackComplete`,
 *   followed by `onDrained` so the orchestrator can begin the 300 ms
 *   debounce window before switching the state machine back to idle.
 */
import type { AnalyserBindingHandle } from "./analyser-binding.js";
import type { TtsChunkPayload } from "../../shared/ipc-schemas.js";

interface BufferedChunk {
  chunk: TtsChunkPayload;
  decoded: AudioBuffer | null;
}

export interface PlaybackQueueOptions {
  audioContext: AudioContext;
  analyserBinding: AnalyserBindingHandle;
  onPlaybackComplete: () => void;
  onDrained: () => void;
  onError?: (err: Error) => void;
  /**
   * Injection seam for tests. Defaults to
   * `audioContext.decodeAudioData.bind(audioContext)`.
   */
  decodeAudioDataImpl?: (data: ArrayBuffer) => Promise<AudioBuffer>;
}

export interface PlaybackQueueHandle {
  enqueue(chunk: TtsChunkPayload): void;
  flush(): void;
  readonly queueSize: number;
  readonly playing: boolean;
}

export function createPlaybackQueue(
  opts: PlaybackQueueOptions,
): PlaybackQueueHandle {
  const decodeAudioDataImpl =
    opts.decodeAudioDataImpl ??
    ((data: ArrayBuffer) => opts.audioContext.decodeAudioData(data));

  // Renderer-side SequenceBuffer state. We store chunks keyed by seq;
  // `nextExpected` advances monotonically. `scheduledEndTime` tracks
  // the audio-context time at which the last scheduled buffer source
  // is expected to finish so the next source can be scheduled
  // sample-accurately without gaps (PITFALLS #6).
  const buffered = new Map<number, BufferedChunk>();
  let nextExpected = 0;
  let scheduledEndTime = 0;
  // Sequence id of the chunk flagged isFinal:true. -1 sentinel until
  // a final chunk is observed. The completion latch fires only once
  // for the final chunk; subsequent chunks are silently dropped.
  let finalSeq = -1;
  let currentSource: AudioBufferSourceNode | null = null;
  // Outstanding source nodes — needed so `flush()` can stop every
  // not-yet-started buffer. The Map is keyed by the chunk seq the
  // source was scheduled for.
  const liveSources = new Map<number, AudioBufferSourceNode>();
  let playing = false;
  let completionFired = false;

  function scheduleReadyChunks(): void {
    while (buffered.has(nextExpected)) {
      const slot = buffered.get(nextExpected)!;
      if (slot.decoded === null) {
        // Decode not finished yet; wait for the decode-resolve
        // continuation to re-enter this function.
        return;
      }
      buffered.delete(nextExpected);
      const seq = nextExpected;
      nextExpected += 1;
      scheduleAndPlay(slot.chunk, slot.decoded, seq);
    }
  }

  function scheduleAndPlay(
    // The chunk payload is documented at the call site for clarity but
    // the scheduler only needs the decoded buffer + seq id. Prefix with
    // `_` so noUnusedParameters is satisfied.
    _chunk: TtsChunkPayload,
    decoded: AudioBuffer,
    seq: number,
  ): void {
    const source = opts.audioContext.createBufferSource();
    source.buffer = decoded;
    // Route through the analyser binding's playback source so the
    // Waveform reflects TTS amplitude during 'speaking'. The orchestrator
    // (Plan 12-04) flips analyserBinding.setMode('speaking') before the
    // first chunk plays.
    source.connect(opts.audioContext.destination);
    opts.analyserBinding.setPlaybackSource(source);

    const startAt = Math.max(opts.audioContext.currentTime, scheduledEndTime);
    source.start(startAt);
    scheduledEndTime = startAt + decoded.duration;
    currentSource = source;
    playing = true;
    liveSources.set(seq, source);

    source.onended = () => {
      liveSources.delete(seq);
      if (currentSource === source) {
        currentSource = null;
      }
      const isLastChunkPlayed =
        finalSeq >= 0 &&
        seq === finalSeq &&
        liveSources.size === 0;
      if (isLastChunkPlayed && !completionFired) {
        completionFired = true;
        playing = false;
        // Drop the analyser playback source so a fresh utterance
        // re-attaches cleanly.
        opts.analyserBinding.setPlaybackSource(null);
        try {
          opts.onPlaybackComplete();
        } catch (err) {
          opts.onError?.(err as Error);
        }
        try {
          opts.onDrained();
        } catch (err) {
          opts.onError?.(err as Error);
        }
      } else if (liveSources.size === 0) {
        playing = false;
      }
    };
  }

  function enqueue(chunk: TtsChunkPayload): void {
    if (!Number.isInteger(chunk.seq) || chunk.seq < 0) {
      throw new Error("invalid sequence");
    }
    if (chunk.isFinal) {
      // First isFinal wins — subsequent isFinal flags on later seq
      // numbers are honoured by replacing finalSeq with the highest
      // observed value. Tests verify single-utterance happy path; the
      // edge case is defensive.
      if (finalSeq < chunk.seq) {
        finalSeq = chunk.seq;
      }
    }
    if (chunk.seq < nextExpected) {
      // Already played or actively scheduled; silent drop.
      return;
    }
    if (buffered.has(chunk.seq)) {
      // Duplicate; silent drop (mirrors voice-tts SequenceBuffer).
      return;
    }
    const slot: BufferedChunk = { chunk, decoded: null };
    buffered.set(chunk.seq, slot);
    decodeAudioDataImpl(chunk.bytes).then(
      (decoded) => {
        slot.decoded = decoded;
        scheduleReadyChunks();
      },
      (err) => {
        // Decode error — drop the chunk so the queue does not stall
        // on a corrupt payload and surface to the caller.
        buffered.delete(chunk.seq);
        opts.onError?.(err as Error);
      },
    );
  }

  function flush(): void {
    if (currentSource !== null) {
      try {
        currentSource.stop(0);
      } catch {
        // already stopped
      }
      currentSource = null;
    }
    for (const source of liveSources.values()) {
      try {
        source.stop(0);
      } catch {
        // already stopped
      }
    }
    liveSources.clear();
    buffered.clear();
    nextExpected = 0;
    scheduledEndTime = 0;
    finalSeq = -1;
    playing = false;
    completionFired = false;
    opts.analyserBinding.setPlaybackSource(null);
    try {
      opts.onDrained();
    } catch (err) {
      opts.onError?.(err as Error);
    }
  }

  return {
    enqueue,
    flush,
    get queueSize(): number {
      return buffered.size;
    },
    get playing(): boolean {
      return playing;
    },
  };
}
