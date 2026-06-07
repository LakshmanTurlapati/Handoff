/**
 * Plan 14-04 — SAFE-06 device-change handler (PITFALLS #25).
 *
 * Observes `mediaDevices.ondevicechange` events through an injected
 * navigatorRef seam and notifies a caller-supplied callback with the
 * classified device list. The Bluetooth-HFP downgrade heuristic
 * (label-pattern detection) lets the orchestrator log a warning when
 * a headset switches to the lower-quality HFP profile but continue
 * (per CONTEXT.md "log a warning but continue").
 *
 * The handler module is pure: no fs, no IPC, no clock side effects.
 * Production wiring lives in the renderer-side mic-capture module
 * (the navigator.mediaDevices ondevicechange surface is renderer-only
 * in Electron); the main-side handler accepts a navigatorRef seam so
 * tests inject a fake mediaDevices object matching the
 * `MediaDevicesLike` shape. A future renderer-to-main bridge can wire
 * the main-side handler through the existing IPC surface; Plan 14-04
 * ships the main-side handler as the testable substrate.
 *
 * Threat model (Plan 14-04):
 *
 *   - T-14-22 accept   — the renderer is part of the same trust domain;
 *                        the handler re-acquires from the OS-reported
 *                        default device, not from renderer-supplied
 *                        IDs.
 *   - T-14-23 mitigate — the handler debounces in practice via the
 *                        0-tick setTimeout in session.onDeviceChange
 *                        + the renderer's mediaDevices.ondevicechange
 *                        coalesces consecutive identical events.
 *   - T-14-24 accept   — HFP downgrade is documented in CONTEXT.md +
 *                        PITFALLS #25; the log line warns; no remote
 *                        disclosure.
 *
 * No emojis (CLAUDE.md global). No direct `navigator.mediaDevices`
 * access — all reads go through the injected navigatorRef seam.
 */

/**
 * Minimal MediaDeviceInfo surface the handler depends on. Mirrors a
 * subset of the W3C MediaDeviceInfo interface so tests do not need to
 * construct full DOM objects.
 *
 * @public
 */
export interface MediaDeviceInfoLike {
  readonly deviceId: string;
  readonly kind: "audioinput" | "audiooutput" | "videoinput";
  readonly label: string;
}

/**
 * Classified device. The `kind` narrows the W3C kind union to the
 * audio-only subset the orchestrator cares about (mic + speaker);
 * `isBluetoothHfp` flags devices labelled as Hands-Free / HFP /
 * Bluetooth Mic so the orchestrator can surface the downgrade warning.
 *
 * @public
 */
export interface ClassifiedDevice {
  readonly deviceId: string;
  readonly kind: "mic" | "speaker";
  readonly isBluetoothHfp: boolean;
}

/**
 * Payload delivered to the onDeviceChange callback. Carries the full
 * classified list + the convenience flag `hfpDowngradeDetected` so
 * the orchestrator can branch without re-scanning the list.
 *
 * @public
 */
export interface DeviceChangeNotification {
  readonly devices: ReadonlyArray<ClassifiedDevice>;
  readonly hfpDowngradeDetected: boolean;
}

/**
 * Minimal MediaDevices surface the handler depends on. Mirrors a
 * subset of W3C MediaDevices; tests inject a hand-rolled fake matching
 * this shape.
 *
 * @public
 */
export interface MediaDevicesLike {
  addEventListener(
    event: "devicechange",
    listener: (...args: unknown[]) => void,
  ): void;
  removeEventListener(
    event: "devicechange",
    listener: (...args: unknown[]) => void,
  ): void;
  enumerateDevices(): Promise<MediaDeviceInfoLike[]>;
}

/**
 * Minimal Navigator surface the handler depends on. Production wraps
 * the renderer's `navigator`; tests pass a synthetic object.
 *
 * @public
 */
export interface NavigatorLike {
  readonly mediaDevices: MediaDevicesLike;
}

/**
 * Construction-time options for the device-change handler.
 *
 * @public
 */
export interface CreateDeviceChangeMonitorOptions {
  /**
   * The navigator reference. In production: the renderer's
   * `navigator`. In tests: a hand-rolled tiny fake matching the
   * `NavigatorLike` shape.
   */
  navigatorRef: NavigatorLike;
  /**
   * Required callback invoked when a devicechange event fires. The
   * callback receives the classified device list + the convenience
   * flag `hfpDowngradeDetected` so the orchestrator can branch on
   * the downgrade case uniformly.
   */
  onDeviceChange: (payload: DeviceChangeNotification) => void;
  /**
   * Optional classifier override. Defaults to the module's exported
   * `classifyDevice` (label-pattern HFP heuristic). Tests inject a
   * recording fake to verify the override path is invoked.
   */
  classifyDevice?: (info: MediaDeviceInfoLike) => ClassifiedDevice;
  /**
   * Optional logger sink. Defaults to console.error with the
   * `[achilles]` prefix. Emits one line per device change carrying
   * the device count + the hfpDowngradeDetected flag — never a raw
   * device label (defence in depth: labels can contain user-identifying
   * strings).
   */
  logger?: (msg: string) => void;
}

/**
 * Public handle returned by `createDeviceChangeMonitor`.
 *
 * @public
 */
export interface DeviceChangeMonitor {
  /**
   * Register the navigatorRef.mediaDevices.addEventListener listener.
   * Idempotent in practice — the handler tracks its own registered
   * state and never registers twice.
   */
  start(): void;
  /**
   * Remove the navigatorRef.mediaDevices.removeEventListener listener.
   * Idempotent — calling stop twice is a no-op.
   */
  stop(): void;
}

/**
 * Label patterns that indicate a Bluetooth-HFP device. The PITFALLS
 * #25 contract calls out:
 *
 *   - 'Hands-Free' substring        — common on macOS for AirPods etc.
 *   - 'HFP' substring               — common on Linux PulseAudio
 *   - /Bluetooth.*Mic/i regex       — generic Bluetooth headset mic
 *
 * The classifier returns isBluetoothHfp=true when ANY of the three
 * matches. We deliberately err on the side of false-positive flagging:
 * the log line is a warning, not a hard fail, so a false-positive
 * surface is operationally harmless and gives the user useful diagnostic
 * info if the audio quality is unexpectedly low.
 */
const HFP_REGEX = /Bluetooth.*Mic/i;

/**
 * Default device classifier. Maps a MediaDeviceInfoLike to a
 * ClassifiedDevice using the label-pattern HFP heuristic. Pure: no
 * side effects, no clock reads, no IPC.
 *
 * WR-01 fix: limit the HFP-downgrade heuristic to audioinput devices.
 * Previously the classifier relabelled `videoinput` as `'mic'` and
 * applied the HFP label pattern to it — so a Bluetooth camera whose
 * label contained 'Hands-Free' (e.g., 'Hands-Free Display Camera')
 * would falsely trigger hfpDowngradeDetected=true. The orchestrator
 * would then run a spurious soft re-acquire of the mic stream.
 *
 * Behaviour after the fix:
 *
 *   - audioinput -> {kind: 'mic',     isBluetoothHfp: <label check>}
 *   - audiooutput -> {kind: 'speaker', isBluetoothHfp: false}
 *   - videoinput -> {kind: 'mic',     isBluetoothHfp: false}
 *     (kind defaulted to 'mic' for back-compat with the prior
 *     normalisation; the HFP flag is FORCED false because video
 *     devices are not audio devices and cannot downgrade an audio
 *     profile.)
 *
 * @public
 */
export function classifyDevice(info: MediaDeviceInfoLike): ClassifiedDevice {
  const label = info.label;
  // Map W3C kind union to the audio-only subset the orchestrator cares
  // about.
  const kind: "mic" | "speaker" =
    info.kind === "audiooutput" ? "speaker" : "mic";
  // WR-01 fix: only audioinput devices participate in the HFP-downgrade
  // heuristic. A 'Hands-Free Display Camera' (videoinput) must NOT
  // surface as an HFP downgrade — the orchestrator's response is a
  // mic-stream re-acquire, which is meaningless when the changed
  // device is video. audiooutput is also excluded because it cannot
  // downgrade an audio INPUT profile.
  const isBluetoothHfp =
    info.kind === "audioinput" &&
    (label.includes("Hands-Free") ||
      label.includes("HFP") ||
      HFP_REGEX.test(label));
  return {
    deviceId: info.deviceId,
    kind,
    isBluetoothHfp,
  };
}

/**
 * Construct a device-change monitor. The returned handle is reusable
 * across an Achilles run — start at app boot; stop at app teardown.
 *
 * @public
 */
export function createDeviceChangeMonitor(
  opts: CreateDeviceChangeMonitorOptions,
): DeviceChangeMonitor {
  const log =
    opts.logger ??
    ((msg: string): void => {
      // eslint-disable-next-line no-console
      console.error(msg);
    });
  const classifier = opts.classifyDevice ?? classifyDevice;

  let registeredListener: ((...args: unknown[]) => void) | null = null;

  function handler(): void {
    // Enumerate devices asynchronously (W3C API is promise-based).
    // We do NOT block; the callback fires when the enumeration
    // resolves. If enumeration fails (e.g., security policy blocked
    // the call), we log the error but do NOT propagate — the
    // orchestrator's behaviour on a missing device list is to keep
    // the existing stream.
    void (async (): Promise<void> => {
      let infos: MediaDeviceInfoLike[];
      try {
        infos = await opts.navigatorRef.mediaDevices.enumerateDevices();
      } catch (err) {
        log(
          `[achilles] device enumeration failed: ${(err as Error).message}`,
        );
        return;
      }
      const classified = infos.map(classifier);
      const hfpDowngradeDetected = classified.some((d) => d.isBluetoothHfp);
      // The log line carries device count + hfp flag only — never a
      // raw label. Labels can contain user-identifying strings (e.g.,
      // "John's AirPods"); we keep them out of the log.
      log(
        `[achilles] device change: deviceCount=${classified.length} ` +
          `hfp=${hfpDowngradeDetected ? "true" : "false"}`,
      );
      opts.onDeviceChange({
        devices: classified,
        hfpDowngradeDetected,
      });
    })();
  }

  function start(): void {
    if (registeredListener !== null) return;
    registeredListener = handler;
    opts.navigatorRef.mediaDevices.addEventListener(
      "devicechange",
      registeredListener,
    );
  }

  function stop(): void {
    if (registeredListener === null) return;
    opts.navigatorRef.mediaDevices.removeEventListener(
      "devicechange",
      registeredListener,
    );
    registeredListener = null;
  }

  return { start, stop };
}
