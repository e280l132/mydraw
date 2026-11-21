// Inventory export: one row per node (icon nodes and labelled shapes) as CSV or a Markdown table.
import { zonePath, type GraphNode, type SceneGraph } from "./sceneGraph";

export const INVENTORY_COLUMNS = ["name", "kind", "type", "zone", "ip", "hostname", "notes"] as const;
export type InventoryRow = Record<(typeof INVENTORY_COLUMNS)[number], string>;

const ALIASES: Record<string, string[]> = {
  ip: ["ip", "ipaddress", "ip_address", "address", "addr"],
  hostname: ["hostname", "host", "fqdn", "dns"],
  notes: ["notes", "note", "description", "comment", "comments"],
};

function pick(n: GraphNode, field: string): string {
  const wanted = ALIASES[field];
  for (const [k, v] of Object.entries(n.data)) if (wanted.includes(k.toLowerCase())) return v;
  return "";
}

export function inventoryRows(graph: SceneGraph): InventoryRow[] {
  return graph.nodes.map((n) => ({
    name: n.label,
    kind: n.kind,
    type: n.type,
    zone: zonePath(graph, n.zone),
    ip: pick(n, "ip"),
    hostname: pick(n, "hostname"),
    notes: pick(n, "notes"),
  }));
}

/** RFC 4180 quoting; cells that a spreadsheet would run as a formula get a leading apostrophe. */
export function csvCell(v: string): string {
  let s = v;
  if (/^[=+@\t\r]/.test(s) || /^-(?![\d.]+$)/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly InventoryRow[]): string {
  const lines = [INVENTORY_COLUMNS.join(",")];
  for (const r of rows) lines.push(INVENTORY_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

function mdCell(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\r?\n/g, "<br>");
}

export function toMarkdownTable(rows: readonly InventoryRow[]): string {
  const head = INVENTORY_COLUMNS.map((c) => c[0].toUpperCase() + c.slice(1));
  const lines = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${INVENTORY_COLUMNS.map((c) => mdCell(r[c])).join(" | ")} |`);
  return lines.join("\n") + "\n";
}
