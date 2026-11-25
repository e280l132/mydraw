// Hand-drawn version of an SVG icon (shared/sketchSvg.ts does the drawing). The icon is mounted in a
// hidden shadow root, so the browser resolves its styling (classes, <style> blocks, inheritance,
// currentColor, transforms) and its <style> can't leak into the app. Each visible shape is then
// replaced by a <g> that keeps the shape's other attributes (transform, clip-path, opacity, class)
// and holds roughjs paths with the computed colours as inline styles. Structure, defs, gradients,
// clip paths, text and <use> stay as they were.
import {
  ellipsePath,
  grainFilter,
  type IconSketch,
  polyPath,
  prefersWobble,
  rectPath,
  sketchMarkup,
  sketchShape,
  wobbleSvg,
} from "../../../shared/sketchSvg";
import { sketchKey } from "../../../shared/iconSketch";
import { ensureSvgSize, svgToDataURL } from "../../../shared/recolor";

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
/** Shapes inside these are templates, not drawn where they are. */
const NOT_DRAWN = new Set(["defs", "clipPath", "mask", "symbol", "pattern", "marker", "linearGradient", "radialGradient", "filter"]);
const GEOMETRY_ATTRS = new Set(["d", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "points", "pathLength", "fill", "stroke", "stroke-width"]);

/** Insert size of an icon: same rule as stencilContent's iconDimensions (height 64, wide logos wider). */
function displaySize(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const w = parseFloat(root.match(/\swidth\s*=\s*["']\s*([\d.]+)/i)?.[1] ?? "64") || 64;
  const h = parseFloat(root.match(/\sheight\s*=\s*["']\s*([\d.]+)/i)?.[1] ?? "64") || 64;
  return fitIcon(w, h);
}

function fitIcon(w: number, h: number): { width: number; height: number } {
  const aspect = w / h || 1;
  if (aspect <= 1) return { width: 64 * aspect, height: 64 };
  const width = Math.min(64 * aspect, 160);
  return { width, height: width / aspect };
}

function num(el: Element, name: string): number {
  return parseFloat(el.getAttribute(name) ?? "0") || 0;
}

function geometry(el: Element): string {
  switch (el.localName) {
    case "path":
      return el.getAttribute("d") ?? "";
    case "rect": {
      const rx = el.getAttribute("rx");
      const ry = el.getAttribute("ry");
      const rxN = rx != null ? num(el, "rx") : ry != null ? num(el, "ry") : 0;
      const ryN = ry != null ? num(el, "ry") : rxN;
      return rectPath(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), rxN, ryN);
    }
    case "circle":
      return ellipsePath(num(el, "cx"), num(el, "cy"), num(el, "r"), num(el, "r"));
    case "ellipse":
      return ellipsePath(num(el, "cx"), num(el, "cy"), num(el, "rx"), num(el, "ry"));
    case "line":
      return `M${num(el, "x1")} ${num(el, "y1")}L${num(el, "x2")} ${num(el, "y2")}`;
    case "polyline":
      return polyPath(el.getAttribute("points") ?? "", false);
    case "polygon":
      return polyPath(el.getAttribute("points") ?? "", true);
  }
  return "";
}

function isTemplate(el: Element): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (NOT_DRAWN.has(p.localName)) return true;
  return false;
}

const paint = (v: string) => (!v || v === "none" || v === "rgba(0, 0, 0, 0)" ? null : v);

/** Redraw an SVG icon by hand, shape by shape (or wobble it when that would be slow / unreadable). */
export function sketchSvgDocument(svgText: string, sketch: IconSketch): string {
  const svg = ensureSvgSize(svgText);
  const size = displaySize(svg);
  if (sketch.mode === "wobble" || prefersWobble(svg)) return wobbleSvg(svgToDataURL(svg), size.width, size.height, sketch);

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const src = parsed.documentElement;
  if (src.localName !== "svg" || parsed.getElementsByTagName("parsererror").length) {
    return wobbleSvg(svgToDataURL(svg), size.width, size.height, sketch);
  }

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  const root = document.importNode(src, true) as unknown as SVGSVGElement;
  root.style.width = `${size.width}px`;
  root.style.height = `${size.height}px`;
  shadow.appendChild(root);
  document.body.appendChild(host);
  try {
    const rootCtm = root.getScreenCTM();
    const shapes = [...root.querySelectorAll("*")].filter((el) => SHAPES.has(el.localName) && !isTemplate(el)) as SVGGraphicsElement[];
    let index = 0;
    // Measure every shape before replacing any.
    const jobs = shapes.map((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
      const ctm = el.getScreenCTM();
      let scale = ctm ? Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) : 0;
      if (!(scale > 0) && rootCtm) scale = Math.sqrt(Math.abs(rootCtm.a * rootCtm.d - rootCtm.b * rootCtm.c));
      return {
        el,
        input: {
          d: geometry(el),
          fill: el.localName === "line" || el.localName === "polyline" ? null : paint(cs.fill),
          stroke: paint(cs.stroke),
          strokeWidth: parseFloat(cs.strokeWidth) || 1,
          scale,
        },
        fillRule: cs.fillRule === "evenodd" ? "evenodd" : undefined,
      };
    });
    for (const job of jobs) {
      if (!job) continue;
      const paths = sketchShape(job.input, sketch, index++);
      const g = document.createElementNS(SVG_NS, "g");
      for (const a of [...job.el.attributes]) if (!GEOMETRY_ATTRS.has(a.name)) g.setAttribute(a.name, a.value);
      // The shape's own style may set fill/stroke for its children; ours are inline on each path.
      g.innerHTML = paths.length ? sketchMarkup(paths, job.input.scale, job.fillRule, sketch.texture) : "";
      job.el.replaceWith(g);
    }
    const grain = grainFilter(sketch.texture);
    if (grain) {
      const defs = document.createElementNS(SVG_NS, "defs");
      defs.innerHTML = grain;
      root.insertBefore(defs, root.firstChild);
    }
    root.style.removeProperty("width");
    root.style.removeProperty("height");
    if (!root.getAttribute("style")) root.removeAttribute("style");
    return ensureSvgSize(new XMLSerializer().serializeToString(root));
  } finally {
    host.remove();
  }
}

/** Hand-drawn version of a PNG (or other raster) icon: the image, wobbled. */
export async function sketchRasterDataURL(dataURL: string, sketch: IconSketch): Promise<string> {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  const size = fitIcon(img.naturalWidth || 64, img.naturalHeight || 64);
  return wobbleSvg(dataURL, size.width, size.height, sketch);
}

const cache = new Map<string, string>();
const CACHE_MAX = 300;

/** Cached `sketchSvgDocument` (the same icon is inserted again and again). */
export function sketchSvgCached(svgText: string, sketch: IconSketch): string {
  const key = `${sketchKey(sketch)}|${svgText}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const out = sketchSvgDocument(svgText, sketch);
  cache.set(key, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return out;
}
