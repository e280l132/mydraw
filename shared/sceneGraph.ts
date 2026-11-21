// Scene elements -> a plain graph (nodes, edges, zones) for the text exporters (Mermaid, CSV,
// Markdown). Works on loose element JSON so it is testable without Excalidraw. Conventions match
// web/src/agent/sceneOps.ts: icon node = container with customData.mydrawNode "icon"; zone =
// customData.mydrawZone + title text; membership = customData.mydrawZoneId; legend = mydrawLegend.

export interface SceneEl {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isDeleted?: boolean;
  text?: string;
  containerId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  strokeColor?: string;
  backgroundColor?: string;
  strokeStyle?: string;
  link?: string | null;
  customData?: Record<string, unknown> | null;
}

export type GraphShape = "rectangle" | "ellipse" | "diamond";

export interface GraphNode {
  id: string;
  label: string;
  shape: GraphShape;
  /** "icon" for icon nodes, otherwise the shape type. */
  type: string;
  /** Category: customData.mydrawKind, else the stencil name for icons, else "". */
  kind: string;
  zone: string | null;
  fill?: string;
  stroke?: string;
  link?: string;
  /** User properties (customData keys that don't start with "mydraw"), values as text. */
  data: Record<string, string>;
}

export interface GraphZone {
  id: string;
  label: string;
  parent: string | null;
  fill?: string;
  stroke?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  arrow: "end" | "both" | "none";
}

export interface SceneGraph {
  nodes: GraphNode[];
  zones: GraphZone[];
  edges: GraphEdge[];
}

const isShape = (t: string): t is GraphShape => t === "rectangle" || t === "ellipse" || t === "diamond";

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function userData(el: SceneEl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(el.customData ?? {})) {
    if (!k.startsWith("mydraw") && v != null && v !== "") out[k] = asText(v);
  }
  return out;
}

const visible = (c: string | undefined) => (c && c !== "transparent" ? c : undefined);

/** Reading order: top to bottom (in 40px bands), then left to right. */
function byPosition<T extends SceneEl>(a: T, b: T): number {
  const ay = Math.round((a.y ?? 0) / 40);
  const by = Math.round((b.y ?? 0) / 40);
  return ay - by || (a.x ?? 0) - (b.x ?? 0);
}

export function extractGraph(elements: readonly SceneEl[]): SceneGraph {
  const live = elements.filter((e) => !e.isDeleted && !e.customData?.mydrawLegend);
  const map = new Map(live.map((e) => [e.id, e]));
  const labelOf = (el: SceneEl): string => {
    const ref = el.boundElements?.find((b) => b.type === "text");
    const t = ref ? map.get(ref.id) : undefined;
    return (t?.text ?? "").trim();
  };

  const zones: GraphZone[] = [];
  const zoneIds = new Set<string>();
  for (const el of live.filter((e) => e.customData?.mydrawZone).sort(byPosition)) {
    zoneIds.add(el.id);
  }
  for (const el of live.filter((e) => zoneIds.has(e.id)).sort(byPosition)) {
    const title = live.find((t) => t.type === "text" && t.customData?.mydrawZoneTitle === el.id);
    const parent = el.customData?.mydrawZoneId as string | undefined;
    zones.push({
      id: el.id,
      label: (title?.text ?? "").trim() || el.id,
      parent: parent && zoneIds.has(parent) ? parent : null,
      fill: visible(el.backgroundColor),
      stroke: el.strokeColor,
    });
  }

  const nodes: GraphNode[] = [];
  for (const el of live.filter((e) => !zoneIds.has(e.id)).sort(byPosition)) {
    const icon = el.customData?.mydrawNode === "icon";
    if (!icon && !isShape(el.type)) continue;
    const label = labelOf(el);
    const data = userData(el);
    if (!icon && !label && !Object.keys(data).length) continue; // decoration, not a node
    const stencil = (el.customData?.mydrawStencil as { name?: string } | undefined)?.name;
    const zone = el.customData?.mydrawZoneId as string | undefined;
    nodes.push({
      id: el.id,
      label: label || stencil || el.id,
      shape: isShape(el.type) ? el.type : "rectangle",
      type: icon ? "icon" : el.type,
      kind: asText(el.customData?.mydrawKind) || (icon ? (stencil ?? "") : ""),
      zone: zone && zoneIds.has(zone) ? zone : null,
      fill: icon ? undefined : visible(el.backgroundColor),
      stroke: icon ? undefined : el.strokeColor,
      link: el.link || undefined,
      data,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];
  for (const el of live.filter((e) => e.type === "arrow" || e.type === "line").sort(byPosition)) {
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    const s = !!el.startArrowhead;
    const e = !!el.endArrowhead;
    edges.push({
      from,
      to,
      label: labelOf(el) || undefined,
      dashed: el.strokeStyle === "dashed" || el.strokeStyle === "dotted",
      arrow: el.type === "line" ? "none" : s && e ? "both" : s || e ? "end" : "none",
    });
    // An arrow with only a start head points the other way.
    if (el.type === "arrow" && s && !e) {
      const last = edges[edges.length - 1];
      [last.from, last.to] = [last.to, last.from];
    }
  }
  return { nodes, zones, edges };
}

/** "Parent / Child" path of a zone. */
export function zonePath(graph: SceneGraph, zoneId: string | null): string {
  const byId = new Map(graph.zones.map((z) => [z.id, z]));
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let z = zoneId ? byId.get(zoneId) : undefined; z && !seen.has(z.id); z = z.parent ? byId.get(z.parent) : undefined) {
    seen.add(z.id);
    parts.unshift(z.label);
  }
  return parts.join(" / ");
}
