/**
 * SettingsPopover — UI-SPEC §7 minimum viable settings.
 *
 * Renders three controls inside the anchored 220×180 popover (the
 * outer child BrowserWindow is owned by `main/settings-popover-window.ts`;
 * this component renders the popover's React tree):
 *
 *   - Hotkey mode (Toggle | Push-To-Talk) — segmented control
 *   - Hotkey accelerator — display + Change-to-capture button
 *   - Reset window position — secondary button with inline confirmation
 *
 * Every change persists via the parent-supplied callbacks (App.tsx
 * wires them through `bridge.updateHotkeyConfig` / `bridge.updateWindowPosition`).
 *
 * Accessibility (UI-SPEC §5):
 *   - Tab order: mode toggle → hotkey capture → reset → close (×).
 *   - Esc closes the popover (invokes `props.onClose`).
 *   - `aria-pressed` on the segmented control reflects selection.
 *
 * Reset confirmation is rendered inline (no `window.confirm`) so the
 * popover stays modeless and keyboard-driven.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";

import type { HotkeyMode } from "../../shared/constants.js";

export interface SettingsPopoverProps {
  hotkeyMode: HotkeyMode;
  /**
   * Electron accelerator string, e.g. 'CommandOrControl+Shift+A'.
   */
  hotkeyKey: string;
  /**
   * Platform — affects the displayed accelerator. 'darwin' uses
   * unicode symbols (⌘, ⌥, ⇧, ⌃); win32/linux uses 'Ctrl', 'Alt',
   * 'Shift'.
   */
  platform: "darwin" | "win32" | "linux";
  /**
   * UI BLOCKER 2: anchor coordinates (window-relative clientX/clientY)
   * passed through `onSettingsOpen` from FloatingShell. The popover
   * positions itself at `anchor.x + RIGHT_OFFSET`, `anchor.y +
   * TOP_OFFSET`. When `null` the popover falls back to its default
   * CSS position (used in tests that do not exercise positioning).
   */
  anchor?: { x: number; y: number } | null;
  onHotkeyModeChange: (mode: HotkeyMode) => void;
  onHotkeyKeyChange: (accelerator: string) => void;
  onResetWindowPosition: () => void;
  onClose: () => void;
}

const SETTINGS_HEADING = "Settings";
const HOTKEY_MODE_LABEL = "Hotkey mode";
const TOGGLE_OPTION = "Toggle";
const PTT_OPTION = "Push-To-Talk";
const HOTKEY_LABEL = "Hotkey";
const CHANGE_BUTTON = "Change";
const CAPTURING_LABEL = "Press a key combo…";
const RESET_BUTTON = "Reset window position";
const RESET_CONFIRMATION = "Reset position to default (top-right)?";
const CONFIRM_BUTTON = "Confirm";
const CANCEL_BUTTON = "Cancel";
const CLOSE_BUTTON_ARIA = "Close settings";

/**
 * Converts an Electron accelerator string into a display form.
 * Examples:
 *   'CommandOrControl+Shift+A' + darwin → '⌘ Shift A'
 *   'CommandOrControl+Shift+A' + win32  → 'Ctrl Shift A'
 *   'Cmd+Alt+Space'            + darwin → '⌘ ⌥ Space'
 *
 * Public surface so the e2e spec can verify the displayed text without
 * re-implementing the table.
 */
export function formatAccelerator(
  accel: string,
  platform: "darwin" | "win32" | "linux",
): string {
  const parts = accel.split("+").map((p) => p.trim());
  const symbolMap: Record<string, string> = platform === "darwin"
    ? {
        CommandOrControl: "⌘",
        Cmd: "⌘",
        Command: "⌘",
        Control: "⌃",
        Ctrl: "⌃",
        Alt: "⌥",
        Option: "⌥",
        Shift: "⇧",
        Super: "Super",
      }
    : {
        CommandOrControl: "Ctrl",
        Cmd: "Win",
        Command: "Win",
        Control: "Ctrl",
        Ctrl: "Ctrl",
        Alt: "Alt",
        Option: "Alt",
        Shift: "Shift",
        Super: "Super",
      };

  // Re-map modifier tokens; preserve everything else.
  const mapped = parts.map((p) => symbolMap[p] ?? p);
  // UI-SPEC §7 sample: '⌘ Shift A' — modifiers joined with spaces.
  // Force 'Shift' to its full word on darwin per the locked sample
  // string (the spec writes 'Shift A', not '⇧ A').
  if (platform === "darwin") {
    return mapped.map((p) => (p === "⇧" ? "Shift" : p)).join(" ");
  }
  return mapped.join(" ");
}

/**
 * Builds an Electron accelerator string from a keyboard event during
 * capture. Filters modifier keys (Shift, Control, Meta, Alt) from the
 * suffix component so the captured key is the actual character/named
 * key, not the modifier itself.
 */
function acceleratorFromEvent(event: ReactKeyboardEvent): string | null {
  const key = event.key;
  // Reject pure modifier presses — wait for a real key.
  const isModifierKey =
    key === "Shift" ||
    key === "Control" ||
    key === "Alt" ||
    key === "Meta" ||
    key === "Hyper" ||
    key === "Super";
  if (isModifierKey) return null;

  const modifiers: string[] = [];
  // Use 'CommandOrControl' so the accelerator is portable across mac
  // (Cmd) and win/linux (Ctrl) — matches the Plan 11-01 default.
  if (event.metaKey || event.ctrlKey) modifiers.push("CommandOrControl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");

  // Require at least one modifier — bare keystroke accelerators clash
  // with the user's typing.
  if (modifiers.length === 0) return null;

  // Normalise letter keys to uppercase; named keys (Space, Enter,
  // ArrowUp, …) pass through.
  const suffix = key.length === 1 ? key.toUpperCase() : key;
  return [...modifiers, suffix].join("+");
}

/**
 * UI BLOCKER 2: anchor offsets per UI-SPEC §7. Right-anchor places the
 * popover at (anchor.x + 12, anchor.y - POPOVER_HEIGHT_PX - 4) so the
 * popover sits above-and-right of the trigger point. Overflow falls
 * back to anchoring above the trigger.
 */
const POPOVER_WIDTH_PX = 220;
const POPOVER_HEIGHT_PX = 180;
const POPOVER_RIGHT_OFFSET_PX = 12;
const POPOVER_ABOVE_GAP_PX = 4;

function computeAnchorStyle(
  anchor: { x: number; y: number } | null | undefined,
): React.CSSProperties | undefined {
  if (anchor === null || anchor === undefined) return undefined;
  // Position the popover absolutely so it overlaps neither the drag
  // handle nor the reactive circle.
  const winWidth = typeof window !== "undefined" ? window.innerWidth : 260;
  let left = anchor.x + POPOVER_RIGHT_OFFSET_PX;
  if (left + POPOVER_WIDTH_PX > winWidth) {
    // Mirror to the left of the anchor so the popover stays inside the
    // window's pixel grid.
    left = Math.max(0, anchor.x - POPOVER_WIDTH_PX - POPOVER_RIGHT_OFFSET_PX);
  }
  let top = anchor.y - POPOVER_HEIGHT_PX - POPOVER_ABOVE_GAP_PX;
  if (top < 0) {
    top = anchor.y + POPOVER_ABOVE_GAP_PX;
  }
  return { position: "absolute", left, top };
}

export function SettingsPopover({
  hotkeyMode,
  hotkeyKey,
  platform,
  anchor,
  onHotkeyModeChange,
  onHotkeyKeyChange,
  onResetWindowPosition,
  onClose,
}: SettingsPopoverProps): ReactElement {
  const [capturing, setCapturing] = useState<boolean>(false);
  const [confirmingReset, setConfirmingReset] = useState<boolean>(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const firstFocusableRef = useRef<HTMLButtonElement | null>(null);

  // UI BLOCKER 3 fix: focus the first focusable element on mount so
  // screen-reader and keyboard users land inside the popover when it
  // opens. The first focusable is the Toggle segmented control button.
  useEffect(() => {
    if (firstFocusableRef.current !== null) {
      firstFocusableRef.current.focus();
    }
  }, []);

  // UI BLOCKER 3 fix: focus trap. Tab cycles within the popover; Shift+Tab
  // cycles backwards. The trap walks the focusable descendants on each
  // Tab press so dynamic children (the confirm row that appears after
  // clicking Reset) are picked up without re-wiring the listener.
  useEffect(() => {
    function onKeydownTrap(event: KeyboardEvent): void {
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      if (root === null) return;
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeydownTrap);
    return () => {
      window.removeEventListener("keydown", onKeydownTrap);
    };
  }, []);

  // Capture-mode key listener. Attached to the popover root so the
  // captured key does not bubble to the host page.
  useEffect(() => {
    if (!capturing) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setCapturing(false);
        return;
      }
      // Synthesize the React-typed event from the native event so we
      // can reuse acceleratorFromEvent.
      const reactLike = {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      } as unknown as ReactKeyboardEvent;
      const accelerator = acceleratorFromEvent(reactLike);
      if (accelerator !== null) {
        event.preventDefault();
        onHotkeyKeyChange(accelerator);
        setCapturing(false);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [capturing, onHotkeyKeyChange]);

  // Esc closes the popover when not in capture mode (capture mode owns
  // the Escape key for cancelling capture).
  useEffect(() => {
    function onRootKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      if (capturing) return;
      if (confirmingReset) {
        setConfirmingReset(false);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onRootKeyDown);
    return () => {
      window.removeEventListener("keydown", onRootKeyDown);
    };
  }, [capturing, confirmingReset, onClose]);

  const handleResetClick = useCallback(() => {
    setConfirmingReset(true);
  }, []);

  const handleResetConfirm = useCallback(() => {
    onResetWindowPosition();
    setConfirmingReset(false);
  }, [onResetWindowPosition]);

  const handleResetCancel = useCallback(() => {
    setConfirmingReset(false);
  }, []);

  // UI BLOCKER 2: compute the anchored position style from props.
  const anchorStyle = computeAnchorStyle(anchor);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={SETTINGS_HEADING}
      data-testid="settings-popover"
      className="settings-popover"
      style={anchorStyle}
    >
      <div className="settings-popover-header">
        <h2 className="settings-popover-heading">{SETTINGS_HEADING}</h2>
        <button
          type="button"
          aria-label={CLOSE_BUTTON_ARIA}
          data-testid="settings-popover-close"
          className="settings-popover-close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <section className="settings-popover-section">
        <label className="settings-popover-label">{HOTKEY_MODE_LABEL}</label>
        <div
          data-testid="hotkey-mode-toggle"
          className="settings-popover-segmented"
          role="group"
          aria-label={HOTKEY_MODE_LABEL}
        >
          <button
            type="button"
            ref={firstFocusableRef}
            data-testid="hotkey-mode-toggle-toggle"
            aria-pressed={hotkeyMode === "toggle"}
            className={
              hotkeyMode === "toggle"
                ? "settings-popover-segmented-option selected"
                : "settings-popover-segmented-option"
            }
            onClick={() => onHotkeyModeChange("toggle")}
          >
            {TOGGLE_OPTION}
          </button>
          <button
            type="button"
            data-testid="hotkey-mode-toggle-pushtotalk"
            aria-pressed={hotkeyMode === "pushToTalk"}
            className={
              hotkeyMode === "pushToTalk"
                ? "settings-popover-segmented-option selected"
                : "settings-popover-segmented-option"
            }
            onClick={() => onHotkeyModeChange("pushToTalk")}
          >
            {PTT_OPTION}
          </button>
        </div>
      </section>

      <section className="settings-popover-section">
        <label className="settings-popover-label">{HOTKEY_LABEL}</label>
        <div className="settings-popover-hotkey">
          <span data-testid="hotkey-key-display" className="settings-popover-hotkey-display">
            {capturing ? CAPTURING_LABEL : formatAccelerator(hotkeyKey, platform)}
          </span>
          <button
            type="button"
            data-testid="settings-popover-hotkey-change"
            className="settings-popover-hotkey-change"
            onClick={() => setCapturing((c) => !c)}
          >
            {capturing ? CANCEL_BUTTON : CHANGE_BUTTON}
          </button>
        </div>
      </section>

      <section className="settings-popover-section">
        {!confirmingReset ? (
          <button
            type="button"
            data-testid="settings-popover-reset"
            className="settings-popover-reset"
            onClick={handleResetClick}
          >
            {RESET_BUTTON}
          </button>
        ) : (
          <div
            data-testid="settings-popover-reset-confirm"
            className="settings-popover-reset-confirm"
          >
            <p>{RESET_CONFIRMATION}</p>
            <div className="settings-popover-reset-confirm-actions">
              <button
                type="button"
                data-testid="settings-popover-reset-confirm-yes"
                onClick={handleResetConfirm}
              >
                {CONFIRM_BUTTON}
              </button>
              <button
                type="button"
                data-testid="settings-popover-reset-confirm-no"
                onClick={handleResetCancel}
              >
                {CANCEL_BUTTON}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
