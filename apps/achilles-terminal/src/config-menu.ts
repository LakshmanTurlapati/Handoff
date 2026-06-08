/**
 * Phase 18, Plan 03, Task 3 — Config menu module.
 *
 * Requirements:
 *   - CAP-04: The 4 VAD knobs (voiceThresholdRatio, voiceHoldMs, silenceHoldMs,
 *     minUtteranceMs) plus save_transcripts and debug_mode become user-editable
 *     via an interactive @clack/prompts.select + @clack/prompts.text menu.
 *   - T-18-18 mitigate: settings.json is written at 0o600 with explicit chmodSync.
 *   - T-18-20 mitigate: validators are runtime functions invoked before merge+write;
 *     out-of-range values are rejected before any fs write.
 *
 * Language picker is OUT — deferred to v1.4 per CONTEXT.md deferred block.
 *
 * Menu loop:
 *   1. Load current settings from ~/.achilles/settings.json (or {} if absent)
 *   2. Show @clack/prompts.select listing each configurable field with current value
 *   3. On field selected -> promptText with validator until valid input
 *   4. Merge value into settings, re-show menu
 *   5. On "Save and exit" -> writeFileSync at 0o600
 *   6. On "Cancel" -> no-op
 *
 * All operations injectable via deps seams for hermetic tests.
 *
 * No emojis (CLAUDE.md global). No console.log / console.error.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync as nodeChmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * A single configurable field.
 *
 * @public
 */
export interface ConfigField {
  /** Dotted key path, e.g. "vad.voiceThresholdRatio" */
  readonly key: string;
  readonly currentValue: unknown;
  /** Human-readable label for the @clack/prompts.select option */
  readonly label: string;
  /** Returns null on valid input; returns error string on invalid. */
  readonly validator?: (v: unknown) => string | null;
}

// ---------------------------------------------------------------------------
// CONFIGURABLE_FIELDS
// ---------------------------------------------------------------------------

/**
 * All user-configurable fields. The currentValue here is the default;
 * at runtime the value is filled in from loaded settings.
 *
 * @public
 */
export const CONFIGURABLE_FIELDS: ReadonlyArray<Omit<ConfigField, "currentValue"> & {
  readonly defaultValue: unknown;
  readonly validator: (v: unknown) => string | null;
}> = Object.freeze([
  {
    key: "vad.voiceThresholdRatio",
    label: "VAD voice threshold ratio (default 3, range 1.5-5)",
    defaultValue: 3,
    validator: (v: unknown): string | null => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1.5 || n > 5) {
        return "Must be a number in [1.5, 5]";
      }
      return null;
    },
  },
  {
    key: "vad.voiceHoldMs",
    label: "VAD voice hold milliseconds (default 60, range 20-200)",
    defaultValue: 60,
    validator: (v: unknown): string | null => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 20 || n > 200) {
        return "Must be a number in [20, 200]";
      }
      return null;
    },
  },
  {
    key: "vad.silenceHoldMs",
    label: "VAD silence hold milliseconds (default 300, range 100-1000)",
    defaultValue: 300,
    validator: (v: unknown): string | null => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 100 || n > 1000) {
        return "Must be a number in [100, 1000]";
      }
      return null;
    },
  },
  {
    key: "vad.minUtteranceMs",
    label: "VAD minimum utterance milliseconds (default 300, range 100-1000)",
    defaultValue: 300,
    validator: (v: unknown): string | null => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 100 || n > 1000) {
        return "Must be a number in [100, 1000]";
      }
      return null;
    },
  },
  {
    key: "save_transcripts",
    label: "Save transcripts to disk (default off)",
    defaultValue: false,
    validator: (v: unknown): string | null => {
      const s = String(v).toLowerCase();
      if (s !== "true" && s !== "false" && s !== "1" && s !== "0" && s !== "yes" && s !== "no") {
        return "Must be true or false";
      }
      return null;
    },
  },
  {
    key: "debug_mode",
    label: "Verbose debug logging (default off)",
    defaultValue: false,
    validator: (v: unknown): string | null => {
      const s = String(v).toLowerCase();
      if (s !== "true" && s !== "false" && s !== "1" && s !== "0" && s !== "yes" && s !== "no") {
        return "Must be true or false";
      }
      return null;
    },
  },
]);

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Dependency injection seam for runConfigMenu.
 *
 * @public
 */
export interface ConfigMenuDeps {
  homedirImpl?: () => string;
  chmodSyncImpl?: (path: string, mode: number) => void;
  /**
   * selectImpl: given the options array, returns a selected value.
   * In production, this is @clack/prompts.select.
   */
  selectImpl?: (
    opts: Array<{ value: string; label: string }>,
  ) => Promise<string | symbol>;
  /**
   * textImpl: prompt for a text value.
   * In production, this is @clack/prompts.text.
   */
  textImpl?: (msg: string) => Promise<string | symbol>;
  isCancelImpl?: (v: unknown) => boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load settings from ~/.achilles/settings.json. Returns {} if absent or invalid.
 */
function loadSettings(homedirImpl: () => string): Record<string, unknown> {
  const settingsPath = join(homedirImpl(), ".achilles", "settings.json");
  if (!existsSync(settingsPath)) return {};
  try {
    const raw = readFileSync(settingsPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Get the current value of a dotted key (e.g. "vad.voiceThresholdRatio")
 * from a nested settings object.
 */
function getNestedValue(settings: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = settings;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a nested value by dotted key in settings (mutates).
 */
function setNestedValue(
  settings: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const parts = key.split(".");
  let current: Record<string, unknown> = settings;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

/**
 * Parse a string value for a boolean config field.
 */
function parseBooleanValue(v: string): boolean {
  const s = v.toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Run the interactive config menu.
 *
 * @public
 */
export async function runConfigMenu(deps: ConfigMenuDeps = {}): Promise<void> {
  const homedirImpl = deps.homedirImpl ?? homedir;
  const chmodSyncImpl = deps.chmodSyncImpl ?? nodeChmodSync;
  const isCancelImpl = deps.isCancelImpl ?? ((v) => typeof v === "symbol");

  // Load current settings
  const settings = loadSettings(homedirImpl);

  // Build the select options from CONFIGURABLE_FIELDS with current values
  function buildOptions(): Array<{ value: string; label: string }> {
    const options: Array<{ value: string; label: string }> = [];
    for (const field of CONFIGURABLE_FIELDS) {
      const current = getNestedValue(settings, field.key) ?? field.defaultValue;
      options.push({
        value: field.key,
        label: `${field.label} [current: ${String(current)}]`,
      });
    }
    options.push({ value: "__save__", label: "Save and exit" });
    options.push({ value: "__cancel__", label: "Cancel" });
    return options;
  }

  // Lazy-load @clack/prompts for production path
  async function resolveSelect(): Promise<
    (opts: Array<{ value: string; label: string }>) => Promise<string | symbol>
  > {
    if (deps.selectImpl !== undefined) {
      return deps.selectImpl;
    }
    const clack = await import("@clack/prompts");
    return (options): Promise<string | symbol> =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      clack.select({
        message: "Configure Achilles settings:",
        options,
      }) as unknown as Promise<string | symbol>;
  }

  async function resolveText(): Promise<(msg: string) => Promise<string | symbol>> {
    if (deps.textImpl !== undefined) {
      return deps.textImpl;
    }
    const clack = await import("@clack/prompts");
    return (msg): Promise<string | symbol> =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      clack.text({ message: msg }) as unknown as Promise<string | symbol>;
  }

  const [selectFn, textFn] = await Promise.all([resolveSelect(), resolveText()]);

  // Main menu loop
  let shouldSave = false;
  while (true) {
    const options = buildOptions();
    const selection = await selectFn(options);

    if (isCancelImpl(selection) || selection === "__cancel__") {
      return;
    }

    if (selection === "__save__") {
      shouldSave = true;
      break;
    }

    // Field selected — prompt for new value
    const fieldKey = String(selection);
    const fieldDef = CONFIGURABLE_FIELDS.find((f) => f.key === fieldKey);
    if (!fieldDef) continue;

    const currentVal = getNestedValue(settings, fieldKey) ?? fieldDef.defaultValue;
    let newValRaw: string | symbol;

    // Keep prompting until valid
    while (true) {
      newValRaw = await textFn(`New value for ${fieldDef.key} (current: ${String(currentVal)}):`);
      if (isCancelImpl(newValRaw)) break;

      const newValStr = String(newValRaw);
      const validationError = fieldDef.validator(newValStr);
      if (validationError === null) {
        // Parse and set the value
        let parsedVal: unknown = newValStr;
        if (fieldKey.startsWith("vad.")) {
          parsedVal = Number(newValStr);
        } else if (fieldKey === "save_transcripts" || fieldKey === "debug_mode") {
          parsedVal = parseBooleanValue(newValStr);
        }
        setNestedValue(settings, fieldKey, parsedVal);
        break;
      }
      // Invalid — re-prompt (loop continues)
    }
  }

  if (!shouldSave) return;

  // Write settings.json at 0o600
  const settingsPath = join(homedirImpl(), ".achilles", "settings.json");
  const settingsDir = dirname(settingsPath);
  mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  chmodSyncImpl(settingsPath, 0o600);
}
