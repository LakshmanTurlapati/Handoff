/**
 * Achilles renderer entry — Plan 11-02 (revised from the Plan 11-01 stub).
 *
 * Renders the real composition root:
 *
 *   <AchillesStateProvider>
 *     <App />        — Plan 11-03 owns App.tsx, which composes the
 *                      FloatingShell + overlay slots (PermissionOverlay,
 *                      ErrorBanner, SettingsPopover).
 *   </AchillesStateProvider>
 *
 * If Plan 11-03's App.tsx is not yet present (parallel-wave dev), the
 * renderer falls back to mounting <FloatingShell /> directly with empty
 * overlay slots so the Plan 11-02 surfaces are still verifiable.
 *
 * Both production builds (via electron-vite) and the headless Playwright
 * preview (via vite.headless.config.ts) share this entry; the bridge
 * adapter (renderer/bridge.ts) picks `window.achilles` (real preload) or
 * `window.__mockBridge` (headless test seam) at runtime so this entry
 * never branches on which.
 *
 * The headless debug surface (`window.__achilles_debug`) is attached by
 * FloatingShell when `import.meta.env.MODE` is 'headless' or
 * 'development' so Plan 11-02's Playwright specs can assert structural
 * contracts (UI-04 waveform analyser binCount) without breaking the
 * production build (Vite tree-shakes the branch when MODE !== those
 * values).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/components.css";

import { App } from "./App.js";
import { InitWizard } from "./components/InitWizard.js";
import { AchillesStateProvider } from "./state/useAchillesState.js";

/**
 * Plan 13-03 routing: when the preload exposed `window.achilles.mode`
 * equals 'init' (the CLI was invoked as `achilles init` and spawned
 * Electron with ACHILLES_MODE=init in the env), the renderer mounts
 * the InitWizard component INSTEAD of the AchillesStateProvider tree.
 * The InitWizard has its own internal state and does NOT consume the
 * Plan 11/12 state reducer.
 *
 * The default — mode === 'launch' OR window.achilles undefined (headless
 * mock bridge path) — preserves the Plan 11-02/03 + 12-04 floating shell
 * tree verbatim. No regression.
 */
const mode =
  (window as { achilles?: { mode?: "init" | "launch" } }).achilles?.mode ??
  "launch";

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  if (mode === "init") {
    createRoot(rootElement).render(
      <StrictMode>
        <InitWizard />
      </StrictMode>,
    );
  } else {
    createRoot(rootElement).render(
      <StrictMode>
        <AchillesStateProvider>
          <App />
        </AchillesStateProvider>
      </StrictMode>,
    );
  }
}
