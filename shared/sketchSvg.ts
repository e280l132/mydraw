// Hand-drawn icons. A "sketched" icon is another rendering of the same SVG (like a recolor): every
// shape's outline and fill is redrawn by roughjs, or, for raster icons and SVGs too complex to
// redraw, the whole picture is wobbled by an SVG displacement filter. The result is a new SVG file;
// the element keeps the original in customData (web/src/library/iconColor.ts), so switching back is
// exact and sketches never compound. Pure: the DOM walk that finds shapes and their computed colours
// lives in web/src/library/sketchIcon.ts.
import { RoughGenerator } from "roughjs/bin/generator";
import { absolutize, normalize, parsePath, serialize } from "path-data-parser";

export * from "./iconSketch";
import type { IconSketch } from "./iconSketch";

// ---------- path geometry ----------

/** Scale every coordinate of path data by `s` (arcs keep their angle and flags). */
export function scalePathData(d: string, s: number): string {
  const segs = normalize(absolutize(parsePath(d)));
  return serialize(segs.map((seg) => ({ key: seg.key, data: seg.data.map((n) => n * s) })));
}

/** Bounding box of path data (control points included: a slight overestimate, fine here). */
export function pathBox(d: string): { w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const seg of normalize(absolutize(parsePath(d)))) {
    for (let i = 0; i + 1 < seg.data.length; i += 2) {
      minX = Math.min(minX, seg.data[i]);
      maxX = Math.max(maxX, seg.data[i]);
      minY = Math.min(minY, seg.data[i + 1]);
      maxY = Math.max(maxY, seg.data[i + 1]);
    }
  }
  return Number.isFinite(minX) ? { w: maxX - minX, h: maxY - minY } : null;
}

const r = (n: number) => Math.round(n * 1000) / 1000;

export function rectPath(x: number, y: number, w: number, h: number, rx = 0, ry = rx): string {
  rx = Math.min(Math.max(0, rx), w / 2);
  ry = Math.min(Math.max(0, ry), h / 2);
  if (!rx || !ry) return `M${r(x)} ${r(y)}H${r(x + w)}V${r(y + h)}H${r(x)}Z`;
  return (
    `M${r(x + rx)} ${r(y)}H${r(x + w - rx)}A${r(rx)} ${r(ry)} 0 0 1 ${r(x + w)} ${r(y + ry)}` +
    `V${r(y + h - ry)}A${r(rx)} ${r(ry)} 0 0 1 ${r(x + w - rx)} ${r(y + h)}` +
    `H${r(x + rx)}A${r(rx)} ${r(ry)} 0 0 1 ${r(x)} ${r(y + h - ry)}` +
    `V${r(y + ry)}A${r(rx)} ${r(ry)} 0 0 1 ${r(x + rx)} ${r(y)}Z`
  );
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${r(cx - rx)} ${r(cy)}A${r(rx)} ${r(ry)} 0 1 0 ${r(cx + rx)} ${r(cy)}A${r(rx)} ${r(ry)} 0 1 0 ${r(cx - rx)} ${r(cy)}Z`;
}

export function polyPath(points: string, close: boolean): string {
  const n = (points.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
  if (n.length < 4) return "";
  let d = `M${n[0]} ${n[1]}`;
  for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
  return close ? `${d}Z` : d;
}

// ---------- one shape ----------

/** A shape as the DOM walk found it: path data in its own user units, computed paint. */
export interface SketchInput {
  d: string;
  /** Computed fill, or null for none. May be `url(#gradient)`. */
  fill: string | null;
  stroke: string | null;
  /** In the shape's user units. */
  strokeWidth: number;
  /** Screen px per user unit at the icon's insert size (ICON_SIZE). */
  scale: number;
}

/** One output path, in px space: wrap the paths of a shape in `scale(1 / input.scale)`. */
export interface SketchPath {
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** fill = the shape's colour area (hatch lines included), line = outlines and strokes. */
  role: "fill" | "line";
  /** Fill misregistration (px), see IconSketch.offset. */
  dx?: number;
  dy?: number;
}

/** Width of the outline a filled, unstroked shape gets (px at insert size, before `weight`). */
export const OUTLINE_PX = 1;
/** Excalidraw's default pen colour. */
export const INK = "#1e1e1e";

/**
 * The outline of a filled shape without a stroke. `shade`: its fill colour a little darker (a pen
 * line around a coloured area; near-white parts keep their own colour so white glyphs stay clean),
 * `ink`: near-black, `same`: the fill colour, `none`: no outline (null).
 */
export function outlineColor(fill: string, mode: IconSketch["outline"] = "shade"): string | null {
  if (mode === "none") return null;
  if (mode === "ink") return INK;
  if (mode === "same") return fill;
  const rgb = parseCssColor(fill);
  if (!rgb) return fill;
  const [r0, g0, b0] = rgb;
  if (r0 > 235 && g0 > 235 && b0 > 235) return fill;
  const k = 0.62;
  const hex = (n: number) => Math.round(n * k).toString(16).padStart(2, "0");
  return `#${hex(r0)}${hex(g0)}${hex(b0)}`;
}

/** A stroke colour under an outline mode: ink turns dark strokes into the pen colour, keeps coloured ones. */
export function strokeColor(stroke: string, mode: IconSketch["outline"]): string {
  if (mode !== "ink") return stroke;
  const rgb = parseCssColor(stroke);
  if (!rgb) return stroke;
  // Dark and not colourful: black, charcoal, navy. Reds and blues keep their colour.
  return Math.max(...rgb) < 100 ? INK : stroke;
}

function parseCssColor(v: string): [number, number, number] | null {
  const t = v.trim().toLowerCase();
  let m = t.match(/^#([0-9a-f]{3})$/);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = t.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Hatch only shapes at least this big (px at insert size): small parts stay solid. */
export const HATCH_MIN_SIDE = 14;

/** Direction of the fill offset for a seed (each redraw lands somewhere else). */
export function offsetVector(sketch: Pick<IconSketch, "offset" | "seed">): { dx: number; dy: number } {
  if (!sketch.offset) return { dx: 0, dy: 0 };
  const a = ((sketch.seed * 137.5) % 360) * (Math.PI / 180);
  return { dx: r(Math.cos(a) * sketch.offset), dy: r(Math.sin(a) * sketch.offset) };
}

/**
 * Redraw one shape by hand. Works in px space (the path scaled by `scale`), so roughjs's defaults
 * (tolerances, jitter, hatch gap) mean the same for 24-unit and 512-unit icons.
 */
export function sketchShape(input: SketchInput, sketch: IconSketch, index = 0): SketchPath[] {
  if (!input.d || !(input.scale > 0)) return [];
  let d: string;
  try {
    d = scalePathData(input.d, input.scale);
  } catch {
    return [];
  }
  const fill = input.fill && input.fill !== "none" && input.fill !== "transparent" ? input.fill : null;
  const stroke = input.stroke && input.stroke !== "none" && input.stroke !== "transparent" ? input.stroke : null;
  if (!fill && !stroke) return [];
  const weight = sketch.weight ?? 1;
  const strokePx = Math.max(0.5, input.strokeWidth * input.scale) * weight;
  const box = pathBox(d);
  const bigEnough = !!box && Math.min(box.w, box.h) >= HATCH_MIN_SIDE;
  const patterned = sketch.fill !== "solid" && sketch.fill !== "none";
  const fillStyle = patterned && bigEnough && fill && !fill.startsWith("url(") ? sketch.fill : "solid";
  const lineArt = sketch.fill === "none";

  const g = new RoughGenerator();
  const seed = 1 + ((sketch.seed + index * 7919) % (2 ** 31 - 2));
  const roughness = sketch.roughness;
  const { dx, dy } = offsetVector(sketch);
  const out: SketchPath[] = [];
  const add = (shape: ReturnType<RoughGenerator["path"]>, role: SketchPath["role"]) => {
    for (const p of g.toPaths(shape)) {
      if (!p.d) continue;
      const path: SketchPath = { d: p.d, fill: p.fill ?? "none", stroke: p.stroke ?? "none", strokeWidth: p.strokeWidth, role };
      if (role === "fill" && (dx || dy)) Object.assign(path, { dx, dy });
      out.push(path);
    }
  };
  const base = {
    seed,
    roughness,
    bowing: 1,
    preserveVertices: false,
    disableMultiStroke: !sketch.doubleStroke,
    disableMultiStrokeFill: true,
    fixedDecimalPlaceDigits: 2,
  };
  if (fill) {
    if (!lineArt) {
      const hatched = fillStyle !== "solid";
      // A solid fill barely wobbles (thin rings and strokes drawn as fills would break up); the
      // outline carries the hand-drawn look.
      add(
        g.path(d, {
          ...base,
          roughness: hatched ? roughness : roughness * 0.3,
          fillShapeRoughnessGain: 0,
          fill,
          fillStyle,
          fillWeight: hatched ? Math.max(0.6, Math.min(2.5, Math.max(0.8, strokePx * 0.6) * weight)) : undefined,
          hachureGap: hatched ? sketch.hatchGap : undefined,
          hachureAngle: sketch.hatchAngle,
          zigzagOffset: hatched ? sketch.hatchGap * 0.8 : undefined,
          dashGap: hatched ? sketch.hatchGap : undefined,
          stroke: "none",
        }),
        "fill",
      );
    }
    // Line art keeps the outline even with outline "none" (otherwise nothing would be drawn).
    const pen = stroke ? strokeColor(stroke, sketch.outline) : outlineColor(fill, lineArt && sketch.outline === "none" ? "ink" : sketch.outline);
    const width = stroke ? strokePx : OUTLINE_PX * weight * (sketch.outline === "ink" || lineArt ? 1.2 : 1);
    if (pen) add(g.path(d, { ...base, seed: seed + 1, stroke: pen, strokeWidth: width }), "line");
  } else if (stroke) {
    add(g.path(d, { ...base, stroke: strokeColor(stroke, sketch.outline), strokeWidth: strokePx }), "line");
  }
  return out;
}

/** Grain filters (one per texture); put once in the icon's <defs>. Region in the px space of the sketched groups. */
export function grainFilter(texture: IconSketch["texture"]): string {
  if (texture === "none") return "";
  // Alpha = a - b·noise: pencil is patchy graphite, paper a light tooth on the fills.
  const [freq, b, a] = texture === "pencil" ? [0.85, 1.9, 1.55] : [0.6, 1.1, 1.3];
  return (
    `<filter id="md-grain-${texture}" x="-100000" y="-100000" width="200000" height="200000" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="7" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-b} ${a}" result="m"/>` +
    `<feComposite in="SourceGraphic" in2="m" operator="in"/>` +
    `</filter>`
  );
}

// ---------- whole icons ----------

/** Rough size of the work: above the limits a sketch would be slow or unreadable, so we wobble. */
export function sketchComplexity(svg: string): { shapes: number; commands: number; images: number } {
  const shapes = (svg.match(/<(path|rect|circle|ellipse|line|polyline|polygon)\b/gi) ?? []).length;
  let commands = 0;
  for (const m of svg.matchAll(/\sd\s*=\s*["']([^"']*)["']/gi)) commands += (m[1].match(/[a-z]/gi) ?? []).length;
  const images = (svg.match(/<image\b/gi) ?? []).length;
  return { shapes, commands, images };
}

export const SKETCH_LIMITS = { shapes: 400, commands: 6000 } as const;

/** Whether an SVG should be wobbled rather than redrawn shape by shape. */
export function prefersWobble(svg: string): boolean {
  const c = sketchComplexity(svg);
  return c.images > 0 || c.shapes === 0 || c.shapes > SKETCH_LIMITS.shapes || c.commands > SKETCH_LIMITS.commands;
}

/**
 * Wrap an image (SVG or PNG data URL) in an SVG that wobbles it: fractal noise displaces every
 * pixel a little, like a shaky hand. `width`/`height` = the size the icon is inserted at (px).
 */
export function wobbleSvg(dataURL: string, width: number, height: number, sketch: IconSketch): string {
  const w = r(width);
  const h = r(height);
  // Noise about 10 px across at insert size: edges shake, the picture itself stays put.
  const k = Math.min(w, h) / 64;
  const strength = r(Math.max(0.5, sketch.roughness * 3.5 * k));
  const freq = r(0.1 / Math.max(0.25, k));
  const pad = Math.ceil(strength);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><filter id="md-wobble" x="${-pad}" y="${-pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" filterUnits="userSpaceOnUse">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${sketch.seed % 100000}" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="${strength}" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter></defs>` +
    `<image href="${dataURL}" xlink:href="${dataURL}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" filter="url(#md-wobble)"/>` +
    `</svg>`
  );
}

/**
 * A sketched shape's paths as SVG markup, wrapped back into the shape's user units. With a texture,
 * the grain filter (see grainFilter) goes on everything (pencil) or the fills (paper).
 */
export function sketchMarkup(paths: SketchPath[], scale: number, fillRule?: string, texture: IconSketch["texture"] = "none"): string {
  const one = (p: SketchPath) => {
    const style = `fill:${p.fill};stroke:${p.stroke};stroke-width:${r(p.strokeWidth)};stroke-linecap:round;stroke-linejoin:round${
      fillRule && p.fill !== "none" ? `;fill-rule:${fillRule}` : ""
    }`;
    const move = p.dx || p.dy ? ` transform="translate(${p.dx ?? 0} ${p.dy ?? 0})"` : "";
    return `<path d="${p.d}"${move} style="${style.replace(/"/g, "'")}"/>`;
  };
  const fills = paths.filter((p) => p.role === "fill").map(one).join("");
  const lines = paths.filter((p) => p.role !== "fill").map(one).join("");
  const grain = texture !== "none" ? ` filter="url(#md-grain-${texture})"` : "";
  const body = texture === "paper" ? `${fills ? `<g${grain}>${fills}</g>` : ""}${lines}` : fills + lines;
  return `<g transform="scale(${1 / scale})"${texture === "pencil" ? grain : ""}>${body}</g>`;
}
