/**
 * TypedFallback — Plan 14-03 SAFE-05 UX critical path.
 *
 * When ElevenLabs STT is down, the orchestrator broadcasts
 * IPC_INCIDENT_STT_FAIL. App.tsx subscribes, sets typedFallbackActive
 * to true, and mounts this overlay. The user types a prompt, presses
 * Enter, and the text is sent via IPC_TYPED_FALLBACK_SUBMIT. Main
 * routes the text through session.handleTypedPrompt(text) which
 * applies the SAME sandwich-defence + bridge.send pipeline as a
 * spoken utterance — there is no parallel code path.
 *
 * Behaviour contract (Plan 14-03 TF1..TF5):
 *
 *   TF1: `active=false` -> returns null (no DOM produced).
 *        `active=true`  -> renders an absolutely-positioned overlay
 *        with a locked label 'STT unavailable. Type your prompt.'
 *        and a single visible input field with placeholder
 *        'Type your prompt'. The input is autofocused on mount.
 *   TF2: Pressing Enter while the input has a non-empty value
 *        invokes onSubmit(trimmedValue); the input is then cleared.
 *   TF3: Pressing Escape invokes onCancel; the parent toggles
 *        active=false.
 *   TF4: Empty submission (whitespace-only) is SILENTLY IGNORED
 *        so the user cannot send an empty prompt to the bridge.
 *   TF5: data-testids are stable: 'typed-fallback' on the container,
 *        'typed-fallback-input' on the text input.
 *
 * The component is CONTROLLED — it subscribes to NOTHING. The
 * `active`, `onSubmit`, and `onCancel` props are supplied by the
 * App composition root which itself subscribes to the incident IPC
 * channels. This keeps the overlay trivially testable and reusable.
 *
 * Threat model: T-14-13 (typed prompt injection) is mitigated by
 * routing the typed text through session.handleTypedPrompt() which
 * applies detectManipulationTokens + wrapTranscript identically to
 * a spoken utterance. The component itself does NOT sanitise the
 * input — that responsibility lives in main where the audit trail
 * already exists.
 *
 * NO emojis (CLAUDE.md global). NO transcript content surfaces in
 * the locked label.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

export interface TypedFallbackProps {
  /**
   * Whether the overlay is currently visible. When false the
   * component returns null (no DOM produced). When true the overlay
   * mounts with an autofocused input.
   *
   * Driven by App.tsx state mirroring IPC_INCIDENT_STT_FAIL.
   */
  active: boolean;
  /**
   * Invoked when the user submits a non-empty prompt (Enter key).
   * The string passed here is the trimmed input value. The parent is
   * responsible for forwarding the text via the bridge — the
   * component does NOT call the bridge directly so testing remains
   * trivial.
   */
  onSubmit: (text: string) => void;
  /**
   * Invoked when the user dismisses the overlay (Escape key). The
   * parent should set active=false in response.
   */
  onCancel: () => void;
}

/**
 * Locked label text. The wording is part of the SAFE-05 user-facing
 * contract — a future contributor should NOT change this without
 * revisiting the threat-model dispositions in 14-03-PLAN.md.
 */
const LOCKED_LABEL = "STT unavailable. Type your prompt.";

/**
 * Locked placeholder text. Mirrors the locked label so both are
 * caught by a future i18n pass uniformly.
 */
const LOCKED_PLACEHOLDER = "Type your prompt";

export function TypedFallback(props: TypedFallbackProps): ReactElement | null {
  const [value, setValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the input on mount. The dependency array deliberately
  // includes `active` so a future caller that re-mounts the
  // component via prop toggling still gets focus.
  useEffect(() => {
    if (!props.active) return;
    // requestAnimationFrame keeps focus deterministic in jsdom which
    // does not honour direct .focus() during render. Production
    // Electron still routes through the same animation frame so the
    // visible focus highlight appears consistently.
    if (typeof requestAnimationFrame === "function") {
      const raf = requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => {
        cancelAnimationFrame(raf);
      };
    }
    // jsdom fallback when requestAnimationFrame is unavailable.
    inputRef.current?.focus();
    return undefined;
  }, [props.active]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        const trimmed = value.trim();
        // TF4: silently ignore whitespace-only submissions.
        if (trimmed.length === 0) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        props.onSubmit(trimmed);
        // Clear the input after a successful submit so the user can
        // continue typing without manually clearing.
        setValue("");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        props.onCancel();
        return;
      }
    },
    [value, props],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
    },
    [],
  );

  if (!props.active) return null;

  return (
    <div
      className="typed-fallback"
      data-testid="typed-fallback"
      role="dialog"
      aria-label={LOCKED_LABEL}
    >
      <div className="typed-fallback-label" data-testid="typed-fallback-label">
        {LOCKED_LABEL}
      </div>
      <input
        ref={inputRef}
        className="typed-fallback-input"
        data-testid="typed-fallback-input"
        type="text"
        autoFocus
        placeholder={LOCKED_PLACEHOLDER}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label={LOCKED_PLACEHOLDER}
      />
    </div>
  );
}
