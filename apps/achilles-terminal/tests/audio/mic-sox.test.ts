/**
 * CAP-01 — createMicSox unit tests (Phase 16, Plan 01, Task 1).
 *
 * Validates the per-platform sox spawn shape, stdio enforcement
 * (PITFALLS.md §1 silent-launch defence — NEVER `"ignore"` on stdout/stderr),
 * the zero-copy Int16Array frame view, the 640-byte frame buffering across
 * arbitrary chunk sizes, and the exit-code + stderr surfacing path.
 *
 * The factory accepts a deterministic spawn injection seam (`spawnImpl`) and
 * platform override (`platformOverride`) so all 7 cases run as pure unit tests
 * with no real sox dependency.
 */
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn as spawnFn } from "node:child_process";
import { createMicSox } from "../../src/audio/mic-sox.js";

type SpawnArgs = Parameters<typeof spawnFn>;

// Minimal stand-in for a node:child_process child. EventEmitter satisfies the
// proc.on / proc.once contract; stdout / stderr are independent EventEmitter
// streams so tests can emit "data" against the proper pipe. kill is a vitest
// spy so we can assert SIGTERM propagation in Test 7.
function makeFakeChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe("createMicSox — sox child process wrapper (CAP-01)", () => {
  it("Test 1: POSIX argv shape (linux/darwin) — rec with no -d flag", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    createMicSox({
      onFrame: vi.fn(),
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "linux",
    });
    expect(fakeSpawn).toHaveBeenCalledTimes(1);
    const call = fakeSpawn.mock.calls[0]!;
    expect(call[0]).toBe("rec");
    expect(call[1]).toEqual([
      "-q",
      "-t",
      "raw",
      "-r",
      "16000",
      "-b",
      "16",
      "-e",
      "signed",
      "-c",
      "1",
      "-",
    ]);
  });

  it("Test 1b: POSIX argv shape (darwin) — rec with no -d flag", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    createMicSox({
      onFrame: vi.fn(),
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "darwin",
    });
    const call = fakeSpawn.mock.calls[0]!;
    expect(call[0]).toBe("rec");
    expect(call[1]).toEqual([
      "-q",
      "-t",
      "raw",
      "-r",
      "16000",
      "-b",
      "16",
      "-e",
      "signed",
      "-c",
      "1",
      "-",
    ]);
  });

  it("Test 2: Windows argv shape — sox.exe with -d default-device flag", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    createMicSox({
      onFrame: vi.fn(),
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "win32",
    });
    const call = fakeSpawn.mock.calls[0]!;
    expect(call[0]).toBe("sox.exe");
    expect(call[1]).toEqual([
      "-q",
      "-d",
      "-t",
      "raw",
      "-r",
      "16000",
      "-b",
      "16",
      "-e",
      "signed",
      "-c",
      "1",
      "-",
    ]);
  });

  it("Test 3: stdio shape — [\"ignore\", \"pipe\", \"pipe\"] (PITFALLS.md §1 silent-launch defence)", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    createMicSox({
      onFrame: vi.fn(),
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "linux",
    });
    const call = fakeSpawn.mock.calls[0]!;
    const options = call[2] as unknown as { stdio: unknown };
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("Test 4: frame extraction — 640-byte chunk yields one Int16Array of length 320", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    const onFrame = vi.fn();
    createMicSox({
      onFrame,
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "linux",
    });
    // Buffer.alloc(640, 0x12) -> 640 bytes of repeating 0x12. Interpreted as
    // little-endian s16, every pair (0x12, 0x12) becomes the int16 0x1212 = 4626.
    fakeChild.stdout.emit("data", Buffer.alloc(640, 0x12));
    expect(onFrame).toHaveBeenCalledTimes(1);
    const frame = onFrame.mock.calls[0]![0] as Int16Array;
    expect(frame).toBeInstanceOf(Int16Array);
    expect(frame.length).toBe(320);
    expect(frame[0]).toBe(0x1212);
    expect(frame[319]).toBe(0x1212);
  });

  it("Test 5: multi-frame buffering — 1280-byte chunk yields two frames; 480-byte then 160-byte assembles one frame from the leftover", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    const onFrame = vi.fn();
    createMicSox({
      onFrame,
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "linux",
    });

    // Case A: a single 1280-byte chunk -> two frames.
    fakeChild.stdout.emit("data", Buffer.alloc(1280, 0x34));
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect((onFrame.mock.calls[0]![0] as Int16Array).length).toBe(320);
    expect((onFrame.mock.calls[1]![0] as Int16Array).length).toBe(320);

    onFrame.mockClear();

    // Case B: a 480-byte chunk then a 160-byte chunk -> 640 bytes -> one frame.
    fakeChild.stdout.emit("data", Buffer.alloc(480, 0x56));
    expect(onFrame).not.toHaveBeenCalled();
    fakeChild.stdout.emit("data", Buffer.alloc(160, 0x78));
    expect(onFrame).toHaveBeenCalledTimes(1);
    const frame = onFrame.mock.calls[0]![0] as Int16Array;
    expect(frame.length).toBe(320);
    // First 240 int16 samples come from the 480-byte 0x56 chunk;
    // last 80 int16 samples come from the 160-byte 0x78 chunk.
    expect(frame[0]).toBe(0x5656);
    expect(frame[239]).toBe(0x5656);
    expect(frame[240]).toBe(0x7878);
    expect(frame[319]).toBe(0x7878);
  });

  it("Test 6: exit-code error — nonzero exit + stderr is surfaced; currentStatus flips to \"exited\"", () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    const onExit = vi.fn();
    const handle = createMicSox({
      onFrame: vi.fn(),
      onExit,
      spawnImpl: fakeSpawn as never,
      platformOverride: "linux",
    });
    expect(handle.currentStatus).toBe("running");
    fakeChild.stderr.emit("data", Buffer.from("no default device", "utf8"));
    fakeChild.emit("exit", 1, null);
    expect(onExit).toHaveBeenCalledWith(1, "no default device");
    expect(handle.currentStatus).toBe("exited");
  });

  it("Test 7: kill propagation — handle.stop() calls kill(\"SIGTERM\") and resolves after exit", async () => {
    const fakeChild = makeFakeChild();
    const fakeSpawn = vi.fn<(...args: SpawnArgs) => typeof fakeChild>(
      () => fakeChild,
    );
    const handle = createMicSox({
      onFrame: vi.fn(),
      onExit: vi.fn(),
      spawnImpl: fakeSpawn as never,
      platformOverride: "linux",
    });
    const stopPromise = handle.stop();
    expect(fakeChild.kill).toHaveBeenCalledTimes(1);
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
    // Resolve via the exit event.
    fakeChild.emit("exit", 0, "SIGTERM");
    await expect(stopPromise).resolves.toBeUndefined();
  });
});
