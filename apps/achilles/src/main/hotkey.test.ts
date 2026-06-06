/**
 * Behaviour tests for the global hotkey registration substrate.
 *
 * `electron.globalShortcut` only fires on key-down (PITFALLS.md note).
 * The tests assert that:
 *   - In 'toggle' mode we register the accelerator once and call
 *     onPress on every fire.
 *   - In 'pushToTalk' mode we register the down edge AND wire a
 *     key-up watcher via the injected webContents source.
 *   - setHotkeyMode persists the mode through the injected store.
 */
import { describe, expect, it, vi } from "vitest";
import {
  registerAchillesHotkey,
  setHotkeyMode,
  unregisterAchillesHotkey,
} from "./hotkey.js";

interface FakeGlobalShortcut {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  isRegistered: ReturnType<typeof vi.fn>;
}

interface FakeKeySource {
  onBeforeInputEvent: ReturnType<typeof vi.fn>;
  emit?: (event: { type: "keyDown" | "keyUp"; key: string }) => void;
}

function makeFakes(): {
  globalShortcutRef: FakeGlobalShortcut;
  webContentsKeySource: FakeKeySource;
  triggerDown: () => void;
  triggerUp: (key: string) => void;
} {
  const downHandlers: Array<() => void> = [];
  const inputHandlers: Array<
    (event: { type: "keyDown" | "keyUp"; key: string }) => void
  > = [];

  const globalShortcutRef: FakeGlobalShortcut = {
    register: vi.fn((_acc: string, cb: () => void) => {
      downHandlers.push(cb);
      return true;
    }),
    unregister: vi.fn(),
    isRegistered: vi.fn().mockReturnValue(true),
  };

  const webContentsKeySource: FakeKeySource = {
    onBeforeInputEvent: vi.fn(
      (cb: (event: { type: "keyDown" | "keyUp"; key: string }) => void) => {
        inputHandlers.push(cb);
      },
    ),
  };

  return {
    globalShortcutRef,
    webContentsKeySource,
    triggerDown: () => downHandlers.forEach((h) => h()),
    triggerUp: (key: string) =>
      inputHandlers.forEach((h) => h({ type: "keyUp", key })),
  };
}

describe("registerAchillesHotkey (H1) — toggle mode", () => {
  it("registers the accelerator exactly once and invokes onPress on each fire", () => {
    const { globalShortcutRef, webContentsKeySource, triggerDown } = makeFakes();
    const onPress = vi.fn();
    const onRelease = vi.fn();

    registerAchillesHotkey(
      "CommandOrControl+Shift+A",
      "toggle",
      onPress,
      onRelease,
      { globalShortcutRef, webContentsKeySource },
    );

    expect(globalShortcutRef.register).toHaveBeenCalledTimes(1);
    expect(globalShortcutRef.register).toHaveBeenCalledWith(
      "CommandOrControl+Shift+A",
      expect.any(Function),
    );

    triggerDown();
    triggerDown();
    expect(onPress).toHaveBeenCalledTimes(2);

    // onRelease is never invoked in toggle mode (the test for H2 will
    // demonstrate the PTT key-up path).
    expect(onRelease).not.toHaveBeenCalled();
  });
});

describe("registerAchillesHotkey (H2) — pushToTalk mode wires key-up", () => {
  it("invokes onRelease when the injected webContents key-up fires", () => {
    const { globalShortcutRef, webContentsKeySource, triggerDown, triggerUp } =
      makeFakes();
    const onPress = vi.fn();
    const onRelease = vi.fn();

    registerAchillesHotkey(
      "CommandOrControl+Shift+A",
      "pushToTalk",
      onPress,
      onRelease,
      { globalShortcutRef, webContentsKeySource },
    );

    // The down edge still flows through globalShortcut.
    triggerDown();
    expect(onPress).toHaveBeenCalledTimes(1);

    // The watcher fires onRelease for any key in the accelerator
    // (the non-modifier suffix component); simulate the 'A' key-up.
    triggerUp("A");
    expect(onRelease).toHaveBeenCalledTimes(1);

    // A key-up for an unrelated key does NOT fire onRelease.
    triggerUp("B");
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});

describe("setHotkeyMode (H3) — persists through the store mock", () => {
  it("writes the new mode to the injected store under 'hotkeyMode'", () => {
    const store = {
      writeHotkeyMode: vi.fn(),
      readHotkeyMode: vi.fn().mockReturnValue("toggle"),
    };

    setHotkeyMode("pushToTalk", { store });

    expect(store.writeHotkeyMode).toHaveBeenCalledTimes(1);
    expect(store.writeHotkeyMode).toHaveBeenCalledWith("pushToTalk");
  });
});

describe("unregisterAchillesHotkey", () => {
  it("calls globalShortcut.unregister with the previously-registered accelerator", () => {
    const { globalShortcutRef, webContentsKeySource } = makeFakes();
    registerAchillesHotkey(
      "CommandOrControl+Shift+A",
      "toggle",
      vi.fn(),
      vi.fn(),
      { globalShortcutRef, webContentsKeySource },
    );

    unregisterAchillesHotkey({ globalShortcutRef });

    expect(globalShortcutRef.unregister).toHaveBeenCalledWith(
      "CommandOrControl+Shift+A",
    );
  });
});
