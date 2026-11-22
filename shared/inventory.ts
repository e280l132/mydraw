// Inventory export: one row per node (icon nodes and labelled shapes) as CSV or a Markdown table.
import { extraProperties, propertyOf, type PropertyKey } from "./properties";
import { zonePath, type GraphNode, type SceneGraph } from "./sceneGraph";

export const INVENTORY_COLUMNS = ["name", "kind", "type", "zone", "ip", "hostname", "vlan", "role", "owner", "url", "notes"] as const;
export type InventoryRow = Record<(typeof INVENTORY_COLUMNS)[number], string>;

/** A node's value for an inventory field, matching the aliases (see shared/properties.ts). */
export function inventoryField(n: GraphNode, field: PropertyKey): string {
  return propertyOf(n.data, field);
}

/** An inventory row plus the node's element id and any user properties that are not inventory columns. */
export type InventoryEntry = InventoryRow & { id: string; extra: Record<string, string> };

export function inventoryEntries(graph: SceneGraph): InventoryEntry[] {
  const rows = inventoryRows(graph);
  return graph.nodes.map((n, i) => ({
    ...rows[i],
    id: n.id,
    extra: Object.fromEntries(Object.entries(extraProperties(n.data))),
  }));
}

export function inventoryRows(graph: SceneGraph): InventoryRow[] {
  return graph.nodes.map((n) => ({
    name: n.label,
    kind: n.kind,
    type: n.type,
    zone: zonePath(graph, n.zone),
    ip: inventoryField(n, "ip"),
    hostname: inventoryField(n, "hostname"),
    vlan: inventoryField(n, "vlan"),
    role: inventoryField(n, "role"),
    owner: inventoryField(n, "owner"),
    url: inventoryField(n, "url"),
    notes: inventoryField(n, "notes"),
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
