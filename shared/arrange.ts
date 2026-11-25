// Align and distribute for the agent (MCP `align` / `distribute`). Pure: works on unit boxes and
// returns how far each unit moves. A unit is what moves as one (a shape with its label, an icon
// node, a group, a zone with its contents); the renderer builds them.
import type { Box } from "./geometry";

export const ALIGN_EDGES = ["left", "center", "right", "top", "middle", "bottom"] as const;
export type AlignEdge = (typeof ALIGN_EDGES)[number];
export type Axis = "horizontal" | "vertical";

export interface UnitBox {
  key: string;
  box: Box;
}
export interface UnitMove {
  key: string;
  dx: number;
  dy: number;
}

export function isAlignEdge(v: unknown): v is AlignEdge {
  return typeof v === "string" && (ALIGN_EDGES as readonly string[]).includes(v);
}

export function unionOf(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.width));
  const btm = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: r - x, height: btm - y };
}

/** Line every unit up on one edge (or centre line) of `ref` (default: the units' common box). */
export function alignMoves(units: readonly UnitBox[], edge: AlignEdge, ref?: Box): UnitMove[] {
  if (!units.length) return [];
  const r = ref ?? unionOf(units.map((u) => u.box));
  return units.map(({ key, box: b }) => {
    let dx = 0;
    let dy = 0;
    if (edge === "left") dx = r.x - b.x;
    else if (edge === "right") dx = r.x + r.width - (b.x + b.width);
    else if (edge === "center") dx = r.x + r.width / 2 - (b.x + b.width / 2);
    else if (edge === "top") dy = r.y - b.y;
    else if (edge === "bottom") dy = r.y + r.height - (b.y + b.height);
    else dy = r.y + r.height / 2 - (b.y + b.height / 2);
    return { key, dx, dy };
  });
}

/**
 * Space units evenly along an axis, in their current order (by centre). Without `gap` the first and
 * last stay put and the gaps between neighbours become equal (needs 3+ units, like Excalidraw);
 * with `gap` the first stays put and each next unit starts `gap` px after the previous one ends.
 */
export function distributeMoves(units: readonly UnitBox[], axis: Axis, gap?: number): UnitMove[] {
  const h = axis === "horizontal";
  const start = (b: Box) => (h ? b.x : b.y);
  const size = (b: Box) => (h ? b.width : b.height);
  const sorted = [...units].sort((a, b) => start(a.box) + size(a.box) / 2 - (start(b.box) + size(b.box) / 2) || a.key.localeCompare(b.key));
  if (sorted.length < 2) return sorted.map((u) => ({ key: u.key, dx: 0, dy: 0 }));
  let step = gap;
  if (step === undefined) {
    if (sorted.length < 3) return sorted.map((u) => ({ key: u.key, dx: 0, dy: 0 }));
    const first = sorted[0].box;
    const last = sorted[sorted.length - 1].box;
    const span = start(last) + size(last) - start(first);
    const used = sorted.reduce((s, u) => s + size(u.box), 0);
    step = (span - used) / (sorted.length - 1);
  }
  let at = start(sorted[0].box);
  return sorted.map(({ key, box }) => {
    const d = at - start(box);
    at += size(box) + (step as number);
    return { key, dx: h ? d : 0, dy: h ? 0 : d };
  });
}
