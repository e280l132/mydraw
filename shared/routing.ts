// Connector routes between boxes: elbow (orthogonal), straight and curved. Pure, unit-tested.
import { center, type Box, type Point } from "./geometry";

export type Routing = "straight" | "elbow" | "curved";
export type Side = "left" | "right" | "top" | "bottom";

/** Distance between a bound elbow arrow's end and its shape (Excalidraw uses 5 for elbow arrows). */
export const ELBOW_GAP = 5;
/** Minimum free run out of a shape before an elbow turns. */
const MIN_RUN = 20;

export function sidePoint(b: Box, side: Side, gap = 0): Point {
  const c = center(b);
  switch (side) {
    case "left":
      return { x: b.x - gap, y: c.y };
    case "right":
      return { x: b.x + b.width + gap, y: c.y };
    case "top":
      return { x: c.x, y: b.y - gap };
    case "bottom":
      return { x: c.x, y: b.y + b.height + gap };
  }
}

/** Drop repeated points and middle points on a straight run. */
export function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) continue;
    out.push(p);
  }
  // Drop middle points on a straight run.
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1];
    const b = out[i + 1];
    return !((Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5) || (Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5));
  });
}

/**
 * Orthogonal route from box `a` to box `b`. Leaves and enters through the sides facing each other
 * (horizontal when the boxes are side by side, vertical when stacked) with one or two bends; boxes
 * that overlap on both axes are joined around their right sides.
 */
export function elbowRoute(a: Box, b: Box, gap = ELBOW_GAP): { points: Point[]; start: Side; end: Side } {
  const ca = center(a);
  const cb = center(b);
  const hGap = cb.x >= ca.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
  const vGap = cb.y >= ca.y ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
  const horizontal = hGap >= MIN_RUN && (hGap >= vGap || vGap < MIN_RUN);
  const vertical = !horizontal && vGap >= MIN_RUN;

  if (horizontal) {
    const start: Side = cb.x >= ca.x ? "right" : "left";
    const end: Side = start === "right" ? "left" : "right";
    const s = sidePoint(a, start, gap);
    const e = sidePoint(b, end, gap);
    // Same height band: a straight run at the overlap's middle.
    const top = Math.max(a.y, b.y);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    if (bottom - top > 8 && (Math.abs(s.y - e.y) < 0.5 || bottom - top > Math.min(a.height, b.height) * 0.6)) {
      const y = Math.abs(s.y - e.y) < 0.5 ? s.y : (top + bottom) / 2;
      return { points: dedupe([{ x: s.x, y }, { x: e.x, y }]), start, end };
    }
    const mx = (s.x + e.x) / 2;
    return { points: dedupe([s, { x: mx, y: s.y }, { x: mx, y: e.y }, e]), start, end };
  }
  if (vertical) {
    const start: Side = cb.y >= ca.y ? "bottom" : "top";
    const end: Side = start === "bottom" ? "top" : "bottom";
    const s = sidePoint(a, start, gap);
    const e = sidePoint(b, end, gap);
    const left = Math.max(a.x, b.x);
    const right = Math.min(a.x + a.width, b.x + b.width);
    if (right - left > 8 && (Math.abs(s.x - e.x) < 0.5 || right - left > Math.min(a.width, b.width) * 0.6)) {
      const x = Math.abs(s.x - e.x) < 0.5 ? s.x : (left + right) / 2;
      return { points: dedupe([{ x, y: s.y }, { x, y: e.y }]), start, end };
    }
    const my = (s.y + e.y) / 2;
    return { points: dedupe([s, { x: s.x, y: my }, { x: e.x, y: my }, e]), start, end };
  }
  // Overlapping or very close: go around the right-hand side.
  const s = sidePoint(a, "right", gap);
  const e = sidePoint(b, "right", gap);
  const x = Math.max(a.x + a.width, b.x + b.width) + MIN_RUN * 2;
  return { points: dedupe([s, { x, y: s.y }, { x, y: e.y }, e]), start: "right", end: "right" };
}

/**
 * A gently curved connector: start, one control point pushed sideways off the middle, end.
 * Excalidraw draws a smooth curve through the points of a "round" arrow.
 */
export function curvedPoints(start: Point, end: Point, bend = 0.18): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [start, end];
  const k = len * bend;
  return [start, { x: (start.x + end.x) / 2 - (dy / len) * k, y: (start.y + end.y) / 2 + (dx / len) * k }, end];
}

/** Where `p` sits relative to box `b`, as Excalidraw's fixedPoint ratio (0..1 inside the box). */
export function fixedPointFor(b: Box, p: Point): [number, number] {
  return [b.width ? (p.x - b.x) / b.width : 0.5, b.height ? (p.y - b.y) / b.height : 0.5];
}

/**
 * Pull the ends of an orthogonal route back by `gap` along its first/last segment, so the arrow
 * stops just short of the shapes (layout routes touch the outlines).
 */
export function inset(points: Point[], gap: number): Point[] {
  if (points.length < 2 || gap <= 0) return points;
  const out = points.map((p) => ({ ...p }));
  const pull = (i: number, j: number) => {
    const a = out[i];
    const b = out[j];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= gap * 2) return;
    a.x += ((b.x - a.x) / len) * gap;
    a.y += ((b.y - a.y) / len) * gap;
  };
  pull(0, 1);
  pull(out.length - 1, out.length - 2);
  return out;
}

/** True when every segment is horizontal or vertical. */
export function isOrthogonal(points: readonly Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].x - points[i - 1].x) > 0.5 && Math.abs(points[i].y - points[i - 1].y) > 0.5) return false;
  }
  return true;
}

/**
 * Tidy a layout's orthogonal route: drop redundant points and make the first and last runs at
 * least `min` long (so arrowheads have room), by moving the neighbouring bend when that keeps the
 * route orthogonal and doesn't flip a segment.
 */
export function tidyRoute(points: Point[], min = 20): Point[] {
  let pts = dedupe(points.map((p) => ({ ...p })));
  if (pts.length < 4) return pts;
  const fix = (end: number, next: number, bend: number) => {
    const e = pts[end];
    const a = pts[next];
    const b = pts[bend];
    const horizontal = Math.abs(e.y - a.y) < 0.5;
    const len = horizontal ? Math.abs(a.x - e.x) : Math.abs(a.y - e.y);
    if (len >= min) return;
    if (horizontal) {
      const dir = Math.sign(a.x - e.x) || 1;
      const x = e.x + dir * min;
      // The bend segment (a-b) is vertical; it moves with a. Don't pass the far end of the route.
      const far = pts[bend + (bend > next ? 1 : -1)];
      if (far && Math.sign(far.x - x) !== dir && Math.abs(far.x - x) > 0.5) return;
      a.x = x;
      b.x = x;
    } else {
      const dir = Math.sign(a.y - e.y) || 1;
      const y = e.y + dir * min;
      const far = pts[bend + (bend > next ? 1 : -1)];
      if (far && Math.sign(far.y - y) !== dir && Math.abs(far.y - y) > 0.5) return;
      a.y = y;
      b.y = y;
    }
  };
  fix(0, 1, 2);
  const n = pts.length;
  fix(n - 1, n - 2, n - 3);
  pts = dedupe(pts);
  return pts;
}
