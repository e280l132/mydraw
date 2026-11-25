// Hand-drawn icon settings: the model, presets, validation and the insert default. No roughjs here
// (the main process reads settings through this); the drawing itself is shared/sketchSvg.ts.

export type IconSketchFill = "solid" | "hachure" | "cross-hatch" | "zigzag" | "dashed" | "none";
export type IconSketchMode = "rough" | "wobble";
/** The pen line around a filled shape: a darker shade of its fill, near-black ink, the fill colour, or none. */
export type IconSketchOutline = "shade" | "ink" | "same" | "none";
/** Grain: pencil (strokes and fills), paper (fills only). */
export type IconSketchTexture = "none" | "pencil" | "paper";
export type IconStylePreset = "pen" | "marker" | "pencil" | "crayon" | "ink" | "line-art" | "hatch" | "wobble";

/** How an icon is sketched. Stored on the image element as `customData.mydrawIconSketch`. */
export interface IconSketch {
  /** 0.2 (barely) .. 3 (very rough). */
  roughness: number;
  fill: IconSketchFill;
  /** Same seed = same strokes, so copies share one file and a recolor keeps the drawing. */
  seed: number;
  mode: IconSketchMode;
  outline: IconSketchOutline;
  /** Pen width multiplier, 0.5 .. 3. */
  weight: number;
  /** Fill drawn this many px off its outline (colouring outside the lines), 0 .. 4. */
  offset: number;
  /** Hatch line spacing in px, 2 .. 10. */
  hatchGap: number;
  /** Hatch angle in degrees, -90 .. 90. */
  hatchAngle: number;
  /** Every line drawn twice, slightly apart (roughjs multi-stroke). */
  doubleStroke: boolean;
  texture: IconSketchTexture;
  /** The preset it was made from (UI only). */
  preset?: IconStylePreset;
}

// roughjs's "dots" (one ellipse per dot: hundreds of KB per shape) and "zigzag-line" (draws nothing at
// icon size) are left out on purpose.
export const ICON_SKETCH_FILLS: readonly IconSketchFill[] = ["solid", "hachure", "cross-hatch", "zigzag", "dashed", "none"];
/** Fills drawn as lines (their gap and angle apply). */
export const HATCH_FILLS: ReadonlySet<IconSketchFill> = new Set(["hachure", "cross-hatch", "zigzag", "dashed"]);
export const ICON_SKETCH_MODES: readonly IconSketchMode[] = ["rough", "wobble"];
export const ICON_SKETCH_OUTLINES: readonly IconSketchOutline[] = ["shade", "ink", "same", "none"];
export const ICON_SKETCH_TEXTURES: readonly IconSketchTexture[] = ["none", "pencil", "paper"];
export const ICON_SKETCH_ROUGHNESS = { min: 0.2, max: 3 } as const;
export const ICON_SKETCH_LIMITS = {
  roughness: [0.2, 3],
  weight: [0.5, 3],
  offset: [0, 4],
  hatchGap: [2, 10],
  hatchAngle: [-90, 90],
} as const;

/** Today's default look ("Pen"). Lower roughness than shapes' 1: icons are small and full of detail. */
export const DEFAULT_ICON_SKETCH: IconSketch = {
  roughness: 0.8,
  fill: "solid",
  seed: 1,
  mode: "rough",
  outline: "shade",
  weight: 1,
  offset: 0,
  hatchGap: 4,
  hatchAngle: -41,
  doubleStroke: false,
  texture: "none",
};

type Look = Omit<IconSketch, "seed" | "preset">;

/** Named looks. Each is a complete look; the UI shows them as tiles. */
export const ICON_STYLE_PRESETS = {
  pen: { label: "Pen", hint: "Sketchy outlines, colours kept", look: { ...DEFAULT_ICON_SKETCH } },
  marker: {
    label: "Marker",
    hint: "Bold ink outline, fill a little off the lines",
    look: { ...DEFAULT_ICON_SKETCH, roughness: 0.6, outline: "ink", weight: 1.7, offset: 2 },
  },
  pencil: {
    label: "Pencil",
    hint: "Thin graphite lines and hatching",
    look: { ...DEFAULT_ICON_SKETCH, roughness: 1.2, fill: "hachure", outline: "ink", weight: 0.8, hatchGap: 3, doubleStroke: true, texture: "pencil" },
  },
  crayon: {
    label: "Crayon",
    hint: "Scribbled fill on grainy paper",
    look: { ...DEFAULT_ICON_SKETCH, roughness: 1.4, fill: "zigzag", hatchGap: 3, weight: 1.4, texture: "paper" },
  },
  ink: {
    label: "Ink",
    hint: "Black pen with cross-hatching",
    look: { ...DEFAULT_ICON_SKETCH, roughness: 1, fill: "cross-hatch", outline: "ink", hatchGap: 4.5 },
  },
  "line-art": {
    label: "Line art",
    hint: "Outlines only, like a colouring book",
    look: { ...DEFAULT_ICON_SKETCH, roughness: 0.9, fill: "none", outline: "ink", weight: 1.2 },
  },
  hatch: { label: "Hatch", hint: "Hatched fills in the icon's colours", look: { ...DEFAULT_ICON_SKETCH, fill: "hachure" } },
  wobble: { label: "Wobble", hint: "The picture made shaky (detailed and PNG icons)", look: { ...DEFAULT_ICON_SKETCH, mode: "wobble" } },
} satisfies Record<IconStylePreset, { label: string; hint: string; look: Look }>;
export const ICON_STYLE_PRESET_IDS = Object.keys(ICON_STYLE_PRESETS) as IconStylePreset[];
/** Older and friendlier names for presets. */
const PRESET_ALIASES: Record<string, IconStylePreset> = { "hand-drawn": "pen", sketch: "pen", handdrawn: "pen", lineart: "line-art", outline: "line-art" };

export function presetName(v: string): IconStylePreset | null {
  if (v in ICON_STYLE_PRESETS) return v as IconStylePreset;
  return PRESET_ALIASES[v] ?? null;
}

/** The full sketch of a preset (with a seed). */
export function presetSketch(id: IconStylePreset, seed = DEFAULT_ICON_SKETCH.seed): IconSketch {
  return { ...ICON_STYLE_PRESETS[id].look, seed, preset: id };
}

/** The insert default: follow the drawing style, or always one way. */
export type IconStyleSetting = "auto" | "original" | "hand-drawn";
export const ICON_STYLE_SETTINGS: readonly IconStyleSetting[] = ["auto", "original", "hand-drawn"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function oneOf<T extends string>(v: unknown, list: readonly T[], name: string): T {
  if (!list.includes(v as T)) throw new Error(`iconStyle.${name} must be one of ${list.join(", ")}`);
  return v as T;
}
function number(v: unknown, name: keyof typeof ICON_SKETCH_LIMITS): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`iconStyle.${name} must be a number`);
  const [lo, hi] = ICON_SKETCH_LIMITS[name];
  return clamp(v, lo, hi);
}

/**
 * Validate untrusted sketch options (agent, files, settings). Accepts a preset name ("pen",
 * "marker", "pencil", … or the old "hand-drawn" / "hatch" / "wobble"), `true`, or a partial object
 * (`preset` first, then the fields on top); "original" / `false` / null mean no sketch. Missing fields
 * come from `base`, so sketches stored before a field existed stay valid. Throws on anything else.
 */
export function normalizeIconSketch(v: unknown, base: IconSketch = DEFAULT_ICON_SKETCH): IconSketch | null {
  if (v === null || v === false || v === "original" || v === "none") return null;
  if (v === true) return { ...base };
  if (typeof v === "string") {
    const p = presetName(v);
    if (!p) throw new Error(`iconStyle must be "original", one of ${ICON_STYLE_PRESET_IDS.map((k) => `"${k}"`).join(", ")}, or an object`);
    return presetSketch(p, base.seed);
  }
  if (typeof v !== "object") throw new Error("iconStyle must be a name or an object");
  const o = v as Record<string, unknown>;
  let out: IconSketch = { ...DEFAULT_ICON_SKETCH, ...base };
  if (o.preset !== undefined) {
    const p = typeof o.preset === "string" ? presetName(o.preset) : null;
    if (!p) throw new Error(`iconStyle.preset must be one of ${ICON_STYLE_PRESET_IDS.join(", ")}`);
    out = presetSketch(p, base.seed);
  }
  if (o.roughness !== undefined) out.roughness = number(o.roughness, "roughness");
  if (o.fill !== undefined) out.fill = oneOf(o.fill, ICON_SKETCH_FILLS, "fill");
  if (o.mode !== undefined) out.mode = oneOf(o.mode, ICON_SKETCH_MODES, "mode");
  if (o.outline !== undefined) out.outline = oneOf(o.outline, ICON_SKETCH_OUTLINES, "outline");
  if (o.texture !== undefined) out.texture = oneOf(o.texture, ICON_SKETCH_TEXTURES, "texture");
  if (o.weight !== undefined) out.weight = number(o.weight, "weight");
  if (o.offset !== undefined) out.offset = number(o.offset, "offset");
  if (o.hatchGap !== undefined) out.hatchGap = number(o.hatchGap, "hatchGap");
  if (o.hatchAngle !== undefined) out.hatchAngle = number(o.hatchAngle, "hatchAngle");
  if (o.doubleStroke !== undefined) {
    if (typeof o.doubleStroke !== "boolean") throw new Error("iconStyle.doubleStroke must be true or false");
    out.doubleStroke = o.doubleStroke;
  }
  if (o.seed !== undefined) {
    if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) throw new Error("iconStyle.seed must be a number");
    out.seed = Math.abs(Math.round(o.seed)) % 2 ** 31 || 1;
  }
  // Keep the preset tag only while the look still is that preset.
  const tag = out.preset;
  delete out.preset;
  const match = iconSketchPreset(out, tag);
  if (match) out.preset = match;
  return out;
}

/** Read a stored sketch leniently (a broken value counts as no sketch). */
export function storedIconSketch(v: unknown): IconSketch | null {
  if (!v || typeof v !== "object") return null;
  try {
    return normalizeIconSketch(v);
  } catch {
    return null;
  }
}

const LOOK_KEYS = Object.keys(DEFAULT_ICON_SKETCH).filter((k) => k !== "seed") as (keyof Look)[];

/** The preset a sketch looks exactly like (seed aside), else null. `prefer` wins when several match. */
export function iconSketchPreset(s: IconSketch, prefer?: IconStylePreset): IconStylePreset | null {
  const same = (id: IconStylePreset) => LOOK_KEYS.every((k) => (ICON_STYLE_PRESETS[id].look as Look)[k] === s[k]);
  if (prefer && prefer in ICON_STYLE_PRESETS && same(prefer)) return prefer;
  return ICON_STYLE_PRESET_IDS.find(same) ?? null;
}

/** What a new stencil gets: the setting, resolved against the drawing style. */
export function iconSketchFor(setting: IconStyleSetting | undefined, drawingStyle: "clean" | "sketch", base: IconSketch = DEFAULT_ICON_SKETCH): IconSketch | null {
  const on = setting === "hand-drawn" || ((setting ?? "auto") === "auto" && drawingStyle === "sketch");
  return on ? { ...base } : null;
}

export function newSketchSeed(): number {
  return 1 + Math.floor(Math.random() * (2 ** 31 - 2));
}

/** The look new hand-drawn icons get (Settings.iconSketch): a sketch without its seed. */
export type IconSketchLook = Omit<IconSketch, "seed">;

/** Settings value → full look (missing fields from the default; a broken value = the default). */
export function lookOfSetting(v: unknown): IconSketchLook {
  const s = storedIconSketch(v && typeof v === "object" ? { ...(v as object), seed: 1 } : null) ?? { ...DEFAULT_ICON_SKETCH };
  const { seed: _seed, ...look } = s;
  void _seed;
  return look;
}

/** The sketch a newly inserted stencil gets under these settings, or null for the original. */
export function insertSketchOf(s: { iconStyle?: IconStyleSetting; drawingStyle: "clean" | "sketch"; iconSketch?: Partial<IconSketchLook> }): IconSketch | null {
  return iconSketchFor(s.iconStyle, s.drawingStyle, { ...lookOfSetting(s.iconSketch), seed: DEFAULT_ICON_SKETCH.seed });
}

/** A stable key for a sketch's look + seed (caches); the preset tag doesn't change the drawing. */
export function sketchKey(s: IconSketch | null | undefined): string {
  if (!s) return "-";
  return Object.keys(s)
    .filter((k) => k !== "preset")
    .sort()
    .map((k) => `${k}=${String(s[k as keyof IconSketch])}`)
    .join(";");
}

// ---------- captions (the name under an icon) ----------

/**
 * Font of the name under an icon: `match` = a hand font under hand-drawn icons and the drawing's font
 * under original ones, `hand` = always the hand font, `drawing` = always the drawing's font.
 */
export type CaptionFontMode = "match" | "hand" | "drawing";
export const CAPTION_FONT_MODES: readonly CaptionFontMode[] = ["match", "hand", "drawing"];
/** Excalidraw's own handwriting font. */
export const DEFAULT_HAND_FONT = "Excalifont";

/** The caption font's name, or null for the drawing's current font. */
export function captionFontName(mode: CaptionFontMode | undefined, sketched: boolean, handFont: string | undefined): string | null {
  const m = mode ?? "match";
  if (m === "hand" || (m === "match" && sketched)) return handFont?.trim() || DEFAULT_HAND_FONT;
  return null;
}

/** A hand-font setting: a plain font family name (validated loosely; unknown names fall back when drawn). */
export function normalizeHandFont(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const f = v.trim();
  return f && f.length <= 80 && /^[A-Za-z0-9_ -]+$/.test(f) ? f : null;
}
