// From an ELK layout to the routes that will actually be drawn, and a quality report for them.
// build_diagram / auto_layout draw `inset(tidyRoute(route))` for orthogonal layouts; scoring the
// same routes means a layout is judged by what the user will see (shared/diagramQuality.ts).
import type { Point } from "./geometry";
import { measureQuality, nodesThrough, type QNode, type QRoute, type QZone, type QualityInput, type QualityReport } from "./diagramQuality";
import { tidyRoutes } from "./edgeTidy";
import type { LayoutInput, LayoutResult } from "./layout";
import { ELBOW_GAP, inset, tidyRoute } from "./routing";

/** A zone title's width is its text plus the title offset and padding that `zoneTitleSize` adds. */
export const ZONE_TITLE_EXTRA = 44;

/**
 * The route as drawn: tidied (end runs long enough for an arrowhead) and pulled back from the node
 * outlines. Tidying moves bends, which can push a run into a node; then the plain route is kept.
 */
export function drawnRoute(route: Point[], orthogonal: boolean, hits: (points: Point[]) => number = () => 0): Point[] {
  if (!orthogonal) return route;
  const tidy = inset(tidyRoute(route, 20 + ELBOW_GAP), ELBOW_GAP);
  return hits(tidy) > hits(route) ? inset(route, ELBOW_GAP) : tidy;
}

export function routesOf(layout: LayoutResult, input: LayoutInput): QRoute[] {
  const scene = qualityScene(layout, input);
  const out: QRoute[] = [];
  for (const e of input.edges ?? []) {
    const raw = layout.edges.get(e.id);
    if (!raw) continue;
    const hits = (points: Point[]) => nodesThrough({ id: e.id, from: e.from, to: e.to, points }, scene).length;
    out.push({ id: e.id, from: e.from, to: e.to, points: drawnRoute(raw, layout.orthogonal, hits), label: e.label });
  }
  return out;
}

/** Nodes and zones of a layout, in the form the quality and tidy code reads. */
export function qualityScene(layout: LayoutResult, input: LayoutInput): Pick<QualityInput, "nodes" | "zones"> {
  const nodes = new Map<string, QNode>();
  for (const n of input.nodes) {
    const b = layout.nodes.get(n.id);
    if (b) nodes.set(n.id, { ...b, zone: n.zone });
  }
  const zones = new Map<string, QZone>();
  for (const z of input.zones ?? []) {
    const b = layout.zones.get(z.id);
    if (b) zones.set(z.id, { ...b, parent: z.parent, titleWidth: Math.max(0, Math.min(b.width, z.minWidth - ZONE_TITLE_EXTRA) + 14), titleHeight: z.titleHeight });
  }
  return { nodes, zones };
}

/** The routes to draw: the layout's, tidied (overlaps separated), labels on free stretches. Orthogonal layouts only. */
export function tidiedRoutes(layout: LayoutResult, input: LayoutInput): QRoute[] {
  const routes = routesOf(layout, input);
  return layout.orthogonal ? tidyRoutes({ ...qualityScene(layout, input), routes }) : routes;
}

export function qualityOfLayout(layout: LayoutResult, input: LayoutInput, routes: QRoute[] = routesOf(layout, input)): QualityReport {
  return measureQuality({ ...qualityScene(layout, input), routes });
}
