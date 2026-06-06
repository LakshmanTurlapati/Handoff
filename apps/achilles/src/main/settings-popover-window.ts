/**
 * SettingsPopover child BrowserWindow (UI-SPEC §7).
 *
 * Right-clicking the reactive circle (or clicking the settings
 * affordance) opens the popover as a CHILD BrowserWindow of the
 * floating shell. The child window is focusable so keyboard nav works
 * inside it without forcing the main floating window to become
 * focusable (which would steal focus from the user's terminal/IDE).
 *
 * The popover:
 *   - is parented to the main window so the OS keeps it grouped
 *     correctly across Spaces / full-screen.
 *   - is positioned at (circle.center.x + 60, circle.center.y - 50)
 *     relative to the parent's screen origin. If the right anchor
 *     would overflow the primary display's right edge, the anchor
 *     mirrors to the LEFT of the circle.
 *   - is dismissed by Escape on its webContents OR by the parent
 *     regaining focus (an outside click).
 *
 * Security posture is identical to the main window:
 *   contextIsolation:true, nodeIntegration:false, sandbox:true
 * (T-11-17 mitigation).
 *
 * The constructor is dependency-injected so unit tests verify the
 * locked contract without launching Electron.
 */
import { WINDOW_WIDTH } from "../shared/constants.js";

/** Default anchor offsets from the circle center per UI-SPEC §7. */
const DEFAULT_RIGHT_OFFSET_PX = 60;
const DEFAULT_TOP_OFFSET_PX = -50;
const POPOVER_WIDTH = 220;
const POPOVER_HEIGHT = 180;

/** Circle center within the 260x260 window per UI-SPEC §2 layout grid. */
const CIRCLE_CENTER_X = 130;
const CIRCLE_CENTER_Y = 98;

export interface SettingsPopoverParent {
  on(channel: "focus" | "blur" | "close", cb: (...args: unknown[]) => void): void;
  off(channel: "focus" | "blur" | "close", cb: (...args: unknown[]) => void): void;
  getPosition(): [number, number];
  focus(): void;
  isDestroyed(): boolean;
}

export interface SettingsPopoverChild {
  setPosition(x: number, y: number, animate?: boolean): void;
  close(): void;
  loadFile(path: string): Promise<void> | void;
  loadURL(url: string): Promise<void> | void;
  isDestroyed(): boolean;
  webContents: {
    on(
      channel: "before-input-event",
      listener: (
        event: { preventDefault(): void },
        input: { type: string; key: string },
      ) => void,
    ): void;
  };
}

export interface CreateSettingsPopoverWindowOptions {
  /**
   * Constructor for the child BrowserWindow. Defaults to
   * `(await import('electron')).BrowserWindow` in production; tests
   * inject a recording stub.
   */
  BrowserWindowCtor?: new (opts: Record<string, unknown>) => SettingsPopoverChild;
  /**
   * Primary-display workArea source. Defaults to
   * `screen.getPrimaryDisplay()` in production; tests inject a fixed
   * rectangle.
   */
  screenRef?: {
    getPrimaryDisplay(): {
      workArea: { x: number; y: number; width: number; height: number };
    };
  };
  /**
   * Override for the anchor offset relative to the circle center.
   * Default right-anchor: (+60, -50). The left-anchor mirrors x.
   */
  anchorOffset?: {
    rightOffsetPx: number;
    topOffsetPx: number;
  };
  /**
   * Optional URL to load. When undefined, the popover loads nothing —
   * production wires `loadFile(<popover.html>)` or the dev-server URL.
   */
  loadUrl?: string;
}

/**
 * Creates the anchored SettingsPopover child window. The returned
 * reference is the child window itself so callers can `close()` it
 * imperatively (the OS focus-out path also closes it, but explicit
 * close is the cleanest dispose route).
 */
export function createSettingsPopoverWindow(
  parent: SettingsPopoverParent,
  opts: CreateSettingsPopoverWindowOptions = {},
): SettingsPopoverChild {
  const Ctor = opts.BrowserWindowCtor;
  if (Ctor === undefined) {
    throw new Error(
      "createSettingsPopoverWindow requires BrowserWindowCtor; main wires electron.BrowserWindow in production.",
    );
  }
  const screenRef = opts.screenRef;
  const offset = opts.anchorOffset ?? {
    rightOffsetPx: DEFAULT_RIGHT_OFFSET_PX,
    topOffsetPx: DEFAULT_TOP_OFFSET_PX,
  };

  const popover = new Ctor({
    parent: parent as unknown,
    modal: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: true,
    skipTaskbar: true,
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Anchor logic — compute the right anchor first; mirror to left when
  // the resulting rect overflows the workArea's right edge.
  const [parentX, parentY] = parent.getPosition();
  const rightX = parentX + CIRCLE_CENTER_X + offset.rightOffsetPx;
  const anchorY = parentY + CIRCLE_CENTER_Y + offset.topOffsetPx;

  const workArea = screenRef?.getPrimaryDisplay().workArea ?? {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  };
  const screenRightEdge = workArea.x + workArea.width;

  let finalX = rightX;
  if (rightX + POPOVER_WIDTH > screenRightEdge) {
    // Mirror to the left of the circle: subtract the right offset from
    // the circle center, then move the popover so its right edge lines
    // up with that point.
    finalX = parentX + CIRCLE_CENTER_X - offset.rightOffsetPx - POPOVER_WIDTH;
  }

  popover.setPosition(finalX, anchorY);

  // Escape on the popover's web contents closes it.
  popover.webContents.on(
    "before-input-event",
    (event, input) => {
      if (input.type !== "keyDown") return;
      if (input.key !== "Escape") return;
      event.preventDefault();
      if (!popover.isDestroyed()) popover.close();
    },
  );

  // Parent regaining focus (an outside click) closes the popover. The
  // listener stays attached for the popover's lifetime; the OS handles
  // teardown of the parent window itself.
  const onParentFocus = (): void => {
    if (!popover.isDestroyed()) popover.close();
  };
  parent.on("focus", onParentFocus);

  // Optional initial load. Production wires this; the unit suite
  // leaves it unset because the locked contract is about the
  // constructor + anchor + dismiss listeners, not the URL.
  if (opts.loadUrl !== undefined) {
    void popover.loadURL(opts.loadUrl);
  }

  // Surface the unused parameter so linters don't flag WINDOW_WIDTH;
  // the import exists because callers may want it for anchor math.
  void WINDOW_WIDTH;

  return popover;
}
