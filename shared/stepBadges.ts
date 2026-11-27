// Numbered step badges (build_diagram edge `step`) sit on their arrow, 28 px from its start. They are
// separate elements (an arrow can hold only one label), so whenever an arrow moves or is re-routed
// (tidy, auto_layout, a hand drag of a bound shape) the badge is put back on it. Pure; used by the
// executor's commit() and by App's onChange. Tested in tests/stepBadges.test.ts.

export interface BadgeEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  points?: readonly (readonly [number, number])[];
  customData?: Record<string, unknown> | null;
}

/** How far along its arrow a badge sits. */
export const BADGE_OFFSET = 28;

interface Point {
  x: number;
  y: number;
}

/** The point `dist` px along a polyline (or its middle when it is shorter than twice that). */
export function pointAlong(pts: readonly Point[], dist: number): Point {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let left = Math.min(dist, total / 2);
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len >= left && len > 0) return { x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * left) / len, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * left) / len };
    left -= len;
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 };
}

/** Where a badge's centre belongs on its arrow. */
export function badgeSpot(arrow: BadgeEl): Point | null {
  if (!arrow.points?.length) return null;
  return pointAlong(
    arrow.points.map(([px, py]) => ({ x: arrow.x + px, y: arrow.y + py })),
    BADGE_OFFSET,
  );
}

/**
 * New positions for badge elements (circle and number) that are no longer on their arrow. Only
 * arrows in `arrowIds` are looked at when it is given. A badge whose arrow is gone is deleted.
 */
export function badgeFixes(elements: readonly BadgeEl[], arrowIds?: ReadonlySet<string>): Map<string, { x: number; y: number } | { isDeleted: true }> {
  const out = new Map<string, { x: number; y: number } | { isDeleted: true }>();
  const byId = new Map(elements.map((e) => [e.id, e]));
  const badges = new Map<string, BadgeEl[]>();
  for (const e of elements) {
    const of = e.customData?.mydrawStepOf;
    if (e.isDeleted || typeof of !== "string" || (arrowIds && !arrowIds.has(of))) continue;
    badges.set(of, [...(badges.get(of) ?? []), e]);
  }
  for (const [arrowId, parts] of badges) {
    const arrow = byId.get(arrowId);
    if (!arrow || arrow.isDeleted) {
      for (const p of parts) out.set(p.id, { isDeleted: true });
      continue;
    }
    const spot = badgeSpot(arrow);
    const circle = parts.find((p) => p.type === "ellipse") ?? parts[0];
    if (!spot) continue;
    const dx = spot.x - (circle.x + circle.width / 2);
    const dy = spot.y - (circle.y + circle.height / 2);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    for (const p of parts) out.set(p.id, { x: p.x + dx, y: p.y + dy });
  }
  return out;
}
