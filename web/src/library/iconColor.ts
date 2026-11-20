// Recoloring SVG icons (stencils) on the canvas. Excalidraw can't color image elements, so we
// rewrite the SVG, store it as a new file and point the element at it. The original SVG is kept in
// the element's customData so "Original" can restore it and recoloring never compounds.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { recolorSvg, svgFromDataURL, svgToDataURL } from "../../../shared/recolor";

const ORIGINAL_KEY = "mydrawOriginalSvg";
const COLOR_KEY = "mydrawIconColor";
/** Larger originals are not stored (recoloring then works from the current version). */
const MAX_STORED_ORIGINAL = 256 * 1024;

export interface IconSelection {
  /** Selected SVG images that can be recolored. */
  count: number;
  /** Raster images in the selection (PNG/JPG) that can't be recolored. */
  raster: number;
  /** The shared color of the selected icons, "original" if none recolored, or null if mixed. */
  color: string | "original" | null;
}

export const NO_ICONS: IconSelection = { count: 0, raster: 0, color: null };

function isSvgFile(files: BinaryFiles, el: ExcalidrawImageElement): boolean {
  return !!el.fileId && files[el.fileId]?.mimeType === "image/svg+xml";
}

/** Summarise the selected images, for the color bar. */
export function iconSelection(
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
  files: BinaryFiles,
): IconSelection {
  let count = 0;
  let raster = 0;
  const colors = new Set<string>();
  for (const el of elements) {
    if (el.type !== "image" || el.isDeleted || !appState.selectedElementIds[el.id]) continue;
    if (isSvgFile(files, el)) {
      count++;
      colors.add((el.customData?.[COLOR_KEY] as string | undefined) ?? "original");
    } else if (el.fileId) {
      raster++;
    }
  }
  return { count, raster, color: colors.size === 1 ? [...colors][0] : null };
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Recolor the selected SVG icons to `color` (hex), or restore their original colors when `color`
 * is null. One undo step. Returns how many icons changed.
 */
export async function recolorSelectedIcons(api: ExcalidrawImperativeAPI, color: string | null): Promise<number> {
  const appState = api.getAppState();
  const files = api.getFiles();
  const all = api.getSceneElementsIncludingDeleted();
  const updates = new Map<string, ExcalidrawElement>();
  const newFiles = new Map<string, { id: FileId; dataURL: DataURL }>();

  for (const el of all) {
    if (el.type !== "image" || el.isDeleted || !appState.selectedElementIds[el.id] || !isSvgFile(files, el)) continue;
    const custom = { ...(el.customData ?? {}) };
    const original = (custom[ORIGINAL_KEY] as string | undefined) ?? svgFromDataURL(files[el.fileId!].dataURL);
    const svg = color ? recolorSvg(original, color) : original;
    const id = (await sha1Hex(svg)) as FileId;
    if (id !== el.fileId) newFiles.set(id, { id, dataURL: svgToDataURL(svg) as DataURL });

    if (color) {
      if (original.length <= MAX_STORED_ORIGINAL) custom[ORIGINAL_KEY] = original;
      custom[COLOR_KEY] = color;
    } else {
      delete custom[ORIGINAL_KEY];
      delete custom[COLOR_KEY];
    }
    updates.set(el.id, newElementWith(el, { fileId: id, status: "saved", customData: custom }));
  }
  if (!updates.size) return 0;

  const now = Date.now();
  api.addFiles(
    [...newFiles.values()].map((f) => ({ ...f, mimeType: "image/svg+xml" as const, created: now, lastRetrieved: now })),
  );
  api.updateScene({
    elements: all.map((el) => updates.get(el.id) ?? el),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return updates.size;
}
