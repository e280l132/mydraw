import { readMeta, withMeta, type DrawingMeta } from "../../shared/drawingMeta";
import { FONTS_KEY, remapFontFamilies } from "../../shared/fonts";
import { embeddedFontsFor, fontsReady, importEmbeddedFonts, prepareFonts } from "./fontRegistry";
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
  await fontsReady;
  const blob = new Blob([content], { type: "application/json" });
  const data = await loadFromBlob(blob, null, null);
  // Fonts carried by the drawing are registered before its text is measured or drawn.
  const remap = importEmbeddedFonts(fontsOf(content));
  return {
    elements: remapFontFamilies(data.elements, remap),
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

/** The drawing's "mydrawFonts" block (null when it has none or can't be parsed). */
function fontsOf(content: string): unknown {
  if (!content.includes(`"${FONTS_KEY}"`)) return null;
  try {
    return (JSON.parse(content) as Record<string, unknown>)[FONTS_KEY] ?? null;
  } catch {
    return null;
  }
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

/**
 * The drawing as `.excalidraw` JSON, with its meta and the fonts its text uses. Call
 * `prepareSerialize` first (async) so the font files are in memory; without it a font that was never
 * read yet is written by name only.
 */
export function serializeScene(api: ExcalidrawImperativeAPI): string {
  // The layout grid is an app preference, not part of the drawing: Excalidraw's grid mode is only
  // switched on for live snapping (web/src/useCanvasHook.ts), so files get Excalidraw's defaults.
  const elements = api.getSceneElements();
  const json = serializeAsJSON(elements, { ...api.getAppState(), ...FILE_GRID_STATE }, api.getFiles(), "local");
  return withMeta(json, getMeta(api), embeddedFontsFor(elements));
}

/** Load the font files `serializeScene` will embed. */
export function prepareSerialize(api: ExcalidrawImperativeAPI): Promise<void> {
  return prepareFonts(api.getSceneElements());
}
