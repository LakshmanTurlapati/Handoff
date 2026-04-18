# Phase 3: Live Remote UI & Control - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `03-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 03-live-remote-ui-control
**Areas discussed:** Timeline structure, Control surface, Live playback behavior, Approval and state emphasis

---

## Timeline Structure

### Q1: Default session structure

| Option | Description | Selected |
|--------|-------------|----------|
| Turn-grouped cards | Each user turn becomes a block with assistant response, tool activity, approvals, and command output grouped under it. | ✓ |
| Single chronological feed | Everything appears in strict time order like a live log. | |
| Sectioned views | Separate the session into views like Messages, Tools, and Approvals. | |
| You decide | Delegate the default structure choice. | |

**User's choice:** Turn-grouped cards  
**Notes:** The user accepted the recommended mobile-first grouping model.

### Q2: Default collapsed density

| Option | Description | Selected |
|--------|-------------|----------|
| Assistant text + latest live status | Show the conversation content and one live activity line, with detailed tool output folded. | ✓ |
| Everything expanded | Show assistant text, tool calls, command output, and notes inline by default. | |
| Status-first summary | Start as a compact summary row and tap in for details. | |
| You decide | Delegate the density choice. | |

**User's choice:** Assistant text + latest live status  
**Notes:** The user preferred the compact assistant-first mobile summary.

### Q3: Completed tool details

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-fold completed tool details, keep the current live step visible | Preserve focus on what is happening now while retaining access to older details. | ✓ |
| Keep everything expanded until the user folds it | Leave all tool detail visible until manually collapsed. | |
| Collapse the whole turn to a summary after each completed step | Compress aggressively after each finished step. | |
| You decide | Delegate the collapse behavior. | |

**User's choice:** Auto-fold completed tool details, keep the current live step visible  
**Notes:** The user preferred mobile focus on the current step.

### Q4: Older turns during a live turn

| Option | Description | Selected |
|--------|-------------|----------|
| Older turns stay readable but compressed to headers + first lines | Keep recent context glanceable while prioritizing the active turn. | ✓ |
| Only the active turn stays open; older turns collapse to one-line summaries | Maximize focus on the active turn. | |
| No automatic compression | Keep the full conversation open continuously. | |
| You decide | Delegate compression behavior. | |

**User's choice:** Older turns stay readable but compressed to headers + first lines  
**Notes:** The user wants recent context retained without sacrificing live focus.

---

## Control Surface

### Q1: Prompt and steer input affordance

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky bottom composer | Persistent input bar pinned to the bottom and expanding upward for longer text. | ✓ |
| Slide-up compose sheet | Compact button opens a larger composer sheet. | |
| Full-screen compose mode | Tapping compose takes over the screen. | |
| You decide | Delegate the input affordance. | |

**User's choice:** Sticky bottom composer  
**Notes:** The user accepted the recommended thumb-reachable chat-style composer.

### Q2: Steer visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Always visible beside the composer | Keep steer explicit and fast regardless of whether the agent is idle or active. | ✓ |
| Only visible while the agent is actively responding | Show steer only during live output. | |
| Inside a session actions menu | Hide steer inside overflow actions. | |
| You decide | Delegate steer placement. | |

**User's choice:** Always visible beside the composer  
**Notes:** The user preferred fast, always-available steering.

### Q3: Interrupt exposure

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated danger button in the sticky composer row | Keep stop visible and immediate in the main action row. | ✓ |
| Header action button | Place interrupt in top-level header actions. | |
| Long-press or swipe gesture | Hide interrupt behind a gesture. | |
| You decide | Delegate interrupt placement. | |

**User's choice:** Dedicated danger button in the sticky composer row  
**Notes:** The user favored explicit access to the critical stop action.

### Q4: UX immediately after interrupt

| Option | Description | Selected |
|--------|-------------|----------|
| Flip the button into a pending stop state and keep the timeline live | Show the request was sent while still streaming cleanup/final output. | ✓ |
| Freeze the timeline and show a blocking “Stopping…” overlay | Replace the session with a blocking stop state. | |
| Immediately return to idle compose state | Pretend the session is already idle. | |
| You decide | Delegate post-interrupt behavior. | |

**User's choice:** Flip the button into a pending stop state and keep the timeline live  
**Notes:** The user wants visible stop acknowledgement without hiding the live session.

---

## Live Playback Behavior

### Q1: Streaming granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Chunked streaming | Update the UI in readable chunks rather than token-by-token. | ✓ |
| Token-by-token streaming | Stream every token as it arrives. | |
| Step-level updates only | Update only when a message block or tool step completes. | |
| You decide | Delegate streaming granularity. | |

**User's choice:** Chunked streaming  
**Notes:** The user preferred the recommended balance between liveness and mobile stability.

### Q2: Scroll behavior during a live turn

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-follow until the user manually scrolls away, then show a “Jump to live” control | Keep the live area in view by default without trapping the user. | ✓ |
| Always auto-follow | Force the view to the latest live output. | |
| Never auto-follow | Leave scrolling entirely manual. | |
| You decide | Delegate scroll behavior. | |

**User's choice:** Auto-follow until the user manually scrolls away, then show a “Jump to live” control  
**Notes:** The user chose the standard chat/live-stream mobile pattern.

### Q3: Short disconnect handling

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the timeline visible, show a subtle reconnect banner, and resume in place | Preserve continuity while making the transient issue visible. | ✓ |
| Replace the timeline with a full-screen reconnect state | Swap the view to a reconnect-only screen. | |
| Silently retry with no UI until it works or fails hard | Retry without any user-visible state. | |
| You decide | Delegate reconnect treatment. | |

**User's choice:** Keep the timeline visible, show a subtle reconnect banner, and resume in place  
**Notes:** The user preferred continuity plus a subtle signal rather than a blocking reconnect screen.

### Q4: Reconnect recovery

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill missed events into the current turn and mark the gap with a subtle “Reconnected” separator | Preserve timeline coherence without pretending no interruption happened. | ✓ |
| Only resume from the current live state | Skip the missed activity and continue from the latest point. | |
| Ask the user to reload the session | Require manual reload after reconnect. | |
| You decide | Delegate reconnect recovery behavior. | |

**User's choice:** Backfill missed events into the current turn and mark the gap with a subtle “Reconnected” separator  
**Notes:** The user wants continuity and visibility into what happened during the interruption.

---

## Approval and State Emphasis

### Q1: Approval prominence

| Option | Description | Selected |
|--------|-------------|----------|
| Inline approval card pinned near the live turn | Keep approval in context with high contrast and persistent visibility. | ✓ |
| Full-width blocking banner over the session | Overlay a blocking approval state over the session. | |
| Small status chip in the header | Represent approval with a compact header indicator. | |
| You decide | Delegate approval treatment. | |

**User's choice:** Inline approval card pinned near the live turn  
**Notes:** The user wants approval to be obvious without disconnecting it from the turn that triggered it.

### Q2: Differentiating activity types

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct card treatments by type | Give agent text, tools, command execution, approvals, and system notices different visual treatments within one system. | ✓ |
| Mostly uniform cards with icons only | Keep one treatment and rely mostly on icons. | |
| Heavy color-coded timeline rows | Use loud color-coded rows throughout. | |
| You decide | Delegate the differentiation scheme. | |

**User's choice:** Distinct card treatments by type  
**Notes:** The user accepted the recommended approach for meeting the “clearly separates” requirement.

### Q3: Failure treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Expanded error card with retry/context actions if available | Make failures obvious and actionable while keeping them in the turn. | ✓ |
| Collapsed red summary row only | Represent failures as a compact red row. | |
| Modal alert | Surface failures as a modal. | |
| You decide | Delegate failure treatment. | |

**User's choice:** Expanded error card with retry/context actions if available  
**Notes:** The user preferred visible, contextual failures over compact or modal alternatives.

### Q4: Turn header emphasis

| Option | Description | Selected |
|--------|-------------|----------|
| Current session state first, then actor/detail text | Lead with states like “Waiting for approval” or “Running bash,” then show the specific detail. | ✓ |
| Actor/detail first, state second | Lead with the specific tool/command or actor. | |
| No special header emphasis | Keep headers visually flat. | |
| You decide | Delegate header emphasis. | |

**User's choice:** Current session state first, then actor/detail text  
**Notes:** The user prefers fast at-a-glance state scanning on mobile.

---

## the agent's Discretion

- Exact visual design system details, as long as the chosen hierarchy and thumb-reach behavior remain intact.
- Exact iconography and motion for status transitions.
- Exact retry/context action presentation when backend support differs by event type.

## Deferred Ideas

None.
