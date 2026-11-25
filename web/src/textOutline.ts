// Text outline (see shared/textOutline.ts). Two parts:
// 1. Draw hooks called by Excalidraw's patched text renderers (scripts/excalidrawPatch.mjs): the
//    canvas one strokes every line before Excalidraw fills it, the SVG one adds a stroke painted
//    under the fill (`paint-order: stroke`). Installed on import; main.tsx imports this module before
//    anything renders (the app and the headless CLI).
// 2. Panel helpers: which text an outline reaches and the one-undo-step change.
import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { drawnOutlineWidth, OUTLINE_DEFAULT_WIDTH, outlineOf, withOutline, type TextOutline } from "../../shared/textOutline";
import { fontSizeTargets } from "./fontSizeOps";
import { commitElements, replaceQuietly } from "./uiActions";
import type { El } from "./agent/sceneOps";

type OutlinedText = { customData?: Record<string, unknown> | null; fontSize: number };

declare global {
  // eslint-disable-next-line no-var
  var __mydrawTextOutline: ((ctx: CanvasRenderingContext2D, el: OutlinedText, lines: string[], x: number, lineHeight: number, offset: number) => void) | undefined;
  // eslint-disable-next-line no-var
  var __mydrawSvgTextOutline: ((node: SVGElement, el: OutlinedText) => void) | undefined;
  // eslint-disable-next-line no-var
  var __mydrawTextOutlineDraws: number | undefined;
}

globalThis.__mydrawTextOutline = (ctx, el, lines, x, lineHeight, offset) => {
  const o = outlineOf(el);
  if (!o) return;
  const w = drawnOutlineWidth(o, el.fontSize);
  if (w <= 0) return;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.lineWidth = w * 2; // half of the stroke lies under the fill
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  for (let i = 0; i < lines.length; i++) ctx.strokeText(lines[i], x, i * lineHeight + offset);
  ctx.restore();
  globalThis.__mydrawTextOutlineDraws = (globalThis.__mydrawTextOutlineDraws ?? 0) + 1;
};

globalThis.__mydrawSvgTextOutline = (node, el) => {
  const o = outlineOf(el);
  if (!o) return;
  const w = drawnOutlineWidth(o, el.fontSize);
  if (w <= 0) return;
  node.setAttribute("stroke", o.color);
  node.setAttribute("stroke-width", `${w * 2}`);
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("paint-order", "stroke");
};

/** Text an outline reaches: selected text, labels of selected shapes/arrows, and the text being edited. */
export function outlineTargets(api: ExcalidrawImperativeAPI): El[] {
  const out = new Map(fontSizeTargets(api).map((e) => [e.id, e]));
  const editing = api.getAppState().editingTextElement;
  if (editing) {
    const live = api.getSceneElements().find((e) => e.id === editing.id);
    if (live && live.type === "text" && !live.locked) out.set(live.id, live as unknown as El);
  }
  return [...out.values()];
}

/** Set (null = remove) the outline of `texts`, keeping each one's width unless `width` is given. One undo step. */
export function setTextOutline(api: ExcalidrawImperativeAPI, texts: readonly El[], patch: { color?: string; width?: number } | null): number {
  const changed: ExcalidrawElement[] = [];
  for (const t of texts) {
    const cur = outlineOf(t as unknown as OutlinedText);
    let next: TextOutline | null = null;
    if (patch) {
      const color = patch.color ?? cur?.color;
      if (!color) continue; // a width alone does nothing on text without an outline
      next = { color, width: patch.width ?? cur?.width ?? OUTLINE_DEFAULT_WIDTH };
    }
    if ((cur?.color ?? null) === (next?.color ?? null) && (cur?.width ?? null) === (next?.width ?? null)) continue;
    const customData = withOutline((t as unknown as OutlinedText).customData, next);
    changed.push(newElementWith(t as unknown as ExcalidrawElement, { customData } as never));
  }
  if (changed.length) commitElements(api, changed);
  return changed.length;
}

/**
 * Width slider: preview `width` on `originals` (the texts as they were when the drag began) without
 * an undo entry. Text without an outline is left alone.
 */
export function previewOutlineWidth(api: ExcalidrawImperativeAPI, originals: readonly El[], width: number) {
  const els: ExcalidrawElement[] = [];
  for (const t of originals) {
    const o = outlineOf(t as unknown as OutlinedText);
    if (o) els.push(newElementWith(t as unknown as ExcalidrawElement, { customData: withOutline((t as unknown as OutlinedText).customData, { ...o, width }) } as never));
  }
  replaceQuietly(api, els);
}

/** End of a slider drag: put the originals back (no undo entry), then commit `width` as ONE undo step. */
export function commitOutlineWidth(api: ExcalidrawImperativeAPI, originals: readonly El[], width: number) {
  const live = new Map(api.getSceneElements().map((e) => [e.id, e]));
  // Same pattern as IconRecolorSession: restore the pre-drag elements quietly, so the commit is one step.
  replaceQuietly(api, originals.filter((t) => live.has(t.id)) as unknown as ExcalidrawElement[]);
  return setTextOutline(api, originals, { width });
}
