# Pitfalls Research

**Domain:** Secure remote control for local Codex sessions
**Researched:** 2026-04-06
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: QR Pairing Without Anti-Hijack Controls

**What goes wrong:**
An attacker reuses or proxies the QR code and tricks a user into authorizing the wrong session.

**Why it happens:**
Developers treat the QR code itself as proof of trust instead of a short-lived initiation step.

**How to avoid:**
Use single-use pairing records, minute-scale expiry, authenticated web users, and a confirmation phrase or terminal approval before activation.

**Warning signs:**
QRs stay valid after first use, can be screenshotted and reused, or complete pairing without any local confirmation.

**Phase to address:**
Phase 1

---

### Pitfall 2: Exposing Local Codex Directly to the Internet

**What goes wrong:**
The product turns into a thin reverse proxy over a local agent runtime, collapsing all security, auth, and policy enforcement into the wrong boundary.

**Why it happens:**
It feels simpler to forward the local WebSocket or terminal stream directly rather than introducing a bridge and product protocol.

**How to avoid:**
Keep app-server local, communicate with it over stdio, and expose only a product-owned relay protocol over outbound connectivity.

**Warning signs:**
Design docs mention public `ws://` listeners on the local machine or direct browser connections into app-server.

**Phase to address:**
Phase 1

---

### Pitfall 3: Reusing Localhost Auth Patterns for a Public Relay

**What goes wrong:**
A design that is acceptable on localhost leaks tokens or is vulnerable to cross-site abuse when put behind a public domain.

**Why it happens:**
Existing local tools often use URL fragments, localStorage, or query-string tokens because the threat model is "same machine, temporary browser."

**How to avoid:**
Use HttpOnly sessions, CSRF protection, strict origin checks, and short-lived WebSocket upgrade tickets instead of long-lived client-stored bearer tokens.

**Warning signs:**
Long-lived tokens in localStorage, query-string auth on public URLs, or browser clients that work even after cookies are cleared.

**Phase to address:**
Phase 1 and Phase 4

---

### Pitfall 4: Designing for One Relay Instance

**What goes wrong:**
The first horizontally scaled deployment cannot route a browser connection to the relay instance that owns the local bridge, causing disconnects and phantom sessions.

**Why it happens:**
It is tempting to keep live ownership only in process memory while moving quickly on the MVP.

**How to avoid:**
Persist relay ownership metadata and make routing an explicit product concern from the beginning, even if the first deploy uses one or two instances.

**Warning signs:**
No ownership registry, no concept of relay instance identity, or browser sessions assuming any relay can serve any bridge.

**Phase to address:**
Phase 5

---

### Pitfall 5: Treating Terminal Output as the Product's Source of Truth

**What goes wrong:**
The remote UI becomes noisy, brittle, and unable to model approvals or structured progress accurately.

**Why it happens:**
Terminal mirroring is the fastest way to show "something is happening."

**How to avoid:**
Render structured Codex events as the primary timeline, and treat raw terminal activity as a secondary view when it adds value.

**Warning signs:**
UI specs only mention PTY streaming, or product requirements cannot distinguish tool execution, approvals, and agent messages.

**Phase to address:**
Phase 2 and Phase 3

---

### Pitfall 6: Allowing the Remote Surface to Bypass Codex Approval Semantics

**What goes wrong:**
The remote UI silently increases Codex autonomy or hides meaningful risk boundaries from the user.

**Why it happens:**
Product builders optimize for convenience and accidentally flatten "approval requested" into "just keep going."

**How to avoid:**
Preserve upstream sandbox and approval state, expose it clearly in the UI, and log high-risk actions.

**Warning signs:**
Remote actions trigger with more privilege than local Codex, or approvals are no longer visible in the remote timeline.

**Phase to address:**
Phase 2 and Phase 4

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| PTY scraping first, protocol later | Fastest visible demo | Expensive migration to a semantic protocol | Acceptable only for throwaway spikes, not for v1 architecture |
| In-memory pairing/session store only | Simple implementation | Breaks on restart and multi-instance deploys | Local development only |
| Long-lived WebSocket tokens | Easier reconnect story | Credential theft risk and hard revocation | Never |
| Single relay process as implicit coordinator | Fewer moving parts | Scaling rewrite becomes mandatory immediately after adoption | Acceptable for a one-user dev environment, not beta |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Codex app-server | Exposing the experimental WebSocket mode directly | Spawn locally over stdio and let the bridge own the external transport |
| Codex exec | Treating it as a rich interactive protocol | Use it for automation or fallback one-shot tasks only |
| Fly.io routing | Assuming any instance can terminate any WebSocket | Persist ownership and route to the owner instance |
| QR-based linking | Trusting the scan event alone | Require local confirmation and single-use expiry |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded event queues | Relay memory climbs and slow clients destabilize everyone | Bound queues, drop/compact non-critical data, and expose backpressure metrics | Moderate concurrency or flaky mobile networks |
| Writing every event delta to durable storage | DB load spikes during active sessions | Persist checkpoints and audit-worthy events, not every character delta | Once multiple active sessions stream simultaneously |
| Global fanout through one coordinator | Relay CPU becomes the bottleneck | Route browser traffic to the owning relay worker | Once users or bridge counts scale beyond one instance |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Pairing without terminal confirmation | QR hijack and unauthorized device enrollment | Confirmation phrase or terminal approval |
| Query-string bearer tokens on public connections | Token leakage in logs/history | HttpOnly cookies plus short-lived upgrade tickets |
| Direct inbound connections to the local machine | Attack surface expansion and NAT complexity | Outbound bridge only |
| Treating remote control as remote shell | Privilege escalation and feature sprawl | Keep scope to Codex session mediation |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Terminal-first UI shrunk onto a phone | Hard to read or act on approvals and progress | Design mobile cards/timelines around semantic events |
| No clear local-versus-remote session state | Users do not know whether their laptop is still connected | Explicit presence, reconnect, and bridge-health indicators |
| Silent session expiry or disconnect | Remote control feels unreliable | Surface expiry countdowns, reconnect states, and disconnect reasons |

## Sources

- OWASP Qrljacking: https://owasp.org/www-community/attacks/Qrljacking
- OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OpenAI Codex App Server docs: https://developers.openai.com/codex/app-server
- OpenAI Codex Agent Approvals & Security docs: https://developers.openai.com/codex/agent-approvals-security
- Fly.io "Connecting to User Machines": https://fly.io/docs/blueprints/connecting-to-user-machines/

---
*Pitfalls research for: secure mobile remote control for local Codex sessions*
*Researched: 2026-04-06*
