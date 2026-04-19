---
description: Start or reuse a thread-bound handoff from the current Codex session.
---

# /handoff

## Preflight

- Confirm the current Codex thread is active and its thread/session context can be resolved.
- If the current thread cannot be resolved, the command must return `missing_active_thread_context` and must not call any generic session-picker flow such as `thread/list` for user selection.
- No session picker fallback
- Confirm the local `handoff` package is installed and the bridge bootstrap has already completed on this machine.

## Plan

1. Resolve the active Codex thread and session context from the current conversation.
2. Ensure the local bridge daemon is running through the packaged `handoff` CLI.
3. Ask the local helper for a concise JSON handoff result bound to the current thread.
4. Return only the launch details, expiry, reuse state, and repair guidance needed for remote continuation.

## Commands

- Once the active thread context is available, call the local helper command `handoff codex-handoff --format json`.
- Bind the resolved thread and session context into that helper invocation.
- Never fall back to `thread/list` or any other generic picker flow if the current thread is unavailable.

## Verification

- Confirm the helper returns structured JSON for exactly one thread-bound handoff.
- Confirm the response includes launch details, expiry, and whether the handoff was reused.
- Confirm failures stay fail-closed and surface actionable repair guidance instead of listing sessions.

## Summary

- Reuse or start a thread-bound remote handoff for the current Codex session only.
- No session picker fallback
- If the active thread context is missing, stop with `missing_active_thread_context`.

## Next Steps

- Open or scan the returned launch URL/QR code on the paired phone.
- Re-run `/handoff` from the same thread to reuse the still-valid handoff if needed.
- If the command reports missing bootstrap or thread context, repair that local state and run `/handoff` again from the active Codex thread.
