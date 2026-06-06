#!/usr/bin/env node
/**
 * Generate the round-trip WAV fixture used by
 * `packages/voice-stt/src/round-trip.test.ts`.
 *
 * Output:
 *   packages/voice-stt/test/fixtures/short-utterance.wav
 *
 * Format (locked by PITFALLS #1 and Phase 09 CONTEXT.md):
 *   - RIFF / WAVE container
 *   - PCM format code 1
 *   - sample rate 16000 Hz
 *   - mono (1 channel)
 *   - 16 bits per sample (Int16, little-endian)
 *   - duration 5 seconds -> 16000 * 5 = 80000 samples
 *
 * Expected file size: 80000 samples * 2 bytes/sample + 44-byte WAV
 * header = 160044 bytes. The round-trip test pins this exact size as
 * an acceptance check.
 *
 * The waveform is a 440 Hz sine with a 250 ms silent lead-in and a
 * 250 ms silent lead-out so the mock ElevenLabs server has a stable,
 * deterministic byte stream to react to. This file is checked into the
 * repository alongside the script so the test is deterministic without
 * re-running the generator.
 *
 * Usage:
 *   node packages/voice-stt/test/fixtures/generate-fixture.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const DURATION_SECONDS = 5;
const TONE_FREQ_HZ = 440;
const TONE_AMPLITUDE = 0.25; // 0..1 fraction of full-scale
const SILENT_LEAD_MS = 250;
const SILENT_TAIL_MS = 250;

const totalSamples = SAMPLE_RATE * DURATION_SECONDS; // 80000
const leadSamples = Math.floor((SAMPLE_RATE * SILENT_LEAD_MS) / 1000);
const tailSamples = Math.floor((SAMPLE_RATE * SILENT_TAIL_MS) / 1000);
const toneSamples = totalSamples - leadSamples - tailSamples;
const dataBytes = totalSamples * (BITS_PER_SAMPLE / 8);

const buffer = Buffer.alloc(44 + dataBytes);

// ---- RIFF header ----
buffer.write("RIFF", 0, 4, "ascii");
buffer.writeUInt32LE(36 + dataBytes, 4); // file size - 8
buffer.write("WAVE", 8, 4, "ascii");

// ---- fmt subchunk ----
buffer.write("fmt ", 12, 4, "ascii");
buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
buffer.writeUInt16LE(1, 20); // PCM format code
buffer.writeUInt16LE(CHANNELS, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE((SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8, 28); // byte rate
buffer.writeUInt16LE((CHANNELS * BITS_PER_SAMPLE) / 8, 32); // block align
buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);

// ---- data subchunk ----
buffer.write("data", 36, 4, "ascii");
buffer.writeUInt32LE(dataBytes, 40);

// ---- PCM payload ----
const fullScale = 0x7fff;
let offset = 44;
for (let i = 0; i < totalSamples; i += 1) {
  let sample = 0;
  if (i >= leadSamples && i < leadSamples + toneSamples) {
    const toneIndex = i - leadSamples;
    const t = toneIndex / SAMPLE_RATE;
    sample = Math.round(
      Math.sin(2 * Math.PI * TONE_FREQ_HZ * t) * TONE_AMPLITUDE * fullScale,
    );
  }
  // Clamp to Int16 range as a belt-and-braces guard.
  if (sample > fullScale) sample = fullScale;
  if (sample < -fullScale - 1) sample = -fullScale - 1;
  buffer.writeInt16LE(sample, offset);
  offset += 2;
}

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "short-utterance.wav");
writeFileSync(outPath, buffer);

const expectedSize = 44 + dataBytes;
console.error(
  `[voice-stt fixture] wrote ${outPath} size=${buffer.length} expected=${expectedSize}`,
);
if (buffer.length !== expectedSize) {
  console.error(
    `[voice-stt fixture] FATAL: produced ${buffer.length} bytes, expected ${expectedSize}`,
  );
  process.exit(1);
}
