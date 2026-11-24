// "Pick color from canvas": find the element under a point and read its real color (not screen
// pixels, which are inverted in dark mode).
import { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { normalizeHex } from "../../../shared/colorMath";
import { dominantSvgColor, isNearWhite, svgFromDataURL } from "../../../shared/recolor";
import { isSvgDataURL } from "./trueColor";

const LINEAR = new Set(["arrow", "line", "freedraw"]);

/**
 * Topmost element under a scene point. Bound text resolves to its container; lines/arrows only if
 * nothing else is hit. With `labels` (the eyedropper) the text itself is returned when the point is
 * on a label, so its own color can be read (a label's color often differs from its shape's).
 */
export function elementAt(api: ExcalidrawImperativeAPI, x: number, y: number, opts: { labels?: boolean } = {}): ExcalidrawElement | null {
  const elements = api.getSceneElements();
  const byId = new Map(elements.map((e) => [e.id, e]));
  const inside = (el: ExcalidrawElement, pad = 0) => {
    const [x1, y1, x2, y2] = getCommonBounds([el]);
    return x >= x1 - pad && x <= x2 + pad && y >= y1 - pad && y <= y2 + pad;
  };
  const tol = 8 / api.getAppState().zoom.value;
  let linear: ExcalidrawElement | null = null;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.type === "frame" || el.type === "magicframe" || el.type === "selection") continue;
    if (LINEAR.has(el.type)) {
      // Half the stroke is drawn on each side of the path: a thick arrow is wider than 4 units.
      if (!linear && inside(el, Math.max(4, el.strokeWidth / 2 + tol))) linear = el;
      continue;
    }
    // A thick stroke is drawn half outside the box; sketchy lines wobble a little more.
    // Text gets the same pointer slack: the box hugs the glyphs, so a click on a letter's edge can land just outside.
    if (!inside(el, isHollowShape(el) ? el.strokeWidth / 2 + tol : el.type === "text" ? tol : 0)) continue;
    // Shapes without a fill are only "there" along their outline, like Excalidraw's own selection.
    if (isHollowShape(el) && !nearOutline(el, x, y, tol)) continue;
    if (el.type === "text" && el.containerId && byId.has(el.containerId) && !opts.labels) return byId.get(el.containerId)!;
    return el;
  }
  return linear;
}

function isHollowShape(el: ExcalidrawElement): boolean {
  return (
    (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") &&
    (!el.backgroundColor || el.backgroundColor === "transparent")
  );
}

/** Is (x, y) within `tol` of the shape's outline? (Rotation is ignored; good enough for picking.) */
function nearOutline(el: ExcalidrawElement, x: number, y: number, tol: number): boolean {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const a = Math.max(el.width / 2, 1);
  const b = Math.max(el.height / 2, 1);
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  // Half the stroke on each side of the ideal outline, plus the pointer slack.
  const t = tol + el.strokeWidth / 2;
  if (el.type === "ellipse") {
    const r = Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
    return Math.abs(r - 1) * Math.min(a, b) <= t;
  }
  if (el.type === "diamond") {
    const r = dx / a + dy / b;
    return Math.abs(r - 1) * Math.min(a, b) <= t;
  }
  // Rectangle: distance to the nearest edge, on either side of it (absolute, so the outer half counts).
  return Math.abs(Math.min(a - dx, b - dy)) <= t;
}

/** Most common non-white, opaque color of a raster image (quantised), as #rrggbb. */
async function dominantRasterColor(dataURL: string): Promise<string | null> {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 128 || (r > 235 && g > 235 && b > 235)) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bk = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bk.n++;
    bk.r += r;
    bk.g += g;
    bk.b += b;
    buckets.set(key, bk);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bk of buckets.values()) if (!best || bk.n > best.n) best = bk;
  if (!best) return null;
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}

/** The color that best represents an element, or null if it has none (e.g. a white-only icon). */
export async function colorOfElement(api: ExcalidrawImperativeAPI, el: ExcalidrawElement): Promise<string | null> {
  if (el.type === "image") {
    const recolored = el.customData?.mydrawIconColor;
    if (typeof recolored === "string" && normalizeHex(recolored)) return normalizeHex(recolored);
    const file = el.fileId ? api.getFiles()[el.fileId] : undefined;
    if (!file) return null;
    if (isSvgDataURL(file.dataURL)) return dominantSvgColor(svgFromDataURL(file.dataURL));
    return dominantRasterColor(file.dataURL);
  }
  // Shapes: the fill if there is one, otherwise the outline. Text/lines: their color.
  const bg = "backgroundColor" in el ? el.backgroundColor : "transparent";
  const candidates = [bg, el.strokeColor].filter((c) => c && c !== "transparent");
  for (const c of candidates) {
    const hex = normalizeHex(c);
    if (hex && !(candidates.length > 1 && isNearWhite(hex))) return hex;
  }
  return candidates.length ? normalizeHex(candidates[0]) : null;
}
