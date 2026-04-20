# Handoff CLI

`handoff` is the local bridge CLI for Handoff. It pairs a phone browser with a
developer's existing local Codex session and runs the outbound-only bridge
daemon that connects back to the hosted relay.

## Install

```bash
npm install --global remote-handoff
```

## Codex Setup

After installing the package, install the packaged `/handoff` slash command into
your local Codex command directory:

```bash
handoff install-codex-command
```

## Commands

```bash
npx remote-handoff install-codex-command
npx remote-handoff pair --base-url https://handoff-web.fly.dev
npx remote-handoff daemon --help
npx remote-handoff launch
```
