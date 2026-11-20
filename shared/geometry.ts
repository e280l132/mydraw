// Pure geometry used by the agent tools: where an arrow meets a shape's outline, and where to put
// new content next to existing content.

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OutlineShape = "rectangle" | "ellipse" | "diamond";

export function center(b: Box): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Point where a ray from the shape's centre towards `toward` crosses its outline, pushed out by
 * `gap`. Returns the centre when `toward` is the centre.
 */
export function outlinePoint(box: Box, shape: OutlineShape, toward: Point, gap = 0): Point {
  const c = center(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return c;
  const ux = dx / len;
  const uy = dy / len;
  const a = Math.max(box.width / 2, 1e-9);
  const b = Math.max(box.height / 2, 1e-9);
  let t: number;
  if (shape === "ellipse") {
    t = 1 / Math.sqrt((ux * ux) / (a * a) + (uy * uy) / (b * b));
  } else if (shape === "diamond") {
    t = 1 / (Math.abs(ux) / a + Math.abs(uy) / b);
  } else {
    t = Math.min(Math.abs(ux) > 1e-9 ? a / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? b / Math.abs(uy) : Infinity);
  }
  t += gap;
  return { x: c.x + ux * t, y: c.y + uy * t };
}

/** Endpoints of a straight connector between two shapes, each on its shape's outline (plus gap). */
export function connectorEndpoints(
  from: { box: Box; shape: OutlineShape },
  to: { box: Box; shape: OutlineShape },
  gap = 0,
): { start: Point; end: Point } {
  const cf = center(from.box);
  const ct = center(to.box);
  return {
    start: outlinePoint(from.box, from.shape, ct, gap),
    end: outlinePoint(to.box, to.shape, cf, gap),
  };
}

export type Side = "right_of" | "left_of" | "above" | "below";

/**
 * Offset that moves `content` next to `ref` on the given side, `gap` apart, with `anchor` (a box
 * inside the content, e.g. the icon of an icon+label stencil) centred on `refAnchor` across the
 * other axis.
 */
export function placeBeside(
  content: Box,
  anchor: Box,
  ref: Box,
  refAnchor: Box,
  side: Side,
  gap: number,
): { dx: number; dy: number } {
  const a = center(anchor);
  const r = center(refAnchor);
  switch (side) {
    case "right_of":
      return { dx: ref.x + ref.width + gap - content.x, dy: r.y - a.y };
    case "left_of":
      return { dx: ref.x - gap - (content.x + content.width), dy: r.y - a.y };
    case "below":
      return { dx: r.x - a.x, dy: ref.y + ref.height + gap - content.y };
    case "above":
      return { dx: r.x - a.x, dy: ref.y - gap - (content.y + content.height) };
  }
}

export function boxFromBounds([x1, y1, x2, y2]: readonly [number, number, number, number]): Box {
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
