// Cleans up a layout's routes (pure, tests/edgeTidy.test.ts): moves arrows that run on top of each
// other apart, and puts each arrow's label on a free stretch of its route instead of always at the
// midpoint. Both keep to the rule that a change must make the picture better (lower local cost).
import type { Box, Point } from "./geometry";
import { labelPoint } from "./labelGuard";
import {
  boxesOverlap,
  coreSegments,
  inflate,
  isHorizontal,
  nodesThrough,
  QUALITY_WEIGHTS,
  runsCross,
  runsOverlap,
  segLength,
  segmentHitsBox,
  segmentsOf,
  type QNode,
  type QRoute,
  type QZone,
} from "./diagramQuality";

export interface TidyInput {
  nodes: ReadonlyMap<string, QNode>;
  zones: ReadonlyMap<string, QZone>;
  routes: readonly QRoute[];
}

/** Distance between parallel runs after separating them (a bit more than the overlap threshold). */
export const TRACK = 14;
/** A moved run keeps at least this much of its neighbouring runs. */
const MIN_NEIGHBOUR = 8;
/** An arrow slides along a node's side, but never closer than this to the corner. */
const SIDE_INSET = 6;
/** Most shifts tried by separateParallel (keeps big diagrams fast). */
export const MAX_ATTEMPTS = 3000;
const SHIFTS = [TRACK, -TRACK, 2 * TRACK, -2 * TRACK, 3 * TRACK, -3 * TRACK];
const TITLE_COST = 40;
/** A label lying across a zone's outline. */
const OUTLINE_COST = 12;
const insideBox = (inner: Box, outer: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
/** A label centred on a vertical stretch has the arrow through its text: worse than a small collision. */
const VERTICAL_LABEL_COST = 25;
/** Gap between a vertical arrow and a label placed beside it. */
const BESIDE_GAP = 12;
/** How far a label's centre may be from its arrow: on it, or beside a vertical stretch (shared/labelGuard.ts uses the same rule). */
export const labelOffsetLimit = (labelWidth: number): number => labelWidth / 2 + BESIDE_GAP + 8;

const titleRects = (zones: ReadonlyMap<string, QZone>): Box[] => [...zones.values()].map((z) => ({ x: z.x, y: z.y, width: z.titleWidth, height: z.titleHeight }));
const clone = (r: QRoute): QRoute => ({ ...r, points: r.points.map((p) => ({ ...p })) });

// ---------- separating routes that lie on top of each other ----------

export function separateParallel(input: TidyInput): QRoute[] {
  const routes = input.routes.map(clone);
  const titles = titleRects(input.zones);
  const boxOf = (id: string): Box | undefined => input.nodes.get(id) ?? input.zones.get(id);
  const cores = routes.map((r) => coreSegments(r.points));

  const titleHits = (r: QRoute) => segmentsOf(r.points).filter((s) => titles.some((t) => segmentHitsBox(s.a, s.b, t))).length;
  /** What a route costs against the others: overlaps, crossings, nodes passed through, zone titles hit. */
  const cost = (i: number): number => {
    let c = 0;
    for (let j = 0; j < routes.length; j++) {
      if (j === i) continue;
      // Every overlapping run counts, so fixing one of two shared runs already improves the cost.
      for (const p of cores[i]) {
        for (const q of cores[j]) {
          if (runsOverlap(p, q)) c += QUALITY_WEIGHTS.edgeOverlap;
          if (runsCross(p, q)) c += QUALITY_WEIGHTS.crossing;
        }
      }
    }
    return c + QUALITY_WEIGHTS.throughNode * nodesThrough(routes[i], input).length + TITLE_COST * titleHits(routes[i]);
  };

  /** Slide segment `si` of route `ri` sideways by `d`; null when that would break the route. */
  const shifted = (ri: number, si: number, d: number): Point[] | null => {
    const r = routes[ri];
    const pts = r.points.map((p) => ({ ...p }));
    const n = pts.length;
    const a = pts[si];
    const b = pts[si + 1];
    const horizontal = Math.abs(a.y - b.y) < 0.5;
    const vertical = Math.abs(a.x - b.x) < 0.5;
    if (!horizontal && !vertical) return null;
    const axis = horizontal ? "y" : "x";
    a[axis] += d;
    b[axis] += d;
    // The ends slide along their node's side and must stay on it.
    const onSide = (p: Point, id: string): boolean => {
      const box = boxOf(id);
      if (!box) return false;
      return horizontal ? p.y >= box.y + SIDE_INSET && p.y <= box.y + box.height - SIDE_INSET : p.x >= box.x + SIDE_INSET && p.x <= box.x + box.width - SIDE_INSET;
    };
    if (si === 0 && !onSide(a, r.from)) return null;
    if (si + 1 === n - 1 && !onSide(b, r.to)) return null;
    // Neighbouring runs stretch or shrink; they must keep their direction and some length.
    const keeps = (before: Point, movedBefore: Point, moved: Point): boolean => {
      const was = movedBefore[axis] - before[axis];
      const now = moved[axis] - before[axis];
      return Math.sign(was) === Math.sign(now) && Math.abs(now) >= MIN_NEIGHBOUR;
    };
    if (si > 0 && !keeps(pts[si - 1], r.points[si], a)) return null;
    if (si + 2 < n && !keeps(pts[si + 2], r.points[si + 1], b)) return null;
    return pts;
  };

  // Work cap: the search is quadratic in arrows and runs; big diagrams stop early with what they have.
  let attempts = 0;
  for (let pass = 0; pass < 6 && attempts < MAX_ATTEMPTS; pass++) {
    let changed = false;
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        // Runs of i and j that lie on top of each other right now.
        const runs = [] as { si: number; sj: number }[];
        for (const p of cores[i]) for (const q of cores[j]) if (runsOverlap(p, q)) runs.push({ si: p.index!, sj: q.index! });
        for (const run of runs) {
          const p = routes[i].points;
          const q = routes[j].points;
          if (!runsOverlap({ a: p[run.si], b: p[run.si + 1] }, { a: q[run.sj], b: q[run.sj + 1] })) continue; // fixed meanwhile
          let done = false;
          // Move the later arrow's run first, then the earlier one's.
          for (const [ri, si] of [[j, run.sj], [i, run.si]] as const) {
            const before = cost(ri) + 0;
            for (const d of SHIFTS) {
              if (++attempts > MAX_ATTEMPTS) break;
              const pts = shifted(ri, si, d);
              if (!pts) continue;
              const old = routes[ri].points;
              const oldCore = cores[ri];
              routes[ri].points = pts;
              cores[ri] = coreSegments(pts);
              if (cost(ri) + Math.abs(d) * 0.02 < before) {
                done = true;
                changed = true;
                break;
              }
              routes[ri].points = old;
              cores[ri] = oldCore;
            }
            if (done) break;
          }
        }
      }
    }
    if (!changed) break;
  }
  return routes;
}

// ---------- labels on free stretches of their route ----------

/** Candidate centres for a label on a route: spread along the segments long enough to hold it. */
function candidates(r: QRoute): Point[] {
  const label = r.label!;
  const out: Point[] = [];
  for (const s of segmentsOf(r.points)) {
    const len = segLength(s);
    const need = (isHorizontal(s) ? label.width : label.height) + 16;
    if (len < need) continue;
    for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const d = len * t;
      if (d < need / 2 || len - d < need / 2) continue;
      const p = { x: s.a.x + ((s.b.x - s.a.x) * d) / len, y: s.a.y + ((s.b.y - s.a.y) * d) / len };
      out.push(p);
      // On a vertical stretch the text would sit across the line: also try just beside it.
      if (!isHorizontal(s)) {
        const side = label.width / 2 + BESIDE_GAP;
        out.push({ x: p.x - side, y: p.y }, { x: p.x + side, y: p.y });
      }
    }
  }
  return out;
}

/** Where each labelled route's label should be drawn (route id -> centre). */
export function placeLabels(input: TidyInput): Map<string, Point> {
  const routes = input.routes.filter((r) => r.points.length >= 2);
  const titles = titleRects(input.zones);
  const centers = new Map<string, Point>();
  const rects = new Map<string, Box>();
  for (const r of routes) {
    if (!r.label) continue;
    const c = r.label.center ?? labelPoint(r.points);
    centers.set(r.id, c);
    rects.set(r.id, { x: c.x - r.label.width / 2, y: c.y - r.label.height / 2, width: r.label.width, height: r.label.height });
  }
  const segsOf = new Map(routes.map((r) => [r.id, segmentsOf(r.points)]));

  const cost = (r: QRoute, c: Point): number => {
    const label = r.label!;
    const rect = inflate({ x: c.x - label.width / 2, y: c.y - label.height / 2, width: label.width, height: label.height }, 2);
    let k = 0;
    for (const n of input.nodes.values()) if (boxesOverlap(rect, n)) k += QUALITY_WEIGHTS.labelCollision;
    for (const t of titles) if (boxesOverlap(rect, t)) k += QUALITY_WEIGHTS.labelCollision;
    // Half in, half out of a zone reads badly: a small penalty for sitting across a zone's outline.
    for (const z of input.zones.values()) if (boxesOverlap(rect, z) && !insideBox(rect, z)) k += OUTLINE_COST;
    for (const o of routes) {
      if (o.id === r.id) continue;
      const other = rects.get(o.id);
      if (other && boxesOverlap(rect, other)) k += QUALITY_WEIGHTS.labelCollision;
      if (segsOf.get(o.id)!.some((s) => segmentHitsBox(s.a, s.b, rect))) k += QUALITY_WEIGHTS.labelCollision;
    }
    // Close to a corner of its own route reads badly: a small penalty per bend inside the rect.
    for (const s of segsOf.get(r.id)!) {
      if (segmentHitsBox(s.a, s.b, rect) && !isOnSegment(s, c)) k += 20;
    }
    // Text runs along a horizontal stretch; on a vertical one the line would cross the text.
    const onVertical = segsOf.get(r.id)!.some((s) => !isHorizontal(s) && isOnSegment(s, c));
    const onHorizontal = segsOf.get(r.id)!.some((s) => isHorizontal(s) && isOnSegment(s, c));
    if (onVertical && !onHorizontal) k += VERTICAL_LABEL_COST;
    const mid = labelPoint(r.points);
    return k + Math.hypot(c.x - mid.x, c.y - mid.y) * 0.02;
  };

  const labelled = routes.filter((r) => r.label);
  for (let pass = 0; pass < 2; pass++) {
    for (const r of labelled) {
      const options = [centers.get(r.id)!, labelPoint(r.points), ...candidates(r)];
      let best = options[0];
      let bestCost = Infinity;
      for (const c of options) {
        const k = cost(r, c);
        if (k < bestCost - 1e-9) {
          best = c;
          bestCost = k;
        }
      }
      centers.set(r.id, best);
      rects.set(r.id, { x: best.x - r.label!.width / 2, y: best.y - r.label!.height / 2, width: r.label!.width, height: r.label!.height });
    }
  }
  return centers;
}

function isOnSegment(s: { a: Point; b: Point }, p: Point): boolean {
  const cross = (s.b.x - s.a.x) * (p.y - s.a.y) - (s.b.y - s.a.y) * (p.x - s.a.x);
  if (Math.abs(cross) > 0.5 * Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)) return false;
  return p.x >= Math.min(s.a.x, s.b.x) - 0.5 && p.x <= Math.max(s.a.x, s.b.x) + 0.5 && p.y >= Math.min(s.a.y, s.b.y) - 0.5 && p.y <= Math.max(s.a.y, s.b.y) + 0.5;
}

/** Separate overlapping runs, then place the labels: the routes ready to draw, labels carrying their centre. */
export function tidyRoutes(input: TidyInput): QRoute[] {
  const separated = separateParallel(input);
  const centers = placeLabels({ ...input, routes: separated });
  return separated.map((r) => (r.label && centers.has(r.id) ? { ...r, label: { ...r.label, center: centers.get(r.id) } } : r));
}
