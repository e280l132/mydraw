// Orthogonal connector routes that go AROUND shapes. Pure, unit-tested (tests/avoidRoute.test.ts).
//
// The route leaves the source straight out of its side (a short "stub"), finds the cheapest
// orthogonal path to the stub in front of the target's side (length + a penalty per bend), and
// enters the target straight. Obstacles are inflated by a clearance; the path runs on a sparse grid
// made of their edges (an orthogonal visibility graph), so it hugs obstacles at a steady distance
// instead of wandering. Bend points (waypoints) are passed in order. When the shapes are packed so
// tightly that no path fits, the clearance shrinks; as a last resort a plain elbow is returned
// (`ok: false`).
import type { Box, Point } from "./geometry";
import type { Side } from "./routing";

/** Direction of travel: 0 right, 1 down, 2 left, 3 up. */
type Dir = 0 | 1 | 2 | 3;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/** Travel direction straight out of a side. */
const OUT: Record<Side, Dir> = { right: 0, bottom: 1, left: 2, top: 3 };

export interface AvoidRouteInput {
  /** Port on the source (on or just outside its outline) and the side it leaves through. */
  start: Point;
  startSide?: Side;
  /** Port on the target and the side it is entered through; no side = a free end. */
  end: Point;
  endSide?: Side;
  /** Boxes to keep clear of (not the source and target: give those as startBox / endBox). */
  obstacles: readonly Box[];
  /** The source / target outlines: the route may not cross them, except for the stubs. */
  startBox?: Box;
  endBox?: Box;
  /** Points the route has to pass through, in order. */
  waypoints?: readonly Point[];
  /** Distance kept from obstacles (default 16). */
  clearance?: number;
  /** Straight run out of / into a shape before the first / after the last bend (default 20). */
  stub?: number;
  /** Cost of one bend, in px of length (default 40). */
  bendCost?: number;
}

export interface AvoidRoute {
  points: Point[];
  /** Length plus bend penalties: lower is better (used to pick the best side). */
  cost: number;
  /** False when no clear path was found and a plain elbow was returned. */
  ok: boolean;
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

const inflate = (b: Box, d: number): Rect => ({ l: b.x - d, t: b.y - d, r: b.x + b.width + d, b: b.y + b.height + d });
const strictlyInside = (p: Point, r: Rect) => p.x > r.l + 0.01 && p.x < r.r - 0.01 && p.y > r.t + 0.01 && p.y < r.b - 0.01;

/** Index of the smallest value >= v (values sorted). */
function lowerBound(values: readonly number[], v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < v - 1e-6) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Tiny binary heap keyed by f. */
class Heap {
  private items: Array<{ f: number; s: number }> = [];
  get size() {
    return this.items.length;
  }
  push(f: number, s: number) {
    const a = this.items;
    a.push({ f, s });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): { f: number; s: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

interface Leg {
  points: Point[];
  cost: number;
  /** Direction of travel on arrival. */
  dir: Dir;
}

/**
 * Drop repeated points and points in the middle of a straight run, but keep the corner of a
 * reversal (a dead end out to a waypoint and back must stay visible).
 */
function compress(pts: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out.filter((p, i) => {
    if (i === 0 || i === out.length - 1) return true;
    const a = out[i - 1];
    const b = out[i + 1];
    const sx1 = Math.sign(p.x - a.x);
    const sy1 = Math.sign(p.y - a.y);
    const sx2 = Math.sign(b.x - p.x);
    const sy2 = Math.sign(b.y - p.y);
    return !(sx1 === sx2 && sy1 === sy2);
  });
}

/**
 * Cheapest orthogonal path from `from` to `to` on the grid made of the rects' edges and the two
 * points. `startDirs`: allowed first directions with their extra cost; `endDir`: preferred direction
 * of travel on arrival (arriving any other way costs a bend, arriving the opposite way is not
 * allowed; null = any).
 */
/** Search buffers, reused between calls (the live preview plans on every pointer move). */
let bufN = 0;
let gBuf = new Float64Array(0);
let parentBuf = new Int32Array(0);
let blockedBuf = new Uint8Array(0);
let hBuf = new Uint8Array(0);
let vBuf = new Uint8Array(0);
function buffers(cells: number) {
  const states = cells * 4;
  if (states > bufN) {
    bufN = Math.max(states, bufN * 2);
    gBuf = new Float64Array(bufN);
    parentBuf = new Int32Array(bufN);
    blockedBuf = new Uint8Array(bufN / 4 + 1);
    hBuf = new Uint8Array(bufN / 4 + 1);
    vBuf = new Uint8Array(bufN / 4 + 1);
  }
  gBuf.fill(Infinity, 0, states);
  parentBuf.fill(-1, 0, states);
  blockedBuf.fill(0, 0, cells);
  hBuf.fill(0, 0, cells);
  vBuf.fill(0, 0, cells);
  return { g: gBuf, parent: parentBuf, blocked: blockedBuf, hBlock: hBuf, vBlock: vBuf };
}

function gridLeg(from: Point, to: Point, rects: readonly Rect[], startDirs: ReadonlyMap<Dir, number>, endDir: Dir | null, bendCost: number): Leg | null {
  if (rects.some((r) => strictlyInside(from, r) || strictlyInside(to, r))) return null;
  const xs = [...new Set([from.x, to.x, ...rects.flatMap((r) => [r.l, r.r])])].sort((a, b) => a - b);
  const ys = [...new Set([from.y, to.y, ...rects.flatMap((r) => [r.t, r.b])])].sort((a, b) => a - b);
  const nx = xs.length;
  const ny = ys.length;
  const id = (i: number, j: number) => i * ny + j;
  // hBlock[id(i,j)]: the edge (i,j)-(i+1,j) runs through an obstacle; vBlock: (i,j)-(i,j+1).
  const { g, parent, blocked, hBlock, vBlock } = buffers(nx * ny);
  for (const r of rects) {
    const i0 = lowerBound(xs, r.l);
    const i1 = lowerBound(xs, r.r); // xs[i1] >= r.r
    const j0 = lowerBound(ys, r.t);
    const j1 = lowerBound(ys, r.b);
    for (let i = i0; i <= Math.min(i1, nx - 1); i++) {
      for (let j = j0; j <= Math.min(j1, ny - 1); j++) {
        const x = xs[i];
        const y = ys[j];
        const inX = x > r.l + 0.01 && x < r.r - 0.01;
        const inY = y > r.t + 0.01 && y < r.b - 0.01;
        if (inX && inY) blocked[id(i, j)] = 1;
        // Horizontal edge to the right stays within [l, r] and runs at a y strictly inside.
        if (inY && i + 1 < nx && x >= r.l - 0.01 && xs[i + 1] <= r.r + 0.01) hBlock[id(i, j)] = 1;
        if (inX && j + 1 < ny && y >= r.t - 0.01 && ys[j + 1] <= r.b + 0.01) vBlock[id(i, j)] = 1;
      }
    }
  }
  const si = lowerBound(xs, from.x);
  const sj = lowerBound(ys, from.y);
  const ti = lowerBound(xs, to.x);
  const tj = lowerBound(ys, to.y);
  const goal = id(ti, tj);

  const heap = new Heap();
  const h = (i: number, j: number) => Math.abs(xs[i] - to.x) + Math.abs(ys[j] - to.y);
  for (const [d, extra] of startDirs) {
    const s = id(si, sj) * 4 + d;
    g[s] = extra;
    heap.push(extra + h(si, sj), s);
  }
  let found = -1;
  let foundCost = Infinity;
  while (heap.size) {
    const { f, s } = heap.pop();
    if (f >= foundCost) break; // nothing left can beat the best arrival
    const node = s >> 2;
    const d = (s & 3) as Dir;
    if (f - h(Math.floor(node / ny), node % ny) > g[s] + 1e-6) continue; // stale
    if (node === goal) {
      if (endDir === null || d !== (endDir + 2) % 4) {
        const total = g[s] + (endDir === null || d === endDir ? 0 : bendCost);
        if (total < foundCost) {
          foundCost = total;
          found = s;
        }
      }
      continue;
    }
    const i = Math.floor(node / ny);
    const j = node % ny;
    for (let nd = 0 as Dir; nd < 4; nd = (nd + 1) as Dir) {
      if (nd === ((d + 2) % 4)) continue; // no U-turns
      let ni = i;
      let nj = j;
      if (nd === 0) {
        if (i + 1 >= nx || hBlock[id(i, j)]) continue;
        ni = i + 1;
      } else if (nd === 2) {
        if (i === 0 || hBlock[id(i - 1, j)]) continue;
        ni = i - 1;
      } else if (nd === 1) {
        if (j + 1 >= ny || vBlock[id(i, j)]) continue;
        nj = j + 1;
      } else {
        if (j === 0 || vBlock[id(i, j - 1)]) continue;
        nj = j - 1;
      }
      const nn = id(ni, nj);
      if (blocked[nn]) continue;
      const step = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]) + (nd === d ? 0 : bendCost);
      const ns = nn * 4 + nd;
      const ng = g[s] + step;
      if (ng < g[ns] - 1e-6) {
        g[ns] = ng;
        parent[ns] = s;
        heap.push(ng + h(ni, nj), ns);
      }
    }
  }
  if (found < 0) return null;
  const cells: Point[] = [];
  for (let s = found; s >= 0; s = parent[s]) {
    const node = s >> 2;
    cells.push({ x: xs[Math.floor(node / ny)], y: ys[node % ny] });
  }
  cells.reverse();
  return { points: compress(cells), cost: foundCost, dir: (found & 3) as Dir };
}

const step = (p: Point, d: Dir, len: number): Point => ({ x: p.x + DX[d] * len, y: p.y + DY[d] * len });

/** A plain elbow from a to b leaving along `d` (fallback when nothing clear is found). */
function plainElbow(a: Point, b: Point, d: Dir | null): Point[] {
  if (Math.abs(a.x - b.x) < 0.5 || Math.abs(a.y - b.y) < 0.5) return [a, b];
  const horizontal = d === null ? Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) : d === 0 || d === 2;
  if (horizontal) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const my = (a.y + b.y) / 2;
  return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
}

/** Total length of a polyline. */
export function routeLength(points: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  return n;
}

/** How far around the legs' ends obstacles are taken into account (grows when a detour leaves it). */
const REGIONS = [400, 1200, Infinity];

export function routeAround(o: AvoidRouteInput): AvoidRoute {
  const stub = o.stub ?? 20;
  const bendCost = o.bendCost ?? 40;
  const baseClearance = o.clearance ?? 16;
  const startDir = o.startSide ? OUT[o.startSide] : null;
  // Arriving through a side means travelling into it: the opposite of "out".
  const endDir = o.endSide ? (((OUT[o.endSide] + 2) % 4) as Dir) : null;
  const stubStart = startDir === null ? o.start : step(o.start, startDir, stub);
  const stubEnd = endDir === null ? o.end : step(o.end, OUT[o.endSide!], stub);
  const stops = [stubStart, ...(o.waypoints ?? []), stubEnd];

  // A bend point or a free end placed inside a shape (a zone, a box) means "route in there": that
  // shape is not an obstacle.
  const free = [...(o.waypoints ?? []), ...(startDir === null ? [o.start] : []), ...(endDir === null ? [o.end] : [])];
  const obstacles = o.obstacles.filter((b) => !free.some((p) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height));

  for (const clearance of [baseClearance, baseClearance / 2, 2]) {
    for (const region of REGIONS) {
      const routed = tryRoute(o, obstacles, clearance, region, stops, startDir, endDir, stub, bendCost);
      if (routed === "blocked") break; // a bigger region only adds obstacles: try a smaller clearance
      // A detour may leave the region and run through a shape that was left out: look again, wider.
      if (region !== Infinity && obstacles.some((b) => crossesBox(routed.points, b))) continue;
      return routed;
    }
  }
  return fallback(o, stops, startDir);
}

function tryRoute(
  o: AvoidRouteInput,
  obstacles: readonly Box[],
  clearance: number,
  REGION: number,
  stops: readonly Point[],
  startDir: Dir | null,
  endDir: Dir | null,
  stub: number,
  bendCost: number,
): AvoidRoute | "blocked" {
  {
    // The source and target themselves are avoided less widely, so their stubs end outside.
    const own = Math.min(clearance, Math.max(0, stub - 4));
    const all: Rect[] = [...obstacles.map((b) => inflate(b, clearance)), ...(o.startBox ? [inflate(o.startBox, own)] : []), ...(o.endBox ? [inflate(o.endBox, own)] : [])];
    const legs: Leg[] = [];
    let prevDir: Dir | null = startDir;
    let ok = true;
    for (let k = 0; k + 1 < stops.length; k++) {
      const a = stops[k];
      const b = stops[k + 1];
      // Only obstacles near this leg matter (keeps the grid small).
      const l = Math.min(a.x, b.x) - REGION;
      const r = Math.max(a.x, b.x) + REGION;
      const t = Math.min(a.y, b.y) - REGION;
      const bt = Math.max(a.y, b.y) + REGION;
      const rects = all.filter((q) => q.r > l && q.l < r && q.b > t && q.t < bt);
      // Leaving a point (the end of the source's stub, or a waypoint): keep going the same way for
      // free, turning costs a bend, going straight back is not allowed (it would draw over itself).
      const dirs = new Map<Dir, number>();
      for (const d of [0, 1, 2, 3] as Dir[]) {
        if (prevDir === null) dirs.set(d, 0);
        else if (d !== (prevDir + 2) % 4) dirs.set(d, d === prevDir ? 0 : bendCost);
      }
      const last = k + 2 === stops.length;
      const leg = gridLeg(a, b, rects, dirs, last ? endDir : null, bendCost);
      if (!leg) {
        ok = false;
        break;
      }
      legs.push(leg);
      prevDir = leg.dir;
    }
    if (!ok) return "blocked";
    const pts: Point[] = [o.start];
    for (const leg of legs) pts.push(...leg.points);
    pts.push(o.end);
    const points = compress(pts);
    return { points, cost: legs.reduce((n, leg) => n + leg.cost, 0), ok: true };
  }
}

function fallback(o: AvoidRouteInput, stops: readonly Point[], startDir: Dir | null): AvoidRoute {
  // Nothing clear: a plain elbow through the stops.
  const pts: Point[] = [o.start];
  let d = startDir;
  for (let k = 0; k + 1 < stops.length; k++) {
    const seg = plainElbow(stops[k], stops[k + 1], d);
    pts.push(...seg);
    d = null;
  }
  pts.push(o.end);
  const points = compress(pts);
  return { points, cost: routeLength(points) + 10_000, ok: false };
}

// ---------- ports and Excalidraw elbow-arrow details ----------

/** A point on side `side` of `b`, `ratio` along it (0..1, left-to-right / top-to-bottom), `gap` outside. */
export function portPoint(b: Box, side: Side, ratio = 0.5, gap = 0): Point {
  const r = Math.min(1, Math.max(0, ratio));
  switch (side) {
    case "left":
      return { x: b.x - gap, y: b.y + b.height * r };
    case "right":
      return { x: b.x + b.width + gap, y: b.y + b.height * r };
    case "top":
      return { x: b.x + b.width * r, y: b.y - gap };
    case "bottom":
      return { x: b.x + b.width * r, y: b.y + b.height + gap };
  }
}

/** The side of `b` nearest to `p` and where along it `p` falls (0..1). */
export function nearestSide(b: Box, p: Point): { side: Side; ratio: number } {
  const d: Array<[Side, number]> = [
    ["left", Math.abs(p.x - b.x) / Math.max(b.width, 1)],
    ["right", Math.abs(b.x + b.width - p.x) / Math.max(b.width, 1)],
    ["top", Math.abs(p.y - b.y) / Math.max(b.height, 1)],
    ["bottom", Math.abs(b.y + b.height - p.y) / Math.max(b.height, 1)],
  ];
  d.sort((a, c) => a[1] - c[1]);
  const side = d[0][0];
  const ratio = side === "left" || side === "right" ? (p.y - b.y) / Math.max(b.height, 1) : (p.x - b.x) / Math.max(b.width, 1);
  return { side, ratio: Math.min(1, Math.max(0, ratio)) };
}

/**
 * Snap a position along a side to the quarter points, so several arrows can share a side neatly.
 * Short sides only have the middle.
 */
export function snapRatio(ratio: number, sideLength: number): number {
  if (sideLength < 60) return 0.5;
  const stops = [0.25, 0.5, 0.75];
  return stops.reduce((best, s) => (Math.abs(s - ratio) < Math.abs(best - ratio) ? s : best), 0.5);
}

/**
 * Excalidraw "fixed segments" for an elbow arrow along `points`: every segment that doesn't touch an
 * end. Excalidraw keeps fixed segments when a bound shape moves and only redraws the end runs, so a
 * route around shapes survives later edits (and the user can still drag its segments).
 * Coordinates are relative to the first point, like the arrow's own points.
 */
export function fixedSegmentsFor(points: readonly Point[]): Array<{ index: number; start: [number, number]; end: [number, number] }> {
  const o = points[0];
  const out: Array<{ index: number; start: [number, number]; end: [number, number] }> = [];
  for (let i = 2; i <= points.length - 2; i++) {
    out.push({ index: i, start: [points[i - 1].x - o.x, points[i - 1].y - o.y], end: [points[i].x - o.x, points[i].y - o.y] });
  }
  return out;
}

/** Does the orthogonal polyline cross the inside of `b` (shrunk by `inset`)? */
export function crossesBox(points: readonly Point[], b: Box, inset = 1): boolean {
  const r = inflate(b, -inset);
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (Math.abs(p.y - q.y) < 0.5) {
      if (p.y > r.t && p.y < r.b && Math.max(p.x, q.x) > r.l && Math.min(p.x, q.x) < r.r) return true;
    } else if (Math.abs(p.x - q.x) < 0.5) {
      if (p.x > r.l && p.x < r.r && Math.max(p.y, q.y) > r.t && Math.min(p.y, q.y) < r.b) return true;
    } else {
      // Not orthogonal: check a few samples.
      for (let k = 1; k < 16; k++) {
        const x = p.x + ((q.x - p.x) * k) / 16;
        const y = p.y + ((q.y - p.y) * k) / 16;
        if (x > r.l && x < r.r && y > r.t && y < r.b) return true;
      }
    }
  }
  return false;
}

/**
 * Ports for a link from `from`'s `fromSide` to `to`'s `toSide`. When the two sides face each other
 * and the boxes overlap across (side by side at about the same height, or stacked), both ports
 * slide onto one line so the arrow is straight instead of a little jog between two mid-points:
 * - `explicit` (the user aimed at a spot on the target): the source port lines up with that spot,
 *   if the spot is within the overlap (or within a few px of it);
 * - otherwise: the source's middle when it is within the overlap, else the target's middle, else
 *   the middle of the overlap.
 * Otherwise the usual ports: the source side's middle, the target side at `toRatio`.
 */
export function alignedPorts(
  from: Box,
  fromSide: Side,
  to: Box,
  toSide: Side,
  toRatio: number,
  opts: { explicit: boolean; gap: number },
): { start: Point; end: Point; straight: boolean } {
  const start = portPoint(from, fromSide, 0.5, opts.gap);
  const end = portPoint(to, toSide, toRatio, opts.gap);
  const facing =
    (fromSide === "right" && toSide === "left" && to.x >= from.x + from.width) ||
    (fromSide === "left" && toSide === "right" && to.x + to.width <= from.x) ||
    (fromSide === "bottom" && toSide === "top" && to.y >= from.y + from.height) ||
    (fromSide === "top" && toSide === "bottom" && to.y + to.height <= from.y);
  if (!facing) return { start, end, straight: false };
  const horizontal = fromSide === "left" || fromSide === "right";
  // Overlap across the direction of travel.
  const lo = horizontal ? Math.max(from.y, to.y) : Math.max(from.x, to.x);
  const hi = horizontal ? Math.min(from.y + from.height, to.y + to.height) : Math.min(from.x + from.width, to.x + to.width);
  if (hi - lo < 4) return { start, end, straight: false };
  const inset = Math.min(6, (hi - lo) / 2);
  const inside = (v: number) => v >= lo + inset && v <= hi - inset;
  const clamp = (v: number) => Math.min(hi - inset, Math.max(lo + inset, v));
  const srcMid = horizontal ? start.y : start.x;
  const tgtPort = horizontal ? end.y : end.x;
  let c: number;
  if (opts.explicit) {
    // Respect the spot the user aimed at; only straighten when it is (nearly) inside the overlap.
    if (Math.abs(clamp(tgtPort) - tgtPort) > 8) return { start, end, straight: false };
    c = clamp(tgtPort);
  } else {
    const tgtMid = horizontal ? to.y + to.height / 2 : to.x + to.width / 2;
    c = inside(srcMid) ? srcMid : inside(tgtMid) ? tgtMid : (lo + hi) / 2;
  }
  return horizontal
    ? { start: { x: start.x, y: c }, end: { x: end.x, y: c }, straight: true }
    : { start: { x: c, y: start.y }, end: { x: c, y: end.y }, straight: true };
}
