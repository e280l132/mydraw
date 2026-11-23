// Safety net for arrow labels (pure, tests/labelGuard.test.ts).
//
// An arrow's label is a bound text element that must sit on its arrow. Every code path that builds
// or edits arrows places it (`labelPoint`), but a label that ends up far from its arrow is such a
// visible defect (it floats in empty canvas, far from what it describes) that the agent executor
// checks for it after every change and puts it back, whatever the cause.
import type { Point } from "./geometry";

/** The part of an element the guard reads. */
export interface GuardEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  /** Arrow points, relative to (x, y). */
  points?: readonly (readonly [number, number])[];
  containerId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
}

/**
 * Where Excalidraw puts an arrow's label: the middle point of an odd number of points, else the
 * middle of the middle segment.
 */
export function labelPoint(route: readonly Point[]): Point {
  const n = route.length;
  if (n % 2 === 1) return route[(n - 1) / 2];
  const a = route[n / 2 - 1];
  const b = route[n / 2];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Distance from `p` to the segment a-b. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the polyline through `pts`. */
export function distToPolyline(p: Point, pts: readonly Point[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/** A label farther than this from its arrow is detached (curved arrows differ from the polyline by far less). */
export const DETACHED_PX = 60;
/** ... or farther than this for a wide label, which sits further out when placed beside a vertical arrow. */
const detachedLimit = (labelWidth: number) => Math.max(DETACHED_PX, labelWidth / 2 + 24);

/** The arrow's points in scene coordinates. */
export function absolutePoints(arrow: Pick<GuardEl, "x" | "y" | "points">): Point[] {
  return (arrow.points ?? []).map(([px, py]) => ({ x: arrow.x + px, y: arrow.y + py }));
}

/**
 * Labels (of `arrowIds`, or of every arrow) that are detached from their arrow, with the position
 * that puts them back at the arrow's label point. Labels near their arrow are left alone.
 */
export function detachedLabels(elements: readonly GuardEl[], arrowIds?: ReadonlySet<string>): Map<string, { x: number; y: number }> {
  const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const fixes = new Map<string, { x: number; y: number }>();
  for (const arrow of byId.values()) {
    if (arrow.type !== "arrow" || (arrowIds && !arrowIds.has(arrow.id))) continue;
    const ref = arrow.boundElements?.find((b) => b.type === "text");
    const label = ref ? byId.get(ref.id) : undefined;
    const pts = absolutePoints(arrow);
    if (!label || label.containerId !== arrow.id || pts.length < 2) continue;
    const center = { x: label.x + label.width / 2, y: label.y + label.height / 2 };
    if (distToPolyline(center, pts) <= detachedLimit(label.width)) continue;
    const mid = labelPoint(pts);
    fixes.set(label.id, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 });
  }
  return fixes;
}
