/**
 * Plan 14-04 — SAFE-06 device-change handler unit tests.
 *
 * DC1..DC7 cover the createDeviceChangeMonitor factory contract:
 *
 *   DC1: factory returns {start, stop} surface
 *   DC2: start() registers navigatorRef.mediaDevices.addEventListener;
 *        the handler enumerates devices and invokes the onDeviceChange
 *        callback with {devices, hfpDowngradeDetected}
 *   DC3: classifyDevice maps a MediaDeviceInfo label to
 *        {deviceId, kind: 'mic'|'speaker', isBluetoothHfp: boolean}
 *        based on HFP / Hands-Free / Bluetooth Mic label patterns
 *   DC4: logger emits the [achilles] line on every device change
 *   DC5: stop() removes the registered listener
 *   DC6: when hfpDowngradeDetected=true the callback receives
 *        kind: 'hfp-downgrade' and the orchestrator logs a warning
 *   DC7: idempotency — stop() twice is a no-op
 *
 * No real Electron, no real Bluetooth, no real audio device. The
 * handler module is pure: only the injected navigatorRef seam +
 * optional logger are touched.
 */
import { describe, expect, it, vi } from "vitest";
import {
  classifyDevice,
  createDeviceChangeMonitor,
  type ClassifiedDevice,
  type MediaDeviceInfoLike,
} from "./device-change-handler.js";

/**
 * Hand-rolled tiny mediaDevices fake matching the navigatorRef surface
 * the createDeviceChangeMonitor depends on. Tests inject this fixture
 * so the suite runs without any real navigator.mediaDevices access.
 */
interface FakeMediaDevices {
  addEventListener(
    event: "devicechange",
    listener: (...args: unknown[]) => void,
  ): void;
  removeEventListener(
    event: "devicechange",
    listener: (...args: unknown[]) => void,
  ): void;
  enumerateDevices(): Promise<MediaDeviceInfoLike[]>;
  emit(event: "devicechange"): void;
  listenerCount(): number;
  setDevices(devices: MediaDeviceInfoLike[]): void;
}

function makeFakeMediaDevices(
  initialDevices: MediaDeviceInfoLike[] = [],
): FakeMediaDevices {
  let devices = [...initialDevices];
  const listeners: Array<(...args: unknown[]) => void> = [];
  return {
    addEventListener(_event, listener): void {
      listeners.push(listener);
    },
    removeEventListener(_event, listener): void {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    },
    enumerateDevices(): Promise<MediaDeviceInfoLike[]> {
      return Promise.resolve([...devices]);
    },
    emit(): void {
      for (const l of [...listeners]) {
        l();
      }
    },
    listenerCount(): number {
      return listeners.length;
    },
    setDevices(d: MediaDeviceInfoLike[]): void {
      devices = [...d];
    },
  };
}

function fakeNavigator(mediaDevices: FakeMediaDevices): { mediaDevices: FakeMediaDevices } {
  return { mediaDevices };
}

describe("classifyDevice — DC3 label heuristics", () => {
  it("returns isBluetoothHfp=true when label contains 'Hands-Free'", () => {
    const dev: MediaDeviceInfoLike = {
      deviceId: "dev-001",
      kind: "audioinput",
      label: "AirPods Pro (Hands-Free)",
    };
    const result = classifyDevice(dev);
    expect(result.isBluetoothHfp).toBe(true);
    expect(result.deviceId).toBe("dev-001");
    expect(result.kind).toBe("mic");
  });

  it("returns isBluetoothHfp=true when label contains 'HFP'", () => {
    const dev: MediaDeviceInfoLike = {
      deviceId: "dev-002",
      kind: "audioinput",
      label: "Sony WH-1000XM4 HFP",
    };
    const result = classifyDevice(dev);
    expect(result.isBluetoothHfp).toBe(true);
    expect(result.kind).toBe("mic");
  });

  it("returns isBluetoothHfp=true when label matches /Bluetooth.*Mic/i", () => {
    const dev: MediaDeviceInfoLike = {
      deviceId: "dev-003",
      kind: "audioinput",
      label: "Bluetooth Microphone Array",
    };
    const result = classifyDevice(dev);
    expect(result.isBluetoothHfp).toBe(true);
  });

  it("returns isBluetoothHfp=false for a regular audioinput label", () => {
    const dev: MediaDeviceInfoLike = {
      deviceId: "dev-004",
      kind: "audioinput",
      label: "MacBook Pro Microphone",
    };
    const result = classifyDevice(dev);
    expect(result.isBluetoothHfp).toBe(false);
    expect(result.kind).toBe("mic");
  });

  it("returns kind 'speaker' for audiooutput devices", () => {
    const dev: MediaDeviceInfoLike = {
      deviceId: "dev-005",
      kind: "audiooutput",
      label: "External Display Speakers",
    };
    const result = classifyDevice(dev);
    expect(result.kind).toBe("speaker");
    expect(result.isBluetoothHfp).toBe(false);
  });
});

describe("createDeviceChangeMonitor — DC1 surface", () => {
  it("returns the {start, stop} surface", () => {
    const md = makeFakeMediaDevices();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange: vi.fn(),
    });
    expect(typeof monitor.start).toBe("function");
    expect(typeof monitor.stop).toBe("function");
  });
});

describe("createDeviceChangeMonitor — DC2 start registers + enumerate + callback", () => {
  it("start() calls addEventListener('devicechange', handler)", () => {
    const md = makeFakeMediaDevices();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange: vi.fn(),
    });
    monitor.start();
    expect(md.listenerCount()).toBe(1);
  });

  it("on devicechange event, enumerateDevices is called and onDeviceChange receives the classified list", async () => {
    const initial: MediaDeviceInfoLike[] = [
      { deviceId: "mic-1", kind: "audioinput", label: "MacBook Pro Mic" },
      { deviceId: "spk-1", kind: "audiooutput", label: "Built-in Output" },
    ];
    const md = makeFakeMediaDevices(initial);
    const onDeviceChange = vi.fn();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange,
    });
    monitor.start();
    md.emit("devicechange");
    // The handler is async because enumerateDevices returns a promise.
    // Flush microtasks so the callback fires.
    await Promise.resolve();
    await Promise.resolve();
    expect(onDeviceChange).toHaveBeenCalled();
    const payload = onDeviceChange.mock.calls[0]![0] as {
      devices: ClassifiedDevice[];
      hfpDowngradeDetected: boolean;
    };
    expect(payload.devices.length).toBe(2);
    expect(payload.hfpDowngradeDetected).toBe(false);
    // The first device is classified as a mic.
    expect(payload.devices[0]!.kind).toBe("mic");
    expect(payload.devices[1]!.kind).toBe("speaker");
  });
});

describe("createDeviceChangeMonitor — DC4 logger diagnostic line", () => {
  it("logger receives '[achilles] device change: deviceCount=N hfp=true|false' on every event", async () => {
    const initial: MediaDeviceInfoLike[] = [
      { deviceId: "mic-1", kind: "audioinput", label: "Bluetooth Mic (HFP)" },
    ];
    const md = makeFakeMediaDevices(initial);
    const logs: string[] = [];
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange: vi.fn(),
      logger: (msg) => logs.push(msg),
    });
    monitor.start();
    md.emit("devicechange");
    await Promise.resolve();
    await Promise.resolve();
    const line = logs.find((l) => l.includes("device change"));
    expect(line).toBeDefined();
    expect(line).toContain("deviceCount=1");
    expect(line).toContain("hfp=true");
  });
});

describe("createDeviceChangeMonitor — DC5 stop removes listener", () => {
  it("stop() calls removeEventListener with the original handler", () => {
    const md = makeFakeMediaDevices();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange: vi.fn(),
    });
    monitor.start();
    expect(md.listenerCount()).toBe(1);
    monitor.stop();
    expect(md.listenerCount()).toBe(0);
  });

  it("after stop, emit('devicechange') does NOT invoke the callback", async () => {
    const md = makeFakeMediaDevices();
    const onDeviceChange = vi.fn();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange,
    });
    monitor.start();
    monitor.stop();
    md.emit("devicechange");
    await Promise.resolve();
    expect(onDeviceChange).not.toHaveBeenCalled();
  });
});

describe("createDeviceChangeMonitor — DC6 HFP downgrade detection", () => {
  it("when any device in the list is classified as HFP, the callback receives hfpDowngradeDetected=true", async () => {
    const initial: MediaDeviceInfoLike[] = [
      {
        deviceId: "bt-1",
        kind: "audioinput",
        label: "AirPods Pro (Hands-Free)",
      },
    ];
    const md = makeFakeMediaDevices(initial);
    const onDeviceChange = vi.fn();
    const logs: string[] = [];
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange,
      logger: (msg) => logs.push(msg),
    });
    monitor.start();
    md.emit("devicechange");
    await Promise.resolve();
    await Promise.resolve();
    const payload = onDeviceChange.mock.calls[0]![0] as {
      devices: ClassifiedDevice[];
      hfpDowngradeDetected: boolean;
    };
    expect(payload.hfpDowngradeDetected).toBe(true);
    // The log line includes hfp=true so post-mortem debugging can
    // correlate the downgrade with the timeline.
    const line = logs.find((l) => l.includes("hfp=true"));
    expect(line).toBeDefined();
  });

  it("when no device is HFP, the callback receives hfpDowngradeDetected=false", async () => {
    const initial: MediaDeviceInfoLike[] = [
      { deviceId: "mic-1", kind: "audioinput", label: "MacBook Pro Mic" },
    ];
    const md = makeFakeMediaDevices(initial);
    const onDeviceChange = vi.fn();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange,
    });
    monitor.start();
    md.emit("devicechange");
    await Promise.resolve();
    await Promise.resolve();
    const payload = onDeviceChange.mock.calls[0]![0] as {
      hfpDowngradeDetected: boolean;
    };
    expect(payload.hfpDowngradeDetected).toBe(false);
  });
});

describe("createDeviceChangeMonitor — DC7 idempotency + classifyDevice override", () => {
  it("stop() twice does not throw", () => {
    const md = makeFakeMediaDevices();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange: vi.fn(),
    });
    monitor.start();
    expect(() => {
      monitor.stop();
      monitor.stop();
    }).not.toThrow();
    expect(md.listenerCount()).toBe(0);
  });

  it("classifyDevice override is invoked instead of the default classifier when supplied", async () => {
    const initial: MediaDeviceInfoLike[] = [
      { deviceId: "mic-1", kind: "audioinput", label: "MacBook Pro Mic" },
    ];
    const md = makeFakeMediaDevices(initial);
    const customClassify = vi.fn((dev: MediaDeviceInfoLike) => ({
      deviceId: dev.deviceId,
      kind: "mic" as const,
      // Force-flag every device as HFP — verifies the override is
      // actually invoked instead of the default classifier.
      isBluetoothHfp: true,
    }));
    const onDeviceChange = vi.fn();
    const monitor = createDeviceChangeMonitor({
      navigatorRef: fakeNavigator(md),
      onDeviceChange,
      classifyDevice: customClassify,
    });
    monitor.start();
    md.emit("devicechange");
    await Promise.resolve();
    await Promise.resolve();
    expect(customClassify).toHaveBeenCalledTimes(1);
    const payload = onDeviceChange.mock.calls[0]![0] as {
      hfpDowngradeDetected: boolean;
    };
    expect(payload.hfpDowngradeDetected).toBe(true);
  });
});
