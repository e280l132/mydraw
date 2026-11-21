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
