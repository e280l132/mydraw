// Extra stroke styles (dash patterns) beyond Excalidraw's solid / dashed / dotted. Stored as
// `customData.mydrawDash`; the element's own `strokeStyle` stays "dashed" or "dotted" (`DASH_STYLES[id].base`),
// so other apps (and Excalidraw before our patch runs) still draw a broken line. Drawn by Excalidraw's
// generator options (`strokeLineDash` in its roughjs options), patched in scripts/excalidrawPatch.mjs
// (`patchDash`) to ask `globalThis.__mydrawDash(element)` first. Pure: used by the hook, the panel, styles,
// the agent and draw.io.

export type DashId = "short-dash" | "long-dash" | "dash-dot" | "dash-dot-dot" | "fine-dot" | "sparse-dot";

export interface DashStyle {
  label: string;
  hint: string;
  /** The Excalidraw strokeStyle kept on the element as a fallback. */
  base: "dashed" | "dotted";
  /** Dash array in scene px for a stroke width (Excalidraw scales its own gaps the same way). */
  pattern(width: number): number[];
}

export const DASH_KEY = "mydrawDash";

export const DASH_STYLES: Record<DashId, DashStyle> = {
  "short-dash": { label: "Short dash", hint: "Short, close dashes", base: "dashed", pattern: (w) => [4, 4 + w] },
  "long-dash": { label: "Long dash", hint: "Long dashes", base: "dashed", pattern: (w) => [16, 8 + w] },
  "dash-dot": { label: "Dash dot", hint: "Dash, dot, dash (center line)", base: "dashed", pattern: (w) => [12, 5 + w, 1.5, 5 + w] },
  "dash-dot-dot": { label: "Dash dot dot", hint: "Dash and two dots (boundary line)", base: "dashed", pattern: (w) => [12, 5 + w, 1.5, 4 + w, 1.5, 5 + w] },
  "fine-dot": { label: "Dense dots", hint: "Dots close together", base: "dotted", pattern: (w) => [1.5, 3 + w] },
  "sparse-dot": { label: "Sparse dots", hint: "Dots far apart", base: "dotted", pattern: (w) => [1.5, 12 + w] },
};

export const DASH_IDS = Object.keys(DASH_STYLES) as DashId[];

/** Excalidraw's own patterns (for previews of its three styles). */
export const NATIVE_DASH = {
  solid: (_w: number): number[] => [],
  dashed: (w: number) => [8, 8 + w],
  dotted: (w: number) => [1.5, 6 + w],
};

export const isDashId = (v: unknown): v is DashId => typeof v === "string" && (DASH_IDS as string[]).includes(v);

type DashEl = { strokeStyle?: string; strokeWidth?: number; customData?: Record<string, unknown> | null } | null | undefined;

/**
 * The element's extra dash style, if any. Only while its `strokeStyle` is still the matching fallback:
 * picking Excalidraw's own Solid (or the other broken style) switches it off without touching customData.
 */
export function dashOf(el: DashEl): DashId | null {
  const id = el?.customData?.[DASH_KEY];
  return isDashId(id) && el?.strokeStyle === DASH_STYLES[id].base ? id : null;
}

/** The dash array to draw `el` with, or undefined to leave Excalidraw's own. */
export function dashArrayFor(el: DashEl): number[] | undefined {
  const id = dashOf(el);
  return id ? DASH_STYLES[id].pattern(el?.strokeWidth ?? 2) : undefined;
}

/** The fields that give an element dash style `id` (null = back to Excalidraw's `strokeStyle`). */
export function dashPatch(
  customData: Record<string, unknown> | null | undefined,
  id: DashId | null,
  strokeStyle: "solid" | "dashed" | "dotted" = "dashed",
): { strokeStyle: "solid" | "dashed" | "dotted"; customData: Record<string, unknown> } {
  const rest = { ...(customData ?? {}) };
  delete rest[DASH_KEY];
  if (!id) return { strokeStyle, customData: rest };
  return { strokeStyle: DASH_STYLES[id].base, customData: { ...rest, [DASH_KEY]: id } };
}

/** Every stroke style name the agent and styles accept. */
export const STROKE_STYLE_NAMES = ["solid", "dashed", "dotted", ...DASH_IDS] as const;
export type StrokeStyleName = (typeof STROKE_STYLE_NAMES)[number];

export function requireStrokeStyle(v: unknown): StrokeStyleName {
  if (typeof v !== "string" || !(STROKE_STYLE_NAMES as readonly string[]).includes(v)) {
    throw new Error(`strokeStyle must be one of ${STROKE_STYLE_NAMES.join(", ")}`);
  }
  return v as StrokeStyleName;
}

/** The element's stroke style as one name (an extra dash style wins over its fallback). */
export const strokeStyleName = (el: DashEl): string => dashOf(el) ?? el?.strokeStyle ?? "solid";

/** draw.io `dashPattern` (in units of the stroke width) for a dash array. */
export function drawioDashPattern(arr: number[], width: number): string {
  const w = width > 0 ? width : 1;
  return arr.map((v) => Math.max(0.5, Math.round((v / w) * 2) / 2)).join(" ");
}

/**
 * The stroke style closest to a draw.io dash pattern: Excalidraw's dashed / dotted or one of ours.
 * No (or an unreadable) pattern = draw.io's default dash = "dashed".
 */
export function strokeFromDrawio(pattern: string | undefined, width: number): "dashed" | "dotted" | DashId {
  const nums = (pattern ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n) || n < 0)) return "dashed";
  const w = width > 0 ? width : 1;
  const px = nums.map((n) => n * w);
  const candidates: ["dashed" | "dotted" | DashId, number[]][] = [
    ["dashed", NATIVE_DASH.dashed(width)],
    ["dotted", NATIVE_DASH.dotted(width)],
    ...DASH_IDS.map((id): [DashId, number[]] => [id, DASH_STYLES[id].pattern(width)]),
  ];
  let best: "dashed" | "dotted" | DashId = "dashed";
  let bestErr = Infinity;
  for (const [id, p] of candidates) {
    if (p.length !== px.length) continue;
    const err = p.reduce((sum, v, i) => sum + Math.abs(v - px[i]) / Math.max(v, 1), 0) / p.length;
    if (err < bestErr) {
      bestErr = err;
      best = id;
    }
  }
  // A long pattern of no known shape: dot-like (short first run) or dash-like.
  if (bestErr === Infinity) return px[0] <= 2 * w ? "dotted" : "dashed";
  return best;
}

/** The extra dash style for a draw.io dash pattern, or null when Excalidraw's own dashed / dotted is closest. */
export function dashFromDrawio(pattern: string | undefined, width: number): DashId | null {
  if (!pattern) return null;
  const s = strokeFromDrawio(pattern, width);
  return s === "dashed" || s === "dotted" ? null : s;
}
