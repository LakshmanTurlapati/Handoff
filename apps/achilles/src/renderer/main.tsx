// Replaced by Plan 11-02 (FloatingShell composition root)
//
// Plan 11-01 ships only enough renderer bootstrap to prove the bridge
// wires correctly: a stub `<App />` that subscribes via
// `window.__mockBridge` (Playwright headless) or `window.achilles`
// (real Electron preload) and reflects the current AchillesState on
// the floating-shell + reactive-circle elements as `data-state="..."`.
//
// The full component composition (reactive circle, waveform, transcript,
// permission overlay, settings popover, error banner) lands in Plans
// 11-02 and 11-03.

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { AchillesState } from "../shared/constants.js";
import { getBridge } from "./bridge.js";

function App(): React.ReactElement {
  const [state, setState] = useState<AchillesState>("idle");

  useEffect(() => {
    const bridge = getBridge();
    const unsubscribe = bridge.onStateChanged((next) => {
      setState(next);
    });
    return unsubscribe;
  }, []);

  return (
    <div
      data-testid="floating-shell-inner"
      style={{
        width: "260px",
        height: "260px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        data-testid="reactive-circle"
        data-state={state}
        style={{
          width: "96px",
          height: "96px",
          borderRadius: "50%",
          backgroundColor: "rgba(95, 100, 113, 0.4)",
          color: "#E8EAED",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "11px",
          pointerEvents: "auto",
        }}
      >
        state: {state}
      </div>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement !== null) {
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
