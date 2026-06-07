/**
 * Plan 14-04 — SAFE-06 suspend-resume handler unit tests.
 *
 * SR1..SR6 cover the wireSuspendResume factory contract:
 *
 *   SR1: wireSuspendResume({powerMonitorRef, onSuspend, onResume,
 *        onLockScreen, onUnlockScreen, logger}) returns dispose; the
 *        function registers powerMonitorRef.on('suspend', onSuspend)
 *        etc.
 *   SR2: onLockScreen + onUnlockScreen are optional; absent callbacks
 *        result in no listener registration for those events
 *   SR3: dispose() calls powerMonitorRef.removeListener for each
 *        registered event with the original callback reference
 *   SR4: logger emits the [achilles] line on every event fired by the
 *        test fake (suspend / resume / lock-screen / unlock-screen)
 *   SR5: the test uses a fake powerMonitorRef as a hand-rolled tiny
 *        EventEmitter so emit('suspend') invokes the callback; verify
 *        suspend / resume + dispose round-trip
 *   SR6: dispose is idempotent; calling twice does not throw
 *
 * No real Electron, no real powerMonitor, no real OS suspend. The
 * handler module is pure: only the injected powerMonitorRef seam +
 * optional logger are touched.
 */
import { describe, expect, it, vi } from "vitest";
import { wireSuspendResume } from "./suspend-resume-handler.js";

/**
 * Hand-rolled tiny EventEmitter fake matching the powerMonitorRef
 * surface the wireSuspendResume function depends on. We deliberately
 * do NOT use node:events to avoid coupling these tests to Node's
 * module system. The fake records on() / removeListener() calls so
 * the suite can verify the registration + tear-down semantics.
 */
interface FakePowerMonitor {
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  listeners(event: string): Array<(...args: unknown[]) => void>;
  listenerCount(event: string): number;
}

function makeFakePowerMonitor(): FakePowerMonitor {
  const map = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(event: string, listener: (...args: unknown[]) => void): void {
      const list = map.get(event) ?? [];
      list.push(listener);
      map.set(event, list);
    },
    removeListener(
      event: string,
      listener: (...args: unknown[]) => void,
    ): void {
      const list = map.get(event);
      if (list === undefined) return;
      const idx = list.indexOf(listener);
      if (idx >= 0) {
        list.splice(idx, 1);
        if (list.length === 0) {
          map.delete(event);
        }
      }
    },
    emit(event: string, ...args: unknown[]): void {
      const list = map.get(event);
      if (list === undefined) return;
      for (const cb of [...list]) {
        cb(...args);
      }
    },
    listeners(event: string): Array<(...args: unknown[]) => void> {
      return [...(map.get(event) ?? [])];
    },
    listenerCount(event: string): number {
      return (map.get(event) ?? []).length;
    },
  };
}

describe("wireSuspendResume — SR1 registration surface", () => {
  it("returns a dispose function and registers the powerMonitor 'suspend' + 'resume' listeners", () => {
    const pm = makeFakePowerMonitor();
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    const handle = wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend,
      onResume,
    });
    expect(typeof handle.dispose).toBe("function");
    expect(pm.listenerCount("suspend")).toBe(1);
    expect(pm.listenerCount("resume")).toBe(1);
  });

  it("emit('suspend') invokes onSuspend; emit('resume') invokes onResume", () => {
    const pm = makeFakePowerMonitor();
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    wireSuspendResume({ powerMonitorRef: pm, onSuspend, onResume });
    pm.emit("suspend");
    expect(onSuspend).toHaveBeenCalledTimes(1);
    pm.emit("resume");
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe("wireSuspendResume — SR2 optional lock-screen / unlock-screen callbacks", () => {
  it("absent onLockScreen results in no listener registration for 'lock-screen'", () => {
    const pm = makeFakePowerMonitor();
    wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
      // no onLockScreen
    });
    expect(pm.listenerCount("lock-screen")).toBe(0);
  });

  it("absent onUnlockScreen results in no listener registration for 'unlock-screen'", () => {
    const pm = makeFakePowerMonitor();
    wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
      // no onUnlockScreen
    });
    expect(pm.listenerCount("unlock-screen")).toBe(0);
  });

  it("present onLockScreen + onUnlockScreen result in listener registration for those events", () => {
    const pm = makeFakePowerMonitor();
    const onLockScreen = vi.fn();
    const onUnlockScreen = vi.fn();
    wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
      onLockScreen,
      onUnlockScreen,
    });
    expect(pm.listenerCount("lock-screen")).toBe(1);
    expect(pm.listenerCount("unlock-screen")).toBe(1);
    pm.emit("lock-screen");
    expect(onLockScreen).toHaveBeenCalledTimes(1);
    pm.emit("unlock-screen");
    expect(onUnlockScreen).toHaveBeenCalledTimes(1);
  });
});

describe("wireSuspendResume — SR3 dispose removes all listeners", () => {
  it("dispose() calls powerMonitorRef.removeListener for each registered event with the original callback reference", () => {
    const pm = makeFakePowerMonitor();
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    const onLockScreen = vi.fn();
    const onUnlockScreen = vi.fn();
    const handle = wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend,
      onResume,
      onLockScreen,
      onUnlockScreen,
    });
    expect(pm.listenerCount("suspend")).toBe(1);
    expect(pm.listenerCount("resume")).toBe(1);
    expect(pm.listenerCount("lock-screen")).toBe(1);
    expect(pm.listenerCount("unlock-screen")).toBe(1);

    handle.dispose();

    expect(pm.listenerCount("suspend")).toBe(0);
    expect(pm.listenerCount("resume")).toBe(0);
    expect(pm.listenerCount("lock-screen")).toBe(0);
    expect(pm.listenerCount("unlock-screen")).toBe(0);
  });

  it("after dispose, subsequent emit('suspend') / emit('resume') does NOT invoke the callbacks", () => {
    const pm = makeFakePowerMonitor();
    const onSuspend = vi.fn();
    const onResume = vi.fn();
    const handle = wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend,
      onResume,
    });
    handle.dispose();
    pm.emit("suspend");
    pm.emit("resume");
    expect(onSuspend).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });
});

describe("wireSuspendResume — SR4 logger emits diagnostic line on every event", () => {
  it("logger receives '[achilles] powerMonitor event: suspend' on emit('suspend')", () => {
    const pm = makeFakePowerMonitor();
    const logs: string[] = [];
    wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
      logger: (msg) => logs.push(msg),
    });
    pm.emit("suspend");
    const suspendLog = logs.find((l) => l.includes("powerMonitor event: suspend"));
    expect(suspendLog).toBeDefined();
  });

  it("logger receives '[achilles] powerMonitor event: resume' on emit('resume')", () => {
    const pm = makeFakePowerMonitor();
    const logs: string[] = [];
    wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
      logger: (msg) => logs.push(msg),
    });
    pm.emit("resume");
    const resumeLog = logs.find((l) => l.includes("powerMonitor event: resume"));
    expect(resumeLog).toBeDefined();
  });

  it("logger receives a line on emit('lock-screen') + emit('unlock-screen') when those callbacks are present", () => {
    const pm = makeFakePowerMonitor();
    const logs: string[] = [];
    wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
      onLockScreen: vi.fn(),
      onUnlockScreen: vi.fn(),
      logger: (msg) => logs.push(msg),
    });
    pm.emit("lock-screen");
    pm.emit("unlock-screen");
    expect(logs.some((l) => l.includes("powerMonitor event: lock-screen"))).toBe(true);
    expect(logs.some((l) => l.includes("powerMonitor event: unlock-screen"))).toBe(true);
  });
});

describe("wireSuspendResume — SR5 round-trip suspend + resume + dispose", () => {
  it("end-to-end: register, emit suspend (callback fires), emit resume (callback fires), dispose (no further events fire)", () => {
    const pm = makeFakePowerMonitor();
    const events: string[] = [];
    const onSuspend = vi.fn(() => events.push("suspend"));
    const onResume = vi.fn(() => events.push("resume"));
    const handle = wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend,
      onResume,
    });

    pm.emit("suspend");
    expect(events).toEqual(["suspend"]);

    pm.emit("resume");
    expect(events).toEqual(["suspend", "resume"]);

    handle.dispose();

    // After dispose, further emits do NOT add to the events log.
    pm.emit("suspend");
    pm.emit("resume");
    expect(events).toEqual(["suspend", "resume"]);
  });
});

describe("wireSuspendResume — SR6 dispose idempotency", () => {
  it("calling dispose() twice does not throw and stays in disposed state", () => {
    const pm = makeFakePowerMonitor();
    const handle = wireSuspendResume({
      powerMonitorRef: pm,
      onSuspend: vi.fn(),
      onResume: vi.fn(),
    });
    expect(() => {
      handle.dispose();
      handle.dispose();
    }).not.toThrow();
    expect(pm.listenerCount("suspend")).toBe(0);
    expect(pm.listenerCount("resume")).toBe(0);
  });
});
