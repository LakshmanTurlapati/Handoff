/**
 * In-process reorder buffer for TTS chunks arriving out of sequence.
 *
 * The ElevenLabs Flash v2.5 stream-input WebSocket emits audio chunks
 * with monotonically increasing `sequence` ids, but network reordering
 * or server-side parallelism may cause them to arrive out of order at
 * the wrapper. `SequenceBuffer` accepts them in arrival order, buffers
 * by sequence, and emits them in strictly monotonic order so that
 * downstream playback (Phase 11 renderer) can simply concatenate.
 *
 * Behaviour summary:
 *   - `push(item)` — store an item; reject negative / non-integer
 *     sequences; dedupe same-sequence pushes (second is a no-op).
 *   - `drain()` — pull items whose sequence == nextExpected; advance
 *     the head; return the emitted array.
 *   - `hasGap()` — true if any item is buffered but the head is
 *     missing.
 *   - `nextExpected()` — the next sequence id we are waiting for.
 *   - `onEmit(cb)` — register a callback that fires for each emitted
 *     item, in monotonic order.
 *
 * Citations:
 *   - PITFALLS #6 — TTS chunks arriving faster than playback drains or
 *     out of order; explicit sequence tracking + pre-buffer is the fix
 *   - 09-CONTEXT.md — SequenceBuffer is the public utility
 */

/**
 * Sequenced items can be any object with a non-negative integer
 * `sequence` field. The buffer is generic over the rest of the shape
 * so TTS chunks, telemetry envelopes, or test fixtures can share it.
 */
export interface Sequenced {
  sequence: number;
}

export class SequenceBuffer<T extends Sequenced> {
  /**
   * Buffered items keyed by sequence. A Map preserves insertion order
   * but we never rely on iteration order — drain() reads by the
   * `nextExpected_` pointer.
   */
  private readonly buffered = new Map<number, T>();

  /**
   * The next sequence the buffer is waiting for. Starts at 0 — the
   * stream protocol assumes zero-based monotonic sequences.
   */
  private nextExpected_ = 0;

  /**
   * Registered emit callback. There is at most one; later
   * registrations overwrite earlier ones. Returning a callback rather
   * than an EventEmitter keeps the surface dependency-free.
   */
  private emitCb: ((item: T) => void) | null = null;

  /**
   * Push an item into the buffer. Reject sequences that are not
   * non-negative integers — this is the untrusted-upstream guard
   * against a misbehaving server that spoofs its way to the head of
   * the stream.
   */
  push(item: T): void {
    const seq = item.sequence;
    if (!Number.isInteger(seq) || seq < 0) {
      throw new Error(
        `SequenceBuffer.push: sequence must be a non-negative integer, got ${seq}`,
      );
    }
    if (seq < this.nextExpected_) {
      // Already emitted — silent drop. Duplicates and late arrivals
      // both land here. The strict-mode dedupe is below.
      return;
    }
    if (this.buffered.has(seq)) {
      // Duplicate sequence — keep the first push to satisfy the test
      // contract that the second is a no-op.
      return;
    }
    this.buffered.set(seq, item);
  }

  /**
   * Drain emittable items from the head. Repeatedly pulls items whose
   * sequence equals `nextExpected_`, advances the pointer, fires the
   * emit callback, and accumulates the drained array.
   */
  drain(): T[] {
    const emitted: T[] = [];
    while (this.buffered.has(this.nextExpected_)) {
      const item = this.buffered.get(this.nextExpected_) as T;
      this.buffered.delete(this.nextExpected_);
      emitted.push(item);
      if (this.emitCb !== null) {
        this.emitCb(item);
      }
      this.nextExpected_ += 1;
    }
    return emitted;
  }

  /**
   * True if the buffered items are not a contiguous prefix beginning at
   * `nextExpected_`. Used by the stream-client to surface a gap event
   * without dropping the buffered higher-sequence items.
   *
   * Concretely: a gap exists when ANY buffered item's sequence is
   * greater than `nextExpected_ + (count of items in the contiguous
   * head prefix)`. Equivalently — there is some sequence between the
   * head and the maximum buffered sequence that is NOT in the buffer.
   *
   * Examples (nextExpected_ = 0):
   *   buffered={}        -> false (nothing pending)
   *   buffered={2}       -> true  (head 0 missing)
   *   buffered={0, 2}    -> true  (head present, but 1 missing before 2)
   *   buffered={0, 1, 2} -> false (contiguous; will drain entirely)
   */
  hasGap(): boolean {
    if (this.buffered.size === 0) {
      return false;
    }
    let maxSeq = -1;
    for (const seq of this.buffered.keys()) {
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
    // The contiguous prefix starting at nextExpected_ should cover
    // [nextExpected_, nextExpected_ + size - 1] if and only if there is
    // no gap. If maxSeq is further than that, some sequence is missing
    // somewhere between nextExpected_ and maxSeq.
    return maxSeq >= this.nextExpected_ + this.buffered.size;
  }

  /**
   * The next sequence id the buffer is waiting for. Useful for
   * telemetry and for tests that assert progress.
   */
  nextExpected(): number {
    return this.nextExpected_;
  }

  /**
   * Register a callback to receive each emitted item in monotonic
   * order. There is at most one callback — later registrations
   * overwrite earlier ones.
   */
  onEmit(cb: (item: T) => void): void {
    this.emitCb = cb;
  }
}
