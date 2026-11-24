// Extra fonts beyond Excalidraw's own (pure: no DOM, no Electron; used by the renderer, main,
// the build script's manifest and tests).
//
// Excalidraw stores a text's font as a number (`fontFamily`) and builds the CSS font string from
// its FONT_FAMILY table (name -> number) WITHOUT quoting the name. So:
//   - every weight/style we offer is its own family ("Inter", "Inter Bold"), registered under a
//     name that is a valid unquoted CSS family (`cssSafeFamily`);
//   - ids come from the name (`fontIdFor`), so the same font gets the same id on every machine;
//   - a drawing carries the font files its text uses (`EmbeddedFonts`, top-level "mydrawFonts"
//     key, written before the "mydraw" meta block; see shared/drawingMeta.ts).

export type FontCategory = "fun" | "professional" | "mono";
export type FontSource = "builtin" | "catalog" | "embedded";

export const FONT_CATEGORIES: readonly FontCategory[] = ["fun", "professional", "mono"];

export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  /** Negative, like the font's hhea.descender. */
  descender: number;
  /** Unitless line height Excalidraw gives new text in this font. */
  lineHeight: number;
}

export interface FontFile {
  /** Where the renderer loads it from (app://, mdfont:// or a data: URL). */
  url: string;
  /** CSS unicode-range of this file ("U+0000-00FF,..."); empty = everything. */
  unicodeRange: string;
}

/** One selectable font = one family name in Excalidraw's picker. */
export interface FontEntry {
  id: number;
  /** Registered (CSS-safe) family name, shown in the picker. */
  family: string;
  /** The typeface it belongs to ("Inter" for "Inter Bold"). */
  typeface: string;
  weight: number;
  style: "normal" | "italic";
  category: FontCategory;
  source: FontSource;
  metrics: FontMetrics;
  files: FontFile[];
  license?: string;
  /** Fontsource id of a catalog download ("playfair-display"). */
  catalogId?: string;
}

/** Font data stored inside a drawing (base64 woff2 per file). */
export interface EmbeddedFontFace {
  id: number;
  family: string;
  typeface: string;
  weight: number;
  style: "normal" | "italic";
  category: FontCategory;
  metrics: FontMetrics;
  files: { unicodeRange: string; data: string }[];
}

export interface EmbeddedFonts {
  version: 1;
  faces: EmbeddedFontFace[];
}

export const FONTS_KEY = "mydrawFonts";

/** Excalidraw's own ids (1-9, 100 CJK fallback, 1000 emoji) stay below this. */
export const CUSTOM_FONT_MIN = 10_000;
const CUSTOM_FONT_SPAN = 990_000;

/** Stable id for a family name (FNV-1a), in [CUSTOM_FONT_MIN, CUSTOM_FONT_MIN + CUSTOM_FONT_SPAN). */
export function fontIdFor(family: string): number {
  let h = 0x811c9dc5;
  const s = family.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return CUSTOM_FONT_MIN + (h % CUSTOM_FONT_SPAN);
}

export function isCustomFontId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= CUSTOM_FONT_MIN;
}

const DIGIT_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/**
 * A family name Excalidraw can use unquoted in a CSS font string: words of letters, digits, "-"
 * and "_", none starting with a digit or "--". A number word is spelled out only when it is not
 * just a version suffix ("Source Serif 4" -> "Source Serif", "M PLUS 1p" -> "M PLUS Onep").
 */
export function cssSafeFamily(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9_\- ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // A trailing bare number is a version ("Source Serif 4", "Source Sans 3"): drop it.
  while (words.length > 1 && /^\d+$/.test(words[words.length - 1])) words.pop();
  const out = words.map((w) => {
    let word = w.replace(/^-+/, "");
    if (/^\d/.test(word)) word = DIGIT_WORDS[Number(word[0])] + word.slice(1);
    return word;
  });
  return out.filter(Boolean).join(" ") || "Font";
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

/** "Inter" + 700 + italic -> "Inter Bold Italic"; 400 normal is the bare typeface name. */
export function faceFamilyName(typeface: string, weight: number, style: "normal" | "italic"): string {
  const parts = [cssSafeFamily(typeface)];
  if (weight !== 400 && WEIGHT_NAMES[weight]) parts.push(WEIGHT_NAMES[weight]);
  if (style === "italic") parts.push("Italic");
  return parts.join(" ");
}

/** Excalidraw-style unitless line height from hhea metrics, rounded to 0.05, within 1.0-1.6. */
export function lineHeightFor(m: Pick<FontMetrics, "unitsPerEm" | "ascender" | "descender">): number {
  const raw = (m.ascender - m.descender) / m.unitsPerEm;
  const rounded = Math.round(raw * 20) / 20;
  return Math.min(1.6, Math.max(1, Number.isFinite(rounded) ? rounded : 1.25));
}

/** Parse "U+0000-00FF,U+0131" into [start, end] pairs. Empty = everything. */
export function parseUnicodeRange(range: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of range.split(",")) {
    const m = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!m) continue;
    if (m[1].includes("?")) {
      out.push([parseInt(m[1].replace(/\?/g, "0"), 16), parseInt(m[1].replace(/\?/g, "f"), 16)]);
    } else {
      const a = parseInt(m[1], 16);
      out.push([a, m[2] ? parseInt(m[2], 16) : a]);
    }
  }
  return out;
}

/** Does `unicodeRange` cover at least one character of `chars`? */
export function rangeCovers(unicodeRange: string, chars: Iterable<string>): boolean {
  if (!unicodeRange.trim()) return true;
  const ranges = parseUnicodeRange(unicodeRange);
  for (const c of chars) {
    const cp = c.codePointAt(0)!;
    if (ranges.some(([a, b]) => cp >= a && cp <= b)) return true;
  }
  return false;
}

interface TextLike {
  type: string;
  isDeleted?: boolean;
  fontFamily?: number;
  originalText?: string;
  text?: string;
}

/** Characters used per custom font id by the (non-deleted) text elements. */
export function charsPerCustomFont(elements: readonly TextLike[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const el of elements) {
    if (el.type !== "text" || el.isDeleted || !isCustomFontId(el.fontFamily)) continue;
    let set = out.get(el.fontFamily);
    if (!set) out.set(el.fontFamily, (set = new Set()));
    for (const c of el.originalText ?? el.text ?? "") set.add(c);
  }
  return out;
}

/**
 * Which files of each used font a drawing must carry: those whose range covers a used character
 * (at least the first file, so an empty text still names its font).
 */
export function filesToEmbed(entry: Pick<FontEntry, "files">, chars: Set<string>): FontFile[] {
  const hit = entry.files.filter((f) => rangeCovers(f.unicodeRange, chars));
  return hit.length ? hit : entry.files.slice(0, 1);
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FAMILY_OK = /^[A-Za-z_][A-Za-z0-9_-]*( [A-Za-z_][A-Za-z0-9_-]*)*$/;
const MAX_FACES = 64;

function normalizeMetrics(raw: unknown): FontMetrics | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const m = { unitsPerEm: n(r.unitsPerEm), ascender: n(r.ascender), descender: n(r.descender), lineHeight: n(r.lineHeight) };
  if (!(m.unitsPerEm > 0) || Number.isNaN(m.ascender) || Number.isNaN(m.descender)) return null;
  if (!(m.lineHeight >= 0.5 && m.lineHeight <= 3)) m.lineHeight = lineHeightFor(m);
  return m;
}

/** Untrusted `mydrawFonts` value from a file -> embedded fonts (invalid faces dropped). */
export function normalizeEmbeddedFonts(raw: unknown): EmbeddedFonts {
  const out: EmbeddedFonts = { version: 1, faces: [] };
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || !Array.isArray(r.faces)) return out;
  const seen = new Set<string>();
  for (const f of r.faces.slice(0, MAX_FACES)) {
    if (!f || typeof f !== "object") continue;
    const face = f as Record<string, unknown>;
    const family = typeof face.family === "string" ? face.family : "";
    if (!FAMILY_OK.test(family) || family.length > 80 || seen.has(family.toLowerCase())) continue;
    const id = isCustomFontId(face.id) ? face.id : fontIdFor(family);
    const metrics = normalizeMetrics(face.metrics);
    if (!metrics) continue;
    const files = Array.isArray(face.files)
      ? face.files
          .filter(
            (x): x is { unicodeRange: string; data: string } =>
              !!x && typeof x === "object" && typeof (x as { data?: unknown }).data === "string" && BASE64.test((x as { data: string }).data),
          )
          .map((x) => ({ unicodeRange: typeof x.unicodeRange === "string" ? x.unicodeRange : "", data: x.data }))
      : [];
    const category = FONT_CATEGORIES.includes(face.category as FontCategory) ? (face.category as FontCategory) : "professional";
    const weight = typeof face.weight === "number" && face.weight >= 1 && face.weight <= 1000 ? Math.round(face.weight) : 400;
    seen.add(family.toLowerCase());
    out.faces.push({
      id,
      family,
      typeface: typeof face.typeface === "string" && face.typeface ? face.typeface.slice(0, 80) : family,
      weight,
      style: face.style === "italic" ? "italic" : "normal",
      category,
      metrics,
      files,
    });
  }
  return out;
}

/**
 * How to bring a drawing's fonts into this app.
 *  - `remap`: file id -> local id, when the local app knows the same family under another id, or the
 *    file's id is taken here by a different family.
 *  - `register`: faces the app doesn't have yet (with the id to register them under).
 * `known` maps family (case-insensitive key) -> id for everything registered now.
 */
export function planFontImport(
  faces: readonly EmbeddedFontFace[],
  known: ReadonlyMap<string, number>,
): { remap: Map<number, number>; register: EmbeddedFontFace[] } {
  const remap = new Map<number, number>();
  const register: EmbeddedFontFace[] = [];
  const taken = new Set(known.values());
  for (const face of faces) {
    const local = known.get(face.family.toLowerCase());
    if (local !== undefined) {
      if (local !== face.id) remap.set(face.id, local);
      continue;
    }
    let id = face.id;
    while (taken.has(id)) id = id + 1 >= CUSTOM_FONT_MIN + CUSTOM_FONT_SPAN ? CUSTOM_FONT_MIN : id + 1;
    taken.add(id);
    if (id !== face.id) remap.set(face.id, id);
    register.push({ ...face, id });
  }
  return { remap, register };
}

/** Elements with `fontFamily` rewritten by `remap` (same objects when nothing changes). */
export function remapFontFamilies<T extends { type: string; fontFamily?: number }>(elements: readonly T[], remap: ReadonlyMap<number, number>): T[] {
  if (!remap.size) return elements as T[];
  return elements.map((el) => {
    if (el.type !== "text" || el.fontFamily === undefined) return el;
    const to = remap.get(el.fontFamily);
    return to === undefined ? el : { ...el, fontFamily: to };
  });
}

// ---------- bold / italic ----------
//
// Excalidraw stores one font per text, so "bold" and "italic" mean switching the text to another
// face of the same typeface ("Inter" -> "Inter Bold" -> "Inter Bold Italic"). Pure: the renderer
// passes the faces it has registered.

/** Weight at or above which a face counts as bold. */
export const BOLD_FROM = 600;
/** Weight a text switches to when made bold and its typeface has no heavier face than regular. */
const BOLD_PREFERRED = [700, 600, 800, 900, 500];

/** A text's current font: bold when its weight is 600 or more. */
export const isBoldFace = (f: Pick<FontEntry, "weight">): boolean => f.weight >= BOLD_FROM;
export const isItalicFace = (f: Pick<FontEntry, "style">): boolean => f.style === "italic";

type FaceKey = Pick<FontEntry, "typeface" | "weight" | "style">;

/** Faces that belong to `face`'s typeface (same typeface name, case-insensitive). */
export function siblingsOf<T extends FaceKey>(face: FaceKey, all: readonly T[]): T[] {
  const name = face.typeface.toLowerCase();
  return all.filter((f) => f.typeface.toLowerCase() === name);
}

/** Can a text in `face` be made bold (or back to regular) / italic (or back to upright)? */
export function canStyle<T extends FaceKey>(face: FaceKey, all: readonly T[]): { bold: boolean; italic: boolean } {
  const sibs = siblingsOf(face, all);
  const hasBold = sibs.some(isBoldFace);
  const hasRegular = sibs.some((f) => !isBoldFace(f));
  return {
    bold: hasBold && hasRegular,
    italic: sibs.some(isItalicFace) && sibs.some((f) => !isItalicFace(f)),
  };
}

/**
 * The face to use when `face` is switched to the wanted bold / italic state, keeping the other
 * property. Null when the typeface has no such face. Among several bold weights 700 wins, then
 * 600 (Inter has both); regular means 400, else the lightest non-bold face.
 */
export function faceFor<T extends FaceKey>(face: FaceKey, all: readonly T[], want: { bold?: boolean; italic?: boolean }): T | null {
  const bold = want.bold ?? isBoldFace(face);
  const italic = want.italic ?? face.style === "italic";
  const pool = siblingsOf(face, all).filter((f) => isItalicFace(f) === italic);
  if (!pool.length) return null;
  if (bold) {
    for (const w of BOLD_PREFERRED) {
      const hit = pool.find((f) => f.weight === w && isBoldFace(f));
      if (hit) return hit;
    }
    return pool.filter(isBoldFace).sort((a, b) => a.weight - b.weight)[0] ?? null;
  }
  const regulars = pool.filter((f) => !isBoldFace(f));
  return regulars.find((f) => f.weight === 400) ?? regulars.sort((a, b) => a.weight - b.weight)[0] ?? null;
}
