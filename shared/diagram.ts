// The diagram description used by build_diagram (and produced by the Mermaid parser and the
// templates): nodes, edges, zones. Validation and defaults live here; layout in layout.ts; the
// renderer turns a laid-out diagram into Excalidraw elements (web/src/agent/diagram.ts).
import { normalizeIconSketch, type IconSketch } from "./iconSketch";
import { resolveShadowInput, type Shadow } from "./shadow";
import { STROKE_STYLE_NAMES, type StrokeStyleName } from "./dash";
import { resolveGradientInput, type Gradient } from "./gradient";
import { requireFillStyle, type FillStyleId } from "./fills";
import { hexToRgb, rgbToHex } from "./colorMath";
import { linkProblem } from "./links";
import { requireColor, resolveColor } from "./palettes";
import { ARROWHEADS, EDGE_WEIGHTS, LOOKS_LIST, NODE_EMPHASES, type Arrowhead, type EdgeWeight, type KindStyle, type LookName, type NodeEmphasis } from "./diagramLook";
import type { LayoutAlgorithm, LayoutDirection } from "./layout";
import type { Routing } from "./routing";
import { SVG_SHAPES, type SvgShape } from "./shapeSvgs";
import { NODE_ROLES, type NodeRole } from "./nodeRoles";
import { inferZoneKind, neutralZoneStyle, ZONE_KIND_STYLES, ZONE_KINDS, type ZoneKind } from "./zoneKinds";
import { gridZoneIds, parseCell, type DiagramGrid, type GridBand } from "./gridLayout";

/** Excalidraw's own shapes, plus the drawn ones of shared/shapeSvgs.ts (cylinder for a database, ...). */
/** A node's iconStyle (agent input), validated; undefined = the look decides. */
function iconStyleOf(v: unknown, id: string): IconSketch | null | undefined {
  if (v === undefined) return undefined;
  try {
    return normalizeIconSketch(v);
  } catch (e) {
    throw new Error(`node ${id} ${e instanceof Error ? e.message : e}`);
  }
}

export type NodeShape = "rectangle" | "ellipse" | "diamond" | SvgShape;
/** Excalidraw's solid / dashed / dotted plus the extra dash styles (shared/dash.ts). */
export type LineStyle = StrokeStyleName;

export interface DiagramNode {
  id: string;
  label?: string;
  shape?: NodeShape;
  /** Stencil id or search text (e.g. "Amazon EC2"); the node becomes an icon with a caption. */
  icon?: string;
  /** Recolor an SVG icon (hex). */
  iconColor?: string;
  /** Hand-drawn icon / drawn shape (null = original). Default: hand-drawn with look "sketch". */
  iconStyle?: IconSketch | null;
  zone?: string;
  /** Place in the diagram's grid: "row/column", or "row/*" across the whole row. Sets `zone` to that cell. */
  cell?: string;
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
  /** "primary": thicker border, bold label; "muted": grey and thin. */
  emphasis?: NodeEmphasis;
  /** Second line under the label (an IP, a role), smaller and grey. */
  subtitle?: string;
  /** Shadow under the node (icon nodes: under the icon); null = none even with a diagram-wide shadow. */
  shadow?: Shadow | null;
  /** Shape nodes: gradient fill (shared/gradient.ts); overrides `fill`. */
  gradient?: Gradient | null;
  /** Shape nodes: fill pattern (solid default; hachure, cross-hatch, dots, dashed, zigzag, zigzag-line). */
  fillStyle?: FillStyleId;
  /** Shape nodes: border style (solid default, dashed, dotted, or an extra dash style). */
  strokeStyle?: LineStyle;
  /** What the node is (entry, edge, compute, service, data, queue, storage, security, monitoring, external): the polished look colours it by role. Default: guessed from shape, kind, icon and label. */
  role?: NodeRole;
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
  /** What the zone is (vpc, az, subnet-public, ...): sets its colours and dash. Guessed from the label when absent. */
  kind?: ZoneKind;
  /** Set on the zones a grid adds (its outer zone, columns and cells): the grid's id. */
  grid?: string;
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
  /** Category shown in the legend, e.g. "Replication"; edges of one kind share its style (DiagramSpec.kinds). */
  kind?: string;
  /** Step number of a flow (1, 2, ...): a numbered badge on the arrow; describe it in DiagramSpec.steps. */
  step?: number;
  /** "primary" (thick), "normal" (default) or "secondary" (thin, faded). */
  weight?: EdgeWeight;
  /** Arrowhead at the end / start (Excalidraw's: triangle, dot, diamond, crowfoot_many, ..., or none). */
  head?: Arrowhead;
  tail?: Arrowhead;
}

export interface DiagramView {
  name: string;
  /** Arrow kinds to keep (e.g. ["Traffic"]). */
  kinds?: string[];
  /** Arrow weights to keep (e.g. ["primary"] for the main path). */
  weights?: EdgeWeight[];
  /** Keep the numbered steps' arrows. */
  steps?: boolean;
  /** Node ids to keep besides the ends of kept arrows. */
  nodes?: string[];
}

export interface DiagramSpec {
  nodes: DiagramNode[];
  edges?: DiagramEdge[];
  zones?: DiagramZone[];
  /** Rows x columns of zones (tiers x availability zones), laid out as a grid; nodes join a cell with `cell`. */
  grid?: DiagramGrid;
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
  /** Icon rows in the legend: auto (default: only icons with a kind or no caption), all, none. */
  legendIcons?: "auto" | "all" | "none";
  /** Title text above the diagram. */
  title?: string;
  /** A line under the title. */
  subtitle?: string;
  /** What each numbered step does (steps[0] = step 1), listed with its badge under the diagram. */
  steps?: string[];
  /** Node `data` keys shown as the node's subtitle (when it has none), e.g. ["instanceType", "ip"]. */
  showData?: string[];
  /** Extra pages: the same diagram again in a frame per view, with only the view's arrows (and their nodes) at full strength. */
  views?: DiagramView[];
  /** "polished" (default: colour by role, soft shadows), "professional" (plain, white nodes) or "sketch" (hand-drawn). */
  look?: LookName;
  /** Default shadow for every node (a node's own `shadow` wins). */
  shadow?: Shadow | null;
  /** Style per edge kind, so every arrow of a kind looks the same; kinds without one get a colour of their own. */
  kinds?: Record<string, KindStyle>;
}

export const DIRECTIONS: readonly LayoutDirection[] = ["right", "down", "left", "up"];
export const ALGORITHMS: readonly LayoutAlgorithm[] = ["layered", "tree", "radial", "force", "grid"];
export const ROUTINGS: readonly Routing[] = ["elbow", "straight", "curved"];
const SHAPES: readonly NodeShape[] = ["rectangle", "ellipse", "diamond", ...SVG_SHAPES];
const STYLES: readonly LineStyle[] = STROKE_STYLE_NAMES;

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

/** A drill-down link: an http(s) address or a path to a .excalidraw drawing (see shared/links.ts). */
function link(v: unknown, what: string): string | undefined {
  const s = str(v, what);
  const bad = s ? linkProblem(s) : null;
  if (bad) throw new Error(`${what}: ${bad}`);
  return s;
}

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

/** Gradient input; from/to may be color names. */
function gradientIn(v: unknown, what: string): Gradient | null | undefined {
  try {
    if (v && typeof v === "object") {
      const o = { ...(v as Record<string, unknown>) };
      for (const k of ["from", "to"] as const) if (o[k] !== undefined) o[k] = requireColor(o[k], `${k}`);
      v = o;
    }
    return resolveGradientInput(v);
  } catch (e) {
    throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function fillIn(v: unknown, what: string): FillStyleId {
  try {
    return requireFillStyle(v);
  } catch (e) {
    throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function shadowIn(v: unknown, what: string): Shadow | null | undefined {
  try {
    return resolveShadowInput(v);
  } catch (e) {
    throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
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

  // Zones a grid added in an earlier pass are made again from the grid (normalizing twice is fine).
  const zones: DiagramZone[] = arr(r.zones, "zones").filter((z) => !(r.grid && typeof z.grid === "string")).map((z, i) => {
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
      kind: oneOf(z.kind, ZONE_KINDS, `zone ${id} kind`),
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
      iconStyle: iconStyleOf(n.iconStyle, id),
      zone: str(n.zone, `node ${id} zone`),
      cell: str(n.cell, `node ${id} cell`),
      color: color(n.color, `node ${id} color`),
      fill: color(n.fill, `node ${id} fill`),
      width: num(n.width, `node ${id} width`),
      height: num(n.height, `node ${id} height`),
      data,
      link: link(n.link, `node ${id} link`),
      kind: str(n.kind, `node ${id} kind`),
      emphasis: oneOf(n.emphasis, NODE_EMPHASES, `node ${id} emphasis`),
      subtitle: str(n.subtitle, `node ${id} subtitle`),
      shadow: shadowIn(n.shadow, `node ${id} shadow`),
      gradient: gradientIn(n.gradient, `node ${id} gradient`),
      fillStyle: n.fillStyle === undefined || n.fillStyle === null ? undefined : fillIn(n.fillStyle, `node ${id} fillStyle`),
      strokeStyle: oneOf(n.strokeStyle, STYLES, `node ${id} strokeStyle`),
      role: oneOf(n.role, NODE_ROLES, `node ${id} role`),
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
      step: stepOf(e.step, `edge ${id} step`),
      weight: oneOf(e.weight, EDGE_WEIGHTS, `edge ${id} weight`),
      head: oneOf(e.head, ARROWHEADS, `edge ${id} head`),
      tail: oneOf(e.tail, ARROWHEADS, `edge ${id} tail`),
    };
  });
  const grid = gridOf(r.grid, zones, claim);
  if (grid) {
    zones.push(...gridZones(grid));
    const zid = gridZoneIds(grid);
    for (const n of nodes) {
      if (!n.cell) continue;
      const { row, col } = parseCell(n.cell, grid);
      // A cell; across a column: that column's band; across a row: between the columns (grid or parent).
      const zone = row && col ? zid.cell(row, col) : col ? zid.column(col) : (zid.outer ?? grid.parent);
      if (n.zone && n.zone !== zone) throw new Error(`node "${n.id}": give either zone or cell, not both`);
      n.cell = `${row ?? "*"}/${col ?? "*"}`;
      n.zone = zone;
    }
  } else {
    const stray = nodes.find((n) => n.cell);
    if (stray) throw new Error(`node "${stray.id}" has a cell but the diagram has no grid`);
  }
  const showData = r.showData === undefined ? undefined : Array.isArray(r.showData) && r.showData.every((k) => typeof k === "string") ? (r.showData as string[]) : (() => { throw new Error("showData must be an array of data keys"); })();
  if (showData?.length) {
    for (const n of nodes) {
      if (n.subtitle || !n.data) continue;
      const parts = showData.map((k) => n.data![k]).filter((v) => v !== undefined && v !== null && v !== "").map(String);
      if (parts.length) n.subtitle = parts.join(" · ");
    }
  }
  const views = viewsOf(r.views, new Set(nodes.map((n) => n.id)));
  const zoneIds = new Set(zones.map((z) => z.id));
  for (const n of nodes) if (n.zone && !zoneIds.has(n.zone)) throw new Error(`node "${n.id}": no zone "${n.zone}"`);
  for (const z of zones) if (z.parent && !zoneIds.has(z.parent)) throw new Error(`zone "${z.id}": no parent zone "${z.parent}"`);

  return {
    nodes,
    edges,
    zones,
    ...(grid ? { grid } : {}),
    ...(views ? { views } : {}),
    direction: oneOf(r.direction, DIRECTIONS, "direction"),
    algorithm: oneOf(r.algorithm, ALGORITHMS, "algorithm"),
    spacing: num(r.spacing, "spacing"),
    routing: oneOf(r.routing, ROUTINGS, "routing"),
    iconSize: num(r.iconSize, "iconSize"),
    x: num(r.x, "x"),
    y: num(r.y, "y"),
    legend: typeof r.legend === "string" ? r.legend : r.legend === true ? true : undefined,
    legendIcons: oneOf(r.legendIcons, ["auto", "all", "none"] as const, "legendIcons"),
    title: str(r.title, "title"),
    subtitle: str(r.subtitle, "subtitle"),
    steps: stepsOf(r.steps),
    look: oneOf(r.look, LOOKS_LIST, "look"),
    shadow: shadowIn(r.shadow, "shadow"),
    kinds: kindsOf(r.kinds),
  };
}

function viewsOf(v: unknown, nodeIds: ReadonlySet<string>): DiagramView[] | undefined {
  if (v === undefined || v === null) return undefined;
  return arr(v, "views").map((x, i) => {
    const strs = (a: unknown, what: string) => (a === undefined ? undefined : Array.isArray(a) && a.every((s) => typeof s === "string") ? (a as string[]) : (() => { throw new Error(`views[${i}].${what} must be an array of strings`); })());
    const nodes = strs(x.nodes, "nodes");
    for (const n of nodes ?? []) if (!nodeIds.has(n)) throw new Error(`views[${i}]: no node "${n}"`);
    const weights = strs(x.weights, "weights");
    for (const w of weights ?? []) if (!(EDGE_WEIGHTS as readonly string[]).includes(w)) throw new Error(`views[${i}].weights: ${w} is not one of ${EDGE_WEIGHTS.join(", ")}`);
    return { name: str(x.name, `views[${i}].name`, true)!, kinds: strs(x.kinds, "kinds"), weights: weights as EdgeWeight[] | undefined, steps: x.steps === true ? true : undefined, nodes };
  });
}

function stepsOf(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((t) => typeof t === "string")) throw new Error("steps must be an array of strings (steps[0] describes step 1)");
  return v.map((t) => t.trim());
}

function stepOf(v: unknown, what: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 99) throw new Error(`${what} must be a whole number from 1 to 99`);
  return v;
}

/** Untrusted `grid` -> a validated grid; its ids (and the zone ids it adds) are claimed. */
function gridOf(v: unknown, zones: readonly DiagramZone[], claim: (id: string, what: string) => void): DiagramGrid | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("grid must be an object {id, rows, columns}");
  const g = v as Loose;
  const id = str(g.id ?? "grid", "grid id", true)!;
  const bands = (list: unknown, what: string): GridBand[] => {
    if (!Array.isArray(list) || !list.length) throw new Error(`grid ${what} must be a non-empty array of {id, label, kind}`);
    const seen = new Set<string>();
    return list.map((b, i) => {
      const o = (typeof b === "string" ? { id: b, label: b } : b) as Loose;
      const bid = str(o.id, `grid ${what}[${i}].id`, true)!;
      if (bid.includes("/") || bid === "*") throw new Error(`grid ${what} id "${bid}" may not contain "/" or be "*"`);
      if (seen.has(bid)) throw new Error(`grid ${what} id "${bid}" is used twice`);
      seen.add(bid);
      return { id: bid, label: str(o.label ?? o.name, `grid ${what} ${bid} label`), kind: oneOf(o.kind, ZONE_KINDS, `grid ${what} ${bid} kind`) };
    });
  };
  const grid: DiagramGrid = {
    id,
    label: str(g.label, "grid label"),
    parent: str(g.parent, "grid parent"),
    rows: bands(g.rows, "rows"),
    columns: bands(g.columns, "columns"),
  };
  if (grid.parent && !zones.some((z) => z.id === grid.parent)) throw new Error(`grid: no parent zone "${grid.parent}"`);
  if (g.cells && typeof g.cells === "object" && !Array.isArray(g.cells)) {
    grid.cells = {};
    for (const [k, label] of Object.entries(g.cells as Loose)) {
      const { row, col } = parseCell(k, grid);
      if (!col || !row) throw new Error(`grid cells: "${k}" must name one row and one column`);
      grid.cells[`${row}/${col}`] = str(label, `grid cell ${k}`) ?? "";
    }
  }
  for (const z of gridZones(grid)) claim(z.id, "zones");
  return grid;
}

/** The zones a grid adds: an outer zone when it has a label, a band per column, a box per cell. */
export function gridZones(g: DiagramGrid): DiagramZone[] {
  const zid = gridZoneIds(g);
  const out: DiagramZone[] = [];
  if (zid.outer) out.push({ id: zid.outer, label: g.label, parent: g.parent, grid: g.id });
  for (const c of g.columns) out.push({ id: zid.column(c.id), label: c.label, parent: zid.outer ?? g.parent, kind: c.kind ?? "az", grid: g.id });
  for (const c of g.columns) {
    for (const r of g.rows) {
      const label = g.cells?.[`${r.id}/${c.id}`] || r.label;
      out.push({ id: zid.cell(r.id, c.id), label, parent: zid.column(c.id), kind: r.kind ?? inferZoneKind(r.label) ?? "tier", grid: g.id });
    }
  }
  return out;
}

/** Untrusted `kinds` -> validated kind styles. */
function kindsOf(v: unknown): Record<string, KindStyle> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("kinds must be an object: { \"Traffic\": { color, style, weight, head } }");
  const out: Record<string, KindStyle> = {};
  for (const [k, raw] of Object.entries(v as Loose)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`kinds.${k} must be an object`);
    const s = raw as Loose;
    out[k] = {
      color: color(s.color, `kinds.${k}.color`),
      style: oneOf(s.style, STYLES, `kinds.${k}.style`),
      weight: oneOf(s.weight, EDGE_WEIGHTS, `kinds.${k}.weight`),
      head: oneOf(s.head, ARROWHEADS, `kinds.${k}.head`),
      tail: oneOf(s.tail, ARROWHEADS, `kinds.${k}.tail`),
    };
  }
  return out;
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

export interface ZoneLook {
  stroke: string;
  fill: string;
  style: LineStyle;
  /** The kind that decided the look (given or guessed from the label), if any. */
  kind?: ZoneKind;
}

/**
 * Border, fill and dash for each zone. A colour given on the zone wins (fill = its tint); else
 * the zone's kind, given or guessed from its label (VPC, AZ, public subnet, ...: shared/zoneKinds.ts);
 * else a neutral slate by depth. Zones no longer take palette colours in turn: a rainbow of zones
 * says nothing about them.
 */
export function zoneColors(zones: readonly DiagramZone[]): Map<string, ZoneLook> {
  const out = new Map<string, ZoneLook>();
  const depths = zoneDepths(zones);
  for (const z of zones) {
    const kind = z.kind ?? inferZoneKind(z.label);
    const base = kind ? ZONE_KIND_STYLES[kind] : neutralZoneStyle(depths.get(z.id) ?? 0);
    const given = z.color && z.color !== "transparent" ? z.color : undefined;
    out.set(z.id, {
      stroke: given ?? base.stroke,
      fill: z.fill ?? (given ? tint(given) : base.fill),
      style: z.style ?? base.style,
      ...(kind ? { kind } : {}),
    });
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
