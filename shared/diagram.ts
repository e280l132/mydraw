// The diagram description used by build_diagram (and produced by the Mermaid parser and the
// templates): nodes, edges, zones. Validation and defaults live here; layout in layout.ts; the
// renderer turns a laid-out diagram into Excalidraw elements (web/src/agent/diagram.ts).
import { hexToRgb, rgbToHex } from "./colorMath";
import { resolveColor } from "./palettes";
import type { LayoutAlgorithm, LayoutDirection } from "./layout";
import type { Routing } from "./routing";

export type NodeShape = "rectangle" | "ellipse" | "diamond";
export type LineStyle = "solid" | "dashed" | "dotted";

export interface DiagramNode {
  id: string;
  label?: string;
  shape?: NodeShape;
  /** Stencil id or search text (e.g. "Amazon EC2"); the node becomes an icon with a caption. */
  icon?: string;
  /** Recolor an SVG icon (hex). */
  iconColor?: string;
  zone?: string;
  /** Stroke (and label) color, hex. */
  color?: string;
  /** Fill color, hex. */
  fill?: string;
  width?: number;
  height?: number;
  /** Custom properties (ip, hostname, ...), stored in the element's customData. */
  data?: Record<string, unknown>;
  link?: string;
  /** Category shown in the legend, e.g. "Server". */
  kind?: string;
}

export interface DiagramZone {
  id: string;
  label?: string;
  parent?: string;
  /** Border and title color, hex. */
  color?: string;
  /** Fill color, hex (default: a light tint of `color`). */
  fill?: string;
  style?: LineStyle;
  /** Lock the zone so it isn't dragged by accident (default true). */
  locked?: boolean;
}

export interface DiagramEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  style?: LineStyle;
  width?: number;
  /** Arrowheads: "end" (default), "both", "none". */
  arrow?: "end" | "both" | "none";
  routing?: Routing;
  /** Category shown in the legend, e.g. "Replication". */
  kind?: string;
}

export interface DiagramSpec {
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
  zones?: DiagramZone[];
  direction?: LayoutDirection;
  algorithm?: LayoutAlgorithm;
  /** Space between nodes, default 60. */
  spacing?: number;
  /** Default connector routing: "elbow" (default), "straight" or "curved". */
  routing?: Routing;
  /** Icon size (longest side), default 64. */
  iconSize?: number;
  /** Top-left corner. Default: right of the existing content. */
  x?: number;
  y?: number;
  /** Add a legend (true, or a title). */
  legend?: boolean | string;
  /** Title text above the diagram. */
  title?: string;
}

export const DIRECTIONS: readonly LayoutDirection[] = ["right", "down", "left", "up"];
export const ALGORITHMS: readonly LayoutAlgorithm[] = ["layered", "tree", "radial", "force", "grid"];
export const ROUTINGS: readonly Routing[] = ["elbow", "straight", "curved"];
const SHAPES: readonly NodeShape[] = ["rectangle", "ellipse", "diamond"];
const STYLES: readonly LineStyle[] = ["solid", "dashed", "dotted"];

/** Zone colors used in turn when a zone has none: [border, fill]. */
export const ZONE_PALETTE: readonly [string, string][] = [
  ["#1971c2", "#e7f5ff"],
  ["#2f9e44", "#ebfbee"],
  ["#e8590c", "#fff4e6"],
  ["#9c36b5", "#f8f0fc"],
  ["#0c8599", "#e3fafc"],
  ["#c2255c", "#fff0f6"],
];

/** Light tint of a color (mixed with white). */
export function tint(hex: string, amount = 0.9): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

type Loose = Record<string, unknown>;

function str(v: unknown, what: string, required = false): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error(`${what} is required`);
    return undefined;
  }
  if (typeof v !== "string" && typeof v !== "number") throw new Error(`${what} must be a string`);
  return String(v);
}

function color(v: unknown, what: string): string | undefined {
  const s = str(v, what);
  if (s === undefined) return undefined;
  const h = resolveColor(s);
  if (!h) throw new Error(`${what} must be a hex color like #1971c2 or a palette name like blue-600, aws.orange`);
  return h;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], what: string): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (!list.includes(v as T)) throw new Error(`${what} must be one of ${list.join(", ")}`);
  return v as T;
}

function num(v: unknown, what: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} must be a number`);
  return v;
}

function arr(v: unknown, what: string): Loose[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every((x) => x && typeof x === "object" && !Array.isArray(x))) throw new Error(`${what} must be an array of objects`);
  return v as Loose[];
}

/** Validate an agent-supplied diagram and fill in edge ids. Throws with a readable message. */
export function normalizeSpec(raw: unknown): DiagramSpec {
  if (!raw || typeof raw !== "object") throw new Error("diagram must be an object with nodes");
  const r = raw as Loose;
  const ids = new Set<string>();
  const claim = (id: string, what: string) => {
    if (ids.has(id)) throw new Error(`${what}: id "${id}" is used twice`);
    ids.add(id);
  };

  const zones: DiagramZone[] = arr(r.zones, "zones").map((z, i) => {
    const id = str(z.id, `zones[${i}].id`, true)!;
    claim(id, "zones");
    return {
      id,
      label: str(z.label ?? z.name, `zone ${id} label`),
      parent: str(z.parent, `zone ${id} parent`),
      color: color(z.color, `zone ${id} color`),
      fill: color(z.fill, `zone ${id} fill`),
      style: oneOf(z.style, STYLES, `zone ${id} style`),
      locked: z.locked === undefined ? undefined : z.locked !== false,
    };
  });
  const nodes: DiagramNode[] = arr(r.nodes, "nodes").map((n, i) => {
    const id = str(n.id, `nodes[${i}].id`, true)!;
    claim(id, "nodes");
    const data = n.data && typeof n.data === "object" && !Array.isArray(n.data) ? (n.data as Loose) : undefined;
    return {
      id,
      label: str(n.label ?? n.text, `node ${id} label`),
      shape: oneOf(n.shape, SHAPES, `node ${id} shape`),
      icon: str(n.icon ?? n.stencil, `node ${id} icon`),
      iconColor: color(n.iconColor, `node ${id} iconColor`),
      zone: str(n.zone, `node ${id} zone`),
      color: color(n.color, `node ${id} color`),
      fill: color(n.fill, `node ${id} fill`),
      width: num(n.width, `node ${id} width`),
      height: num(n.height, `node ${id} height`),
      data,
      link: str(n.link, `node ${id} link`),
      kind: str(n.kind, `node ${id} kind`),
    };
  });
  if (!nodes.length && !zones.length) throw new Error("diagram needs at least one node");
  let auto = 1;
  const rawEdges = arr(r.edges, "edges");
  // Explicit edge ids first, so generated ones (e1, e2, ...) never clash with them.
  const explicit = new Set(rawEdges.map((e) => e.id).filter((id) => id !== undefined && id !== null && id !== "").map(String));
  const edges: DiagramEdge[] = rawEdges.map((e, i) => {
    const from = str(e.from ?? e.source, `edges[${i}].from`, true)!;
    const to = str(e.to ?? e.target, `edges[${i}].to`, true)!;
    if (!ids.has(from)) throw new Error(`edges[${i}]: no node or zone "${from}"`);
    if (!ids.has(to)) throw new Error(`edges[${i}]: no node or zone "${to}"`);
    let id = str(e.id, `edges[${i}].id`);
    if (!id) {
      do id = `e${auto++}`;
      while (ids.has(id) || explicit.has(id));
    }
    claim(id, "edges");
    return {
      id,
      from,
      to,
      label: str(e.label, `edge ${id} label`),
      color: color(e.color, `edge ${id} color`),
      style: oneOf(e.style, STYLES, `edge ${id} style`),
      width: num(e.width, `edge ${id} width`),
      arrow: oneOf(e.arrow, ["end", "both", "none"] as const, `edge ${id} arrow`),
      routing: oneOf(e.routing, ROUTINGS, `edge ${id} routing`),
      kind: str(e.kind, `edge ${id} kind`),
    };
  });
  const zoneIds = new Set(zones.map((z) => z.id));
  for (const n of nodes) if (n.zone && !zoneIds.has(n.zone)) throw new Error(`node "${n.id}": no zone "${n.zone}"`);
  for (const z of zones) if (z.parent && !zoneIds.has(z.parent)) throw new Error(`zone "${z.id}": no parent zone "${z.parent}"`);

  return {
    nodes,
    edges,
    zones,
    direction: oneOf(r.direction, DIRECTIONS, "direction"),
    algorithm: oneOf(r.algorithm, ALGORITHMS, "algorithm"),
    spacing: num(r.spacing, "spacing"),
    routing: oneOf(r.routing, ROUTINGS, "routing"),
    iconSize: num(r.iconSize, "iconSize"),
    x: num(r.x, "x"),
    y: num(r.y, "y"),
    legend: typeof r.legend === "string" ? r.legend : r.legend === true ? true : undefined,
    title: str(r.title, "title"),
  };
}

/** Depth of each zone (0 = top level). */
export function zoneDepths(zones: readonly DiagramZone[]): Map<string, number> {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const depth = new Map<string, number>();
  const get = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const p = byId.get(id)?.parent;
    const d = p ? get(p) + 1 : 0;
    depth.set(id, d);
    return d;
  };
  for (const z of zones) get(z.id);
  return depth;
}

/** Border and fill colors for each zone: given ones, else the palette in turn. */
export function zoneColors(zones: readonly DiagramZone[]): Map<string, { stroke: string; fill: string }> {
  const out = new Map<string, { stroke: string; fill: string }>();
  let i = 0;
  for (const z of zones) {
    const [ps, pf] = ZONE_PALETTE[i++ % ZONE_PALETTE.length];
    const stroke = z.color && z.color !== "transparent" ? z.color : ps;
    const fill = z.fill ?? (z.color && z.color !== "transparent" ? tint(z.color) : pf);
    out.set(z.id, { stroke, fill });
  }
  return out;
}

/**
 * Rename every id of a diagram that clashes with `taken` (e.g. a Mermaid diagram or template added
 * to a drawing that already has nodes "A" or "e1"): all ids get the same "-2", "-3", ... suffix.
 */
export function uniquifySpec(spec: DiagramSpec, taken: ReadonlySet<string>): DiagramSpec {
  const ids = [
    ...spec.nodes.map((n) => n.id),
    ...(spec.zones ?? []).flatMap((z) => [z.id, `${z.id}.title`]),
    ...(spec.edges ?? []).map((e) => e.id).filter((x): x is string => !!x),
  ];
  if (!ids.some((id) => taken.has(id))) return spec;
  let n = 2;
  while (ids.some((id) => taken.has(`${id}-${n}`))) n++;
  const r = (id: string) => `${id}-${n}`;
  const ro = (id: string | undefined) => (id === undefined ? undefined : r(id));
  return {
    ...spec,
    nodes: spec.nodes.map((x) => ({ ...x, id: r(x.id), zone: ro(x.zone) })),
    zones: (spec.zones ?? []).map((z) => ({ ...z, id: r(z.id), parent: ro(z.parent) })),
    edges: (spec.edges ?? []).map((e) => ({ ...e, id: ro(e.id), from: r(e.from), to: r(e.to) })),
  };
}
