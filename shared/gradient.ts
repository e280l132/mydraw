// Gradient fills. Excalidraw has only flat colors, so a gradient lives in `customData.mydrawGradient`
// and the element keeps `fillStyle: "solid"` with `backgroundColor = from` (what other apps show).
// The gradient is drawn only while that still holds: picking another fill color or a pattern fill
// switches it off without touching customData. Drawn by the element hook (web/src/shadowRender.ts):
// the element is rendered with a sentinel fill color that becomes the gradient. Pure: used by the hook,
// the panel, the agent, styles and draw.io.

export type GradientKind = "linear" | "radial";

export interface Gradient {
  kind: GradientKind;
  /** #rrggbb: the start (linear) or centre (radial) color; also the element's backgroundColor. */
  from: string;
  /** #rrggbb: the end (linear) or edge (radial) color. */
  to: string;
  /** Linear only: direction from `from` to `to`, degrees clockwise from +x (90 = top to bottom). */
  angle: number;
}

export const GRADIENT_KEY = "mydrawGradient";
/** Element types a gradient is drawn for. */
const GRADIENT_TYPES = new Set(["rectangle", "diamond", "ellipse"]);
export const canGradient = (type: string | undefined) => !!type && GRADIENT_TYPES.has(type);

export type GradientPresetId = "sky" | "sunset" | "mint" | "grape" | "slate" | "peach" | "glow" | "spot";

export const GRADIENT_PRESETS: Record<GradientPresetId, { label: string; gradient: Gradient }> = {
  sky: { label: "Sky", gradient: { kind: "linear", from: "#d0ebff", to: "#4dabf7", angle: 90 } },
  sunset: { label: "Sunset", gradient: { kind: "linear", from: "#ffe066", to: "#ff6b6b", angle: 90 } },
  mint: { label: "Mint", gradient: { kind: "linear", from: "#e6fcf5", to: "#38d9a9", angle: 90 } },
  grape: { label: "Grape", gradient: { kind: "linear", from: "#e5dbff", to: "#845ef7", angle: 45 } },
  slate: { label: "Slate", gradient: { kind: "linear", from: "#f8f9fa", to: "#ced4da", angle: 90 } },
  peach: { label: "Peach", gradient: { kind: "linear", from: "#fff4e6", to: "#ffa94d", angle: 0 } },
  glow: { label: "Glow", gradient: { kind: "radial", from: "#ffffff", to: "#74c0fc", angle: 90 } },
  spot: { label: "Spotlight", gradient: { kind: "radial", from: "#fff9db", to: "#fab005", angle: 90 } },
};
export const GRADIENT_PRESET_IDS = Object.keys(GRADIENT_PRESETS) as GradientPresetId[];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function hex(c: unknown): string | null {
  if (typeof c !== "string" || !HEX.test(c.trim())) return null;
  const h = c.trim().slice(1).toLowerCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join("") : h}`;
}

/** Validate an untrusted gradient (file, agent); null = not a gradient. */
export function normalizeGradient(v: unknown): Gradient | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const from = hex(o.from);
  const to = hex(o.to);
  if (!from || !to) return null;
  const kind: GradientKind = o.kind === "radial" ? "radial" : "linear";
  const a = typeof o.angle === "number" && Number.isFinite(o.angle) ? o.angle : 90;
  return { kind, from, to, angle: Math.round(((a % 360) + 360) % 360) };
}

type WithFill = {
  type?: string;
  fillStyle?: string;
  backgroundColor?: string;
  customData?: Record<string, unknown> | null;
} | null | undefined;

/** The gradient stored on an element (whether or not it is drawn). */
export function storedGradient(el: WithFill): Gradient | null {
  return normalizeGradient(el?.customData?.[GRADIENT_KEY]);
}

/** The gradient to draw: stored, a supported shape, a solid fill, and the fill still its `from` color. */
export function gradientOf(el: WithFill): Gradient | null {
  if (!el || !canGradient(el.type) || el.fillStyle !== "solid") return null;
  const g = storedGradient(el);
  return g && hex(el.backgroundColor) === g.from ? g : null;
}

/** The fields that give an element gradient `g` (null removes it; the fill stays `from`). */
export function gradientPatch(customData: Record<string, unknown> | null | undefined, g: Gradient | null): {
  customData: Record<string, unknown>;
  fillStyle?: "solid";
  backgroundColor?: string;
} {
  const rest = { ...(customData ?? {}) };
  delete rest[GRADIENT_KEY];
  if (!g) return { customData: rest };
  return { customData: { ...rest, [GRADIENT_KEY]: { ...g } }, fillStyle: "solid", backgroundColor: g.from };
}

export function sameGradient(a: Gradient | null, b: Gradient | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.from === b.from && a.to === b.to && (a.kind === "radial" || a.angle === b.angle);
}

export function gradientPresetOf(g: Gradient | null): GradientPresetId | null {
  return g ? (GRADIENT_PRESET_IDS.find((id) => sameGradient(GRADIENT_PRESETS[id].gradient, g)) ?? null) : null;
}

/** Linear: the gradient line across a w x h box (local coords) so `from`/`to` sit on opposite corners' projections. */
export function linearEnds(g: Gradient, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const r = (g.angle * Math.PI) / 180;
  const ux = Math.cos(r), uy = Math.sin(r);
  const half = Math.abs((w / 2) * ux) + Math.abs((h / 2) * uy);
  const cx = w / 2, cy = h / 2;
  const q = (v: number) => Math.round(v * 1000) / 1000 + 0; // + 0 turns -0 into 0
  return { x1: q(cx - ux * half), y1: q(cy - uy * half), x2: q(cx + ux * half), y2: q(cy + uy * half) };
}

/** Radial: centre and radius reaching the box corners. */
export function radialEnds(w: number, h: number): { cx: number; cy: number; r: number } {
  return { cx: w / 2, cy: h / 2, r: Math.hypot(w, h) / 2 };
}

/** CSS for previews. */
export function cssGradient(g: Gradient): string {
  return g.kind === "radial" ? `radial-gradient(circle, ${g.from}, ${g.to})` : `linear-gradient(${g.angle + 90}deg, ${g.from}, ${g.to})`;
}

/**
 * Agent / style input: a preset name, {preset?, from?, to?, kind?, angle?} or null/"none" (remove).
 * Colors must be hex here; callers resolve color names first. Throws on anything unreadable.
 */
export function resolveGradientInput(v: unknown): Gradient | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === false || v === "none") return null;
  if (typeof v === "string") {
    const p = GRADIENT_PRESETS[v.trim().toLowerCase() as GradientPresetId];
    if (!p) throw new Error(`Unknown gradient "${v}". Use one of: ${GRADIENT_PRESET_IDS.join(", ")}, or none.`);
    return { ...p.gradient };
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    let base: Partial<Gradient> = {};
    if (o.preset !== undefined) {
      const p = GRADIENT_PRESETS[String(o.preset).toLowerCase() as GradientPresetId];
      if (!p) throw new Error(`Unknown gradient preset "${String(o.preset)}". Use one of: ${GRADIENT_PRESET_IDS.join(", ")}.`);
      base = p.gradient;
    }
    if (o.kind !== undefined && o.kind !== "linear" && o.kind !== "radial") throw new Error(`gradient kind must be linear or radial`);
    const g = normalizeGradient({ ...base, ...o });
    if (!g) throw new Error("gradient needs from and to colors (hex like #a5d8ff)");
    return g;
  }
  throw new Error("gradient must be a preset name, {preset?, from, to, kind: linear|radial, angle} or null.");
}

/** draw.io `gradientDirection` for a gradient (draw.io has four directions and radial). */
export function drawioDirection(g: Gradient): string {
  if (g.kind === "radial") return "radial";
  const a = ((Math.round(g.angle / 90) * 90) % 360 + 360) % 360;
  return a === 0 ? "east" : a === 90 ? "south" : a === 180 ? "west" : "north";
}

/** draw.io fill + gradient -> gradient (direction default south, like draw.io). */
export function gradientFromDrawio(fill: string | undefined, gradientColor: string | undefined, direction: string | undefined): Gradient | null {
  const from = hex(fill);
  const to = hex(gradientColor);
  if (!from || !to) return null;
  if (direction === "radial") return { kind: "radial", from, to, angle: 90 };
  const angle = direction === "east" ? 0 : direction === "west" ? 180 : direction === "north" ? 270 : 90;
  return { kind: "linear", from, to, angle };
}
