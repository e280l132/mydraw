// Quick connect (hover a shape -> "+" handles -> a connected node beside it): where the new node
// goes. Pure, unit-tested in tests/quickConnect.test.ts.
import { placeBeside, type Box, type Side } from "./geometry";

export type QuickSide = "top" | "right" | "bottom" | "left";
export const QUICK_SIDES: readonly QuickSide[] = ["top", "right", "bottom", "left"];

/** Distance between the source and the new node. */
export const QUICK_GAP = 80;
/** Free space kept around the new node (to other elements). */
export const QUICK_MARGIN = 20;
/** How far the search for a free spot goes (in half-node steps). */
const MAX_RING = 16;

const PLACE_SIDE: Record<QuickSide, Side> = { top: "above", right: "right_of", bottom: "below", left: "left_of" };

/** Do two boxes overlap (or come closer than `margin`)? Touching edges with margin 0 don't. */
export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;
}

export interface QuickPlaceInput {
  /** The shape the new node connects from. */
  source: Box;
  side: QuickSide;
  /** Size of the new node. */
  size: { width: number; height: number };
  /** Boxes of the other elements the new node must not overlap. */
  obstacles: readonly Box[];
  gap?: number;
  margin?: number;
}

/**
 * Box for a new node on `side` of `source`, `gap` away and centred on it (so a connector between
 * them is straight). When that spot is taken, the node slides along the side (both ways, nearest
 * first) or moves further out, whichever is closer, until it overlaps nothing. If no free spot is
 * found nearby, the centred spot is returned.
 */
export function quickConnectBox(o: QuickPlaceInput): Box {
  const gap = o.gap ?? QUICK_GAP;
  const margin = o.margin ?? QUICK_MARGIN;
  const content: Box = { x: 0, y: 0, width: o.size.width, height: o.size.height };
  const { dx, dy } = placeBeside(content, content, o.source, o.source, PLACE_SIDE[o.side], gap);
  const base: Box = { ...content, x: dx, y: dy };
  const horizontal = o.side === "left" || o.side === "right";
  const outward = o.side === "right" || o.side === "bottom" ? 1 : -1;
  const across = horizontal ? o.size.height : o.size.width;
  const along = horizontal ? o.size.width : o.size.height;
  const acrossStep = Math.max(10, (across + margin) / 2);
  const outStep = Math.max(10, (along + margin) / 2);
  const free = (b: Box) => !o.obstacles.some((ob) => boxesOverlap(b, ob, margin));
  const at = (out: number, slide: number): Box =>
    horizontal
      ? { ...base, x: base.x + outward * out * outStep, y: base.y + slide * acrossStep }
      : { ...base, x: base.x + slide * acrossStep, y: base.y + outward * out * outStep };

  // Rings of equal distance (in steps): sliding first, then pushing out; down/right before up/left.
  for (let ring = 0; ring <= MAX_RING; ring++) {
    for (let out = 0; out <= ring; out++) {
      const k = ring - out;
      for (const slide of k === 0 ? [0] : [k, -k]) {
        const b = at(out, slide);
        if (free(b)) return b;
      }
    }
  }
  return base;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** `outer` grown so it contains `inner` with `pad` around it, or null when it already does. */
export function growToContain(outer: Box, inner: Box, pad: Padding): Box | null {
  const x1 = Math.min(outer.x, inner.x - pad.left);
  const y1 = Math.min(outer.y, inner.y - pad.top);
  const x2 = Math.max(outer.x + outer.width, inner.x + inner.width + pad.right);
  const y2 = Math.max(outer.y + outer.height, inner.y + inner.height + pad.bottom);
  if (x1 === outer.x && y1 === outer.y && x2 === outer.x + outer.width && y2 === outer.y + outer.height) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
