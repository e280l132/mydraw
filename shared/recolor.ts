// Recolor an SVG icon to a single color. Colored parts (fills, strokes, gradient stops, currentColor)
// become the target color; white/near-white details and transparent parts are kept, so e.g. an
// AWS icon's orange square turns blue while its white glyph stays white.

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
  purple: "#800080",
  yellow: "#ffff00",
  silver: "#c0c0c0",
};

const COLOR_ATTRS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and a few names into [r, g, b, a]. */
export function parseColor(value: string): [number, number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return parseColor(NAMED[v]);
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : 1;
    return [+m[1], +m[2], +m[3], a];
  }
  return null;
}

/** White and near-white are treated as "detail" colors and kept. */
export function isNearWhite(value: string): boolean {
  const c = parseColor(value);
  if (!c) return false;
  const [r, g, b] = c;
  return r > 235 && g > 235 && b > 235;
}

function shouldReplace(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent" || v === "inherit" || v.startsWith("url(")) return false;
  if (v === "currentcolor") return true;
  const c = parseColor(v);
  if (!c) return false;
  if (c[3] === 0) return false;
  return !isNearWhite(v);
}

function replaceStyleDecls(css: string, color: string): string {
  return css.replace(
    /(^|[;{\s])(fill|stroke|stop-color|flood-color|lighting-color|color)\s*:\s*([^;}"']+)/gi,
    (all, pre: string, prop: string, val: string) => (shouldReplace(val) ? `${pre}${prop}:${color}` : all),
  );
}

/** Recolor an SVG document string. `color` must be a hex color like "#1971c2". */
export function recolorSvg(svg: string, color: string): string {
  if (!/^#[0-9a-f]{3,8}$/i.test(color)) throw new Error(`invalid color ${color}`);
  let out = svg;

  // 1. Presentation attributes: fill="…", stroke="…", stop-color="…", color="…"
  const attrRe = new RegExp(`(\\s(?:${COLOR_ATTRS.join("|")}))\\s*=\\s*(["'])([^"']*)\\2`, "gi");
  out = out.replace(attrRe, (all, name: string, q: string, val: string) =>
    shouldReplace(val) ? `${name}=${q}${color}${q}` : all,
  );

  // 2. Inline style="…" attributes.
  out = out.replace(/(\sstyle\s*=\s*)(["'])([^"']*)\2/gi, (_all, pre: string, q: string, css: string) => {
    return `${pre}${q}${replaceStyleDecls(css, color)}${q}`;
  });

  // 3. <style> blocks (class-based icons).
  out = out.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_all, open: string, css: string, close: string) => {
    return `${open}${replaceStyleDecls(css, color)}${close}`;
  });

  // 4. Shapes without an explicit fill default to black: give the root a fill, and set `color`
  //    so anything using currentColor follows.
  out = out.replace(/<svg\b([^>]*)>/i, (_all, attrs: string) => {
    let a = attrs;
    if (!/\sfill\s*=/i.test(a)) a += ` fill="${color}"`;
    if (/\scolor\s*=/i.test(a)) a = a.replace(/(\scolor\s*=\s*)(["'])[^"']*\2/i, `$1"${color}"`);
    else a += ` color="${color}"`;
    return `<svg${a}>`;
  });
  return out;
}

/** Decode an SVG data URL (base64 or URL-encoded) to text. */
export function svgFromDataURL(dataURL: string): string {
  const comma = dataURL.indexOf(",");
  if (comma < 0 || !/^data:image\/svg\+xml/i.test(dataURL)) throw new Error("not an SVG data URL");
  const meta = dataURL.slice(0, comma);
  const body = dataURL.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(body);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  return decodeURIComponent(body);
}

export function svgToDataURL(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/**
 * Give the root <svg> explicit width/height (from its viewBox) when missing. Images need an
 * intrinsic size: without one the browser reports a default size and Excalidraw's image export
 * crops/zooms the icon. Excalidraw does the same for SVGs it imports itself.
 */
export function ensureSvgSize(svg: string, fallback = 64): string {
  return svg.replace(/<svg\b([^>]*)>/i, (all, attrs: string) => {
    const hasW = /\swidth\s*=\s*["']\s*[\d.]+(px)?\s*["']/i.test(attrs);
    const hasH = /\sheight\s*=\s*["']\s*[\d.]+(px)?\s*["']/i.test(attrs);
    if (hasW && hasH) return all;
    const vb = attrs.match(/\sviewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
    const w = vb ? parseFloat(vb[3]) : fallback;
    const h = vb ? parseFloat(vb[4]) : fallback;
    // Drop percentage/auto sizes, then set numeric ones.
    const cleaned = attrs.replace(/\s(width|height)\s*=\s*(["'])[^"']*\2/gi, "");
    return `<svg${cleaned} width="${w}" height="${h}">`;
  });
}

/**
 * The main color of an SVG icon: the most frequently used fill/stroke/stop color, ignoring
 * white/near-white details, transparent parts and "none". `currentColor` resolves to the root's
 * `color` (attribute or style), defaulting to black. Returns a lower-case #rrggbb, or null.
 */
export function dominantSvgColor(svg: string): string | null {
  const root = svg.match(/<svg\b([^>]*)>/i)?.[1] ?? "";
  const rootColor =
    root.match(/\scolor\s*=\s*["']([^"']+)["']/i)?.[1] ?? root.match(/[;"'\s]color\s*:\s*([^;"']+)/i)?.[1] ?? "#000000";
  const counts = new Map<string, number>();
  const add = (raw: string) => {
    let v = raw.trim();
    if (v.toLowerCase() === "currentcolor") v = rootColor;
    if (!shouldReplace(v)) return;
    const c = parseColor(v);
    if (!c) return;
    const hex = `#${c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };
  for (const m of svg.matchAll(/\s(?:fill|stroke|stop-color)\s*=\s*["']([^"']*)["']/gi)) add(m[1]);
  for (const m of svg.matchAll(/(?:^|[;{\s"'])(?:fill|stroke|stop-color)\s*:\s*([^;}"']+)/gi)) add(m[1]);
  // Shapes with no fill at all are black by default.
  const anyFill = /\s(?:fill|stroke)\s*=|(?:fill|stroke)\s*:/i.test(svg);
  if (!counts.size && !anyFill && /<(path|rect|circle|ellipse|polygon)\b/i.test(svg)) add("#000000");
  let best: string | null = null;
  let bestN = 0;
  for (const [hex, n] of counts) if (n > bestN) [best, bestN] = [hex, n];
  return best;
}
