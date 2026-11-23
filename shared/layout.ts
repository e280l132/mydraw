// Graph layout with ELK (Eclipse Layout Kernel, via elkjs). Pure: takes node sizes, zone nesting and
// edges, returns absolute boxes and edge routes. Used by build_diagram, mermaid_to_scene,
// apply_template and auto_layout. Runs in the renderer and in tests (Node).
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { Box, Point } from "./geometry";

export type LayoutDirection = "right" | "down" | "left" | "up";
export type LayoutAlgorithm = "layered" | "tree" | "radial" | "force" | "grid";

export interface LayoutNodeInput {
  id: string;
  width: number;
  height: number;
  /** Zone the node sits in. */
  zone?: string;
}

export interface LayoutZoneInput {
  id: string;
  parent?: string;
  /** Space above the contents for the zone title. */
  titleHeight: number;
  /** Minimum width (e.g. so the title fits). */
  minWidth: number;
}

export interface LayoutEdgeInput {
  id: string;
  from: string;
  to: string;
  /** Size of the edge label, so the layout leaves room for it. */
  label?: { width: number; height: number };
}

export interface LayoutInput {
  nodes: LayoutNodeInput[];
  zones?: LayoutZoneInput[];
  edges?: LayoutEdgeInput[];
  direction?: LayoutDirection;
  algorithm?: LayoutAlgorithm;
  /** Space between nodes (default 60). Space between layers is 1.5x this. */
  spacing?: number;
  /** Padding inside zones (default 24). */
  zonePadding?: number;
  /** ELK options applied last (the variants `layoutBest` tries). */
  elkOptions?: Record<string, string>;
}

export interface LayoutResult {
  nodes: Map<string, Box>;
  zones: Map<string, Box>;
  /** Edge routes from start to end, absolute. Orthogonal for the layered algorithm. */
  edges: Map<string, Point[]>;
  /** True when edge routes are orthogonal (layered); other algorithms give straight lines. */
  orthogonal: boolean;
  bounds: Box;
}

const ELK_ALGORITHM: Record<LayoutAlgorithm, string> = {
  layered: "layered",
  tree: "mrtree",
  radial: "radial",
  force: "force",
  grid: "rectpacking",
};

const ELK_DIRECTION: Record<LayoutDirection, string> = { right: "RIGHT", down: "DOWN", left: "LEFT", up: "UP" };

let elk: InstanceType<typeof ELK> | null = null;

/** Check zone nesting and membership; throws with an agent-readable message. */
export function checkLayoutInput(input: LayoutInput): void {
  const ids = new Set<string>();
  const zones = new Map((input.zones ?? []).map((z) => [z.id, z]));
  for (const x of [...input.nodes, ...(input.zones ?? [])]) {
    if (ids.has(x.id)) throw new Error(`duplicate id "${x.id}"`);
    ids.add(x.id);
  }
  for (const n of input.nodes) if (n.zone && !zones.has(n.zone)) throw new Error(`node "${n.id}": no zone "${n.zone}"`);
  for (const z of zones.values()) {
    if (z.parent && !zones.has(z.parent)) throw new Error(`zone "${z.id}": no parent zone "${z.parent}"`);
    const seen = new Set<string>([z.id]);
    for (let p = z.parent; p; p = zones.get(p)?.parent) {
      if (seen.has(p)) throw new Error(`zone "${z.id}" is nested inside itself`);
      seen.add(p);
    }
  }
  for (const e of input.edges ?? []) {
    if (!ids.has(e.from)) throw new Error(`edge "${e.id}": no node or zone "${e.from}"`);
    if (!ids.has(e.to)) throw new Error(`edge "${e.id}": no node or zone "${e.to}"`);
  }
}

export async function layoutGraph(input: LayoutInput): Promise<LayoutResult> {
  checkLayoutInput(input);
  const algorithm = input.algorithm ?? "layered";
  const spacing = input.spacing ?? 60;
  const pad = input.zonePadding ?? 24;
  const layered = algorithm === "layered";

  const layoutOptions: Record<string, string> = {
    "elk.algorithm": ELK_ALGORITHM[algorithm],
    "elk.direction": ELK_DIRECTION[input.direction ?? "right"],
    "elk.spacing.nodeNode": String(spacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(Math.round(spacing * 1.5)),
    "elk.spacing.edgeNode": String(Math.round(spacing / 2.5)),
    "elk.layered.spacing.edgeNodeBetweenLayers": String(Math.round(spacing / 2.5)),
    "elk.spacing.edgeEdge": "16",
    "elk.spacing.edgeLabel": "6",
    "elk.spacing.componentComponent": String(spacing),
    "elk.edgeRouting": layered ? "ORTHOGONAL" : "POLYLINE",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    "elk.edgeLabels.placement": "CENTER",
    "elk.json.shapeCoords": "ROOT",
    "elk.json.edgeCoords": "ROOT",
    "elk.radial.compactor": "WEDGE_COMPACTION",
    "elk.force.iterations": "300",
    "elk.rectpacking.widthApproximation.targetWidth": "-1",
    ...(layered ? input.elkOptions : {}),
  };

  // Build the nested ELK graph: zones are compound nodes.
  const byId = new Map<string, ElkNode>();
  const root: ElkNode = { id: "__root", layoutOptions, children: [], edges: [] };
  for (const z of input.zones ?? []) {
    byId.set(z.id, {
      id: z.id,
      children: [],
      width: z.minWidth,
      height: z.titleHeight + pad * 2,
      layoutOptions: {
        "elk.padding": `[top=${z.titleHeight + pad},left=${pad},bottom=${pad},right=${pad}]`,
        "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
        "elk.nodeSize.minimum": `(${z.minWidth},${z.titleHeight + pad * 2})`,
        ...(layered ? {} : { "elk.algorithm": ELK_ALGORITHM[algorithm] }),
      },
    });
  }
  for (const n of input.nodes) byId.set(n.id, { id: n.id, width: n.width, height: n.height });
  const parentOf = (zoneOrNode?: string) => (zoneOrNode ? byId.get(zoneOrNode)! : root);
  for (const z of input.zones ?? []) parentOf(z.parent).children!.push(byId.get(z.id)!);
  for (const n of input.nodes) parentOf(n.zone).children!.push(byId.get(n.id)!);
  for (const e of input.edges ?? []) {
    const edge: ElkExtendedEdge = { id: e.id, sources: [e.from], targets: [e.to] };
    if (e.label && layered) edge.labels = [{ id: `${e.id}__label`, text: " ", width: e.label.width, height: e.label.height }];
    root.edges!.push(edge);
  }

  elk ??= new ELK();
  const out = await elk.layout(root);

  const nodes = new Map<string, Box>();
  const zones = new Map<string, Box>();
  const zoneIds = new Set((input.zones ?? []).map((z) => z.id));
  const walk = (n: ElkNode) => {
    for (const c of n.children ?? []) {
      const box = { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 };
      (zoneIds.has(c.id) ? zones : nodes).set(c.id, box);
      walk(c);
    }
  };
  walk(out);

  // ELK sometimes ignores a compound node's minimum size with cross-hierarchy edges: widen such
  // zones to the right (inner zones first) and keep every parent around its children.
  const zoneList = input.zones ?? [];
  const depth = (id: string): number => {
    const p = zoneList.find((z) => z.id === id)?.parent;
    return p ? depth(p) + 1 : 0;
  };
  for (const z of [...zoneList].sort((a, b) => depth(b.id) - depth(a.id))) {
    const box = zones.get(z.id)!;
    if (box.width < z.minWidth) box.width = z.minWidth;
    if (z.parent) {
      const p = zones.get(z.parent)!;
      const right = box.x + box.width + pad;
      if (right > p.x + p.width) p.width = right - p.x;
    }
  }

  const edges = new Map<string, Point[]>();
  const collect = (n: ElkNode) => {
    for (const e of (n.edges ?? []) as ElkExtendedEdge[]) {
      const s = e.sections?.[0];
      if (!s) continue;
      edges.set(e.id, [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({ x: p.x, y: p.y })));
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(out);

  if (layered) {
    const strips = zoneList.map((z) => {
      const b = zones.get(z.id)!;
      return { id: z.id, rect: { x: b.x, y: b.y, width: Math.min(z.minWidth, b.width), height: z.titleHeight }, zone: b };
    });
    for (const e of input.edges ?? []) {
      const route = edges.get(e.id);
      if (!route) continue;
      edges.set(e.id, avoidTitleStrips(route, strips, nodes.get(e.from) ?? zones.get(e.from), nodes.get(e.to) ?? zones.get(e.to)));
    }
  }

  const all = [...nodes.values(), ...zones.values()];
  const x1 = Math.min(...all.map((b) => b.x));
  const y1 = Math.min(...all.map((b) => b.y));
  const x2 = Math.max(...all.map((b) => b.x + b.width));
  const y2 = Math.max(...all.map((b) => b.y + b.height));
  const bounds = all.length ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : { x: 0, y: 0, width: 0, height: 0 };
  return { nodes, zones, edges, orthogonal: layered, bounds };
}

/** Move a layout so its top-left corner is at `origin`. */
export function translateLayout(r: LayoutResult, origin: Point): LayoutResult {
  const dx = origin.x - r.bounds.x;
  const dy = origin.y - r.bounds.y;
  const mv = (b: Box): Box => ({ ...b, x: b.x + dx, y: b.y + dy });
  return {
    nodes: new Map([...r.nodes].map(([k, b]) => [k, mv(b)])),
    zones: new Map([...r.zones].map(([k, b]) => [k, mv(b)])),
    edges: new Map([...r.edges].map(([k, pts]) => [k, pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))])),
    orthogonal: r.orthogonal,
    bounds: mv(r.bounds),
  };
}

// ---------- keeping edges out of zone title strips ----------

const STRIP_MARGIN = 8;

interface Strip {
  id: string;
  rect: Box;
  zone: Box;
}

function crosses(a: Point, b: Point, r: Box): boolean {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  return x2 > r.x && x1 < r.x + r.width && y2 > r.y && y1 < r.y + r.height;
}

/**
 * ELK knows nothing about the zone title text, so an orthogonal route can run through it. Nudge the
 * offending segment just past the title (down for a horizontal run, right for a vertical one),
 * moving its neighbours with it. A segment that touches the route's start or end is only moved
 * along its node's side, so the arrow never detaches; if no clean move exists the route is kept.
 */
export function avoidTitleStrips(route: Point[], strips: Strip[], fromBox?: Box, toBox?: Box): Point[] {
  let pts = route.map((p) => ({ ...p }));
  for (let round = 0; round < 6; round++) {
    let moved = false;
    for (const strip of strips) {
      const r = strip.rect;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (!crosses(a, b, r)) continue;
        const horizontal = Math.abs(a.y - b.y) < 0.5;
        const vertical = Math.abs(a.x - b.x) < 0.5;
        const first = i === 0;
        const last = i + 1 === pts.length - 1;
        if (horizontal) {
          const y = r.y + r.height + STRIP_MARGIN;
          if (y > strip.zone.y + strip.zone.height - STRIP_MARGIN) continue;
          // End points stay on their node: only move a point that is an interior bend.
          if (first || last) continue;
          a.y = y;
          b.y = y;
          moved = true;
        } else if (vertical) {
          const x = r.x + r.width + STRIP_MARGIN;
          if (x > strip.zone.x + strip.zone.width - STRIP_MARGIN) continue;
          const okEnd = (box: Box | undefined) => !!box && x > box.x + 4 && x < box.x + box.width - 4;
          if ((first && !okEnd(fromBox)) || (last && !okEnd(toBox))) {
            // An end point is pinned to its node: jog around the title instead of sliding the run.
            const down = b.y > a.y;
            const above = r.y - STRIP_MARGIN;
            const below = r.y + r.height + STRIP_MARGIN;
            const y1 = down ? above : below;
            const y2 = down ? below : above;
            if ((down && (a.y >= above || b.y <= below)) || (!down && (a.y <= below || b.y >= above))) continue;
            pts.splice(i + 1, 0, { x: a.x, y: y1 }, { x, y: y1 }, { x, y: y2 }, { x: a.x, y: y2 });
            moved = true;
            break;
          }
          a.x = x;
          b.x = x;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  // Drop points that became collinear or duplicated.
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const q = pts[i - 1];
    const n = pts[i + 1];
    const same = Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
    const line = (Math.abs(q.x - p.x) < 0.5 && Math.abs(p.x - n.x) < 0.5) || (Math.abs(q.y - p.y) < 0.5 && Math.abs(p.y - n.y) < 0.5);
    return !same && !line;
  });
}
