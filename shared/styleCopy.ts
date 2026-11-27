// Style Brush: pick up an element's look and paint parts of it onto other elements. Pure: the brush
// overlay (web/src/StyleBrush.tsx), "Paste look" and the agent's `copy_look` all go through here.
//
// A look is split into four parts the user switches on and off (fill is on by default):
//   fill    backgroundColor, fillStyle, gradient (customData.mydrawGradient), hatch pattern (mydrawFillPattern)
//   stroke  strokeColor, strokeWidth, strokeStyle incl. extra dashes (customData.mydrawDash), roughness
//   effects shadow (customData.mydrawShadow), opacity
//   text    font, size, colour and outline (customData.mydrawTextOutline) of a text or a shape's label
// `lookUpdates` turns a look into update objects for `applyUpdates` (web/src/agent/sceneOps.ts), which
// already knows how to store gradients, dashes, shadows and outlines (an icon node's shadow goes on
// its image, a shape's outline on its label). Only parts the target can take are emitted.
import { dashOf } from "./dash";
import { canGradient, cssGradient, gradientOf, type Gradient } from "./gradient";
import { canShadow, shadowOf, type Shadow } from "./shadow";
import { patternOf, type FillPattern } from "./fillPattern";
import { outlineOf, type TextOutline } from "./textOutline";

export type LookPart = "fill" | "stroke" | "effects" | "text";
export const LOOK_PARTS: readonly LookPart[] = ["fill", "stroke", "effects", "text"];
export const LOOK_PART_LABELS: Record<LookPart, string> = { fill: "Fill", stroke: "Stroke", effects: "Shadow", text: "Text" };
export const DEFAULT_LOOK_PARTS: readonly LookPart[] = ["fill"];

export const isLookPart = (v: unknown): v is LookPart => typeof v === "string" && (LOOK_PARTS as readonly string[]).includes(v);

/** Parts from untrusted input (localStorage, agent); falls back to the default. */
export function normalizeLookParts(v: unknown): LookPart[] {
  if (!Array.isArray(v)) return [...DEFAULT_LOOK_PARTS];
  const out = LOOK_PARTS.filter((p) => v.includes(p));
  return out.length ? out : [...DEFAULT_LOOK_PARTS];
}

/** The minimum an element needs to look like for this module. */
export interface LookEl {
  id: string;
  type: string;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  fontFamily?: number;
  fontSize?: number;
  locked?: boolean;
  customData?: Record<string, unknown> | null;
}

export interface Look {
  /** `pattern`: hatch line width + spacing as drawn (shared/fillPattern.ts), only for pattern fills. */
  fill?: { backgroundColor: string; fillStyle: string; gradient: Gradient | null; pattern?: FillPattern };
  stroke?: { strokeColor: string; strokeWidth: number; strokeStyle: string; roughness: number };
  effects?: { shadow: Shadow | null; opacity?: number };
  text?: { fontFamily: number; fontSize: number; strokeColor: string; textOutline: TextOutline | null };
}

/** What an element is, for picking up or painting a look. */
export interface LookTarget {
  el: LookEl;
  /** Bound text of a shape or arrow (icon node: its caption). */
  label?: LookEl;
  /** Icon node (container) -> its image. */
  iconImage?: LookEl;
}

const FILLABLE = (el: LookEl) => canGradient(el.type);
const STROKABLE = new Set(["rectangle", "diamond", "ellipse", "arrow", "line"]);
const isIconNode = (el: LookEl) => el.customData?.mydrawNode === "icon";
const isZone = (el: LookEl) => !!el.customData?.mydrawZone || !!el.customData?.mydrawZoneTitle;
const isLegend = (el: LookEl) => !!el.customData?.mydrawLegend;
const visibleColor = (c: string | undefined): c is string => !!c && c !== "transparent";

function textLook(t: LookEl): Look["text"] {
  if (t.type !== "text" || typeof t.fontFamily !== "number" || typeof t.fontSize !== "number") return undefined;
  return { fontFamily: t.fontFamily, fontSize: t.fontSize, strokeColor: t.strokeColor ?? "#1e1e1e", textOutline: outlineOf(t) };
}

/** Pick up the look of `t.el`. Parts it has nothing for stay undefined. */
export function captureLook(t: LookTarget): Look {
  const { el } = t;
  const look: Look = {};
  if (isIconNode(el)) {
    // An icon's fill is its icon colour; its shadow sits on the image.
    const color = t.iconImage?.customData?.mydrawIconColor;
    if (typeof color === "string" && visibleColor(color)) look.fill = { backgroundColor: color, fillStyle: "solid", gradient: null };
    if (t.iconImage) look.effects = { shadow: shadowOf(t.iconImage) };
    const caption = t.label && textLook(t.label);
    if (caption) look.text = caption;
    return look;
  }
  if (el.type === "text") {
    const tl = textLook(el);
    if (tl) look.text = tl;
    look.effects = { shadow: shadowOf(el), opacity: el.opacity };
    return look;
  }
  if (FILLABLE(el)) {
    const g = gradientOf(el);
    const fillStyle = el.fillStyle ?? "solid";
    look.fill = { backgroundColor: el.backgroundColor ?? "transparent", fillStyle, gradient: g };
    if (fillStyle !== "solid" && !g) look.fill.pattern = patternOf({ type: el.type, strokeWidth: el.strokeWidth ?? 2, customData: el.customData });
  }
  if (STROKABLE.has(el.type)) {
    look.stroke = {
      strokeColor: el.strokeColor ?? "#1e1e1e",
      strokeWidth: el.strokeWidth ?? 2,
      strokeStyle: dashOf(el) ?? el.strokeStyle ?? "solid",
      roughness: el.roughness ?? 0,
    };
  }
  if (canShadow(el.type)) look.effects = { shadow: shadowOf(el), opacity: el.opacity };
  const label = t.label && textLook(t.label);
  if (label) look.text = label;
  return look;
}

/** Parts of `look` (among `parts`) that `t` can take. */
export function partsFor(look: Look, t: LookTarget, parts: readonly LookPart[]): LookPart[] {
  const { el } = t;
  if (el.locked || isZone(el) || isLegend(el)) return [];
  const icon = isIconNode(el);
  return parts.filter((p) => {
    if (!look[p]) return false;
    switch (p) {
      case "fill":
        if (icon) return !!t.iconImage && iconColorOf(look) !== null;
        return FILLABLE(el);
      case "stroke":
        return !icon && STROKABLE.has(el.type);
      case "effects":
        return icon ? !!t.iconImage : canShadow(el.type) && el.type !== "image";
      case "text":
        return el.type === "text" || !!t.label;
    }
  });
}

/** The colour an icon gets from a fill: a gradient's start, else the fill colour (none when transparent). */
export function iconColorOf(look: Look): string | null {
  const f = look.fill;
  if (!f) return null;
  const c = f.gradient?.from ?? f.backgroundColor;
  return visibleColor(c) ? c : null;
}

export interface LookChange {
  /** Updates for applyUpdates (ids of the target and/or its label). */
  updates: Record<string, unknown>[];
  /** The label whose font changed: its container must re-fit it (applyUpdates `label`). */
  refit?: string;
  /** Icon node: recolour its image to this colour. */
  iconColor?: { imageId: string; color: string };
}

/** What painting `look` onto `t` changes (null when nothing applies). */
export function lookUpdates(look: Look, t: LookTarget, parts: readonly LookPart[]): LookChange | null {
  const use = partsFor(look, t, parts);
  if (!use.length) return null;
  const { el } = t;
  const icon = isIconNode(el);
  const own: Record<string, unknown> = { id: el.id };
  const out: LookChange = { updates: [] };

  if (use.includes("fill")) {
    if (icon) {
      out.iconColor = { imageId: t.iconImage!.id, color: iconColorOf(look)! };
    } else {
      const f = look.fill!;
      own.backgroundColor = f.backgroundColor;
      own.fillStyle = f.fillStyle;
      // null takes a gradient off; a gradient sets fillStyle solid + backgroundColor = from itself.
      own.gradient = f.gradient ? { ...f.gradient } : null;
      // The hatch as the source draws it (its own stroke width may differ from the target's).
      if (f.pattern) own.fillPattern = { ...f.pattern };
    }
  }
  if (use.includes("stroke")) {
    const s = look.stroke!;
    Object.assign(own, { strokeColor: s.strokeColor, strokeWidth: s.strokeWidth, strokeStyle: s.strokeStyle, roughness: s.roughness });
  }
  if (use.includes("effects")) {
    const e = look.effects!;
    own.shadow = e.shadow ? { ...e.shadow } : null;
    if (!icon && e.opacity !== undefined) own.opacity = e.opacity;
  }
  if (use.includes("text")) {
    const tx = look.text!;
    const textEl = el.type === "text" ? el : t.label!;
    const fontChanged = textEl.fontFamily !== tx.fontFamily || textEl.fontSize !== tx.fontSize;
    const tu: Record<string, unknown> = { strokeColor: tx.strokeColor };
    if (fontChanged) Object.assign(tu, { fontFamily: tx.fontFamily, fontSize: tx.fontSize });
    if (textEl === el) Object.assign(own, tu, { textOutline: tx.textOutline ? { ...tx.textOutline } : null });
    else {
      out.updates.push({ id: textEl.id, ...tu });
      own.textOutline = tx.textOutline ? { ...tx.textOutline } : null; // on a container: goes to its label
      if (fontChanged) out.refit = el.id;
    }
  }
  if (Object.keys(own).length > 1) out.updates.unshift(own);
  return out.updates.length || out.iconColor ? out : null;
}

/** CSS background showing a look's fill (HUD swatch). Patterns show as their colour. */
export function lookSwatchCss(look: Look): string | null {
  const f = look.fill;
  if (!f) return null;
  if (f.gradient) return cssGradient(f.gradient);
  return visibleColor(f.backgroundColor) ? f.backgroundColor : null;
}
