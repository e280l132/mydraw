import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/**
 * "Pin style panel": keep Excalidraw's style column (Colors & styles, Align, Edges, ...) on screen
 * with the select tool and nothing selected. Excalidraw only renders it while something is
 * selected or a drawing tool is active, so scripts/excalidrawPatch.mjs rewrites its
 * `showSelectedShapeActions` to also return true while `globalThis.__mydrawPinPanel` is set.
 * Global preference, kept in localStorage like the other panel toggles.
 */
const KEY = "mydraw.panelPinned";

declare global {
  // eslint-disable-next-line no-var
  var __mydrawPinPanel: boolean | undefined;
}

export function loadPanelPinned(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

// Set before Excalidraw's first render so a pinned panel shows on startup.
globalThis.__mydrawPinPanel = loadPanelPinned();

/** Set the flag the patched Excalidraw reads and repaint every drawing so the column appears or goes. */
export function applyPanelPinned(pinned: boolean, apis: Iterable<ExcalidrawImperativeAPI>): void {
  globalThis.__mydrawPinPanel = pinned;
  try {
    localStorage.setItem(KEY, pinned ? "1" : "0");
  } catch {
    /* private window: the pin lasts for this session */
  }
  for (const api of apis) api.refresh();
}
