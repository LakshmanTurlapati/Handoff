---
description: Start or reuse a thread-bound handoff from the current Codex session.
---

# `/handoff`

Start or reuse a remote continuation handoff for the active Codex thread.

## Preflight

1. Confirm the local `handoff` CLI is installed and available on `PATH`.
2. Confirm this command is running from an active Codex thread with resolvable thread context.
3. If the active thread context is missing, return `missing_active_thread_context` with repair guidance and stop.
4. Do not widen sandbox or approval behavior. This command must preserve the current Codex session semantics.

## Plan

1. Resolve the current Codex thread context.
2. Fail closed if the current thread cannot be resolved.
3. Invoke the local Handoff helper for the active thread.
4. Return a concise result block for the active thread only.

## Commands

1. Once the active thread context is available, call the exact local helper command `handoff codex-handoff --format json`.
2. Parse the JSON response and present the concise handoff result to the user.
3. If the current thread cannot be resolved, the command must return `missing_active_thread_context`.
4. If the current thread cannot be resolved, the command must not call any generic session-picker flow such as `thread/list` for user selection.

## Verification

1. Confirm the helper returned structured JSON for the same active thread that invoked `/handoff`.
2. Confirm the result describes one thread-bound handoff outcome instead of a generic session-selection flow.
3. Confirm no fallback to `thread/list` was used for user selection.

## Summary

- **Action**: Start or reuse a thread-bound handoff for the active Codex session
- **Status**: success | partial | failed
- **Details**: thread-bound handoff result from `handoff codex-handoff --format json`

## Next Steps

1. Open the returned handoff URL on the target phone browser.
2. Complete pairing if prompted by the hosted flow.
3. Re-run `/handoff` from the same thread if the existing handoff expires or is revoked.
