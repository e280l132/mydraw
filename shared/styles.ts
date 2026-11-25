// Themes (whole-diagram looks) and style presets (named element styles). Pure data + helpers.
import { resolveShadowInput, SHADOW_PRESETS, type Shadow } from "./shadow";
import { fontIdFor } from "./fonts";
import { requireColor, resolveColor } from "./palettes";
import { GRADIENT_PRESETS, resolveGradientInput, type Gradient } from "./gradient";
import { requireFillStyle, type FillStyleId } from "./fills";
import { requireStrokeStyle, type StrokeStyleName } from "./dash";

/** Excalidraw 0.18 font family ids. */
export const FONTS: Record<string, number> = {
  virgil: 1,
  helvetica: 2,
  cascadia: 3,
  excalifont: 5,
  nunito: 6,
  "lilita-one": 7,
  "comic-shanns": 8,
  liberation: 9,
};

/** A family name of mydraw's extra fonts ("Inter", "Caveat Bold"): letters, digits, "_", "-", single spaces. */
const FAMILY_NAME = /^[A-Za-z_][A-Za-z0-9_-]*( [A-Za-z_][A-Za-z0-9_-]*)*$/;

/**
 * Font id for a style's `fontFamily`: one of the FONTS slugs, or the family name of one of mydraw's
 * extra fonts, whose id comes from its name (shared/fonts.ts `fontIdFor`). Undefined when invalid.
 */
export function fontIdOf(font: string): number | undefined {
  const slug = FONTS[font.toLowerCase()];
  if (slug !== undefined) return slug;
  return FAMILY_NAME.test(font) && font.length <= 80 ? fontIdFor(font) : undefined;
}

/** A style's fontFamily as stored: a FONTS slug in lower case, or an extra font's family name as given. */
function normalizeFont(font: unknown): string | undefined {
  if (typeof font !== "string") return undefined;
  const f = font.trim();
  if (FONTS[f.toLowerCase()] !== undefined) return f.toLowerCase();
  return fontIdOf(f) === undefined ? undefined : f;
}

const FONT_HELP = `fontFamily must be one of ${Object.keys(FONTS).join(", ")} or a font name from list_fonts (e.g. "Inter", "Caveat Bold")`;

export type Roundness = "sharp" | "round";
export type FillStyle = FillStyleId;
/** Excalidraw's three plus the extra dash styles (shared/dash.ts). */
export type StrokeStyle = StrokeStyleName;

/** Properties a style can set. Colors may be names; they are resolved when applied. */
export interface StyleSpec {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: FillStyle;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle;
  roughness?: number;
  opacity?: number;
  roundness?: Roundness;
  fontFamily?: string;
  fontSize?: number;
  /** Shadow (shared/shadow.ts); null removes one. */
  shadow?: Shadow | null;
  /** Gradient fill for rectangles, diamonds and ellipses (shared/gradient.ts); null = flat fill. */
  gradient?: Gradient | null;
}

export interface StylePreset {
  id: string;
  title: string;
  description: string;
  /** Group shown in the panel (e.g. "Zones", "Links"). */
  category: string;
  style: StyleSpec;
  builtin?: boolean;
}

export interface Theme {
  id: string;
  title: string;
  description: string;
  /** Group shown in the panel (e.g. "Dark", "Light"). */
  category: string;
  /** Canvas background color. */
  background: string;
  /** Color of default ink (strokes and text that use a theme's ink color) in this theme. */
  ink: string;
  roughness: number;
  roundness: Roundness;
  fontFamily: string;
  strokeWidth: number;
  /** Whether the canvas is dark (informational). */
  dark: boolean;
  builtin?: boolean;
}

const T = (
  id: string,
  title: string,
  category: string,
  description: string,
  background: string,
  ink: string,
  o: Partial<Pick<Theme, "roughness" | "roundness" | "fontFamily" | "strokeWidth">> = {},
): Theme => ({
  id,
  title,
  category,
  description,
  background,
  ink,
  roughness: o.roughness ?? 0,
  roundness: o.roundness ?? "sharp",
  fontFamily: o.fontFamily ?? "nunito",
  strokeWidth: o.strokeWidth ?? 2,
  dark: luminance(background) < 0.4,
  builtin: true,
});

function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export const BUILTIN_THEMES: Theme[] = [
  T("clean", "Clean", "Classic", "Crisp professional look: sharp corners, no sketchiness, Nunito.", "#ffffff", "#1e1e1e"),
  T("sketch", "Sketch", "Classic", "Hand-drawn Excalidraw look: rough lines, rounded corners, Excalifont.", "#ffffff", "#1e1e1e", {
    roughness: 1,
    roundness: "round",
    fontFamily: "excalifont",
  }),
  T("soft", "Soft", "Classic", "Rounded corners, clean lines, friendly Nunito.", "#ffffff", "#343a40", { roundness: "round" }),
  T("whiteboard", "Whiteboard", "Classic", "Slightly rough marker on white.", "#fcfcfc", "#212529", { roughness: 1, roundness: "round", fontFamily: "comic-shanns", strokeWidth: 3 }),
  T("paper", "Paper", "Light", "Warm cream paper with brown-black ink.", "#fbf6e9", "#3b3228", { fontFamily: "liberation" }),
  T("solarized-light", "Solarized Light", "Light", "Solarized light canvas.", "#fdf6e3", "#073642", { fontFamily: "cascadia" }),
  T("pastel", "Pastel", "Light", "Soft lavender canvas, rounded shapes.", "#f3efff", "#4c3f6b", { roundness: "round" }),
  T("high-contrast", "High contrast", "Light", "Pure black on white, thick lines.", "#ffffff", "#000000", { strokeWidth: 3 }),
  T("print", "Print mono", "Light", "Thin black lines, ideal for printing in grayscale.", "#ffffff", "#111111", { strokeWidth: 1, fontFamily: "helvetica" }),
  T("dark", "Dark", "Dark", "Light ink on a near-black canvas, sharp and clean.", "#1e1e1e", "#e9ecef"),
  T("midnight", "Midnight", "Dark", "Deep navy canvas with pale blue ink.", "#0d1b2a", "#cfe3ff"),
  T("terminal", "Terminal", "Dark", "Green phosphor on black, monospaced.", "#0a0f0a", "#5cff7a", { fontFamily: "cascadia", strokeWidth: 1 }),
  T("solarized-dark", "Solarized Dark", "Dark", "Solarized dark canvas.", "#002b36", "#93a1a1", { fontFamily: "cascadia" }),
  T("dracula", "Dracula", "Dark", "Purple-gray canvas with soft lilac ink.", "#282a36", "#f8f8f2", { roundness: "round" }),
  T("blueprint", "Blueprint", "Technical", "White lines on a deep blue canvas, monospaced text.", "#0b3a75", "#e8f1ff", { fontFamily: "cascadia", strokeWidth: 1 }),
  T("schematic", "Schematic", "Technical", "Dark green board with pale ink, monospaced.", "#10331f", "#d5f5dc", { fontFamily: "cascadia", strokeWidth: 1 }),
  T("ocean", "Ocean", "Color", "Pale aqua canvas with deep teal ink.", "#e3f6f8", "#0b4f5c", { roundness: "round" }),
  T("forest", "Forest", "Color", "Soft green canvas with dark green ink.", "#e8f3e8", "#1f4d2b", { roundness: "round" }),
  T("sunset", "Sunset", "Color", "Warm peach canvas with plum ink.", "#fff0e6", "#5a2a43", { roundness: "round" }),
];
/** Back-compat alias. */
export const THEMES = BUILTIN_THEMES;

/** Every theme's ink color: strokes with one of these are re-inked when the theme changes. */
export function inkColors(themes: readonly Theme[]): string[] {
  return [...new Set(["#1e1e1e", ...themes.map((t) => t.ink.toLowerCase())])];
}
export const INK_COLORS: string[] = inkColors(BUILTIN_THEMES);

export function themeById(id: string, themes: readonly Theme[] = BUILTIN_THEMES): Theme | undefined {
  const k = id.trim().toLowerCase();
  // Later entries (the user's) win over built-ins of the same name.
  return [...themes].reverse().find((t) => t.id === k || t.title.toLowerCase() === k);
}

const P = (id: string, title: string, category: string, description: string, style: StyleSpec): StylePreset => ({
  id,
  title,
  category,
  description,
  style,
  builtin: true,
});
const zone = (c: string, extra: StyleSpec = {}): StyleSpec => ({
  strokeColor: `${c}-700`,
  backgroundColor: `${c}-50`,
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  ...extra,
});
const link = (c: string, w: number, st: StrokeStyle = "solid"): StyleSpec => ({ strokeColor: c, strokeWidth: w, strokeStyle: st });
const status = (c: string): StyleSpec => ({ strokeColor: `${c}-700`, backgroundColor: `${c}-100`, fillStyle: "solid", strokeWidth: 2 });

export const BUILTIN_PRESETS: StylePreset[] = [
  P("prod-zone", "Prod", "Zones", "Green tint for production.", zone("green")),
  P("staging-zone", "Staging", "Zones", "Amber tint for staging.", zone("amber")),
  P("dev-zone", "Dev", "Zones", "Sky tint for development.", zone("sky")),
  P("internal", "Internal", "Zones", "Blue tint for private networks.", zone("blue")),
  P("dmz", "DMZ", "Zones", "Orange dashed boundary for exposed networks.", zone("tangerine", { strokeStyle: "dashed", backgroundColor: "orange-50" })),
  P("public-zone", "Public / Internet", "Zones", "Red-tinted dashed boundary for untrusted networks.", zone("red", { strokeStyle: "dashed" })),
  P("mgmt-zone", "Management", "Zones", "Purple tint for management networks.", zone("violet")),
  P("data-zone", "Data / Storage", "Zones", "Teal tint for storage and databases.", zone("teal")),
  P("guest-zone", "Guest / IoT", "Zones", "Gray dotted area for guest and IoT.", zone("gray", { strokeStyle: "dotted" })),
  P("secure-zone", "Restricted", "Zones", "Thick dark-red outline for restricted areas.", zone("red", { strokeWidth: 4, backgroundColor: "rose-50" })),

  P("primary-link", "Primary", "Links", "Solid dark-blue connector.", link("blue-700", 3)),
  P("critical-link", "Critical", "Links", "Thick red connector.", link("red-600", 4)),
  P("backup-link", "Backup", "Links", "Gray dashed connector for standby paths.", link("gray-500", 2, "dashed")),
  P("async-link", "Async / optional", "Links", "Dotted connector for async or optional flows.", link("slate-500", 2, "dotted")),
  P("secure-link", "Encrypted", "Links", "Green connector for encrypted traffic.", link("green-700", 3)),
  P("mgmt-link", "Management", "Links", "Purple dashed connector for management traffic.", link("violet-600", 2, "dashed")),
  P("deprecated-link", "Deprecated", "Links", "Faded gray dotted connector.", { ...link("gray-400", 2, "dotted"), opacity: 70 }),
  P("thin-link", "Thin", "Links", "Hairline connector.", link("gray-600", 1)),

  P("ok", "OK", "Status", "Green status box.", status("green")),
  P("warning", "Warning", "Status", "Amber status box.", status("amber")),
  P("error", "Error", "Status", "Red status box.", status("red")),
  P("info", "Info", "Status", "Blue status box.", status("blue")),
  P("planned", "Planned", "Status", "Dashed gray box for things not built yet.", { strokeColor: "gray-500", backgroundColor: "transparent", strokeStyle: "dashed" }),
  P("disabled", "Disabled", "Status", "Faded box for turned-off things.", { strokeColor: "gray-400", backgroundColor: "gray-100", fillStyle: "solid", opacity: 60 }),

  P("highlight", "Highlight", "Emphasis", "Yellow fill with an amber outline.", { strokeColor: "amber-700", backgroundColor: "yellow-200", fillStyle: "solid" }),
  P("muted", "Muted", "Emphasis", "Faded gray, for things out of scope.", { strokeColor: "gray-400", backgroundColor: "transparent", opacity: 60 }),
  P("callout", "Callout", "Emphasis", "Thick orange outline.", { strokeColor: "orange-600", strokeWidth: 4, backgroundColor: "orange-50", fillStyle: "solid" }),
  P("note", "Sticky note", "Emphasis", "Yellow note card.", { strokeColor: "yellow-700", backgroundColor: "yellow-100", fillStyle: "solid", strokeWidth: 1, roundness: "sharp" }),
  P("outline", "Outline only", "Emphasis", "No fill, normal outline.", { backgroundColor: "transparent", strokeWidth: 2 }),
  P("solid-dark", "Solid dark", "Emphasis", "Dark fill, for headers and primary boxes.", { strokeColor: "slate-900", backgroundColor: "slate-700", fillStyle: "solid" }),
  P("card", "Card", "Emphasis", "White card with a soft shadow.", { strokeColor: "gray-300", backgroundColor: "white", fillStyle: "solid", strokeWidth: 1, roundness: "round", shadow: { ...SHADOW_PRESETS.soft.shadow } }),
  P("floating", "Floating", "Emphasis", "Lifted off the page: wide faint shadow.", { shadow: { ...SHADOW_PRESETS.lifted.shadow } }),
  P("glow", "Glow", "Emphasis", "Blue glow around the item.", { shadow: { ...SHADOW_PRESETS.glow.shadow } }),
  P("no-shadow", "No shadow", "Emphasis", "Remove the shadow.", { shadow: null }),
  P("gradient-sky", "Sky gradient", "Emphasis", "Light-to-blue gradient fill with a blue outline.", { strokeColor: "blue-700", gradient: { ...GRADIENT_PRESETS.sky.gradient } }),
  P("gradient-sunset", "Sunset gradient", "Emphasis", "Yellow-to-red gradient fill.", { strokeColor: "red-700", gradient: { ...GRADIENT_PRESETS.sunset.gradient } }),
  P("flat-fill", "Flat fill", "Emphasis", "Remove a gradient (keeps its start color).", { gradient: null }),

  P("title", "Title", "Text", "Large heading.", { fontSize: 36 }),
  P("subtitle", "Subtitle", "Text", "Medium heading.", { fontSize: 24 }),
  P("body", "Body", "Text", "Normal text.", { fontSize: 16 }),
  P("caption", "Caption", "Text", "Small gray caption.", { fontSize: 12, strokeColor: "gray-600" }),
  P("code", "Code", "Text", "Monospaced text.", { fontFamily: "cascadia", fontSize: 14 }),
];


/** Validate an untrusted style object (from MCP or localStorage); colors are checked, not resolved. */
export function normalizeStyle(raw: unknown): StyleSpec {
  if (!raw || typeof raw !== "object") throw new Error("style must be an object");
  const r = raw as Record<string, unknown>;
  const out: StyleSpec = {};
  for (const k of ["strokeColor", "backgroundColor"] as const) {
    if (r[k] !== undefined) {
      requireColor(r[k], k);
      out[k] = String(r[k]);
    }
  }
  if (r.fillStyle !== undefined) out.fillStyle = requireFillStyle(r.fillStyle);
  if (r.strokeStyle !== undefined) out.strokeStyle = requireStrokeStyle(r.strokeStyle);
  for (const [k, lo, hi] of [["strokeWidth", 0.5, 12], ["roughness", 0, 2], ["opacity", 0, 100], ["fontSize", 6, 200]] as const) {
    if (r[k] !== undefined) {
      const n = Number(r[k]);
      if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${k} must be a number from ${lo} to ${hi}`);
      out[k] = n;
    }
  }
  if (r.roundness !== undefined) {
    if (r.roundness !== "sharp" && r.roundness !== "round") throw new Error('roundness must be "sharp" or "round"');
    out.roundness = r.roundness;
  }
  if (r.fontFamily !== undefined) {
    const f = normalizeFont(r.fontFamily);
    if (f === undefined) throw new Error(FONT_HELP);
    out.fontFamily = f;
  }
  if (r.shadow !== undefined) out.shadow = resolveShadowInput(r.shadow) ?? null;
  if (r.gradient !== undefined) {
    let g = r.gradient;
    if (g && typeof g === "object") {
      const o = { ...(g as Record<string, unknown>) };
      for (const k of ["from", "to"] as const) if (o[k] !== undefined) o[k] = resolveColor(String(o[k])) ?? o[k];
      g = o;
    }
    out.gradient = resolveGradientInput(g) ?? null;
  }
  return out;
}

export interface ElementPatch {
  [k: string]: unknown;
}

/** Excalidraw element fields for a style. `kind` limits what makes sense (text has no fill or roundness). */
export function stylePatch(style: StyleSpec, kind: "shape" | "text" | "line"): ElementPatch {
  const p: ElementPatch = {};
  if (style.strokeColor !== undefined) p.strokeColor = requireColor(style.strokeColor, "strokeColor");
  if (kind !== "text") {
    if (style.strokeWidth !== undefined) p.strokeWidth = style.strokeWidth;
    if (style.strokeStyle !== undefined) p.strokeStyle = style.strokeStyle;
    if (style.roughness !== undefined) p.roughness = style.roughness;
  }
  if (style.opacity !== undefined) p.opacity = style.opacity;
  if (style.shadow !== undefined) p.shadow = style.shadow;
  if (kind === "shape") {
    if (style.backgroundColor !== undefined) {
      p.backgroundColor = requireColor(style.backgroundColor, "backgroundColor");
      if (style.fillStyle === undefined && p.backgroundColor !== "transparent") p.fillStyle = "solid";
    }
    if (style.fillStyle !== undefined) p.fillStyle = style.fillStyle;
    if (style.gradient !== undefined) p.gradient = style.gradient;
    if (style.roundness !== undefined) p.roundness = style.roundness === "round" ? { type: 3 } : null;
  }
  if (kind === "text") {
    if (style.fontFamily !== undefined) p.fontFamily = fontIdOf(style.fontFamily);
    if (style.fontSize !== undefined) p.fontSize = style.fontSize;
  }
  return p;
}

/** Style an element takes from a theme (without touching its custom fills). */
export function themeStyle(theme: Theme): StyleSpec {
  return {
    roughness: theme.roughness,
    roundness: theme.roundness,
    strokeWidth: theme.strokeWidth,
    fontFamily: theme.fontFamily,
  };
}

// ---------- user library (presets and themes the user saved; persisted by the app) ----------

export interface StyleLibrary {
  presets: StylePreset[];
  themes: Theme[];
}

export const EMPTY_LIBRARY: StyleLibrary = { presets: [], themes: [] };

/** URL-safe id for a name. Names with no ASCII letters (e.g. "数据库") get a short stable hash so they never collide. */
export function slugId(s: string): string {
  const name = s.trim().toLowerCase();
  const slug = name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (slug || !name) return slug;
  let h = 5381;
  for (const ch of name) h = ((h << 5) + h + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `x${h.toString(36)}`;
}

const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normalizeCategory(v: unknown, fallback = "My presets"): string {
  return cleanText(v, 40) || fallback;
}

/** Validate an untrusted preset (agent input or file). Throws on a bad style. */
export function normalizePreset(raw: unknown): StylePreset {
  if (!raw || typeof raw !== "object") throw new Error("preset must be an object");
  const r = raw as Record<string, unknown>;
  const title = cleanText(r.title ?? r.name, 60);
  if (!title) throw new Error("preset needs a name");
  return {
    id: slugId(cleanText(r.id, 80) || title) || "preset",
    title,
    description: cleanText(r.description, 200),
    category: normalizeCategory(r.category),
    style: normalizeStyle(r.style),
  };
}

/** Validate an untrusted theme (agent input or file). */
export function normalizeTheme(raw: unknown): Theme {
  if (!raw || typeof raw !== "object") throw new Error("theme must be an object");
  const r = raw as Record<string, unknown>;
  const title = cleanText(r.title ?? r.name, 60);
  if (!title) throw new Error("theme needs a name");
  const bg = requireColor(r.background, "background");
  const ink = requireColor(r.ink, "ink");
  if (bg === "transparent" || ink === "transparent") throw new Error("background and ink must be real colors");
  const font = r.fontFamily === undefined ? "nunito" : normalizeFont(r.fontFamily);
  if (font === undefined) throw new Error(FONT_HELP);
  const roughness = r.roughness === undefined ? 0 : Number(r.roughness);
  const strokeWidth = r.strokeWidth === undefined ? 2 : Number(r.strokeWidth);
  if (!(roughness >= 0 && roughness <= 2)) throw new Error("roughness must be 0 to 2");
  if (!(strokeWidth >= 0.5 && strokeWidth <= 12)) throw new Error("strokeWidth must be 0.5 to 12");
  const roundness = r.roundness === "round" ? "round" : "sharp";
  return {
    id: slugId(cleanText(r.id, 80) || title) || "theme",
    title,
    description: cleanText(r.description, 200),
    category: normalizeCategory(r.category, "My themes"),
    background: bg,
    ink,
    roughness,
    roundness,
    fontFamily: font,
    strokeWidth,
    dark: luminance(bg) < 0.4,
  };
}

/** Tolerant loader: skips entries that don't validate, never throws. */
export function normalizeLibrary(raw: unknown): StyleLibrary {
  const out: StyleLibrary = { presets: [], themes: [] };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const [key, norm, list] of [
    ["presets", normalizePreset, out.presets],
    ["themes", normalizeTheme, out.themes],
  ] as const) {
    if (!Array.isArray(r[key])) continue;
    for (const item of r[key] as unknown[]) {
      try {
        const n = norm(item) as StylePreset & Theme;
        const i = (list as Array<{ id: string }>).findIndex((x) => x.id === n.id);
        if (i >= 0) (list as Array<unknown>)[i] = n;
        else (list as Array<unknown>).push(n);
      } catch {
        /* skip a malformed entry */
      }
    }
  }
  return out;
}
