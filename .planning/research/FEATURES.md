# Feature Research

**Domain:** Secure remote control for local Codex sessions
**Researched:** 2026-04-06
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Secure web sign-in and device session management | Internet-facing developer tools must establish identity before pairing or control | MEDIUM | Start with simple first-party auth; add passkeys later if needed |
| Terminal-generated QR pairing flow | The reference product pattern is scan-from-terminal, continue-from-phone | MEDIUM | Must include a fallback code and terminal confirmation, not just a QR |
| Live synced session view | Users expect remote continuation to reflect the same session, not a separate automation job | HIGH | Structured event streaming is more important than raw terminal mirroring |
| Remote prompt / steer / interrupt controls | A remote window that can only observe is incomplete for the target use case | HIGH | Must map to Codex thread/turn semantics cleanly |
| Approval visibility | Users need to see when Codex is blocked on permissions or sandbox boundaries | HIGH | This is part of trust, not optional polish |
| Reconnect behavior | Mobile networks and laptop sleep interruptions are normal, not edge cases | HIGH | Bridge and browser both need resilient reconnect semantics |
| Device revocation and audit | Security-sensitive remote tooling must let users end trust explicitly | MEDIUM | Required for credible internet-facing use |
| Phone-first UI | The core product promise is continuation from a phone | MEDIUM | Do not design a terminal-first desktop UI and later "shrink" it |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Codex-native bridge using app-server | Preserves approvals, history, and agent events better than PTY scraping | HIGH | This is the product's strongest technical differentiator |
| Terminal confirmation phrase on pairing | Reduces QR hijacking risk and increases user trust | MEDIUM | Important because QR-only pairing is easy to abuse |
| Outbound-only local bridge | Avoids asking users to expose localhost or open inbound ports | HIGH | Strong security and setup advantage |
| Open-source, self-hostable relay + web UI | Attractive to security-conscious developers and teams | MEDIUM | Should remain a product principle, not a later marketing layer |
| Relay ownership routing on Fly.io | Makes multi-instance scale possible without collapsing back to one sticky node | HIGH | Worth designing in early even if fully optimizing later |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Raw shell passthrough | Feels powerful and familiar | Explodes the risk surface and turns the product into a remote shell | Keep the product scoped to mediated Codex actions and structured activity |
| Static or reusable pairing QR codes | Feels simpler than short-lived tickets | Vulnerable to replay and QR-login hijacking | Single-use, short-lived QR tokens plus terminal confirmation |
| Treating terminal bytes as the canonical protocol | Seems easier because terminals already exist | Loses semantic approvals, turn state, and replayability | Use app-server events as canonical data and render terminal activity as a view |
| Fully cloud-hosted Codex workspaces in v1 | Sounds like a bigger market | Changes the product from local continuation into hosted execution | Keep v1 focused on local-session continuation |

## Feature Dependencies

```text
Web auth
    └──requires──> Device pairing
                          └──requires──> Local bridge registration
                                                └──requires──> Active relay ownership

Live event stream
    └──enables──> Prompt / steer / interrupt
                          └──depends on──> Approval surfaces

Audit trail
    └──supports──> Device revocation
```

### Dependency Notes

- **Device pairing requires authenticated web identity:** pairing cannot be the first trust anchor in an internet-facing system
- **Live control requires structured event streaming first:** remote input is only safe once session identity and event state are coherent
- **Audit and revocation depend on durable metadata:** in-memory session state is not enough once multiple devices or relay instances exist

## MVP Definition

### Launch With (v1)

- [ ] Authenticated web session and 7-day device session lifecycle
- [ ] Terminal QR pairing with short-lived tokens and terminal confirmation
- [ ] Local bridge that connects outbound only and attaches to local Codex sessions
- [ ] Phone-optimized live session UI with prompt, steer, interrupt, and approval visibility
- [ ] Device revocation, session teardown, and basic audit records

### Add After Validation (v1.x)

- [ ] Approval-needed notifications while the user is away from the live session
- [ ] Multiple concurrent remote sessions per user with clearer ownership UI
- [ ] Read-only observer mode for another browser or teammate

### Future Consideration (v2+)

- [ ] Native iOS/Android shells on top of the same protocol
- [ ] Team/shared session features
- [ ] Hosted workspaces or cloud execution modes

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Secure pairing | HIGH | MEDIUM | P1 |
| Live session streaming | HIGH | HIGH | P1 |
| Remote prompt / steer | HIGH | HIGH | P1 |
| Approval visibility | HIGH | HIGH | P1 |
| Device revocation | HIGH | MEDIUM | P1 |
| Notifications | MEDIUM | MEDIUM | P2 |
| Observer mode | MEDIUM | MEDIUM | P2 |
| Native apps | MEDIUM | HIGH | P3 |
| Team collaboration | LOW/MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have after initial validation
- P3: Defer until the core loop is proven

## Competitor Feature Analysis

| Feature | Competitor A | Competitor B | Our Approach |
|---------|--------------|--------------|--------------|
| Local session continuation | Claude Code Remote Control continues a local session from mobile/web | GSD2 web surfaces expose live activity and remote prompts for GSD workflows | Codex-native continuation of a local Codex session with explicit product-owned bridge and relay |
| Pairing | Claude Code uses session URLs and QR entry from the terminal | GSD2 focuses more on remote prompts than mobile pairing | QR pairing plus terminal confirmation to reduce QR hijack risk |
| Live progress | Claude Code keeps session state in sync across devices | GSD2 streams live activity and terminal output via SSE | Structured Codex app-server events rendered in a phone-optimized UI |
| Security model | Claude Code keeps execution local and uses outbound connectivity only | GSD2 local web auth is suitable for localhost, not public internet as-is | Internet-facing cookies, short-lived WS tickets, audit logs, and relay ownership checks |

## Sources

- Anthropic Claude Code Remote Control docs: https://code.claude.com/docs/en/remote-control
- OpenAI Codex App Server docs: https://developers.openai.com/codex/app-server
- OpenAI Codex Non-interactive Mode docs: https://developers.openai.com/codex/noninteractive
- GSD2 reference code under `resources/gsd-2/`

---
*Feature research for: secure mobile remote control for local Codex sessions*
*Researched: 2026-04-06*
