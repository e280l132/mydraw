import { readMeta, withMeta, type DrawingMeta } from "../../shared/drawingMeta";
import { FILE_GRID_STATE } from "../../shared/grid";
import { getMeta } from "./drawingMeta";
import { hashElementsVersion, loadFromBlob, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { trueColorFiles } from "./library/trueColor";

export interface LoadedScene {
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
  /** History id and custom colors stored in the file (a fresh id when it has none). */
  meta: DrawingMeta;
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
    // SVG images keep their colors in dark mode (see library/trueColor.ts).
    files: trueColorFiles(data.files ?? {}),
    meta: readMeta(content),
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
  // The layout grid is an app preference, not part of the drawing: Excalidraw's grid mode is only
  // switched on for live snapping (web/src/useCanvasHook.ts), so files get Excalidraw's defaults.
  const json = serializeAsJSON(api.getSceneElements(), { ...api.getAppState(), ...FILE_GRID_STATE }, api.getFiles(), "local");
  return withMeta(json, getMeta(api));
}
