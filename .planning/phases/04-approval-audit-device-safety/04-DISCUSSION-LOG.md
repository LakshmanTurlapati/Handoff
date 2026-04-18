# Phase 4: Approval, Audit & Device Safety - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `04-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 04-approval-audit-device-safety
**Areas discussed:** device management surface, revocation semantics, approval handling, reconnect policy, trust enforcement

---

## Device Management Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated management surface | Authenticated web view listing paired devices and active remote sessions with explicit revoke controls | ✓ |
| Session-shell-only controls | Allow revocation only from inside the active live session shell | |
| Minimal device list | Show paired devices only and handle active session teardown elsewhere | |

**User's choice:** Recommended default auto-selected via non-interactive fallback.
**Notes:** Best matches `AUTH-03` and repeated-use safety. Revocation should be easy to find outside the live session.

---

## Revocation Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate fail-closed revoke | Invalidate the durable device session and tear down any active live session immediately | ✓ |
| Soft revoke after next reconnect | Mark the device revoked but allow the current live session to continue until it disconnects | |
| Warn-only revoke | Show the device as unsafe without tearing down active use | |

**User's choice:** Recommended default auto-selected via non-interactive fallback.
**Notes:** Trust loss should take precedence over convenience. This also satisfies the clean disconnect requirement tied to revoked sessions.

---

## Approval Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Inline approval cards | Keep approvals visible in the live session context using the existing mobile card treatment | ✓ |
| Separate approval inbox | Route approvals to a dedicated approval page or queue | |
| Full-screen modal blocker | Interrupt the session with a modal whenever approval is required | |

**User's choice:** Recommended default auto-selected via non-interactive fallback.
**Notes:** Carries forward the Phase 3 decision that approval must be impossible to miss without leaving the session context.

---

## Reconnect Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Resume on short drops only | Preserve subtle reconnect and backfill behavior for transient failures, but never resurrect revoked or ended sessions | ✓ |
| Always auto-resume | Reconnect any previously attached session whenever connectivity returns | |
| Force full re-pairing | Treat every disconnect as requiring the full pairing flow again | |

**User's choice:** Recommended default auto-selected via non-interactive fallback.
**Notes:** Balances `AUTH-04` and `LIVE-03` against the trust boundary. Short interruptions recover; revoked or terminal states do not.

---

## Trust Enforcement

| Option | Description | Selected |
|--------|-------------|----------|
| Durable row validation | Confirm device-session expiry, revocation, and ownership from durable storage before authorizing live access | ✓ |
| Cookie-claims only | Trust the signed device cookie without checking the backing row | |
| New alternate token channel | Add a parallel bearer-token path for reconnect and live control | |

**User's choice:** Recommended default auto-selected via non-interactive fallback.
**Notes:** This closes the largest current safety gap in the Phase 3/4 boundary while preserving the existing Auth.js plus ws-ticket model.

---

## the agent's Discretion

- Exact page layout and navigation for device/session management.
- Compact audit-history presentation details.
- Precise copy and motion treatment for reconnect, revoked, and terminal-ended states.

## Deferred Ideas

None — discussion stayed within phase scope.
