// Shadows: a drop shadow (or glow) under any shape, text, icon, line or arrow. Excalidraw has no
// such property, so it lives in `customData.mydrawShadow` and is drawn by patched Excalidraw
// renderers (scripts/excalidrawPatch.mjs -> web/src/shadowRender.ts). Pure: used by the renderer
// hooks, the style panel, styles/presets, the agent and draw.io.

export interface Shadow {
  /** #rrggbb. */
  color: string;
  /** 0..1, applied on top of the element's own opacity. */
  opacity: number;
  /** Blur in scene px (canvas `shadowBlur`; SVG stdDeviation = blur / 2). */
  blur: number;
  /** How far the shadow falls from the element, scene px. */
  distance: number;
  /** Direction the shadow falls, degrees clockwise from +x (screen y grows down): 90 = straight down. */
  angle: number;
  /**
   * What kind of shadow (absent = "drop", so older files read the same):
   * - drop: one shadow behind the element (also glows: distance 0).
   * - inner: inset, inside the element's outline (pressed / well).
   * - layered: two shadows, a tight one and a wide faint one (elevation; with a color, neon).
   * - extrude: solid copies stepped along the angle (3D block / long shadow).
   * - contact: a soft ellipse on the "ground" under the element (floating).
   */
  kind?: ShadowKind;
}

export type ShadowKind = "drop" | "inner" | "layered" | "extrude" | "contact";
export const SHADOW_KINDS: readonly ShadowKind[] = ["drop", "inner", "layered", "extrude", "contact"];
export const SHADOW_KIND_LABELS: Record<ShadowKind, string> = {
  drop: "Drop",
  inner: "Inner",
  layered: "Layered",
  extrude: "3D",
  contact: "Ground",
};
/** Extrude: one copy per scene px of distance, at most this many. */
export const EXTRUDE_MAX_STEPS = 60;
export const shadowKind = (s: Shadow | null | undefined): ShadowKind => s?.kind ?? "drop";

export const SHADOW_KEY = "mydrawShadow";
export const SHADOW_BLUR_MAX = 80;
export const SHADOW_DISTANCE_MAX = 80;
/** The Amount slider: blur + distance. */
export const SHADOW_AMOUNT_MAX = 100;

export type ShadowPresetId = "soft" | "drop" | "lifted" | "hard" | "glow" | "long" | "inner" | "elevated" | "neon" | "extrude" | "float";

export const SHADOW_PRESETS: Record<ShadowPresetId, { label: string; hint: string; shadow: Shadow }> = {
  soft: { label: "Soft", hint: "Gentle shadow straight below", shadow: { color: "#000000", opacity: 0.25, blur: 16, distance: 6, angle: 90 } },
  drop: { label: "Drop", hint: "Classic drop shadow, down-right", shadow: { color: "#000000", opacity: 0.35, blur: 6, distance: 4, angle: 45 } },
  lifted: { label: "Lifted", hint: "Wide, faint: the shape floats", shadow: { color: "#000000", opacity: 0.2, blur: 28, distance: 14, angle: 90 } },
  hard: { label: "Hard", hint: "Solid offset copy, no blur", shadow: { color: "#000000", opacity: 0.9, blur: 0, distance: 5, angle: 45 } },
  glow: { label: "Glow", hint: "Colored halo all around", shadow: { color: "#4dabf7", opacity: 0.8, blur: 14, distance: 0, angle: 90 } },
  long: { label: "Long", hint: "Long hard shadow, down-right", shadow: { color: "#000000", opacity: 0.3, blur: 0, distance: 24, angle: 45 } },
  inner: { label: "Inner", hint: "Inset shadow: the shape looks pressed in", shadow: { color: "#000000", opacity: 0.4, blur: 8, distance: 3, angle: 90, kind: "inner" } },
  elevated: { label: "Elevated", hint: "Two layers, tight and wide: a raised card", shadow: { color: "#000000", opacity: 0.3, blur: 24, distance: 10, angle: 90, kind: "layered" } },
  neon: { label: "Neon", hint: "Bright double glow", shadow: { color: "#f06595", opacity: 0.9, blur: 18, distance: 0, angle: 90, kind: "layered" } },
  extrude: { label: "3D", hint: "Solid block behind the shape, down-right", shadow: { color: "#495057", opacity: 1, blur: 0, distance: 8, angle: 45, kind: "extrude" } },
  float: { label: "Float", hint: "Soft shadow on the ground below: the shape hovers", shadow: { color: "#000000", opacity: 0.35, blur: 10, distance: 14, angle: 90, kind: "contact" } },
};
export const SHADOW_PRESET_IDS = Object.keys(SHADOW_PRESETS) as ShadowPresetId[];
export const DEFAULT_SHADOW: Shadow = SHADOW_PRESETS.soft.shadow;

/** Element types a shadow can be drawn for. */
const SHADOW_TYPES = new Set(["rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "image", "text"]);
export function canShadow(type: string | undefined): boolean {
  return !!type && SHADOW_TYPES.has(type);
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
const round = (v: number, places = 2) => Math.round(v * 10 ** places) / 10 ** places;

/** #rgb / #rrggbb -> lowercase #rrggbb, else null. */
export function shadowHex(c: unknown): string | null {
  if (typeof c !== "string") return null;
  const s = c.trim();
  if (!HEX.test(s)) return null;
  const h = s.slice(1).toLowerCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join("") : h}`;
}

/** Validate an untrusted shadow (file, agent); missing fields come from `base`. Null = no shadow. */
export function normalizeShadow(v: unknown, base: Shadow = DEFAULT_SHADOW): Shadow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const color = o.color === undefined ? base.color : shadowHex(o.color);
  if (!color) return null;
  if (o.kind !== undefined && !(SHADOW_KINDS as readonly unknown[]).includes(o.kind)) return null;
  const kind = (o.kind as ShadowKind | undefined) ?? base.kind ?? "drop";
  return {
    color,
    opacity: round(clamp(num(o.opacity, base.opacity), 0, 1)),
    blur: round(clamp(num(o.blur, base.blur), 0, SHADOW_BLUR_MAX), 1),
    distance: round(clamp(num(o.distance, base.distance), 0, SHADOW_DISTANCE_MAX), 1),
    angle: Math.round((((num(o.angle, base.angle) % 360) + 360) % 360)),
    // Drop shadows carry no `kind`, so files from before shadow kinds compare equal.
    ...(kind !== "drop" ? { kind } : {}),
  };
}

type WithData = { customData?: Record<string, unknown> | null } | null | undefined;

/** The element's shadow, if it has a valid one. */
export function shadowOf(el: WithData): Shadow | null {
  const raw = el?.customData?.[SHADOW_KEY];
  return raw ? normalizeShadow(raw) : null;
}

/**
 * customData with the shadow set (or removed with null). Always an object: Excalidraw's
 * `newElementWith` ignores `undefined` values, so `customData: undefined` would keep the old shadow.
 */
export function withShadow(customData: Record<string, unknown> | null | undefined, shadow: Shadow | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(customData ?? {}) };
  if (shadow) next[SHADOW_KEY] = { ...shadow };
  else delete next[SHADOW_KEY];
  return next;
}

export function sameShadow(a: Shadow | null, b: Shadow | null): boolean {
  if (!a || !b) return a === b;
  return a.color === b.color && a.opacity === b.opacity && a.blur === b.blur && a.distance === b.distance && a.angle === b.angle && shadowKind(a) === shadowKind(b);
}

/** The one shadow shared by all `els` (panel state), null when none has one, "mixed" otherwise. */
export function commonShadow(els: readonly WithData[]): Shadow | null | "mixed" {
  if (!els.length) return null;
  const first = shadowOf(els[0]);
  for (const e of els.slice(1)) if (!sameShadow(first, shadowOf(e))) return "mixed";
  return first;
}

/** The preset `s` equals, if any. */
export function presetOf(s: Shadow | null): ShadowPresetId | null {
  if (!s) return null;
  return SHADOW_PRESET_IDS.find((id) => sameShadow(SHADOW_PRESETS[id].shadow, s)) ?? null;
}

/** Amount slider value: blur + distance, 0..100. */
export function shadowAmount(s: Shadow): number {
  return Math.round(clamp(s.blur + s.distance, 0, SHADOW_AMOUNT_MAX));
}

/** Scale blur and distance together to `amount` (their ratio is kept; a zero-size shadow takes Soft's ratio). */
export function withAmount(s: Shadow, amount: number): Shadow {
  const a = clamp(Math.round(amount), 0, SHADOW_AMOUNT_MAX);
  let { blur, distance } = s;
  if (blur + distance <= 0) ({ blur, distance } = DEFAULT_SHADOW);
  const k = a / (blur + distance);
  return {
    ...s,
    blur: round(clamp(blur * k, 0, SHADOW_BLUR_MAX), 1),
    distance: round(clamp(distance * k, 0, SHADOW_DISTANCE_MAX), 1),
  };
}

/** Shadow offset in scene px, times `k` (device scale for canvas). */
export function shadowOffset(s: Shadow, k = 1): { dx: number; dy: number } {
  const r = (s.angle * Math.PI) / 180;
  return { dx: round(Math.cos(r) * s.distance * k, 3), dy: round(Math.sin(r) * s.distance * k, 3) };
}

/** How far (scene px) a shadow can reach past the element's box: offset + about 1.5x the blur. */
export function shadowExtent(s: Shadow | null): number {
  if (!s) return 0;
  // A ground shadow also has the ellipse's own height below the element.
  return Math.ceil(s.distance + s.blur * 1.5 + (shadowKind(s) === "contact" ? 14 : 2));
}

/** One shadow drawn behind an element (scene px). */
export interface ShadowLayer {
  dx: number;
  dy: number;
  blur: number;
  opacity: number;
}

/**
 * The plain shadows a drop / layered / extrude shadow is made of, back to front (each drawn from the
 * element's own outline). Inner and contact shadows are drawn differently and return [].
 */
export function shadowLayers(s: Shadow): ShadowLayer[] {
  const { dx, dy } = shadowOffset(s);
  switch (shadowKind(s)) {
    case "drop":
      return [{ dx, dy, blur: s.blur, opacity: s.opacity }];
    case "layered":
      // Wide and faint first, then tight and darker (Material-style elevation; colored = neon).
      return [
        { dx, dy, blur: s.blur, opacity: round(s.opacity * 0.6, 3) },
        { dx: round(dx * 0.3, 3), dy: round(dy * 0.3, 3), blur: round(s.blur * 0.3, 2), opacity: s.opacity },
      ];
    case "extrude": {
      const n = Math.min(EXTRUDE_MAX_STEPS, Math.max(1, Math.round(s.distance)));
      const out: ShadowLayer[] = [];
      for (let i = n; i >= 1; i--) out.push({ dx: round((dx * i) / n, 3), dy: round((dy * i) / n, 3), blur: s.blur, opacity: s.opacity });
      return out;
    }
    default:
      return [];
  }
}

/** The ground ellipse of a contact shadow, for an (unrotated) element box: centre and radii, scene px. */
export function contactEllipse(s: Shadow, box: { x: number; y: number; width: number; height: number }): { cx: number; cy: number; rx: number; ry: number } {
  const rx = Math.max(4, (box.width / 2) * 0.9 + s.blur * 0.5);
  const ry = Math.max(3, Math.min(box.height * 0.18, 6 + s.blur * 0.3));
  const { dx } = shadowOffset(s);
  return { cx: box.x + box.width / 2 + dx * 0.5, cy: box.y + box.height + s.distance * 0.5, rx, ry };
}

/** Largest extent among `els` (export padding). */
export function maxShadowExtent(els: readonly WithData[]): number {
  let m = 0;
  for (const e of els) m = Math.max(m, shadowExtent(shadowOf(e)));
  return m;
}

/** `rgba()` for canvas. */
export function shadowRgba(color: string, opacity: number): string {
  const h = shadowHex(color) ?? "#000000";
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${round(opacity, 3)})`;
}

/**
 * Agent / style input -> shadow. `true` = Soft, a preset name, or an object (a `preset` field picks
 * the base, other fields override; `amount` scales blur+distance). null/false/"none" = remove.
 * Returns undefined when `v` is undefined (leave as is). Throws on anything it can't read.
 */
export function resolveShadowInput(v: unknown): Shadow | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === false || v === "none") return null;
  if (v === true) return { ...DEFAULT_SHADOW };
  if (typeof v === "string") {
    const p = SHADOW_PRESETS[v.trim().toLowerCase() as ShadowPresetId];
    if (!p) throw new Error(`Unknown shadow preset "${v}". Use one of: ${SHADOW_PRESET_IDS.join(", ")}, or none.`);
    return { ...p.shadow };
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    let base = DEFAULT_SHADOW;
    if (o.preset !== undefined) {
      const p = SHADOW_PRESETS[String(o.preset).toLowerCase() as ShadowPresetId];
      if (!p) throw new Error(`Unknown shadow preset "${String(o.preset)}". Use one of: ${SHADOW_PRESET_IDS.join(", ")}.`);
      base = p.shadow;
    }
    if (o.color !== undefined && !shadowHex(o.color)) throw new Error(`Shadow color must be hex like #000000 (got ${JSON.stringify(o.color)}).`);
    const s = normalizeShadow(o, base);
    if (!s) throw new Error("Invalid shadow.");
    return typeof o.amount === "number" ? withAmount(s, o.amount) : s;
  }
  throw new Error("shadow must be true, a preset name, an object {preset?, color?, opacity?, blur?, distance?, angle?, amount?} or null.");
}

/** Compact form for get_scene: the preset name when it is one, else the values. */
export function describeShadow(s: Shadow | null): string | Shadow | undefined {
  if (!s) return undefined;
  return presetOf(s) ?? s;
}

// ---------- geometry for the renderers ----------

export interface ShadowBoxInput {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  strokeWidth?: number;
  fontSize?: number;
  points?: readonly (readonly [number, number])[];
}

/**
 * A rotation-safe box (scene px) that holds everything an element draws: its points, strokes,
 * arrowheads, roughness wobble, text outline. Used to size the export layer and the SVG filter region
 * (the shadow extent is added by the caller).
 */
export function drawnBox(el: ShadowBoxInput): { x: number; y: number; width: number; height: number } {
  let x1 = el.x, y1 = el.y, x2 = el.x + el.width, y2 = el.y + el.height;
  if (el.points?.length) {
    x1 = y1 = Infinity;
    x2 = y2 = -Infinity;
    for (const [px, py] of el.points) {
      x1 = Math.min(x1, el.x + px); y1 = Math.min(y1, el.y + py);
      x2 = Math.max(x2, el.x + px); y2 = Math.max(y2, el.y + py);
    }
  }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const half = Math.hypot(x2 - x1, y2 - y1) / 2;
  const sw = el.strokeWidth ?? 1;
  const margin = 24 + sw * 4 + (el.type === "text" ? (el.fontSize ?? 20) / 2 : 0);
  const r = half + margin;
  return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
}
