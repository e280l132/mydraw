// Hatch / cross-hatch (and the other roughjs pattern fills) line width and spacing.
// Excalidraw derives both from the stroke width (`fillWeight = strokeWidth / 2`,
// `hachureGap = strokeWidth * 4`), so a thicker outline also meant thicker, sparser hatching.
// `customData.mydrawFillPattern = {weight, gap}` stores them on their own; the patched roughjs
// options (scripts/excalidrawPatch.mjs, `patchFillPattern`) ask `fillPatternFor(element)` first.
// When an element's stroke width changes and it has no stored pattern yet, the pattern it had is
// pinned (`patternPins`, `pinPatternPatch`), so the stroke width only changes the outline. Pure.

export const PATTERN_KEY = "mydrawFillPattern";

export interface FillPattern {
  /** Width of the pattern's lines/dots, px. */
  weight: number;
  /** Distance between the pattern's lines, px. */
  gap: number;
}

export const PATTERN_WEIGHT = { min: 0.25, max: 8, step: 0.25 } as const;
export const PATTERN_GAP = { min: 2, max: 48, step: 1 } as const;

/** Element types whose fill roughjs draws as a pattern. */
const PATTERNED = new Set(["rectangle", "diamond", "ellipse", "line", "iframe", "embeddable"]);

export const takesPattern = (type: string) => PATTERNED.has(type);

type Loose = Record<string, unknown>;
interface PatternElement {
  type: string;
  strokeWidth: number;
  customData?: Loose | null;
}

/** What Excalidraw draws for stroke width `sw`. */
export const defaultPattern = (sw: number): FillPattern => ({ weight: sw / 2, gap: sw * 4 });

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Validate an untrusted pattern; null when it isn't one. */
export function normalizePattern(v: unknown): FillPattern | null {
  if (!v || typeof v !== "object") return null;
  const { weight, gap } = v as Loose;
  if (typeof weight !== "number" || typeof gap !== "number" || !Number.isFinite(weight) || !Number.isFinite(gap)) return null;
  return { weight: clamp(weight, PATTERN_WEIGHT.min, PATTERN_WEIGHT.max), gap: clamp(gap, PATTERN_GAP.min, PATTERN_GAP.max) };
}

/**
 * Untrusted input (agent, styles, build_diagram): null = follow the stroke width again; an object with
 * `weight` and/or `gap` (missing ones from `base`). Throws on anything else.
 */
export function resolvePatternInput(v: unknown, base: FillPattern): FillPattern | null {
  if (v === null) return null;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("fillPattern must be {weight?, gap?} (px) or null");
  const o = v as Loose;
  for (const k of ["weight", "gap"] as const) {
    if (o[k] !== undefined && (typeof o[k] !== "number" || !Number.isFinite(o[k]))) throw new Error(`fillPattern ${k} must be a number`);
  }
  if (o.weight === undefined && o.gap === undefined) throw new Error("fillPattern needs weight and/or gap");
  return normalizePattern({ weight: o.weight ?? base.weight, gap: o.gap ?? base.gap });
}

/** The stored pattern, or null (= follows the stroke width). */
export const storedPattern = (el: { customData?: Loose | null }): FillPattern | null => normalizePattern(el.customData?.[PATTERN_KEY]);

/** The pattern an element is drawn with. */
export const patternOf = (el: PatternElement): FillPattern => storedPattern(el) ?? defaultPattern(el.strokeWidth);

/** Render hook: roughjs options for a stored pattern, undefined = Excalidraw's own. */
export function fillPatternFor(el: PatternElement): { fillWeight: number; hachureGap: number } | undefined {
  const p = takesPattern(el.type) ? storedPattern(el) : null;
  return p ? { fillWeight: p.weight, hachureGap: p.gap } : undefined;
}

/** customData with pattern `p` (null removes it: the pattern follows the stroke width again). Always an object. */
export function withPattern(data: Loose | null | undefined, p: FillPattern | null): Loose {
  const out: Loose = { ...(data ?? {}) };
  if (p) out[PATTERN_KEY] = { weight: p.weight, gap: p.gap };
  else delete out[PATTERN_KEY];
  return out;
}

/**
 * Extra fields for changing `el`'s stroke width to `sw`: pins the pattern it has now when it has none
 * stored. Empty when nothing needs pinning.
 */
export function pinPatternPatch(el: PatternElement, sw: number): { customData?: Loose } {
  if (!takesPattern(el.type) || storedPattern(el) || sw === el.strokeWidth) return {};
  return { customData: withPattern(el.customData, defaultPattern(el.strokeWidth)) };
}

/**
 * Elements whose stroke width changed (since `basis`, id -> the width their pattern follows) without
 * a stored pattern: they get the pattern of their old width. Returns the pins and the next basis.
 */
export function patternPins(
  basis: ReadonlyMap<string, number> | null,
  elements: readonly (PatternElement & { id: string; isDeleted?: boolean })[],
): { pins: { id: string; pattern: FillPattern }[]; basis: Map<string, number> } {
  const next = new Map<string, number>();
  const pins: { id: string; pattern: FillPattern }[] = [];
  for (const e of elements) {
    if (e.isDeleted || !takesPattern(e.type)) continue;
    const old = basis?.get(e.id);
    const stored = storedPattern(e);
    if (stored) {
      // A pinned default pattern remembers the width it came from: an undo that takes the pin away
      // together with the stroke change then finds nothing to pin.
      next.set(e.id, stored.gap === stored.weight * 8 ? stored.weight * 2 : e.strokeWidth);
    } else if (old !== undefined && old !== e.strokeWidth) {
      pins.push({ id: e.id, pattern: defaultPattern(old) });
      next.set(e.id, old);
    } else next.set(e.id, e.strokeWidth);
  }
  return { pins, basis: next };
}
