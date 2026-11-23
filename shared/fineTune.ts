// Fine-tune sliders for stroke width, sloppiness (roughness) and edge radius: values beyond
// Excalidraw's three preset buttons. Pure, unit-tested (tests/fineTune.test.ts).
//
// Excalidraw renders any number for `strokeWidth` and `roughness`. A custom corner radius is
// `roundness: {type: 3 (ADAPTIVE_RADIUS), value}`, honoured only for rectangle/image/embeddable/
// iframe (`isUsingAdaptiveRadius`), and capped by the renderer at 25% of the shorter side.

export type FineTuneKind = "strokeWidth" | "roughness" | "radius";

export interface FineTuneSpec {
  kind: FineTuneKind;
  title: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Values of Excalidraw's own buttons: anything else lights up the fine-tune button. */
  presets: readonly number[];
}

export const ROUNDNESS_ADAPTIVE = 3;
/** Excalidraw's `DEFAULT_ADAPTIVE_RADIUS` (radius of its "Round" edges button). */
export const DEFAULT_RADIUS = 32;
/** Excalidraw's `DEFAULT_PROPORTIONAL_RADIUS`: the radius never exceeds this share of the shorter side. */
export const RADIUS_SHARE = 0.25;

export const FINE_TUNE: Record<FineTuneKind, FineTuneSpec> = {
  strokeWidth: { kind: "strokeWidth", title: "Stroke width", unit: "px", min: 0.5, max: 32, step: 0.5, presets: [1, 2, 4] },
  roughness: { kind: "roughness", title: "Sloppiness", unit: "", min: 0, max: 10, step: 0.25, presets: [0, 1, 2] },
  // `max` is per selection (radiusMax); this one bounds what the number box accepts.
  radius: { kind: "radius", title: "Corner radius", unit: "px", min: 0, max: 1000, step: 1, presets: [0, DEFAULT_RADIUS] },
};

/** Radio group name of the Excalidraw panel section each slider belongs to. */
export const FINE_TUNE_GROUP: Record<FineTuneKind, string> = {
  strokeWidth: "stroke-width",
  roughness: "sloppiness",
  radius: "edges",
};

/** Slider positions run 0..SLIDER_STEPS; the value grows with the square so small values stay precise. */
export const SLIDER_STEPS = 1000;
const CURVE = 2;

export const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function sliderToValue(pos: number, min: number, max: number, step: number): number {
  const t = clamp(pos / SLIDER_STEPS, 0, 1);
  return clamp(Number(roundTo(min + (max - min) * t ** CURVE, step).toFixed(4)), min, max);
}

export function valueToSlider(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  const t = clamp((value - min) / (max - min), 0, 1);
  return Math.round(t ** (1 / CURVE) * SLIDER_STEPS);
}

/** Clamp + round untrusted input (number box) for a slider with bounds `min..max`. */
export function cleanValue(raw: number, min: number, max: number, step: number): number | null {
  if (!Number.isFinite(raw)) return null;
  return clamp(Number(roundTo(raw, step).toFixed(4)), min, max);
}

/** What the sliders need to know about an element (a subset of ExcalidrawElement). */
export interface TunableElement {
  type: string;
  width: number;
  height: number;
  strokeWidth: number;
  roughness: number;
  roundness: { type: number; value?: number } | null;
  customData?: Record<string, unknown>;
}

const STROKE_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "freedraw", "embeddable", "iframe"]);
const ROUGH_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow", "line"]);
const RADIUS_TYPES = new Set(["rectangle", "image", "embeddable", "iframe"]);

/** Whether slider `kind` changes element `el`. Icon-node containers (borderless) are left alone. */
export function canTune(kind: FineTuneKind, el: TunableElement): boolean {
  if (el.customData?.mydrawNode === "icon") return false;
  if (kind === "strokeWidth") return STROKE_TYPES.has(el.type);
  if (kind === "roughness") return ROUGH_TYPES.has(el.type);
  return RADIUS_TYPES.has(el.type);
}

/** The largest radius the renderer draws for an element: 25% of its shorter side. */
export function radiusCap(el: Pick<TunableElement, "width" | "height">): number {
  return Math.min(Math.abs(el.width), Math.abs(el.height)) * RADIUS_SHARE;
}

/** The corner radius an element is drawn with (0 = sharp). */
export function drawnRadius(el: TunableElement): number {
  const r = el.roundness;
  if (!r) return 0;
  const cap = radiusCap(el);
  if (r.type === ROUNDNESS_ADAPTIVE) return Math.min(r.value ?? DEFAULT_RADIUS, cap);
  return cap; // proportional / legacy: always 25%
}

/** Radius slider maximum for a selection: the biggest radius any of them can show (at least 8). */
export function radiusMax(els: readonly TunableElement[]): number {
  const cap = els.reduce((m, e) => Math.max(m, radiusCap(e)), 0);
  return Math.max(8, Math.ceil(cap));
}

/** The element's current value for `kind`. */
export function readValue(kind: FineTuneKind, el: TunableElement): number {
  if (kind === "strokeWidth") return el.strokeWidth;
  if (kind === "roughness") return el.roughness;
  const r = el.roundness;
  if (!r) return 0;
  return r.type === ROUNDNESS_ADAPTIVE ? (r.value ?? DEFAULT_RADIUS) : Math.round(radiusCap(el));
}

/** The value shown for a selection: the first element's, and whether the others differ. */
export function selectionValue(kind: FineTuneKind, els: readonly TunableElement[]): { value: number; mixed: boolean } | null {
  if (!els.length) return null;
  const value = readValue(kind, els[0]);
  return { value, mixed: els.some((e) => readValue(kind, e) !== value) };
}

/** True when the selection uses a value none of Excalidraw's buttons gives. */
export function isCustom(kind: FineTuneKind, els: readonly TunableElement[]): boolean {
  return els.some((e) => {
    if (kind === "radius") return e.roundness?.type === ROUNDNESS_ADAPTIVE && e.roundness.value !== undefined && e.roundness.value !== DEFAULT_RADIUS;
    return !FINE_TUNE[kind].presets.includes(readValue(kind, e));
  });
}

/** The element fields to change for `kind` = `value`. */
export function patchFor(kind: FineTuneKind, value: number): Partial<TunableElement> {
  if (kind === "strokeWidth") return { strokeWidth: value };
  if (kind === "roughness") return { roughness: value };
  return { roundness: value > 0 ? { type: ROUNDNESS_ADAPTIVE, value } : null };
}
