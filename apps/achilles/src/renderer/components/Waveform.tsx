/**
 * Waveform — 32-bar Canvas2D visualizer (UI-04).
 *
 * Subscribes to an AnalyserNode-shaped object (`AnalyserNode` in
 * production, `MockAnalyser` in Phase 11 testing) and renders the
 * frequency-bin magnitudes as vertical bars on a 190×22 canvas.
 *
 * Per UI-SPEC §2:
 *   - barCount=32, barWidth=4px, barGap=2px
 *   - total span = 32 × 4 + 31 × 2 = 190px
 *   - maxBarHeight = 22px
 *
 * Per UI-SPEC §1 the bar fill color is state-dependent:
 *   - idle       → --achilles-text-dim, baseline 2px
 *   - listening  → --achilles-listening, bars driven by mic source
 *   - processing → --achilles-processing at 0.5 opacity, shimmer
 *   - speaking   → --achilles-speaking, bars driven by TTS source
 *   - error      → --achilles-error at 0.3 opacity, flat baseline
 *
 * The component uses requestAnimationFrame for the redraw loop but
 * gates the polling at most every 50ms (20fps) so the CPU cost stays
 * low (T-11-09: DoS — rAF on Waveform).
 */
import { useEffect, useRef, type ReactElement } from "react";

import type { AchillesState } from "../../shared/constants.js";
import type { AnalyserLike } from "./MockAnalyser.js";

export interface WaveformProps {
  state: AchillesState;
  /**
   * Audio analyser source. Pass `null` to suppress the rAF polling
   * loop and render a static baseline (the component is still mounted
   * with a 190×22 canvas — the test seam (WF1) reads the dimensions
   * regardless).
   */
  analyser: AnalyserLike | null;
  barCount?: number;
  barWidth?: number;
  barGap?: number;
  maxBarHeight?: number;
}

const DEFAULT_BAR_COUNT = 32;
const DEFAULT_BAR_WIDTH = 4;
const DEFAULT_BAR_GAP = 2;
const DEFAULT_MAX_BAR_HEIGHT = 22;
const POLL_INTERVAL_MS = 50;

/**
 * Reads the CSS custom property's resolved color from the document
 * root. Falls back to a literal color when the document is absent
 * (SSR) or the property is unset.
 */
function readTokenColor(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value === "" ? fallback : value;
}

/**
 * Picks the fill style for a given state. Returns a CSS color string
 * (with opacity baked in where the design calls for it).
 */
function fillStyleForState(state: AchillesState): string {
  switch (state) {
    case "idle":
      return readTokenColor("--achilles-text-dim", "rgba(232,234,237,0.7)");
    case "listening":
      return readTokenColor("--achilles-listening", "#3DD68C");
    case "processing": {
      const base = readTokenColor("--achilles-processing", "#F5A623");
      return colorWithOpacity(base, 0.5);
    }
    case "speaking":
      return readTokenColor("--achilles-speaking", "#4A9EFF");
    case "error": {
      const base = readTokenColor("--achilles-error", "#FF4D4F");
      return colorWithOpacity(base, 0.3);
    }
    default:
      return readTokenColor("--achilles-text-dim", "rgba(232,234,237,0.7)");
  }
}

/**
 * Applies an opacity layer to a hex / rgb color. Accepts the common
 * subset CSS colors produced by token values (#RRGGBB or rgba(...)).
 * The result is always rgba(...).
 */
function colorWithOpacity(color: string, opacity: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("#") && (trimmed.length === 7 || trimmed.length === 4)) {
    // Normalise #abc → #aabbcc
    const hex = trimmed.length === 4
      ? `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
      : trimmed;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }
  if (trimmed.startsWith("rgb(")) {
    return trimmed.replace(/^rgb\(/, "rgba(").replace(/\)$/, `,${opacity})`);
  }
  if (trimmed.startsWith("rgba(")) {
    // Replace the existing alpha with our opacity.
    return trimmed.replace(/,\s*[0-9.]+\)$/, `,${opacity})`);
  }
  // Unknown format — wrap in rgba 0 fallback
  return `rgba(255,255,255,${opacity})`;
}

export function Waveform({
  state,
  analyser,
  barCount = DEFAULT_BAR_COUNT,
  barWidth = DEFAULT_BAR_WIDTH,
  barGap = DEFAULT_BAR_GAP,
  maxBarHeight = DEFAULT_MAX_BAR_HEIGHT,
}: WaveformProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Persist the data array across re-renders so we do not reallocate
  // per frame. Initialise lazily because `Uint8Array` may not be
  // available during SSR.
  const dataRef = useRef<Uint8Array | null>(null);
  const lastDrawRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);

  const totalWidth = barCount * barWidth + (barCount - 1) * barGap;
  const totalHeight = maxBarHeight;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;

    function draw(): void {
      if (canvas === null) return;
      if (ctx === null) return;
      ctx.clearRect(0, 0, totalWidth, totalHeight);
      ctx.fillStyle = fillStyleForState(state);

      // Render bars. When the analyser is null OR the state is idle/error,
      // we render a flat baseline (2px) so the canvas is never blank.
      if (
        analyser === null ||
        state === "idle" ||
        state === "error"
      ) {
        for (let i = 0; i < barCount; i++) {
          const x = i * (barWidth + barGap);
          ctx.fillRect(x, totalHeight - 2, barWidth, 2);
        }
        return;
      }

      // Live source — read the analyser data into a reusable buffer.
      if (dataRef.current === null || dataRef.current.length !== analyser.frequencyBinCount) {
        dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(dataRef.current);

      const n = Math.min(barCount, dataRef.current.length);
      for (let i = 0; i < n; i++) {
        const magnitude = dataRef.current[i]! / 255;
        const h = Math.max(2, Math.floor(magnitude * totalHeight));
        const x = i * (barWidth + barGap);
        const y = totalHeight - h;
        ctx.fillRect(x, y, barWidth, h);
      }
    }

    // Initial paint so the canvas is never blank before the first
    // rAF tick.
    draw();

    // Skip the rAF loop entirely when the analyser is null or the
    // state does not consume amplitude (T-11-09 mitigation).
    if (
      analyser === null ||
      state === "idle" ||
      state === "error"
    ) {
      return () => {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }

    function loop(timestamp: number): void {
      if (timestamp - lastDrawRef.current >= POLL_INTERVAL_MS) {
        draw();
        lastDrawRef.current = timestamp;
      }
      rafRef.current = requestAnimationFrame(loop);
    }
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state, analyser, barCount, barWidth, barGap, maxBarHeight, totalWidth, totalHeight]);

  return (
    <div className="waveform">
      <canvas
        ref={canvasRef}
        data-testid="waveform"
        width={totalWidth}
        height={totalHeight}
      />
    </div>
  );
}
