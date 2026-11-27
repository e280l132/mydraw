// Grid zones: rows x columns, e.g. tiers (public / web / app / data subnets) x availability zones.
// ELK can nest zones but cannot line up rows across columns, so a grid is laid out here and enters
// the ELK graph as one fixed-size node. Pure (no DOM), used by build_diagram (web/src/agent/diagram.ts).
import { routeAround, portPoint } from "./avoidRoute";
import type { Box, Point } from "./geometry";
import { ELBOW_GAP, type Side } from "./routing";
import type { ZoneKind } from "./zoneKinds";

export interface GridBand {
  id: string;
  label?: string;
  kind?: ZoneKind;
}

export interface DiagramGrid {
  id: string;
  /** Title of the whole grid (drawn as a zone around it); none = no outer zone. */
  label?: string;
  /** Zone the grid sits in (e.g. the VPC). */
  parent?: string;
  /** Tiers, top to bottom (cells are drawn per column, titled with the row's label). */
  rows: GridBand[];
  /** Columns, left to right (availability zones: dashed bands across every row). */
  columns: GridBand[];
  /** Cell titles that differ from the row label, by "row/column" (e.g. "Public subnet 10.0.1.0/24"). */
  cells?: Record<string, string>;
}

/**
 * A node in the grid: its row and column. `col: null` = across the whole row (a load balancer
 * spanning AZ columns), `row: null` = across the whole column (spanning AZ rows when the tiers are
 * the columns). Not both.
 */
export interface GridNodeIn {
  id: string;
  width: number;
  height: number;
  row: string | null;
  col: string | null;
}

export interface GridLayoutOptions {
  /** Height of a zone title strip (column bands and cells). */
  titleHeight: (label: string | undefined) => number;
  /** Width a title needs. */
  titleWidth: (label: string | undefined) => number;
  /** Space between nodes in a cell (default 48). */
  gap?: number;
  /** Padding inside cells (default 20). */
  pad?: number;
}

export interface GridLayout {
  width: number;
  height: number;
  /** Boxes relative to the grid's top-left corner. */
  nodes: Map<string, Box>;
  /** Column bands (full height). */
  columns: Map<string, Box>;
  /** Cells by "row/column". */
  cells: Map<string, Box>;
}

export const cellKey = (row: string, col: string) => `${row}/${col}`;

/** Zone ids a grid adds to the diagram: the outer zone (when labelled), one per column, one per cell. */
export function gridZoneIds(g: DiagramGrid): { outer: string | null; column: (c: string) => string; cell: (r: string, c: string) => string } {
  return {
    outer: g.label ? g.id : null,
    column: (c) => `${g.id}.${c}`,
    cell: (r, c) => `${g.id}.${r}.${c}`,
  };
}

// Parse a node's `cell` against the grid: "row/column", "row/*" across the row, "*/column" across the column.
export function parseCell(cell: string, g: DiagramGrid): { row: string | null; col: string | null } {
  const m = /^([^/]+)\/([^/]+)$/.exec(cell.trim());
  if (!m) throw new Error(`cell "${cell}" must be "row/column" ("row/*" across a row, "*/column" across a column)`);
  const [, row, col] = m;
  if (row === "*" && col === "*") throw new Error(`cell "${cell}": give a row or a column`);
  if (row !== "*" && !g.rows.some((r) => r.id === row)) throw new Error(`cell "${cell}": no row "${row}" in grid ${g.id} (rows: ${g.rows.map((r) => r.id).join(", ")})`);
  if (col !== "*" && !g.columns.some((c) => c.id === col)) throw new Error(`cell "${cell}": no column "${col}" in grid ${g.id} (columns: ${g.columns.map((c) => c.id).join(", ")})`);
  return { row: row === "*" ? null : row, col: col === "*" ? null : col };
}

/**
 * Lay out a grid. Each column is a band as tall as the grid (title on top); in it each row has a
 * cell box. Nodes of a cell sit in one line, centred. Row heights are the tallest cell of the row,
 * column widths the widest cell of the column, so rows and columns line up.
 *
 * Spanning nodes: with an even number of columns a row-spanning node sits in the gap between the
 * two middle columns, level with the row's nodes (the way AWS diagrams draw a load balancer across
 * two AZs); with an odd number, in a strip above the row. Column-spanning nodes likewise sit in the
 * gap between the two middle rows, or in a strip at the top of the column.
 */
export function layoutGrid(g: DiagramGrid, nodes: readonly GridNodeIn[], o: GridLayoutOptions): GridLayout {
  const gap = o.gap ?? 48;
  const pad = o.pad ?? 20;
  const inset = 14; // cell inside its column band
  const colGap = 24;
  const rowGap = 16;
  const spanMargin = 36; // around a node placed in a gap
  const nC = g.columns.length;
  const nR = g.rows.length;
  const midCol = nC >= 2 && nC % 2 === 0 ? nC / 2 - 1 : -1; // gap after this column holds row-spanning nodes
  const midRow = nR >= 2 && nR % 2 === 0 ? nR / 2 - 1 : -1;
  const cellTitle = (r: GridBand, c: GridBand) => g.cells?.[cellKey(r.id, c.id)] ?? r.label;
  const colTitleH = Math.max(0, ...g.columns.map((c) => o.titleHeight(c.label)));

  const inCell = (r: string, c: string) => nodes.filter((n) => n.row === r && n.col === c);
  const rowSpan = (r: string) => nodes.filter((n) => n.row === r && n.col === null);
  const colSpan = (c: string) => nodes.filter((n) => n.col === c && n.row === null);
  const lineWidth = (list: readonly GridNodeIn[]) => list.reduce((s, n) => s + n.width, 0) + gap * Math.max(0, list.length - 1);
  const lineHeight = (list: readonly GridNodeIn[]) => Math.max(0, ...list.map((n) => n.height));

  // Cell sizes (content only, without the inset).
  const cellW = new Map<string, number>();
  const cellH = new Map<string, number>();
  for (const r of g.rows) {
    for (const c of g.columns) {
      const list = inCell(r.id, c.id);
      const title = cellTitle(r, c);
      cellW.set(cellKey(r.id, c.id), Math.max(140, lineWidth(list) + pad * 2, o.titleWidth(title)));
      cellH.set(cellKey(r.id, c.id), o.titleHeight(title) + (list.length ? lineHeight(list) + pad * 2 : pad * 2));
    }
  }
  const rowTitleH = (r: GridBand) => Math.max(...g.columns.map((c) => o.titleHeight(cellTitle(r, c))));

  // Column widths, and the gaps between columns (the middle one may hold row-spanning nodes).
  const colW = g.columns.map((c) => Math.max(o.titleWidth(c.label), ...g.rows.map((r) => cellW.get(cellKey(r.id, c.id))! + inset * 2), lineWidth(colSpan(c.id)) + pad * 2));
  const colGaps = g.columns.map(() => colGap);
  if (midCol >= 0) for (const r of g.rows) colGaps[midCol] = Math.max(colGaps[midCol], lineWidth(rowSpan(r.id)) + spanMargin * 2);
  const totalCols = () => colW.reduce((s, w) => s + w, 0) + colGaps.slice(0, nC - 1).reduce((s, w) => s + w, 0);
  // Odd column count: row-spanning nodes in a strip above the row; the row must be wide enough.
  if (midCol < 0) {
    for (const r of g.rows) {
      const need = lineWidth(rowSpan(r.id)) + pad * 2;
      const have = totalCols();
      if (need > have && nC) for (let i = 0; i < nC; i++) colW[i] += (need - have) / nC;
    }
  }
  const stripH = (r: GridBand) => (midCol < 0 && rowSpan(r.id).length ? lineHeight(rowSpan(r.id)) + rowGap * 2 : 0);

  // Row heights; a row with nodes in the middle column gap is at least tall enough for them.
  const rowH = g.rows.map((r) => {
    const cells = Math.max(...g.columns.map((c) => cellH.get(cellKey(r.id, c.id))!));
    const inline = midCol >= 0 && rowSpan(r.id).length ? rowTitleH(r) + lineHeight(rowSpan(r.id)) + pad * 2 : 0;
    return Math.max(cells, inline);
  });
  // Column-spanning nodes: the gap between the middle rows, or a strip at the top of every column.
  const rowGaps = g.rows.map(() => rowGap);
  if (midRow >= 0) for (const c of g.columns) rowGaps[midRow] = Math.max(rowGaps[midRow], lineHeight(colSpan(c.id)) + spanMargin * 2);
  const topStrip = midRow < 0 ? Math.max(0, ...g.columns.map((c) => (colSpan(c.id).length ? lineHeight(colSpan(c.id)) + rowGap * 2 : 0))) : 0;

  const width = totalCols();
  const height =
    colTitleH + rowGap + topStrip + g.rows.reduce((s, r, i) => s + stripH(r) + rowH[i], 0) + rowGaps.slice(0, nR - 1).reduce((s, w) => s + w, 0) + rowGap;

  const columns = new Map<string, Box>();
  const colX: number[] = [];
  let x = 0;
  g.columns.forEach((c, i) => {
    colX.push(x);
    columns.set(c.id, { x, y: 0, width: colW[i], height });
    x += colW[i] + colGaps[i];
  });

  const cells = new Map<string, Box>();
  const out = new Map<string, Box>();
  const placeLine = (list: readonly GridNodeIn[], cx: number, cy: number) => {
    let nx = cx - lineWidth(list) / 2;
    for (const n of list) {
      out.set(n.id, { x: nx, y: cy - n.height / 2, width: n.width, height: n.height });
      nx += n.width + gap;
    }
  };
  let y = colTitleH + rowGap;
  if (topStrip) for (const [i, c] of g.columns.entries()) placeLine(colSpan(c.id), colX[i] + colW[i] / 2, y + topStrip / 2);
  y += topStrip;
  g.rows.forEach((r, ri) => {
    const sh = stripH(r);
    if (sh) placeLine(rowSpan(r.id), width / 2, y + sh / 2);
    const top = y + sh;
    const h = rowH[ri];
    const th = rowTitleH(r);
    g.columns.forEach((c, ci) => {
      const box = { x: colX[ci] + inset, y: top, width: colW[ci] - inset * 2, height: h };
      cells.set(cellKey(r.id, c.id), box);
      placeLine(inCell(r.id, c.id), box.x + box.width / 2, box.y + th + (box.height - th) / 2);
    });
    if (midCol >= 0 && rowSpan(r.id).length) placeLine(rowSpan(r.id), colX[midCol] + colW[midCol] + colGaps[midCol] / 2, top + th + (h - th) / 2);
    y = top + h;
    if (ri < nR - 1) {
      if (ri === midRow) for (const [i, c] of g.columns.entries()) placeLine(colSpan(c.id), colX[i] + colW[i] / 2, y + rowGaps[ri] / 2);
      y += rowGaps[ri];
    }
  });
  return { width, height, nodes: out, columns, cells };
}

const SIDES: readonly Side[] = ["right", "left", "bottom", "top"];
/** Positions along a side, used in turn so arrows leaving one side don't share a port. */
const SLOTS = [0.5, 0.3, 0.7, 0.18, 0.82];

/**
 * An orthogonal route from box `a` to box `b` that keeps clear of `obstacles`: every pair of sides
 * is tried and the cheapest clear route wins. `slot(box id, side)` gives the port position along a
 * side (default the middle).
 */
export function routeBetweenBoxes(
  a: Box,
  b: Box,
  obstacles: readonly Box[],
  slot: (end: "a" | "b", side: Side) => number = () => 0.5,
): { points: Point[]; startSide: Side; endSide: Side } {
  let best: { points: Point[]; cost: number; startSide: Side; endSide: Side } | null = null;
  for (const s of SIDES) {
    for (const t of SIDES) {
      const r = routeAround({
        start: portPoint(a, s, slot("a", s), ELBOW_GAP),
        startSide: s,
        end: portPoint(b, t, slot("b", t), ELBOW_GAP),
        endSide: t,
        startBox: a,
        endBox: b,
        obstacles,
      });
      const cost = r.cost + (r.ok ? 0 : 100000);
      if (!best || cost < best.cost) best = { points: r.points, cost, startSide: s, endSide: t };
    }
  }
  return { points: best!.points, startSide: best!.startSide, endSide: best!.endSide };
}

/**
 * Routes for arrows the ELK layout could not route (those touching a grid), one after another:
 * each end takes the next free port position on the side it uses, so several arrows leaving one
 * side of a node fan out instead of running on top of each other. Obstacles: every other node and
 * the `walls` (zone title strips).
 */
export function routeEdges(
  edges: readonly { id: string; from: string; to: string }[],
  boxes: ReadonlyMap<string, Box>,
  walls: readonly Box[] = [],
): Map<string, Point[]> {
  const used = new Map<string, number>();
  const key = (id: string, side: Side) => `${id}|${side}`;
  const out = new Map<string, Point[]>();
  for (const e of edges) {
    const a = boxes.get(e.from);
    const b = boxes.get(e.to);
    if (!a || !b) continue;
    const obstacles = [...[...boxes].filter(([id]) => id !== e.from && id !== e.to).map(([, box]) => box), ...walls.filter((w) => !overlaps(w, a) && !overlaps(w, b))];
    const slot = (end: "a" | "b", side: Side) => SLOTS[Math.min(used.get(key(end === "a" ? e.from : e.to, side)) ?? 0, SLOTS.length - 1)];
    const r = routeBetweenBoxes(a, b, obstacles, slot);
    for (const [id, side] of [[e.from, r.startSide], [e.to, r.endSide]] as const) used.set(key(id, side), (used.get(key(id, side)) ?? 0) + 1);
    out.set(e.id, r.points);
  }
  return out;
}

function overlaps(p: Box, q: Box): boolean {
  return p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
}
