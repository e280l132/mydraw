// Scene graph -> Mermaid flowchart text. Reads back through parseMermaidFlowchart (shared/mermaid.ts):
// shapes use the brackets that parser maps to the same shape, zones become (nested) subgraphs,
// labels are quoted and escaped with Mermaid entity codes (#quot; #124; ...).
import type { GraphEdge, GraphNode, SceneGraph } from "./sceneGraph";

export interface MermaidOptions {
  /** Default: left-to-right when the nodes are laid out wider than tall, else top-down. */
  direction?: "LR" | "RL" | "TD" | "BT";
  /** Write `style` lines for custom fill/stroke colors (default true). */
  styles?: boolean;
  /** Node positions for the direction guess. */
  bounds?: { width: number; height: number };
}

const RESERVED = new Set(["end", "graph", "flowchart", "subgraph", "style", "class", "classdef", "click", "default", "direction", "linkstyle", "call", "href"]);
const DEFAULT_INK = new Set(["#1e1e1e", "#000000", "#000"]);

/** Escape text for a quoted Mermaid label. */
export function escapeLabel(text: string): string {
  return text
    .replace(/#(?=[a-z0-9]+;)/gi, "#35;") // a literal "#x;" must not read as an entity
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\|/g, "#124;")
    .replace(/%/g, "#37;")
    .replace(/\r?\n/g, "<br/>");
}

function slug(label: string): string {
  const s = label
    .normalize("NFKD")
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s.slice(0, 32);
}

function uniqueIds(items: { key: string; label: string }[], taken: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const { key, label } of items) {
    let base = slug(label) || "n";
    if (/^\d/.test(base) || RESERVED.has(base.toLowerCase())) base = `n_${base}`;
    let id = base;
    for (let i = 2; taken.has(id.toLowerCase()); i++) id = `${base}_${i}`;
    taken.add(id.toLowerCase());
    out.set(key, id);
  }
  return out;
}

function nodeText(n: GraphNode, id: string): string {
  const t = `"${escapeLabel(n.label)}"`;
  switch (n.shape) {
    case "ellipse":
      return `${id}((${t}))`;
    case "diamond":
      return `${id}{${t}}`;
    default:
      return `${id}[${t}]`;
  }
}

function arrowText(e: GraphEdge): string {
  const dash = e.dashed;
  const body = e.arrow === "both" ? (dash ? "<-.->" : "<-->") : e.arrow === "end" ? (dash ? "-.->" : "-->") : dash ? "-.-" : "---";
  return e.label ? `${body}|"${escapeLabel(e.label)}"|` : body;
}

export function toMermaid(graph: SceneGraph, opts: MermaidOptions = {}): string {
  const taken = new Set<string>();
  const zoneIds = uniqueIds(graph.zones.map((z) => ({ key: z.id, label: z.label })), taken);
  const nodeIds = uniqueIds(graph.nodes.map((n) => ({ key: n.id, label: n.label })), taken);

  let direction = opts.direction;
  if (!direction) direction = opts.bounds && opts.bounds.width > opts.bounds.height * 1.2 ? "LR" : "TD";

  const lines: string[] = [`flowchart ${direction}`];
  const pad = (depth: number) => "  ".repeat(depth + 1);
  const walk = (zoneId: string | null, depth: number) => {
    for (const z of graph.zones.filter((x) => x.parent === zoneId)) {
      lines.push(`${pad(depth)}subgraph ${zoneIds.get(z.id)}["${escapeLabel(z.label)}"]`);
      walk(z.id, depth + 1);
      lines.push(`${pad(depth)}end`);
    }
    for (const n of graph.nodes.filter((x) => x.zone === zoneId)) lines.push(pad(depth) + nodeText(n, nodeIds.get(n.id)!));
  };
  walk(null, 0);

  for (const e of graph.edges) {
    lines.push(`${pad(0)}${nodeIds.get(e.from)} ${arrowText(e)} ${nodeIds.get(e.to)}`);
  }

  if (opts.styles !== false) {
    const css = (fill?: string, stroke?: string) => {
      const parts: string[] = [];
      if (fill) parts.push(`fill:${fill}`);
      if (stroke && !DEFAULT_INK.has(stroke.toLowerCase())) parts.push(`stroke:${stroke}`);
      return parts.join(",");
    };
    const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
    for (const n of graph.nodes) {
      const s = css(n.fill && hex.test(n.fill) ? n.fill : undefined, n.stroke && hex.test(n.stroke) ? n.stroke : undefined);
      if (s) lines.push(`${pad(0)}style ${nodeIds.get(n.id)} ${s}`);
    }
    for (const z of graph.zones) {
      const s = css(z.fill && hex.test(z.fill) ? z.fill : undefined, z.stroke && hex.test(z.stroke) ? z.stroke : undefined);
      if (s) lines.push(`${pad(0)}style ${zoneIds.get(z.id)} ${s}`);
    }
  }
  return lines.join("\n") + "\n";
}
