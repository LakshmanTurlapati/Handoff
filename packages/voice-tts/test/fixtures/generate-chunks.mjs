#!/usr/bin/env node
/**
 * Generate the 30-second sequenced TTS chunks fixture.
 *
 * Produces packages/voice-tts/test/fixtures/sequenced-chunks.json with
 * 60 deterministic chunks (sequence 0..59), each carrying a tiny
 * audioBase64 payload (`base64("chunk-<i>")`) and a fixed durationMs of
 * 500 — so the cumulative duration is exactly 30000 ms. The chunks
 * stand in for real ElevenLabs Flash v2.5 audio data; the ordering
 * test does not decode audio, it only verifies sequence reordering.
 *
 * Usage:
 *   node packages/voice-tts/test/fixtures/generate-chunks.mjs
 *
 * The script is committed alongside the generated JSON so reviewers
 * can regenerate the fixture if its parameters change. The JSON file
 * is ALSO committed so tests are deterministic without re-running the
 * script.
 *
 * Citations:
 *   - PITFALLS #6 — TTS chunks arriving out of order; sequenced
 *     fixture lets the SequenceBuffer prove it reorders.
 *   - 09-CONTEXT.md — 30-second narration as N synthetic chunks; the
 *     scrambled replay is the headline ROADMAP success criterion.
 */
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOTAL_CHUNKS = 60;
const CHUNK_DURATION_MS = 500;
const TOTAL_DURATION_MS = TOTAL_CHUNKS * CHUNK_DURATION_MS; // 30000

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "sequenced-chunks.json");

const chunks = [];
for (let i = 0; i < TOTAL_CHUNKS; i += 1) {
  chunks.push({
    sequence: i,
    audioBase64: Buffer.from(`chunk-${i}`).toString("base64"),
    durationMs: CHUNK_DURATION_MS,
    mimeType: "audio/mpeg",
  });
}

const fixture = {
  totalChunks: TOTAL_CHUNKS,
  durationMs: TOTAL_DURATION_MS,
  chunks,
};

writeFileSync(outPath, JSON.stringify(fixture, null, 2) + "\n", "utf8");
process.stdout.write(
  `[voice-tts] wrote ${TOTAL_CHUNKS} chunks (${TOTAL_DURATION_MS} ms) to ${outPath}\n`,
);
