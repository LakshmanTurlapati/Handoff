/**
 * Phase 18, Plan 02, Task 3 — RED tests for marker.ts
 *
 * Tests for hasInitMarker, writeInitMarker, readInitMarker.
 * All tests inject homedirImpl or use tmpdir so no real ~/.achilles touch.
 *
 * No emojis (CLAUDE.md global).
 */
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hasInitMarker,
  writeInitMarker,
  readInitMarker,
  type InitMarker,
  type MarkerDeps,
} from "../../src/init/marker.js";

/** Build a tmpdir-based home and return deps + cleanup function. */
function makeTmpHome(): { dir: string; deps: MarkerDeps; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "achilles-marker-test-"));
  const deps: MarkerDeps = {
    homedirImpl: () => dir,
  };
  return {
    dir,
    deps,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const sampleMarker: InitMarker = {
  initializedAt: "2026-06-08T12:00:00.000Z",
  version: "1.3.0",
  apiKeySource: "keychain",
};

describe("hasInitMarker — missing", () => {
  it("returns false when the file does not exist", () => {
    const { deps, cleanup } = makeTmpHome();
    try {
      expect(hasInitMarker(deps)).toBe(false);
    } finally {
      cleanup();
    }
  });
});

describe("writeInitMarker -> readInitMarker round-trip", () => {
  it("round-trips a valid InitMarker", () => {
    const { deps, cleanup } = makeTmpHome();
    try {
      writeInitMarker(sampleMarker, deps);
      const result = readInitMarker(deps);
      expect(result).not.toBeNull();
      expect(result?.initializedAt).toBe(sampleMarker.initializedAt);
      expect(result?.version).toBe(sampleMarker.version);
      expect(result?.apiKeySource).toBe(sampleMarker.apiKeySource);
    } finally {
      cleanup();
    }
  });
});

describe("readInitMarker — corrupt content", () => {
  it("returns null when JSON.parse throws on corrupt content", () => {
    const { dir, deps, cleanup } = makeTmpHome();
    try {
      const achillesDir = join(dir, ".achilles");
      mkdirSync(achillesDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(achillesDir, "init.json"), "not valid json {{{", {
        mode: 0o600,
      });
      expect(readInitMarker(deps)).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe("writeInitMarker — 0o600 perms", () => {
  it("enforces 0o600 perms via chmodSync", () => {
    const { deps, cleanup } = makeTmpHome();
    try {
      const chmodSpy = vi.fn();
      const depsWithSpy: MarkerDeps = {
        ...deps,
        chmodSyncImpl: chmodSpy,
      };
      writeInitMarker(sampleMarker, depsWithSpy);
      expect(chmodSpy).toHaveBeenCalledWith(expect.any(String), 0o600);
    } finally {
      cleanup();
    }
  });
});

describe("writeInitMarker — creates parent dir", () => {
  it("creates the parent ~/.achilles dir with 0o700 perms if missing", () => {
    const { dir, deps, cleanup } = makeTmpHome();
    try {
      const realMkdirSync = mkdirSync;
      const mkdirSpy = vi.fn(
        (path: string, opts: { recursive: boolean; mode: number }) => {
          // Delegate to real mkdirSync so subsequent writeFileSync does not fail.
          realMkdirSync(path, opts);
        },
      );
      const depsWithSpy: MarkerDeps = {
        ...deps,
        mkdirSyncImpl: mkdirSpy,
      };
      writeInitMarker(sampleMarker, depsWithSpy);
      // Should have been called with recursive:true and mode 0o700.
      expect(mkdirSpy).toHaveBeenCalledWith(
        join(dir, ".achilles"),
        expect.objectContaining({ recursive: true, mode: 0o700 }),
      );
    } finally {
      cleanup();
    }
  });
});
