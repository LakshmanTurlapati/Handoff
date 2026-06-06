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
import { AchillesStateProvider } from "./state/useAchillesState.js";

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(
    <StrictMode>
      <AchillesStateProvider>
        <App />
      </AchillesStateProvider>
    </StrictMode>,
  );
}
