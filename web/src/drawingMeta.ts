// The per-drawing meta (history id, custom colors) of each open drawing, kept beside its
// Excalidraw API object and written into the file by `serializeScene` (see shared/drawingMeta.ts).
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { addToPalette, emptyMeta, newHistoryId, type DrawingMeta } from "../../shared/drawingMeta";

const metas = new WeakMap<ExcalidrawImperativeAPI, DrawingMeta>();

export function getMeta(api: ExcalidrawImperativeAPI): DrawingMeta {
  let m = metas.get(api);
  if (!m) {
    m = emptyMeta();
    metas.set(api, m);
  }
  return m;
}

export function setMeta(api: ExcalidrawImperativeAPI, meta: DrawingMeta): void {
  metas.set(api, { id: meta.id, palette: [...meta.palette] });
}

/** Remember a custom color in this drawing (newest first). Saved with the next save. */
export function addDrawingColor(api: ExcalidrawImperativeAPI, hex: string): string[] {
  const m = getMeta(api);
  m.palette = addToPalette(m.palette, hex);
  return m.palette;
}

/** Give a drawing a new history id: used by Save As, so the copy starts its own history. */
export function forkHistory(api: ExcalidrawImperativeAPI): void {
  getMeta(api).id = newHistoryId();
}
