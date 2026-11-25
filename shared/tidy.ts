// Tidy without re-laying out: the user's arrangement stays, only small moves are made. Pure; used by
// the renderer's `tidyDrawing` (web/src/agent/diagram.ts) for the "Tidy" command and the MCP `tidy`
// tool; tests/tidy.test.ts. Also the helpers Re-layout uses to respect the drawing: `inferDirection`
// (which way the arrows flow), `byReadingOrder` (ELK keeps the input order, so the result resembles
// the drawing) and `nodeOverlaps` (the layout quality score does not count overlapping nodes; a
// hand-drawn drawing can have them, ELK's never do).
import type { Box } from "./geometry";
import type { LayoutDirection } from "./layout";

export interface TidyItem {
  id: string;
  box: Box;
  /** Zone the item sits in (its container), if any. */
  zone?: string;
}

export interface TidyZone {
  id: string;
  box: Box;
  parent?: string;
  /** Room the title needs at the zone's top (title height + margins). */
  titleRoom: number;
}

export interface TidyOptions {
  /** Smallest gap between neighbours after tidying (default 24). */
  minGap?: number;
  /** Padding inside zones (default 24; the top also keeps `titleRoom`). */
  zonePad?: number;
}

export interface TidyResult {
  /** How far each item (and everything in it) moved. Only items that moved. */
  moves: Map<string, { dx: number; dy: number }>;
  /** New boxes of zones that moved or grew (absolute, final). */
  zones: Map<string, Box>;
  /** What was done, for the user: counts of rows/columns lined up, gaps evened, overlaps fixed. */
  stats: { rows: number; columns: number; evened: number; overlaps: number };
}

const EPS = 0.5;

const cx = (b: Box) => b.x + b.width / 2;
const cy = (b: Box) => b.y + b.height / 2;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};

export function overlapArea(a: Box, b: Box, margin = 0): number {
  const w = Math.min(a.x + a.width, b.x + b.width) + margin - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) + margin - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Pairs of boxes that overlap by more than `min` px both ways. */
export function nodeOverlaps(boxes: readonly Box[], min = 4): number {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (w > min && h > min) n++;
    }
  }
  return n;
}

/** Weight of one overlapping pair of nodes in a layout score (like an arrow through a node, worse). */
export const OVERLAP_WEIGHT = 80;

/**
 * The way the arrows flow, from the centres of their ends; undefined when there are no arrows or
 * no clear direction (the main axis must carry at least `ratio` times the other, and most arrows
 * must agree on the sign).
 */
export function inferDirection(boxes: ReadonlyMap<string, Box>, edges: readonly { from: string; to: string }[], ratio = 1.5): LayoutDirection | undefined {
  let sx = 0;
  let sy = 0;
  let ax = 0;
  let ay = 0;
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    const dx = cx(b) - cx(a);
    const dy = cy(b) - cy(a);
    sx += dx;
    sy += dy;
    ax += Math.abs(dx);
    ay += Math.abs(dy);
  }
  if (!ax && !ay) return undefined;
  if (ax >= ay * ratio && Math.abs(sx) >= ax * 0.4) return sx >= 0 ? "right" : "left";
  if (ay >= ax * ratio && Math.abs(sy) >= ay * 0.4) return sy >= 0 ? "down" : "up";
  return undefined;
}

/** Items in reading order for a flow direction: along the flow first, then across it. */
export function byReadingOrder<T extends { box: Box }>(items: readonly T[], direction: LayoutDirection = "right"): T[] {
  const along = (b: Box) => (direction === "right" ? b.x : direction === "left" ? -(b.x + b.width) : direction === "down" ? b.y : -(b.y + b.height));
  const across = (b: Box) => (direction === "right" || direction === "left" ? cy(b) : cx(b));
  // Bucket the main axis a little so items in the same column/row sort by the other axis.
  const unit = Math.max(20, median(items.map((i) => (direction === "right" || direction === "left" ? i.box.width : i.box.height))) / 2);
  return [...items].sort((a, b) => Math.round(along(a.box) / unit) - Math.round(along(b.box) / unit) || across(a.box) - across(b.box));
}

/** Groups of items whose centres line up within `tol` on one axis (only groups of 2+). */
function lines(items: readonly { id: string; box: Box }[], axis: "x" | "y", tol: number): string[][] {
  const c = axis === "y" ? cy : cx;
  const sorted = [...items].sort((a, b) => c(a.box) - c(b.box));
  const out: string[][] = [];
  let cur: typeof sorted = [];
  let sum = 0;
  for (const it of sorted) {
    if (cur.length && Math.abs(c(it.box) - sum / cur.length) > tol) {
      if (cur.length > 1) out.push(cur.map((i) => i.id));
      cur = [];
      sum = 0;
    }
    cur.push(it);
    sum += c(it.box);
  }
  if (cur.length > 1) out.push(cur.map((i) => i.id));
  return out;
}

/**
 * Tidy one container's items in place (boxes are mutated): line up near-rows and near-columns,
 * even out gaps that are nearly even, then push overlapping items apart.
 */
function tidyLevel(boxes: Map<string, Box>, stats: TidyResult["stats"], minGap: number, zoneIds: ReadonlySet<string>): void {
  // Zones only take part in the overlap pass: lining a zone up with a node would drag it sideways.
  const items = [...boxes].filter(([id]) => !zoneIds.has(id)).map(([id, box]) => ({ id, box }));
  if (boxes.size < 2) return;
  const rowTol = items.length ? Math.max(14, median(items.map((i) => i.box.height)) * 0.4) : 0;
  const colTol = items.length ? Math.max(14, median(items.map((i) => i.box.width)) * 0.4) : 0;

  // 1. rows and columns: centres that nearly line up are lined up on their median.
  const rows = lines(items, "y", rowTol);
  const cols = lines(items, "x", colTol);
  for (const row of rows) {
    const target = median(row.map((id) => cy(boxes.get(id)!)));
    let moved = false;
    for (const id of row) {
      const b = boxes.get(id)!;
      const d = target - cy(b);
      if (Math.abs(d) > EPS) {
        b.y += d;
        moved = true;
      }
    }
    if (moved) stats.rows++;
  }
  for (const col of cols) {
    const target = median(col.map((id) => cx(boxes.get(id)!)));
    let moved = false;
    for (const id of col) {
      const b = boxes.get(id)!;
      const d = target - cx(b);
      if (Math.abs(d) > EPS) {
        b.x += d;
        moved = true;
      }
    }
    if (moved) stats.columns++;
  }

  // 2. nearly even gaps become even (first and last stay), only where it can't break a column/row.
  const inCol = new Set(cols.flat());
  const inRow = new Set(rows.flat());
  const even = (ids: string[], axis: "x" | "y") => {
    if (ids.length < 3) return;
    const pos = (b: Box) => (axis === "x" ? b.x : b.y);
    const size = (b: Box) => (axis === "x" ? b.width : b.height);
    const s = ids.map((id) => boxes.get(id)!).sort((a, b) => pos(a) - pos(b));
    const gaps = s.slice(1).map((b, i) => pos(b) - (pos(s[i]) + size(s[i])));
    const lo = Math.min(...gaps);
    const hi = Math.max(...gaps);
    if (lo <= 0 || hi - lo <= 2 || hi > lo * 2.5) return;
    const step = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    let at = pos(s[0]) + size(s[0]) + step;
    for (const b of s.slice(1, -1)) {
      if (axis === "x") b.x = at;
      else b.y = at;
      at += size(b) + step;
    }
    stats.evened++;
  };
  for (const row of rows) if (!row.some((id) => inCol.has(id))) even(row, "x");
  for (const col of cols) if (!col.some((id) => inRow.has(id))) even(col, "y");

  // 3. overlaps: push the later item (reading order) out along the shorter way, keeping minGap.
  const order = [...boxes.keys()].sort((a, b) => boxes.get(a)!.y - boxes.get(b)!.y || boxes.get(a)!.x - boxes.get(b)!.x);
  const fixed = new Set<string>();
  for (let pass = 0; pass < 60; pass++) {
    let any = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = boxes.get(order[i])!;
        const b = boxes.get(order[j])!;
        const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (w <= 0 || h <= 0) continue;
        any = true;
        fixed.add(`${order[i]}|${order[j]}`);
        // Move b right or down (whichever is the shorter push), or left/up when it sits left/above.
        const pushX = cx(b) >= cx(a) ? a.x + a.width + minGap - b.x : -(b.x + b.width + minGap - a.x);
        const pushY = cy(b) >= cy(a) ? a.y + a.height + minGap - b.y : -(b.y + b.height + minGap - a.y);
        if (Math.abs(pushX) <= Math.abs(pushY)) b.x += pushX;
        else b.y += pushY;
      }
    }
    if (!any) break;
  }
  stats.overlaps += fixed.size;
}

/** Tidy items and zones, inner zones first; a zone grows to hold its tidied contents and then moves as one item. */
export function tidyLayout(items: readonly TidyItem[], zones: readonly TidyZone[], opts: TidyOptions = {}): TidyResult {
  const minGap = opts.minGap ?? 24;
  const pad = opts.zonePad ?? 24;
  const stats = { rows: 0, columns: 0, evened: 0, overlaps: 0 };
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const zoneIds = new Set(zoneById.keys());
  const depth = (z: TidyZone): number => {
    let d = 0;
    const seen = new Set<string>();
    for (let p = z.parent; p && zoneById.has(p) && !seen.has(p); p = zoneById.get(p)!.parent) {
      seen.add(p);
      d++;
    }
    return d;
  };
  const known = (zone?: string) => (zone && zoneById.has(zone) ? zone : undefined);
  // Working boxes (mutated), and what each container holds.
  const box = new Map<string, Box>();
  for (const it of items) box.set(it.id, { ...it.box });
  for (const z of zones) box.set(z.id, { ...z.box });
  const children = new Map<string | undefined, string[]>();
  const add = (parent: string | undefined, id: string) => children.set(parent, [...(children.get(parent) ?? []), id]);
  for (const it of items) add(known(it.zone), it.id);
  for (const z of zones) add(known(z.parent), z.id);
  const descendants = (id: string): string[] => (children.get(id) ?? []).flatMap((c) => [c, ...descendants(c)]);
  const shift = (id: string, dx: number, dy: number) => {
    for (const d of descendants(id)) {
      const b = box.get(d)!;
      b.x += dx;
      b.y += dy;
    }
  };

  const levels: (string | undefined)[] = [...zones].sort((a, b) => depth(b) - depth(a)).map((z) => z.id);
  levels.push(undefined);
  for (const level of levels) {
    const kids = children.get(level) ?? [];
    if (kids.length) {
      const before = new Map(kids.map((id) => [id, { ...box.get(id)! }]));
      const work = new Map(kids.map((id) => [id, box.get(id)!]));
      tidyLevel(work, stats, minGap, zoneIds);
      // A child zone that moved carries its contents.
      for (const id of kids) {
        if (!zoneById.has(id)) continue;
        const a = before.get(id)!;
        const b = box.get(id)!;
        if (Math.abs(b.x - a.x) > EPS || Math.abs(b.y - a.y) > EPS) shift(id, b.x - a.x, b.y - a.y);
      }
    }
    if (level === undefined) continue;
    // The zone grows to hold its contents (never shrinks: a big zone may be on purpose).
    const z = box.get(level)!;
    const inner = kids.map((id) => box.get(id)!);
    if (!inner.length) continue;
    const x1 = Math.min(z.x, ...inner.map((b) => b.x - pad));
    const y1 = Math.min(z.y, ...inner.map((b) => b.y - zoneById.get(level)!.titleRoom));
    const x2 = Math.max(z.x + z.width, ...inner.map((b) => b.x + b.width + pad));
    const y2 = Math.max(z.y + z.height, ...inner.map((b) => b.y + b.height + pad));
    Object.assign(z, { x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }

  const moves = new Map<string, { dx: number; dy: number }>();
  for (const it of items) {
    const b = box.get(it.id)!;
    const dx = b.x - it.box.x;
    const dy = b.y - it.box.y;
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) moves.set(it.id, { dx, dy });
  }
  const zoneOut = new Map<string, Box>();
  for (const z of zones) {
    const b = box.get(z.id)!;
    if (Math.abs(b.x - z.box.x) > EPS || Math.abs(b.y - z.box.y) > EPS || Math.abs(b.width - z.box.width) > EPS || Math.abs(b.height - z.box.height) > EPS) zoneOut.set(z.id, b);
  }
  return { moves, zones: zoneOut, stats };
}
