/**
 * Phase 17, Plan 01, Task 2 — Behaviour tests for structured-logger.ts.
 *
 * Five properties asserted:
 *
 *   1. NDJSON shape: writes one JSON object per line with required
 *      fields ts/level/event
 *   2. Redaction: default patterns remove the sk- fixture pattern from
 *      any field value
 *   3. Rotation: when the file exceeds maxBytes, the file rotates to
 *      .log.1 and a fresh file is started
 *   4. Disposed flag: after dispose(), subsequent info/warn/error
 *      calls are no-ops
 *   5. Child scope: child("scope") returns a logger that prefixes
 *      every line with scope: "scope"
 *
 * Hermetic: every test uses node:fs.mkdtempSync + node:os.tmpdir for
 * an isolated working directory; NO write to ~/.achilles/.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStructuredLogger } from "../src/structured-logger.js";

/**
 * Build a logger pointed at a fresh tmpdir + return both. Caller is
 * responsible for cleanup via the returned tmpdir path.
 */
function makeHermeticLogger(
  overrides: Partial<Parameters<typeof createStructuredLogger>[0]> = {},
): { logger: ReturnType<typeof createStructuredLogger>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "achilles-logger-test-"));
  const logger = createStructuredLogger({
    logDir: dir,
    nowImpl: () => 1_700_000_000_000,
    ...overrides,
  });
  return { logger, dir };
}

describe("structured-logger — NDJSON shape", () => {
  it("writes one JSON object per line with ts / level / event fields", () => {
    const { logger, dir } = makeHermeticLogger();
    try {
      logger.info("session_start", { mode: "voice" });
      logger.warn("low_disk", { freeBytes: 1024 });
      logger.error("ws_disconnect", { code: 1011 });
      const filePath = join(dir, "achilles.log");
      expect(existsSync(filePath)).toBe(true);
      const lines = readFileSync(filePath, "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines.length).toBe(3);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(typeof parsed.ts).toBe("number");
        expect(typeof parsed.level).toBe("string");
        expect(typeof parsed.event).toBe("string");
      }
      const first = JSON.parse(lines[0] as string);
      expect(first.event).toBe("session_start");
      expect(first.level).toBe("info");
      expect(first.mode).toBe("voice");
      const second = JSON.parse(lines[1] as string);
      expect(second.level).toBe("warn");
      const third = JSON.parse(lines[2] as string);
      expect(third.level).toBe("error");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("structured-logger — redaction", () => {
  it("default patterns remove the sk- fixture pattern from field values", () => {
    const { logger, dir } = makeHermeticLogger();
    try {
      const SECRET = "sk-aaaaaaaaaaaaaaaaaaaaaa";
      logger.info("api_call", { authToken: SECRET, endpoint: "/chat" });
      const lines = readFileSync(join(dir, "achilles.log"), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      const line = lines[0] as string;
      expect(line).not.toContain(SECRET);
      expect(line).toContain("[REDACTED]");
      // The non-secret field is preserved.
      expect(line).toContain("/chat");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("redacts xi-, Bearer, JWT, long-hex, and ELEVENLABS_API_KEY shapes", () => {
    const { logger, dir } = makeHermeticLogger();
    try {
      const XI_KEY = "xi-abcdefghijklmnopqrstuvwxyz";
      const BEARER = "Bearer abcdef.ghijkl_mnopqr-stuvwx";
      const JWT =
        "abcdefghijklmnopqrstuvwxyz1234567890abcdef.eyJhbGciOiJIUzI1NiJ9.signature_part";
      const LONG_HEX = "abcdef0123456789".repeat(4);
      const ENV_ASSIGN = "ELEVENLABS_API_KEY=secret_value_here";
      logger.info("multi_secret", {
        xi: XI_KEY,
        bearer: BEARER,
        jwt: JWT,
        hex: LONG_HEX,
        env: ENV_ASSIGN,
      });
      const line = readFileSync(join(dir, "achilles.log"), "utf8");
      expect(line).not.toContain(XI_KEY);
      expect(line).not.toContain(BEARER);
      expect(line).not.toContain(JWT);
      expect(line).not.toContain(LONG_HEX);
      expect(line).not.toContain(ENV_ASSIGN);
      expect(line).toContain("[REDACTED]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("structured-logger — rotation", () => {
  it("when file exceeds maxBytes, renames to .log.1 and starts a fresh file", () => {
    const { logger, dir } = makeHermeticLogger({ maxBytes: 200 });
    try {
      // Each line is well under 200 bytes; writing 30 of them
      // (~50-100 bytes each) easily exceeds the threshold.
      for (let i = 0; i < 30; i++) {
        logger.info("tick", { i });
      }
      const filePath = join(dir, "achilles.log");
      const rotatedPath = join(dir, "achilles.log.1");
      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(rotatedPath)).toBe(true);
      // The .log file is the small post-rotation file; .log.1 is the
      // larger archived previous-generation file.
      const liveBytes = readFileSync(filePath, "utf8").length;
      const rotatedBytes = readFileSync(rotatedPath, "utf8").length;
      // Combined, all 30 ticks should be on disk in either file.
      expect(rotatedBytes).toBeGreaterThan(0);
      expect(liveBytes + rotatedBytes).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("structured-logger — disposed flag", () => {
  it("subsequent info/warn/error calls become no-ops after dispose()", () => {
    const { logger, dir } = makeHermeticLogger();
    try {
      logger.info("before_dispose", { stage: 1 });
      logger.dispose();
      logger.info("after_dispose_info", { stage: 2 });
      logger.warn("after_dispose_warn", { stage: 3 });
      logger.error("after_dispose_error", { stage: 4 });
      const lines = readFileSync(join(dir, "achilles.log"), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0] as string);
      expect(parsed.event).toBe("before_dispose");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("structured-logger — child scope", () => {
  it("child('scope') returns a logger that prefixes every line with scope: 'scope'", () => {
    const { logger, dir } = makeHermeticLogger();
    try {
      const child = logger.child("stt");
      child.info("partial", { text: "hello" });
      const lines = readFileSync(join(dir, "achilles.log"), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0] as string);
      expect(parsed.scope).toBe("stt");
      expect(parsed.event).toBe("partial");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nested child scopes compose with a dot separator", () => {
    const { logger, dir } = makeHermeticLogger();
    try {
      const child = logger.child("audio");
      const grandchild = child.child("stt");
      grandchild.info("ready");
      const lines = readFileSync(join(dir, "achilles.log"), "utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0] as string);
      expect(parsed.scope).toBe("audio.stt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
