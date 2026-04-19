# Phase 7: Codex-Native `/handoff` Command - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 07-codex-native-handoff-command
**Areas discussed:** Current-thread targeting, Repeat `/handoff` behavior, Command response inside Codex, Failure guidance

---

## Current-thread targeting

| Option | Description | Selected |
|--------|-------------|----------|
| Active thread only | Bind to the exact invoking thread/session; if there is no real active thread context, fail with guidance | ✓ |
| Active thread preferred with fallback | Prefer the current thread, but fall back to a recent-session picker or default session if no thread context exists | |
| Active thread plus explicit override | Default to the current thread, but allow an advanced explicit session override | |

**User's choice:** Active thread only
**Notes:** The command should satisfy `CMD-02` cleanly and avoid later ambiguity by being anchored to the thread it was invoked from.

## Repeat `/handoff` behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Always mint fresh | Generate a new handoff every time for deterministic behavior | |
| Reuse still-valid existing handoff | Reuse the current valid handoff for the same thread and only mint a new one after expiry or revocation | ✓ |
| Ask each time | Detect an existing handoff and ask whether to reuse or mint fresh | |

**User's choice:** Reuse still-valid existing handoff
**Notes:** The command should behave like a stable continuation handle for the active thread while the existing handoff remains valid.

## Command response inside Codex

| Option | Description | Selected |
|--------|-------------|----------|
| Concise handoff block | Show hosted URL, QR code, expiry, and reused/new status | ✓ |
| URL only | Minimal output with just the hosted link | |
| Rich status panel | Show additional bridge, relay, session, and launch diagnostics | |

**User's choice:** Concise handoff block
**Notes:** The output should stay phone-oriented and compact rather than becoming a diagnostics dashboard.

## Failure guidance

| Option | Description | Selected |
|--------|-------------|----------|
| Fail with actionable repair guidance | Fail closed for missing bootstrap or missing thread context and explain what the user needs to do | ✓ |
| Partial setup fallback | Fail for missing thread context, but auto-enter first-run setup for missing bootstrap | |
| Constrained fallback path | Offer setup or manual session selection directly from `/handoff` | |

**User's choice:** Fail with actionable repair guidance
**Notes:** The command should preserve the strict safety and context contract rather than widening the Phase 7 path with implicit fallback behavior.

## the agent's Discretion

- Exact plugin or command registration mechanism inside Codex
- Exact formatting of the success block, as long as it includes URL, QR, expiry, and reused/new status
- Exact storage shape for thread-scoped reusable handoff metadata

## Deferred Ideas

None
