# Achilles build resources

This directory holds the operator-supplied assets and configuration that `electron-builder` consumes when producing signed cross-platform installers. The plan-ed v1.2 release ships the cross-platform configuration in `apps/achilles/electron-builder.json` plus the macOS hardened-runtime entitlements and Info.plist fragment under this directory. The icon binaries and code-signing material are operator-owned and must be added before the first signed build runs.

## Required icon assets (operator adds before first signed build)

`electron-builder` expects three icon files under this directory, one per platform. Use the standard filenames so no JSON config change is needed:

- `icon.icns` — macOS app icon. 1024x1024 multi-resolution Apple Icon Image.
- `icon.ico` — Windows app icon. Multi-resolution Windows Icon resource (256x256, 128x128, 64x64, 48x48, 32x32, 16x16).
- `icon.png` — Linux app icon. 512x512 PNG.

The v1.2 source tree intentionally does NOT ship placeholder icons because doing so could surface as the real product identity in a signed build. The operator generates these from the canonical product artwork before tagging the release.

## Code-signing env vars

`electron-builder` reads the following environment variables at build time. The operator sets them in the release shell (or a CI secret store) before invoking `npm run dist`. The repo does NOT ship sample values or any commit-time secret material.

- `APPLE_ID` — Apple developer account email associated with the signing identity.
- `APPLE_APP_SPECIFIC_PASSWORD` — App-specific password generated at appleid.apple.com (NOT the Apple ID password itself). Used by the notarisation API.
- `APPLE_TEAM_ID` — 10-character team identifier from developer.apple.com. Substituted into `mac.notarize.teamId` via the `${env.APPLE_TEAM_ID}` reference in `electron-builder.json`.
- `CSC_LINK` — Base64-encoded P12 certificate OR a filesystem path to a `.p12` file. Used by both the macOS and Windows signing paths.
- `CSC_KEY_PASSWORD` — Password that unlocks the P12 certificate referenced by `CSC_LINK`.

## Producing installers locally

The operator invokes one of the workspace dist scripts from the repo root:

```bash
npm run dist --workspace apps/achilles            # host OS only
npm run dist:mac --workspace apps/achilles        # macOS target (.dmg)
npm run dist:win --workspace apps/achilles        # Windows target (.exe NSIS)
npm run dist:linux --workspace apps/achilles      # Linux target (.AppImage)
```

Cross-OS builds require a CI matrix because macOS notarisation requires a macOS runner with the Apple toolchain installed, and Windows code signing benefits from a Windows runner. The v1.2 release matrix is operator-triggered on the host machine for each platform; the v1.3 milestone tracks the actual CI matrix.

## CI policy

Per the global instruction "never run applications automatically" and the plan 13-04 contract `NO real electron-builder build in CI`, `electron-builder` runs are OPERATOR-triggered only. The CI pipelines defined elsewhere in this repo do NOT invoke `npm run dist`. The release matrix lives in v1.3 scope. The `prepublishOnly` chain on `apps/achilles-cli` performs source-of-truth and tarball-no-secrets gates only; it does NOT run a real installer build.
