/**
 * DragHandle — invisible 260×30 strip at the top of the floating window
 * with `-webkit-app-region: drag` so Electron treats it as the OS-level
 * drag region (UI-05 affordance).
 *
 * Children passed through `props.children` can re-enable click events
 * by applying the `no-drag` class (or `-webkit-app-region: no-drag`
 * inline) — used by Plan 11-02's settings affordance and by the
 * SettingsPopover's close button when they are positioned inside the
 * 0..30 px band.
 *
 * The component intentionally renders no IPC wiring — main owns the
 * window-position persistence via wireDragPersistence; the drag is
 * driven by the OS window manager.
 *
 * The `-webkit-app-region: drag` style is applied via the
 * `.drag-handle` class in `apps/achilles/src/renderer/styles/overlays.css`
 * because jsdom's CSSStyleDeclaration drops the proprietary property
 * when set inline via `WebkitAppRegion`. The class-based approach lets
 * Electron consume the CSS rule directly in production while unit tests
 * verify the className contract.
 *
 * The `data-app-region` attribute exposes the drag-region intent to
 * Playwright + unit assertions without depending on a non-standard CSS
 * property that jsdom strips.
 */
import type { ReactElement, ReactNode } from "react";

export interface DragHandleProps {
  children?: ReactNode;
}

export function DragHandle({ children }: DragHandleProps): ReactElement {
  return (
    <div
      data-testid="drag-handle"
      data-app-region="drag"
      className="drag-handle"
    >
      {children}
    </div>
  );
}
