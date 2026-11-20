import { hashElementsVersion, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export interface LoadedScene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

/** Parse and normalise `.excalidraw` JSON (also accepts PNG/SVG with an embedded scene later). */
export async function parseDrawing(content: string): Promise<LoadedScene> {
  const blob = new Blob([content], { type: "application/json" });
  const data = await loadFromBlob(blob, null, null);
  return {
    elements: data.elements,
    // Keep only document-level settings from the file; UI state comes from this app.
    appState: {
      viewBackgroundColor: data.appState.viewBackgroundColor,
      gridSize: data.appState.gridSize,
      gridStep: data.appState.gridStep,
      gridModeEnabled: data.appState.gridModeEnabled,
    },
    files: data.files ?? {},
  };
}

/**
 * Fingerprint of everything that is saved to disk. Compared with the value at the last
 * save to decide whether a tab has unsaved changes.
 */
export function sceneHash(elements: readonly ExcalidrawElement[], appState: Pick<AppState, "viewBackgroundColor">): string {
  return `${hashElementsVersion(elements)}:${elements.length}:${appState.viewBackgroundColor}`;
}

export function apiSceneHash(api: ExcalidrawImperativeAPI): string {
  return sceneHash(api.getSceneElementsIncludingDeleted(), api.getAppState());
}

export function serializeScene(api: ExcalidrawImperativeAPI): string {
  return serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
}
