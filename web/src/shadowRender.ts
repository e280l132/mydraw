// Shadow draw hooks (see shared/shadow.ts). Excalidraw's per-element renderers are patched
// (scripts/excalidrawPatch.mjs, "shadows") to hand a shadowed element to these hooks, which call
// the original renderer back with the shadow set up around it. Installed on import; main.tsx imports
// this module before anything renders (the app and the headless CLI).
//
// Canvas (`renderElement`):
// - On screen an element is ONE drawImage of its cached element canvas, so the context's shadow
//   (shadowColor/Blur/OffsetX/Y) is set around the call. Canvas shadows ignore the transform, so the
//   values are scaled by the context's own scale (zoom x devicePixelRatio).
// - Exports (exportToCanvas: PNG/JPG/WebP/PPTX, thumbnails, presentation) draw fill, stroke and text
//   lines as separate calls, and a per-call shadow would land on the element itself. The element is
//   drawn into a layer canvas (same transform and filter) and the layer is drawn once with the shadow.
// - Dark mode: the canvas computes a shadow AFTER `ctx.filter`, so with the in-canvas theme
//   (canvasHook.ts) and dark exports the shadow color is exact. When Excalidraw's CSS filter darkens
//   the canvas instead (fallback), the color is pre-corrected with preDarkColor.
// SVG (`renderElementToSvg`: SVG, HTML, PDF exports): the element is rendered into its own <g>, which
// gets an feDropShadow filter (region in user space, so zero-height lines keep their shadow).
import { preDarkColor } from "../../shared/grid";
import { canShadow, contactEllipse, drawnBox, shadowExtent, shadowKind, shadowLayers, shadowOf, shadowOffset, shadowRgba, type Shadow, type ShadowBoxInput, type ShadowLayer } from "../../shared/shadow";
import { THEME_FILTER } from "./darkImages";
import { gradientOf, linearEnds, radialEnds, type Gradient } from "../../shared/gradient";

type El = ShadowBoxInput & { id: string; customData?: Record<string, unknown> | null };
type AnyFn = (...args: unknown[]) => unknown;
interface Hook {
  wants(el: El): boolean;
  run(fn: AnyFn, args: unknown[]): unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var __mydrawShadowRender: Hook | undefined;
  // eslint-disable-next-line no-var
  var __mydrawSvgShadow: Hook | undefined;
  // eslint-disable-next-line no-var
  var __mydrawShadowDraws: { screen: number; layer: number; svg: number; inner: number; contact: number; gradient: number } | undefined;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Biggest export layer we allocate (device px per side / area); beyond that the shadow is skipped. */
const MAX_SIDE = 16384;
const MAX_AREA = 64 * 1024 * 1024;

let busy = false;
const draws = (globalThis.__mydrawShadowDraws ??= { screen: 0, layer: 0, svg: 0, inner: 0, contact: 0, gradient: 0 });

/** The shadow to draw for `el`, or null (none, invalid, or invisible). */
function visibleShadow(el: El | null | undefined): Shadow | null {
  if (!el || !canShadow(el.type) || !el.customData?.mydrawShadow) return null;
  const s = shadowOf(el);
  return s && s.opacity > 0 && (s.blur > 0 || s.distance > 0) ? s : null;
}

const wants = (el: El) => !busy && (visibleShadow(el) !== null || gradientOf(el as never) !== null);

// ---------- gradient fills (shared/gradient.ts) ----------
// The element is drawn as a copy whose backgroundColor is SENTINEL. roughjs sets `ctx.fillStyle = fill`
// (canvas) or `fill="<fill>"` (SVG); on canvas a one-time wrap of the fillStyle setter swaps the sentinel
// for a gradient while `painting` is set; in SVG the attribute is rewritten afterwards. roughjs draws
// in element-local coordinates (0..width, 0..height), so the gradient's ends are in those too.
// The copy is memoised per element object so Excalidraw's per-element caches (shape, element canvas) hit.
const SENTINEL = "#fe01fd";
// Excalidraw also changes elements IN PLACE while dragging or resizing (`mutateElement`: same object,
// new x/y/size, new versionNonce), so the copy is rebuilt whenever the nonce moves; otherwise a moved
// gradient shape would keep being drawn where it was.
type Versioned = El & { versionNonce?: number; version?: number };
const clones = new WeakMap<object, { nonce: number | undefined; version: number | undefined; copy: El }>();
const cloneFor = (el: El): El => {
  const v = el as Versioned;
  const hit = clones.get(el);
  if (hit && hit.nonce === v.versionNonce && hit.version === v.version) return hit.copy;
  const copy = { ...el, backgroundColor: SENTINEL } as El;
  clones.set(el, { nonce: v.versionNonce, version: v.version, copy });
  return copy;
};
let painting: { g: Gradient; w: number; h: number } | null = null;

function canvasGradient(ctx: CanvasRenderingContext2D, p: { g: Gradient; w: number; h: number }): CanvasGradient {
  const { g, w, h } = p;
  let grad: CanvasGradient;
  if (g.kind === "radial") {
    const r = radialEnds(w, h);
    grad = ctx.createRadialGradient(r.cx, r.cy, 0, r.cx, r.cy, r.r);
  } else {
    const e = linearEnds(g, w, h);
    grad = ctx.createLinearGradient(e.x1, e.y1, e.x2, e.y2);
  }
  grad.addColorStop(0, g.from);
  grad.addColorStop(1, g.to);
  draws.gradient++;
  return grad;
}

(function wrapFillStyle() {
  const proto = CanvasRenderingContext2D.prototype as CanvasRenderingContext2D & { __mydrawGradientWrap?: boolean };
  if (proto.__mydrawGradientWrap) return;
  const d = Object.getOwnPropertyDescriptor(proto, "fillStyle");
  if (!d?.set || !d.get) return;
  const set = d.set;
  Object.defineProperty(proto, "fillStyle", {
    ...d,
    set(this: CanvasRenderingContext2D, v: string | CanvasGradient | CanvasPattern) {
      set.call(this, painting && typeof v === "string" && v.toLowerCase() === SENTINEL ? canvasGradient(this, painting) : v);
    },
  });
  proto.__mydrawGradientWrap = true;
})();

/** Rewrite the sentinel fills Excalidraw put into `g` to a gradient defined in `g`. */
function svgGradient(doc: Document, g: Element, el: El, grad: Gradient) {
  const fills = [...g.querySelectorAll(`[fill="${SENTINEL}"]`)];
  if (!fills.length) return;
  const id = `md-gr-${safeId(el.id)}`;
  const def =
    grad.kind === "radial"
      ? (() => {
          const r = radialEnds(el.width, el.height);
          return fe(doc, g, "radialGradient", { id, gradientUnits: "userSpaceOnUse", cx: r.cx, cy: r.cy, r: r.r });
        })()
      : (() => {
          const e = linearEnds(grad, el.width, el.height);
          return fe(doc, g, "linearGradient", { id, gradientUnits: "userSpaceOnUse", ...e });
        })();
  fe(doc, def, "stop", { offset: 0, "stop-color": grad.from });
  fe(doc, def, "stop", { offset: 1, "stop-color": grad.to });
  g.insertBefore(def, g.firstChild);
  for (const f of fills) f.setAttribute("fill", `url(#${id})`);
  draws.gradient++;
}

function setShadow(ctx: CanvasRenderingContext2D, s: Shadow, k: number, color: string) {
  const { dx, dy } = shadowOffset(s, k);
  ctx.shadowColor = shadowRgba(color, s.opacity);
  ctx.shadowBlur = s.blur * k;
  ctx.shadowOffsetX = dx;
  ctx.shadowOffsetY = dy;
}

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

type RenderConfig = { isExporting?: boolean };
type AppState = { theme?: string; scrollX: number; scrollY: number };
type Rough = { constructor: new (canvas: HTMLCanvasElement) => unknown };

/**
 * Shadow-only copies: draw far off to the right (nothing visible lands on the canvas) with the shadow
 * offset pulled back by the same amount, so only the shadow shows. Device px.
 */
const offShift = (ctx: CanvasRenderingContext2D) => ctx.canvas.width * 2 + 4096;

function setLayer(ctx: CanvasRenderingContext2D, l: ShadowLayer, k: number, color: string, shiftX: number) {
  ctx.shadowColor = shadowRgba(color, l.opacity);
  ctx.shadowBlur = l.blur * k;
  ctx.shadowOffsetX = l.dx * k + shiftX;
  ctx.shadowOffsetY = l.dy * k;
}

/** Contact shadow: a radial-gradient ellipse under the element's box (current transform = scene). */
function drawContact(ctx: CanvasRenderingContext2D, el: El, s: Shadow, color: string, scrollX: number, scrollY: number) {
  const e = contactEllipse(s, el);
  ctx.save();
  // A fill (unlike a canvas shadow) goes through ctx.filter: keep the in-canvas dark theme off it, so the
  // color is exact like the other shadows (under Excalidraw's CSS filter it was pre-corrected).
  ctx.filter = "none";
  ctx.translate(e.cx + scrollX, e.cy + scrollY);
  ctx.scale(e.rx, e.ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const soft = Math.min(0.9, 0.25 + s.blur / 60);
  g.addColorStop(0, shadowRgba(color, s.opacity));
  g.addColorStop(1 - soft, shadowRgba(color, s.opacity * 0.6));
  g.addColorStop(1, shadowRgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  draws.contact++;
}

/**
 * Inner shadow on a layer holding the element (device px): a mask that is opaque everywhere except
 * the element casts the shadow, kept only where the element is (source-atop).
 */
function innerShadow(layer: HTMLCanvasElement, s: Shadow, k: number, color: string) {
  const mask = document.createElement("canvas");
  mask.width = layer.width;
  mask.height = layer.height;
  const m = mask.getContext("2d")!;
  m.fillStyle = "#000";
  m.fillRect(0, 0, mask.width, mask.height);
  m.globalCompositeOperation = "destination-out";
  m.drawImage(layer, 0, 0);
  const l = layer.getContext("2d")!;
  l.save();
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.filter = "none";
  l.globalAlpha = 1;
  l.globalCompositeOperation = "source-atop";
  const shift = offShift(l);
  const { dx, dy } = shadowOffset(s);
  setLayer(l, { dx, dy, blur: s.blur, opacity: s.opacity }, k, color, shift);
  l.drawImage(mask, -shift, 0);
  l.restore();
  draws.inner++;
}

globalThis.__mydrawShadowRender = {
  wants,
  run(fnIn, argsIn) {
    const el0 = argsIn[0] as El;
    const grad = gradientOf(el0 as never);
    // A gradient fill: draw the sentinel copy with `painting` set (see above).
    const args = grad ? [cloneFor(el0), ...argsIn.slice(1)] : argsIn;
    const fn: AnyFn = grad
      ? (...a) => {
          const prev = painting;
          painting = { g: grad, w: el0.width, h: el0.height };
          try {
            return fnIn(...a);
          } finally {
            painting = prev;
          }
        }
      : fnIn;
    const sh = visibleShadow(el0);
    if (!sh) {
      busy = true;
      try {
        return fn(...args);
      } finally {
        busy = false;
      }
    }
    const [el, , , rc, ctx, renderConfig, appState] = args as [El, unknown, unknown, Rough, CanvasRenderingContext2D, RenderConfig, AppState];
    const s = sh;
    const kind = shadowKind(s);
    const m = ctx.getTransform();
    const k = Math.hypot(m.a, m.b) || 1;
    // Under Excalidraw's CSS dark filter the whole canvas is inverted afterwards: pre-correct.
    const color = appState.theme === "dark" && ctx.filter !== THEME_FILTER ? preDarkColor(s.color) : s.color;
    const layers = shadowLayers(s);
    busy = true;
    try {
      if (kind === "contact") drawContact(ctx, el, s, color, appState.scrollX, appState.scrollY);
      if (!renderConfig.isExporting && kind !== "inner") {
        // On screen an element is one drawImage of its cached canvas: shadows go around that call.
        if (kind === "contact") return fn(...args);
        if (layers.length === 1) {
          setShadow(ctx, s, k, color);
          try {
            return fn(...args);
          } finally {
            clearShadow(ctx);
            draws.screen++;
          }
        }
        // Several layers: shadow-only copies drawn off-canvas (translated in scene units), then the element.
        const shift = offShift(ctx);
        for (const l of layers) {
          ctx.save();
          ctx.translate(shift / k, 0);
          setLayer(ctx, l, k, color, -shift);
          try {
            fn(...args);
          } finally {
            ctx.restore();
          }
        }
        draws.screen++;
        return fn(...args);
      }
      // Exports (and inner shadows on screen): draw into a layer covering the element (+ its shadow),
      // then composite it with the shadow(s).
      const b = drawnBox(el);
      const pts = [
        [b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height],
      ].map(([x, y]) => m.transformPoint(new DOMPoint(x + appState.scrollX, y + appState.scrollY)));
      const pad = kind === "inner" ? 0 : shadowExtent(s) * k;
      const cw = ctx.canvas.width, ch = ctx.canvas.height;
      const x0 = Math.max(-pad, Math.floor(Math.min(...pts.map((p) => p.x))));
      const y0 = Math.max(-pad, Math.floor(Math.min(...pts.map((p) => p.y))));
      const x1 = Math.min(cw + pad, Math.ceil(Math.max(...pts.map((p) => p.x))));
      const y1 = Math.min(ch + pad, Math.ceil(Math.max(...pts.map((p) => p.y))));
      const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
      if (w <= 0 || h <= 0) return undefined;
      if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_AREA) return fn(...args); // too big: no shadow
      const layer = document.createElement("canvas");
      layer.width = w;
      layer.height = h;
      const lctx = layer.getContext("2d")!;
      lctx.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
      lctx.filter = ctx.filter;
      lctx.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
      const lrc = new rc.constructor(layer);
      const out = fn(el, args[1], args[2], lrc, lctx, renderConfig, appState);
      if (kind === "inner") innerShadow(layer, s, k, color);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = "none"; // the layer is already filtered
      ctx.globalAlpha = 1; // and already carries the element's opacity
      if (layers.length) {
        const shift = offShift(ctx);
        for (const l of layers) {
          setLayer(ctx, l, k, color, shift);
          ctx.drawImage(layer, x0 - shift, y0);
        }
        clearShadow(ctx);
      }
      ctx.drawImage(layer, x0, y0);
      ctx.restore();
      draws.layer++;
      return out;
    } finally {
      busy = false;
    }
  },
};

/** Filter / element ids must be safe inside `url(#…)` and a selector. */
const safeId = (id: string) => id.replace(/[^\w-]/g, "_");

const fe = (doc: Document, parent: Element, tag: string, attrs: Record<string, string | number>) => {
  const n = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent.appendChild(n);
  return n;
};

/**
 * Filter primitives for layered / extrude / inner / contact shadows. Each plain layer = the element's
 * alpha, blurred, offset and colored; all merged under the element. Inner = the inverted alpha's
 * shadow, kept inside the element, merged on top of it. Contact draws a separate ellipse: the filter
 * only passes the element through.
 */
function buildFilter(doc: Document, filter: Element, s: Shadow, color: string) {
  const kind = shadowKind(s);
  const merge: string[] = [];
  if (kind === "inner") {
    const { dx, dy } = shadowOffset(s);
    const inv = fe(doc, filter, "feComponentTransfer", { in: "SourceAlpha", result: "inv" });
    fe(doc, inv, "feFuncA", { type: "table", tableValues: "1 0" });
    fe(doc, filter, "feGaussianBlur", { in: "inv", stdDeviation: s.blur / 2, result: "invb" });
    fe(doc, filter, "feOffset", { in: "invb", dx, dy, result: "invo" });
    fe(doc, filter, "feFlood", { "flood-color": color, "flood-opacity": s.opacity, result: "ic" });
    fe(doc, filter, "feComposite", { in: "ic", in2: "invo", operator: "in", result: "ish" });
    fe(doc, filter, "feComposite", { in: "ish", in2: "SourceAlpha", operator: "in", result: "inner" });
    merge.push("SourceGraphic", "inner");
  } else {
    shadowLayers(s).forEach((l, i) => {
      fe(doc, filter, "feGaussianBlur", { in: "SourceAlpha", stdDeviation: l.blur / 2, result: `b${i}` });
      fe(doc, filter, "feOffset", { in: `b${i}`, dx: l.dx, dy: l.dy, result: `o${i}` });
      fe(doc, filter, "feFlood", { "flood-color": color, "flood-opacity": l.opacity, result: `c${i}` });
      fe(doc, filter, "feComposite", { in: `c${i}`, in2: `o${i}`, operator: "in", result: `s${i}` });
      merge.push(`s${i}`);
    });
    merge.push("SourceGraphic");
  }
  const m = fe(doc, filter, "feMerge", {});
  for (const r of merge) fe(doc, m, "feMergeNode", { in: r });
}

/** Contact shadow: an ellipse with a radial gradient, under the element. */
function contactSvg(doc: Document, el: El, s: Shadow, color: string, offsetX: number, offsetY: number): SVGElement {
  const e = contactEllipse(s, el);
  const id = `md-gs-${safeId(el.id)}`;
  const g = doc.createElementNS(SVG_NS, "g");
  const grad = fe(doc, g, "radialGradient", { id });
  const soft = Math.min(0.9, 0.25 + s.blur / 60);
  fe(doc, grad, "stop", { offset: 0, "stop-color": color, "stop-opacity": s.opacity });
  fe(doc, grad, "stop", { offset: 1 - soft, "stop-color": color, "stop-opacity": s.opacity * 0.6 });
  fe(doc, grad, "stop", { offset: 1, "stop-color": color, "stop-opacity": 0 });
  fe(doc, g, "ellipse", { cx: e.cx + offsetX, cy: e.cy + offsetY, rx: e.rx, ry: e.ry, fill: `url(#${id})` });
  draws.contact++;
  return g;
}

globalThis.__mydrawSvgShadow = {
  wants,
  run(fn, args) {
    const [el, elementsMap, rsvg, svgRoot, files, offsetX, offsetY, renderConfig] = args as [El, unknown, unknown, SVGElement, unknown, number, number, { exportWithDarkMode?: boolean }];
    const grad = gradientOf(el as never);
    const doc = svgRoot.ownerDocument;
    const g = doc.createElementNS(SVG_NS, "g");
    busy = true;
    let out: unknown;
    try {
      out = fn(grad ? cloneFor(el) : el, elementsMap, rsvg, g, files, offsetX, offsetY, renderConfig);
    } finally {
      busy = false;
    }
    if (!g.childNodes.length) return out;
    if (grad) svgGradient(doc, g, el, grad);
    const sh = visibleShadow(el);
    if (!sh) {
      svgRoot.appendChild(g);
      return out;
    }
    const s = sh;
    // Image symbols were put into our <g>: move them where Excalidraw keeps them (or drop duplicates).
    const top = (svgRoot as SVGElement & { ownerSVGElement: SVGSVGElement | null }).ownerSVGElement ?? svgRoot;
    for (const sym of [...g.querySelectorAll("symbol")]) {
      const dup = sym.id && [...top.querySelectorAll("symbol")].some((o) => o !== sym && o.id === sym.id);
      if (dup) sym.remove();
      else (top.querySelector("defs") ?? top).prepend(sym);
    }
    const color = renderConfig.exportWithDarkMode ? preDarkColor(s.color) : s.color;
    const { dx, dy } = shadowOffset(s);
    const b = drawnBox(el);
    const ext = shadowExtent(s);
    const id = `md-sh-${safeId(el.id)}`;
    const filter = doc.createElementNS(SVG_NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("x", `${b.x + offsetX - ext}`);
    filter.setAttribute("y", `${b.y + offsetY - ext}`);
    filter.setAttribute("width", `${b.width + 2 * ext}`);
    filter.setAttribute("height", `${b.height + 2 * ext}`);
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const kind = shadowKind(s);
    if (kind === "drop") {
      const drop = doc.createElementNS(SVG_NS, "feDropShadow");
      drop.setAttribute("dx", `${dx}`);
      drop.setAttribute("dy", `${dy}`);
      drop.setAttribute("stdDeviation", `${s.blur / 2}`);
      drop.setAttribute("flood-color", color);
      drop.setAttribute("flood-opacity", `${s.opacity}`);
      filter.appendChild(drop);
    } else {
      buildFilter(doc, filter, s, color);
    }
    if (kind === "contact") svgRoot.appendChild(contactSvg(doc, el, s, color, offsetX, offsetY));
    g.setAttribute("filter", `url(#${id})`);
    svgRoot.appendChild(filter);
    svgRoot.appendChild(g);
    draws.svg++;
    return out;
  },
};
