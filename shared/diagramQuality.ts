// Measures how clean a diagram is (pure, tests/diagramQuality.test.ts): arrows lying on top of each
// other, arrows running through nodes they don't connect, labels under other arrows or nodes,
// crossings, bends, length and aspect ratio. Used to pick the best of several layouts
// (shared/layout.ts `layoutBest`), to report problems to the agent (`quality` in build_diagram's
// result) and, through an adapter, by diagram lint.
import type { Box, Point } from "./geometry";
import { labelPoint } from "./labelGuard";

export interface QNode extends Box {
  /** Zone the node sits in. */
  zone?: string;
}

export interface QZone extends Box {
  parent?: string;
  /** Size of the title text at the zone's top-left corner. */
  titleWidth: number;
  titleHeight: number;
}

export interface QRoute {
  id: string;
  /** Node or zone ids of the ends. */
  from: string;
  to: string;
  points: Point[];
  /** Label size; `center` is where it will be drawn (default: the route's label point). */
  label?: { width: number; height: number; center?: Point };
}

export interface QualityInput {
  nodes: ReadonlyMap<string, QNode>;
  zones: ReadonlyMap<string, QZone>;
  routes: readonly QRoute[];
}

export type QualityKind = "edge-overlap" | "edge-through-node" | "label-collision";

export interface QualityIssue {
  kind: QualityKind;
  /** The arrow with the problem. */
  edge: string;
  /** What it hits: another arrow, a node, a zone title or another label. */
  other: string;
  message: string;
}

export interface QualityMetrics {
  nodes: number;
  edges: number;
  edgeOverlap: number;
  throughNode: number;
  labelCollision: number;
  crossings: number;
  bends: number;
  /** Total route length in px. */
  length: number;
  /** Width : height of the diagram (>= 1). */
  aspect: number;
}

export interface QualityReport {
  metrics: QualityMetrics;
  issues: QualityIssue[];
  score: number;
  advice: string[];
}

/** Parallel runs closer than this (with enough shared length) count as lying on top of each other. */
export const TRACK_MIN = 9;
/** A shared run must be longer than this to count. */
const OVERLAP_MIN = 12;
/** Ignore the first and last run of a route this far from its ends (arrows fan out of a node). */
const END_RUN = 20;
/** A route passing this close to a node it doesn't connect counts as going through it. */
const NODE_MARGIN = 4;
const LABEL_MARGIN = 2;

/** Lower is better. */
export const QUALITY_WEIGHTS = {
  edgeOverlap: 50,
  throughNode: 80,
  labelCollision: 60,
  crossing: 4,
  bend: 1,
  lengthPerPx: 0.01,
  /** Per unit of aspect ratio beyond `aspectFree` (diagrams of at least `aspectMinNodes` nodes: a short chain is naturally wide). */
  aspect: 40,
  aspectFree: 3.5,
  aspectMinNodes: 8,
} as const;

export const inflate = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m });

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Liang-Barsky: does the segment a-b touch the rectangle? */
export function segmentHitsBox(a: Point, b: Point, r: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.width - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.height - a.y);
}

export interface Seg {
  a: Point;
  b: Point;
  /** Index of the segment in its route (set on core segments). */
  index?: number;
}

export function segmentsOf(points: readonly Point[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < points.length; i++) out.push({ a: points[i - 1], b: points[i] });
  return out;
}

export const isHorizontal = (s: Seg) => Math.abs(s.a.y - s.b.y) < 0.5;
export const isVertical = (s: Seg) => Math.abs(s.a.x - s.b.x) < 0.5;
export const segLength = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

/**
 * The route's segments without the first and last END_RUN px (where arrows leave and enter their
 * nodes). Each carries its `index` in the route.
 */
export function coreSegments(points: readonly Point[]): Seg[] {
  const segs = segmentsOf(points).map((s, index) => ({ a: { ...s.a }, b: { ...s.b }, index }));
  const trim = (s: Seg, atStart: boolean): Seg | null => {
    const len = segLength(s);
    if (len <= END_RUN * 2) return null;
    const k = END_RUN / len;
    if (atStart) return { a: { x: s.a.x + (s.b.x - s.a.x) * k, y: s.a.y + (s.b.y - s.a.y) * k }, b: s.b, index: s.index };
    return { a: s.a, b: { x: s.b.x - (s.b.x - s.a.x) * k, y: s.b.y - (s.b.y - s.a.y) * k }, index: s.index };
  };
  if (!segs.length) return [];
  const first = trim(segs[0], true);
  if (segs.length === 1) {
    const both = first && trim(first, false);
    return both ? [both] : [];
  }
  const last = trim(segs[segs.length - 1], false);
  return [...(first ? [first] : []), ...segs.slice(1, -1), ...(last ? [last] : [])];
}

/** Do two parallel runs lie on top of each other (closer than TRACK_MIN, sharing more than OVERLAP_MIN)? */
export function runsOverlap(p: Seg, q: Seg): boolean {
  if (isHorizontal(p) && isHorizontal(q)) {
    if (Math.abs(p.a.y - q.a.y) >= TRACK_MIN) return false;
    const lo = Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x));
    const hi = Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x));
    return hi - lo > OVERLAP_MIN;
  }
  if (isVertical(p) && isVertical(q)) {
    if (Math.abs(p.a.x - q.a.x) >= TRACK_MIN) return false;
    const lo = Math.max(Math.min(p.a.y, p.b.y), Math.min(q.a.y, q.b.y));
    const hi = Math.min(Math.max(p.a.y, p.b.y), Math.max(q.a.y, q.b.y));
    return hi - lo > OVERLAP_MIN;
  }
  return false;
}

/** Proper crossing of two perpendicular runs (touching at an end doesn't count). */
export function runsCross(p: Seg, q: Seg): boolean {
  const [h, v] = isHorizontal(p) && isVertical(q) ? [p, q] : isVertical(p) && isHorizontal(q) ? [q, p] : [null, null];
  if (!h || !v) return false;
  const x = v.a.x;
  const y = h.a.y;
  const e = 0.5;
  return x > Math.min(h.a.x, h.b.x) + e && x < Math.max(h.a.x, h.b.x) - e && y > Math.min(v.a.y, v.b.y) + e && y < Math.max(v.a.y, v.b.y) - e;
}

/** Where a route's label is drawn. */
export function labelRectOf(r: QRoute): Box | null {
  if (!r.label || r.points.length < 2) return null;
  const c = r.label.center ?? labelPoint(r.points);
  return { x: c.x - r.label.width / 2, y: c.y - r.label.height / 2, width: r.label.width, height: r.label.height };
}

/** Zones containing `id` (a node or zone), innermost first. */
export function ancestors(id: string, input: Pick<QualityInput, "nodes" | "zones">): string[] {
  const out: string[] = [];
  let z = input.nodes.get(id)?.zone ?? input.zones.get(id)?.parent;
  while (z && !out.includes(z)) {
    out.push(z);
    z = input.zones.get(z)?.parent;
  }
  return out;
}

/** Ids of the nodes a route passes through without connecting them (nodes inside a zone it ends at are fine). */
export function nodesThrough(r: QRoute, input: Pick<QualityInput, "nodes" | "zones">): string[] {
  const segs = segmentsOf(r.points);
  const out: string[] = [];
  for (const [id, n] of input.nodes) {
    if (id === r.from || id === r.to) continue;
    const chain = ancestors(id, input);
    if (chain.includes(r.from) || chain.includes(r.to)) continue;
    const box = inflate(n, NODE_MARGIN);
    if (segs.some((s) => segmentHitsBox(s.a, s.b, box))) out.push(id);
  }
  return out;
}

export function measureQuality(input: QualityInput): QualityReport {
  const issues: QualityIssue[] = [];
  const routes = input.routes.filter((r) => r.points.length >= 2);
  const core = routes.map((r) => coreSegments(r.points));
  const full = routes.map((r) => segmentsOf(r.points));

  // Arrows on top of each other, and crossings.
  let edgeOverlap = 0;
  let crossings = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      let overlapped = false;
      for (const p of core[i]) {
        for (const q of core[j]) {
          if (!overlapped && runsOverlap(p, q)) overlapped = true;
          if (runsCross(p, q)) crossings++;
        }
      }
      if (overlapped) {
        edgeOverlap++;
        issues.push({
          kind: "edge-overlap",
          edge: routes[i].id,
          other: routes[j].id,
          message: `arrows "${routes[i].id}" and "${routes[j].id}" run on top of each other`,
        });
      }
    }
  }

  // Arrows through nodes they don't connect.
  let throughNode = 0;
  for (let i = 0; i < routes.length; i++) {
    for (const id of nodesThrough(routes[i], input)) {
      throughNode++;
      issues.push({ kind: "edge-through-node", edge: routes[i].id, other: id, message: `arrow "${routes[i].id}" runs through node "${id}"` });
    }
  }

  // Labels under nodes, zone titles, other labels or other arrows.
  let labelCollision = 0;
  const labels = routes.map(labelRectOf);
  for (let i = 0; i < routes.length; i++) {
    const rect = labels[i];
    if (!rect) continue;
    const box = inflate(rect, LABEL_MARGIN);
    const hit = (other: string, what: string) => {
      labelCollision++;
      issues.push({ kind: "label-collision", edge: routes[i].id, other, message: `label of "${routes[i].id}" ${what}` });
    };
    let found = false;
    for (const [id, n] of input.nodes) {
      if (boxesOverlap(box, n)) {
        hit(id, `overlaps node "${id}"`);
        found = true;
        break;
      }
    }
    if (found) continue;
    for (const [id, z] of input.zones) {
      if (boxesOverlap(box, { x: z.x, y: z.y, width: z.titleWidth, height: z.titleHeight })) {
        hit(id, `overlaps the title of zone "${id}"`);
        found = true;
        break;
      }
    }
    if (found) continue;
    for (let j = 0; j < routes.length; j++) {
      if (j === i) continue;
      const other = labels[j];
      if (other && boxesOverlap(box, other)) {
        hit(routes[j].id, `overlaps the label of "${routes[j].id}"`);
        found = true;
        break;
      }
      if (full[j].some((s) => segmentHitsBox(s.a, s.b, box))) {
        hit(routes[j].id, `sits under arrow "${routes[j].id}"`);
        found = true;
        break;
      }
    }
  }

  const bends = routes.reduce((n, r) => n + Math.max(0, r.points.length - 2), 0);
  const totalLength = full.reduce((n, segs) => n + segs.reduce((m, s) => m + segLength(s), 0), 0);
  const boxes = [...input.nodes.values(), ...input.zones.values()];
  let aspect = 1;
  if (boxes.length) {
    const w = Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x));
    const h = Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y));
    aspect = w > 0 && h > 0 ? Math.max(w / h, h / w) : 1;
  }

  const metrics: QualityMetrics = { nodes: input.nodes.size, edges: routes.length, edgeOverlap, throughNode, labelCollision, crossings, bends, length: Math.round(totalLength), aspect: Math.round(aspect * 100) / 100 };
  return { metrics, issues, score: scoreOf(metrics), advice: adviceFor(input, routes, metrics, full) };
}

export function scoreOf(m: QualityMetrics): number {
  const w = QUALITY_WEIGHTS;
  const s =
    m.edgeOverlap * w.edgeOverlap +
    m.throughNode * w.throughNode +
    m.labelCollision * w.labelCollision +
    m.crossings * w.crossing +
    m.bends * w.bend +
    m.length * w.lengthPerPx +
    (m.nodes >= w.aspectMinNodes ? Math.max(0, m.aspect - w.aspectFree) * w.aspect : 0);
  return Math.round(s * 10) / 10;
}

/** Advice an agent can act on when the structure (not the layout) is the problem. */
function adviceFor(input: QualityInput, routes: readonly QRoute[], m: QualityMetrics, full: Seg[][]): string[] {
  const advice: string[] = [];
  const degree = new Map<string, number>();
  for (const r of routes) {
    degree.set(r.from, (degree.get(r.from) ?? 0) + 1);
    degree.set(r.to, (degree.get(r.to) ?? 0) + 1);
  }
  for (const [id, n] of [...degree].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    if (n >= 7) advice.push(`"${id}" has ${n} arrows: draw one arrow to a zone instead of one per node, drop their labels, or split the diagram.`);
  }
  if (m.edges > 45) advice.push(`${m.edges} arrows is hard to read (aim for about 40 or fewer): use zone-to-zone arrows or split the diagram.`);
  const boxes = [...input.nodes.values(), ...input.zones.values()];
  if (boxes.length) {
    const span = Math.max(
      Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
      Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
    );
    const long = routes.filter((_, i) => full[i].reduce((n, s) => n + segLength(s), 0) > span * 0.6);
    if (long.length >= 3) advice.push(`${long.length} arrows are longer than 60% of the diagram (${long.slice(0, 3).map((r) => r.id).join(", ")}...): move their ends closer or route them through a zone arrow.`);
  }
  if (m.labelCollision) advice.push(`${m.labelCollision} label(s) collide with other things: shorten them, or label only short arrows.`);
  if (m.edgeOverlap) advice.push(`${m.edgeOverlap} pair(s) of arrows run on top of each other: use fewer arrows leaving the same node, or different directions.`);
  if (m.throughNode) advice.push(`${m.throughNode} arrow(s) pass through nodes they don't connect: re-route them (connect {avoid: true}) or change the layout direction.`);
  if (m.nodes >= QUALITY_WEIGHTS.aspectMinNodes && m.aspect > QUALITY_WEIGHTS.aspectFree) advice.push(`The diagram is ${m.aspect}:1 (very wide or tall): try the other direction, or split it.`);
  return advice;
}
