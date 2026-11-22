// Quick connect (hover a shape -> "+" handles -> a connected node beside it): where the new node
// goes. Pure, unit-tested in tests/quickConnect.test.ts.
import { placeBeside, type Box, type Side } from "./geometry";

export type QuickSide = "top" | "right" | "bottom" | "left";
export const QUICK_SIDES: readonly QuickSide[] = ["top", "right", "bottom", "left"];

/** Distance between the source and a new connected node (room for the arrow). */
export const QUICK_GAP = 80;
/** Distance between the source and a plain copy (no arrow): close, like a row of icons. */
export const QUICK_COPY_GAP = 20;
/** Free space kept around a plain copy (to other elements). */
export const QUICK_COPY_MARGIN = 10;
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
  /**
   * The shape the source sits in (a container drawn around it). The new node is kept inside it when
   * there is room, trying smaller gaps before giving up and placing it outside as usual.
   */
  within?: Box;
  /** Smallest gap tried when squeezing the node into `within` (default 30, room for a short arrow). */
  minGap?: number;
}

/** Gaps tried, in order, when the node has to fit inside `within`. */
const INSIDE_GAPS = [QUICK_GAP, 60, 44, 30, 20, 12];
/** Free space kept between a node placed inside a container and the container's edge. */
const INSIDE_PAD = 8;

const insideBox = (b: Box, w: Box, pad: number) => b.x >= w.x + pad && b.y >= w.y + pad && b.x + b.width <= w.x + w.width - pad && b.y + b.height <= w.y + w.height - pad;

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
  const within = o.within;
  if (within) {
    const minGap = o.minGap ?? 30;
    for (const g of [gap, ...INSIDE_GAPS.filter((x) => x < gap && x >= minGap)]) {
      const found = search(o, content, g, margin, (b) => insideBox(b, within, INSIDE_PAD));
      if (found) return found;
    }
  }
  return search(o, content, gap, margin, () => true) ?? centred(o, content, gap);
}

function centred(o: QuickPlaceInput, content: Box, gap: number): Box {
  const { dx, dy } = placeBeside(content, content, o.source, o.source, PLACE_SIDE[o.side], gap);
  return { ...content, x: dx, y: dy };
}

/** The nearest spot (by rings of equal distance) where `accept` holds and nothing is overlapped, or null. */
function search(o: QuickPlaceInput, content: Box, gap: number, margin: number, accept: (b: Box) => boolean): Box | null {
  const base = centred(o, content, gap);
  const horizontal = o.side === "left" || o.side === "right";
  const outward = o.side === "right" || o.side === "bottom" ? 1 : -1;
  const across = horizontal ? o.size.height : o.size.width;
  const along = horizontal ? o.size.width : o.size.height;
  const acrossStep = Math.max(10, (across + margin) / 2);
  const outStep = Math.max(10, (along + margin) / 2);
  const free = (b: Box) => accept(b) && !o.obstacles.some((ob) => boxesOverlap(b, ob, margin));
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
  return null;
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

// ---------- units: what quick connect starts from ----------
// A "unit" is one thing as the user sees it: a shape, an icon node, a stencil from the Stencils
// panel (a bare image plus an optional free caption), or a group of elements. The arrow binds to one
// element of the unit (the anchor); the whole unit is what gets copied and what the box is measured on.

/** The bits of an element the anchor choice needs. */
export interface UnitEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Set for text that sits inside a shape (it is part of that shape, never an anchor). */
  containerId?: string | null;
}

const BODY_TYPES = new Set(["rectangle", "ellipse", "diamond", "image"]);

export const OPPOSITE_SIDE: Record<QuickSide, QuickSide> = { top: "bottom", right: "left", bottom: "top", left: "right" };

/** The main element of a unit: the biggest shape or image (first on ties); else the biggest free text. */
export function pickPrimary<T extends UnitEl>(members: readonly T[]): T | null {
  let best: T | null = null;
  for (const m of members) {
    if (!BODY_TYPES.has(m.type)) continue;
    if (!best || m.width * m.height > best.width * best.height) best = m;
  }
  if (best) return best;
  for (const m of members) {
    if (m.type !== "text" || m.containerId) continue;
    if (!best || m.width * m.height > best.width * best.height) best = m;
  }
  return best;
}

/**
 * The element an arrow on `side` of the unit binds to. Usually the main element; but a stencil's
 * free caption hangs below its image, so the bottom side binds to the caption (an arrow from the
 * image would run through the text).
 */
export function pickAnchor<T extends UnitEl>(members: readonly T[], side: QuickSide): T | null {
  const primary = pickPrimary(members);
  if (!primary) return null;
  const bodies = members.filter((m) => BODY_TYPES.has(m.type));
  if (side === "bottom" && primary.type !== "text") {
    const caption = members
      .filter((m) => m.type === "text" && !m.containerId && m.y >= primary.y + primary.height / 2)
      .sort((a, b) => b.y + b.height - (a.y + a.height))[0];
    if (caption) return caption;
  }
  if (bodies.length < 2) return primary;
  // A group of several shapes: the member on the clicked side (the one nearest the middle of that
  // side on ties), so the arrow doesn't cross the others.
  const all = unionBox(bodies)!;
  const cx = all.x + all.width / 2;
  const cy = all.y + all.height / 2;
  const edge = (m: T) => (side === "right" ? m.x + m.width : side === "left" ? -m.x : side === "bottom" ? m.y + m.height : -m.y);
  const off = (m: T) => (side === "left" || side === "right" ? Math.abs(m.y + m.height / 2 - cy) : Math.abs(m.x + m.width / 2 - cx));
  return [...bodies].sort((a, b) => edge(b) - edge(a) || off(a) - off(b))[0];
}

/** Smallest box containing all `boxes` (null for none). */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.width));
  const y2 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** The side of `target` that faces `source` (by their centres; left/right wins on a tie). */
export function facingSide(source: Box, target: Box): QuickSide {
  const dx = source.x + source.width / 2 - (target.x + target.width / 2);
  const dy = source.y + source.height / 2 - (target.y + target.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}
