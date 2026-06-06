/**
 * @vitest-environment jsdom
 *
 * Behaviour tests for SettingsPopover (UI-SPEC §7).
 *
 *   - SP1: renders settings heading + segmented control + hotkey display
 *   - SP2: clicking the PTT segmented option invokes onHotkeyModeChange('pushToTalk')
 *   - SP3: Change button + keydown capture + Escape cancels capture
 *   - SP4: Reset window position → confirmation prompt → onResetWindowPosition
 *   - SP5: Escape on the popover root invokes onClose
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPopover } from "./SettingsPopover.js";

afterEach(() => {
  cleanup();
});

describe("SettingsPopover — SP1 renders the locked UI-SPEC §7 surface", () => {
  it("contains the settings-popover testid, heading 'Settings', segmented control, and formatted hotkey display", () => {
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );

    const popover = screen.getByTestId("settings-popover");
    expect(popover).toBeTruthy();
    const heading = popover.querySelector("h2");
    expect(heading!.textContent).toBe("Settings");

    const toggle = screen.getByTestId("hotkey-mode-toggle");
    expect(toggle.querySelectorAll("button")[0]!.textContent).toBe("Toggle");
    expect(toggle.querySelectorAll("button")[1]!.textContent).toBe(
      "Push-To-Talk",
    );

    const display = screen.getByTestId("hotkey-key-display");
    // formatAccelerator on darwin: 'CommandOrControl+Shift+A' → '⌘ Shift A'
    expect(display.textContent).toBe("⌘ Shift A");
  });
});

describe("SettingsPopover — SP2 mode change", () => {
  it("invokes onHotkeyModeChange('pushToTalk') exactly once when the PTT option is clicked", () => {
    const onHotkeyModeChange = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={onHotkeyModeChange}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );

    const ptt = screen.getByTestId("hotkey-mode-toggle-pushtotalk");
    ptt.click();
    expect(onHotkeyModeChange).toHaveBeenCalledTimes(1);
    expect(onHotkeyModeChange).toHaveBeenCalledWith("pushToTalk");
  });
});

describe("SettingsPopover — SP3 hotkey capture", () => {
  it("Change button enters capture mode with the locked 'Press a key combo…' copy", () => {
    const onHotkeyKeyChange = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={onHotkeyKeyChange}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const change = screen.getByTestId("settings-popover-hotkey-change");
    fireEvent.click(change);
    const display = screen.getByTestId("hotkey-key-display");
    expect(display.textContent).toBe("Press a key combo…");
  });

  it("captures Cmd+Shift+B as 'CommandOrControl+Shift+B' on darwin and exits capture", () => {
    const onHotkeyKeyChange = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={onHotkeyKeyChange}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const change = screen.getByTestId("settings-popover-hotkey-change");
    fireEvent.click(change);

    // Simulate Cmd+Shift+B on the window — the popover attaches the
    // listener at capture phase so a window-level keydown fires it.
    fireEvent.keyDown(window, {
      key: "b",
      metaKey: true,
      shiftKey: true,
    });

    expect(onHotkeyKeyChange).toHaveBeenCalledTimes(1);
    expect(onHotkeyKeyChange).toHaveBeenCalledWith(
      "CommandOrControl+Shift+B",
    );
  });

  it("Escape during capture cancels without invoking onHotkeyKeyChange", () => {
    const onHotkeyKeyChange = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={onHotkeyKeyChange}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const change = screen.getByTestId("settings-popover-hotkey-change");
    fireEvent.click(change);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onHotkeyKeyChange).not.toHaveBeenCalled();
    const display = screen.getByTestId("hotkey-key-display");
    // Back to the formatted current accelerator after cancel.
    expect(display.textContent).toBe("⌘ Shift A");
  });
});

describe("SettingsPopover — SP4 reset window position confirmation", () => {
  it("prompts with the locked confirmation copy then invokes onResetWindowPosition on confirm", () => {
    const onResetWindowPosition = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={onResetWindowPosition}
        onClose={() => {}}
      />,
    );

    const reset = screen.getByTestId("settings-popover-reset");
    fireEvent.click(reset);

    const confirmPanel = screen.getByTestId("settings-popover-reset-confirm");
    expect(confirmPanel.textContent).toContain(
      "Reset position to default (top-right)?",
    );

    const yes = screen.getByTestId("settings-popover-reset-confirm-yes");
    fireEvent.click(yes);
    expect(onResetWindowPosition).toHaveBeenCalledTimes(1);
  });

  it("Cancel button returns to the un-confirmed state without calling onResetWindowPosition", () => {
    const onResetWindowPosition = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={onResetWindowPosition}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("settings-popover-reset"));
    fireEvent.click(screen.getByTestId("settings-popover-reset-confirm-no"));
    expect(onResetWindowPosition).not.toHaveBeenCalled();
    // Back to the reset button surface.
    expect(screen.queryByTestId("settings-popover-reset")).not.toBeNull();
  });
});

describe("SettingsPopover — SP5 Escape closes the popover", () => {
  it("invokes onClose when Escape is pressed (no capture active)", () => {
    const onClose = vi.fn();
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsPopover — UI BLOCKER 3 focus trap + initial focus + aria-modal", () => {
  it("declares aria-modal='true' on the popover root", () => {
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const popover = screen.getByTestId("settings-popover");
    expect(popover.getAttribute("aria-modal")).toBe("true");
  });

  it("focuses the toggle button on mount", () => {
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const firstFocusable = screen.getByTestId("hotkey-mode-toggle-toggle");
    expect(document.activeElement).toBe(firstFocusable);
  });
});

describe("SettingsPopover — UI BLOCKER 2 anchor positioning", () => {
  it("applies absolute positioning from the anchor prop", () => {
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        anchor={{ x: 50, y: 200 }}
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const popover = screen.getByTestId("settings-popover");
    expect(popover.style.position).toBe("absolute");
    // Above-and-right of anchor.
    expect(popover.style.left).not.toBe("");
    expect(popover.style.top).not.toBe("");
  });

  it("falls back to no positioning style when anchor is null", () => {
    render(
      <SettingsPopover
        hotkeyMode="toggle"
        hotkeyKey="CommandOrControl+Shift+A"
        platform="darwin"
        anchor={null}
        onHotkeyModeChange={() => {}}
        onHotkeyKeyChange={() => {}}
        onResetWindowPosition={() => {}}
        onClose={() => {}}
      />,
    );
    const popover = screen.getByTestId("settings-popover");
    expect(popover.style.position).toBe("");
  });
});
