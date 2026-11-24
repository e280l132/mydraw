// SVG outlines for node shapes Excalidraw doesn't have (pure, tests/shapeSvgs.test.ts): database
// cylinder, cloud, document, queue, person, server, hexagon, folder. build_diagram draws them as an
// image inside a borderless container (like an icon node), so labels, arrows, recolour, dark mode
// and every export work as for icons.

export const SVG_SHAPES = ["cylinder", "cloud", "document", "queue", "actor", "server", "hexagon", "folder"] as const;
export type SvgShape = (typeof SVG_SHAPES)[number];

/** Shapes whose label goes under the drawing (like an icon's caption) instead of inside it. */
export const CAPTION_SHAPES: ReadonlySet<SvgShape> = new Set(["actor", "server"]);

/** Size of the drawing for shapes with a caption (the node adds the caption below). */
export const CAPTION_SHAPE_SIZE: Record<"actor" | "server", { width: number; height: number }> = {
  actor: { width: 44, height: 68 },
  server: { width: 64, height: 64 },
};

/** Extra room a label needs inside a shape (on top of the text size). */
export const SHAPE_PADDING: Record<SvgShape, { x: number; y: number }> = {
  cylinder: { x: 30, y: 44 },
  cloud: { x: 56, y: 40 },
  document: { x: 30, y: 34 },
  queue: { x: 56, y: 24 },
  actor: { x: 0, y: 0 },
  server: { x: 0, y: 0 },
  hexagon: { x: 56, y: 26 },
  folder: { x: 30, y: 36 },
};

export interface ShapeSvgOptions {
  width: number;
  height: number;
  stroke: string;
  /** Fill colour, or "transparent". */
  fill: string;
  strokeWidth: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (c: string) => c.replace(/[^#a-zA-Z0-9(),.%\s-]/g, "");

/** The shape as an SVG document (numeric width/height, as Excalidraw's image export needs). */
export function shapeSvg(kind: SvgShape, o: ShapeSvgOptions): string {
  const w = Math.max(8, o.width);
  const h = Math.max(8, o.height);
  const sw = Math.max(0.5, o.strokeWidth);
  // Draw inside the box: the stroke is centred on the path.
  const l = sw / 2;
  const t = sw / 2;
  const r = w - sw / 2;
  const b = h - sw / 2;
  const fill = esc(o.fill === "transparent" ? "none" : o.fill);
  const stroke = esc(o.stroke);
  const attrs = `fill="${fill}" stroke="${stroke}" stroke-width="${r1(sw)}" stroke-linejoin="round" stroke-linecap="round"`;
  let body: string;
  switch (kind) {
    case "cylinder": {
      const ry = Math.min(h * 0.12, 16);
      const rx = (r - l) / 2;
      body =
        `<path d="M${r1(l)},${r1(t + ry)} L${r1(l)},${r1(b - ry)} A${r1(rx)},${r1(ry)} 0 0 0 ${r1(r)},${r1(b - ry)} L${r1(r)},${r1(t + ry)} Z" ${attrs}/>` +
        `<ellipse cx="${r1(w / 2)}" cy="${r1(t + ry)}" rx="${r1(rx)}" ry="${r1(ry)}" ${attrs}/>`;
      break;
    }
    case "queue": {
      const rx = Math.min(w * 0.12, 16);
      const ry = (b - t) / 2;
      body =
        `<path d="M${r1(l + rx)},${r1(t)} L${r1(r - rx)},${r1(t)} A${r1(rx)},${r1(ry)} 0 0 1 ${r1(r - rx)},${r1(b)} L${r1(l + rx)},${r1(b)} A${r1(rx)},${r1(ry)} 0 0 1 ${r1(l + rx)},${r1(t)} Z" ${attrs}/>` +
        `<ellipse cx="${r1(r - rx)}" cy="${r1(h / 2)}" rx="${r1(rx)}" ry="${r1(ry)}" ${attrs}/>`;
      break;
    }
    case "cloud": {
      // A cloud in a 100 x 64 box, stretched to the node; the stroke keeps its width.
      body =
        `<svg x="${r1(l)}" y="${r1(t)}" width="${r1(r - l)}" height="${r1(b - t)}" viewBox="0 0 100 64" preserveAspectRatio="none" overflow="visible">` +
        `<path d="M24,61 C10,61 2,52 4,42 C1,30 12,21 24,23 C26,10 40,3 53,8 C61,1 77,3 81,16 C93,15 101,26 97,38 C101,51 91,61 78,61 Z" ${attrs} vector-effect="non-scaling-stroke"/></svg>`;
      break;
    }
    case "document": {
      const a = Math.min(h * 0.08, 10);
      body = `<path d="M${r1(l)},${r1(t)} L${r1(r)},${r1(t)} L${r1(r)},${r1(b - a)} C${r1(r - (r - l) * 0.3)},${r1(b - 3 * a)} ${r1(l + (r - l) * 0.45)},${r1(b + a)} ${r1(l)},${r1(b - a)} Z" ${attrs}/>`;
      break;
    }
    case "hexagon": {
      const d = Math.min((b - t) / 2, (r - l) * 0.2);
      const m = h / 2;
      body = `<path d="M${r1(l + d)},${r1(t)} L${r1(r - d)},${r1(t)} L${r1(r)},${r1(m)} L${r1(r - d)},${r1(b)} L${r1(l + d)},${r1(b)} L${r1(l)},${r1(m)} Z" ${attrs}/>`;
      break;
    }
    case "folder": {
      const th = Math.min(h * 0.16, 14);
      const tw = (r - l) * 0.38;
      body = `<path d="M${r1(l)},${r1(t + th)} L${r1(l)},${r1(t)} L${r1(l + tw)},${r1(t)} L${r1(l + tw + th)},${r1(t + th)} L${r1(r)},${r1(t + th)} L${r1(r)},${r1(b)} L${r1(l)},${r1(b)} Z" ${attrs}/>`;
      break;
    }
    case "actor": {
      const cx = w / 2;
      const hr = Math.min(w * 0.22, h * 0.14);
      const neck = t + hr * 2;
      const hip = t + (b - t) * 0.62;
      const shoulder = neck + (hip - neck) * 0.25;
      const line = `fill="none" stroke="${stroke}" stroke-width="${r1(sw)}" stroke-linecap="round" stroke-linejoin="round"`;
      body =
        `<circle cx="${r1(cx)}" cy="${r1(t + hr)}" r="${r1(hr)}" ${attrs}/>` +
        `<path d="M${r1(cx)},${r1(neck)} L${r1(cx)},${r1(hip)} M${r1(l + 2)},${r1(shoulder)} L${r1(r - 2)},${r1(shoulder)} M${r1(cx)},${r1(hip)} L${r1(l + 4)},${r1(b)} M${r1(cx)},${r1(hip)} L${r1(r - 4)},${r1(b)}" ${line}/>`;
      break;
    }
    case "server": {
      const gap = (b - t) / 3;
      const slots = [0, 1, 2]
        .map((i) => {
          const y = t + i * gap;
          return (
            `<rect x="${r1(l)}" y="${r1(y + 1)}" width="${r1(r - l)}" height="${r1(gap - 3)}" rx="3" ${attrs}/>` +
            `<circle cx="${r1(l + 9)}" cy="${r1(y + gap / 2 - 0.5)}" r="2.2" fill="${stroke}"/>` +
            `<path d="M${r1(l + 18)},${r1(y + gap / 2 - 0.5)} L${r1(r - 8)},${r1(y + gap / 2 - 0.5)}" fill="none" stroke="${stroke}" stroke-width="${r1(Math.max(1, sw * 0.6))}" stroke-linecap="round"/>`
          );
        })
        .join("");
      body = slots;
      break;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(w)}" height="${r1(h)}" viewBox="0 0 ${r1(w)} ${r1(h)}">${body}</svg>`;
}

export function isSvgShape(s: unknown): s is SvgShape {
  return typeof s === "string" && (SVG_SHAPES as readonly string[]).includes(s);
}
