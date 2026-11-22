// Text -> diagram specs: CSV (a host list or an edge list) and YAML (the DiagramSpec written as
// YAML, with shortcuts). The result is raw spec input for normalizeSpec (shared/diagram.ts), which
// validates it; the app lays it out and builds it like `build_diagram`. Pure (the YAML parser is a
// dependency, nothing else).
import { parse as parseYaml } from "yaml";
import { parseCsv } from "./csv";
import { PROPERTY_FIELDS } from "./properties";

export interface ImportResult {
  spec: Record<string, unknown>;
  warnings: string[];
}

const MAX_ROWS = 2000;
const MAX_CELL = 2000;

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Collects node ids, unique and findable by id or (case-insensitive) label. */
class Registry {
  nodes: Array<Record<string, unknown>> = [];
  private byKey = new Map<string, string>();
  private used = new Set<string>();
  uniqueId(base: string): string {
    const root = base || "node";
    let id = root;
    for (let n = 2; this.used.has(id); n++) id = `${root}-${n}`;
    this.used.add(id);
    return id;
  }
  add(label: string, extra: Record<string, unknown> = {}, id?: string): string {
    const nid = this.uniqueId(id ? slug(id) || "node" : slug(label));
    this.nodes.push({ id: nid, label, ...extra });
    this.byKey.set(nid.toLowerCase(), nid);
    // The id as the user wrote it ("web_1") is findable even though the node id is slugged ("web-1").
    if (id && !this.byKey.has(id.trim().toLowerCase())) this.byKey.set(id.trim().toLowerCase(), nid);
    if (!this.byKey.has(label.toLowerCase())) this.byKey.set(label.toLowerCase(), nid);
    return nid;
  }
  find(ref: string): string | undefined {
    return this.byKey.get(ref.trim().toLowerCase());
  }
}

class EdgeSet {
  edges: Array<Record<string, unknown>> = [];
  add(from: string, to: string, extra: Record<string, unknown> = {}): void {
    if (from === to) return;
    const same = this.edges.find((e) => e.from === from && e.to === to);
    if (same) return;
    // A and B listing each other is one two-way link.
    const reverse = this.edges.find((e) => e.from === to && e.to === from);
    if (reverse) {
      reverse.arrow = "both";
      return;
    }
    this.edges.push({ from, to, ...extra });
  }
}

// ---------- CSV ----------

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "device", "node", "label", "title", "host", "hostname"],
  icon: ["icon", "stencil", "model", "type"],
  kind: ["kind", "category"],
  zone: ["zone", "group", "network", "site", "location", "segment"],
  connects: ["connects_to", "connects to", "connectsto", "connections", "links", "link_to", "uplink", "uplinks", "peers", "neighbors", "neighbours", "to"],
  from: ["from", "source", "src"],
  to: ["to", "target", "dst", "destination"],
  edgeLabel: ["label", "description", "protocol"],
};

function columnIndex(header: string[], names: string[]): number {
  for (const n of names) {
    const i = header.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

const propertyKey = (h: string): string => {
  const f = PROPERTY_FIELDS.find((p) => (p.aliases as readonly string[]).includes(h));
  return f ? f.key : h;
};

/** "Prod / DMZ" or "Prod > DMZ" -> nested zones; returns the deepest zone id. */
function zoneChain(path: string, zones: Map<string, Record<string, unknown>>): string | undefined {
  const parts = path.split(/\s*[/>]\s*/).map((p) => p.trim()).filter(Boolean);
  let parent: string | undefined;
  let key = "";
  for (const part of parts) {
    key = `${key}/${part.toLowerCase()}`;
    let z = zones.get(key);
    if (!z) {
      // "Prod-DMZ" and "Prod / DMZ" slug alike: keep the ids unique.
      const base = `z-${slug(key) || zones.size + 1}`;
      const used = new Set([...zones.values()].map((x) => x.id));
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      z = { id, label: part, ...(parent ? { parent } : {}) };
      zones.set(key, z);
    }
    parent = z.id as string;
  }
  return parent;
}

/**
 * CSV to a diagram. Two layouts:
 * - host list: a `name` column (also device/host/...), optional `type`/`icon` (stencil search text),
 *   `kind`, `zone` ("Prod / DMZ" nests), `connects_to` (names separated by ; or |) and any other
 *   columns as properties (ip, hostname, vlan, role, owner, url, notes, ...);
 * - edge list: `from` and `to` columns (and an optional `label`), nodes are created from the names.
 */
export function csvToSpec(text: string): ImportResult {
  const warnings: string[] = [];
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("the CSV needs a header row and at least one data row");
  if (table.length - 1 > MAX_ROWS) throw new Error(`too many rows (${table.length - 1}); the limit is ${MAX_ROWS}`);
  const header = table[0].map((h) => h.trim().toLowerCase());
  const rows = table.slice(1).map((r) => r.map((c) => c.trim().slice(0, MAX_CELL)));
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "") : "");

  const reg = new Registry();
  const edges = new EdgeSet();
  const zones = new Map<string, Record<string, unknown>>();

  const fromCol = columnIndex(header, COLUMN_ALIASES.from);
  const toCol = columnIndex(header, COLUMN_ALIASES.to);
  // In a from/to list "label" describes the connection, not a node.
  const edgeColumns = fromCol >= 0 && toCol >= 0 && fromCol !== toCol;
  const nameCol = columnIndex(header, edgeColumns ? COLUMN_ALIASES.name.filter((n) => n !== "label") : COLUMN_ALIASES.name);

  if (nameCol < 0 && fromCol >= 0 && toCol >= 0 && fromCol !== toCol) {
    const labelCol = columnIndex(header, COLUMN_ALIASES.edgeLabel);
    const ensure = (name: string) => reg.find(name) ?? reg.add(name);
    for (const r of rows) {
      const a = cell(r, fromCol);
      const b = cell(r, toCol);
      if (!a || !b) continue;
      edges.add(ensure(a), ensure(b), cell(r, labelCol) ? { label: cell(r, labelCol) } : {});
    }
    if (!reg.nodes.length) throw new Error("no connections found: every row needs a from and a to");
    return { spec: { nodes: reg.nodes, edges: edges.edges }, warnings };
  }

  if (nameCol < 0) throw new Error('no name column: add a "name" column (or "from" and "to" columns for a list of connections)');

  const iconCols = ["icon", "stencil", "model", "type"].map((n) => header.indexOf(n)).filter((i) => i >= 0);
  const kindCol = columnIndex(header, COLUMN_ALIASES.kind);
  const zoneCol = columnIndex(header, COLUMN_ALIASES.zone);
  const connectsCol = columnIndex(header, COLUMN_ALIASES.connects);
  const special = new Set([nameCol, kindCol, zoneCol, connectsCol, ...iconCols].filter((i) => i >= 0));
  const pending: Array<{ from: string; refs: string[] }> = [];

  for (const r of rows) {
    const name = cell(r, nameCol);
    if (!name) continue;
    if (reg.find(name)) warnings.push(`"${name}" appears more than once: the first row is used for links`);
    const data: Record<string, string> = {};
    header.forEach((h, i) => {
      // The name column's own value is the label; when it is "hostname" it is also the hostname property.
      if (i === nameCol && h === "hostname") data.hostname = name;
      if (special.has(i) || !h || !r[i]) return;
      data[propertyKey(h)] = r[i];
    });
    const icon = iconCols.map((i) => r[i]).find((v) => v);
    const zone = cell(r, zoneCol) ? zoneChain(cell(r, zoneCol), zones) : undefined;
    const id = reg.add(name, {
      ...(icon ? { icon } : {}),
      ...(cell(r, kindCol) ? { kind: cell(r, kindCol) } : {}),
      ...(zone ? { zone } : {}),
      ...(Object.keys(data).length ? { data } : {}),
    });
    const refs = cell(r, connectsCol).split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    if (refs.length) pending.push({ from: id, refs });
  }
  if (!reg.nodes.length) throw new Error("no rows with a name");

  for (const { from, refs } of pending) {
    for (const ref of refs) {
      let to = reg.find(ref);
      if (!to) {
        to = reg.add(ref);
        warnings.push(`"${ref}" is linked to but not listed: added as a node`);
      }
      edges.add(from, to);
    }
  }
  return { spec: { nodes: reg.nodes, edges: edges.edges, ...(zones.size ? { zones: [...zones.values()] } : {}) }, warnings };
}

// ---------- YAML ----------

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

const EDGE_TEXT = /^\s*(.+?)\s*(<-->|<->|-->|<--|<-|->|--)\s*(.+?)\s*(?::\s*(.+?))?\s*$/;

/**
 * YAML to a diagram: the DiagramSpec (shared/diagram.ts) written as YAML, with shortcuts:
 * - `nodes` / `zones` can be a list or a map keyed by id; a node can be just a name;
 * - an edge can be a string: `web -> db`, `web -> db: SQL`, `a <-> b`, `a -- b` (names or ids).
 */
export function yamlToSpec(text: string): ImportResult {
  const warnings: string[] = [];
  let doc: unknown;
  try {
    doc = parseYaml(text, { maxAliasCount: 20 });
  } catch (e) {
    throw new Error(`invalid YAML: ${(e as Error).message.split("\n")[0]}`);
  }
  if (Array.isArray(doc)) doc = { nodes: doc };
  if (!isObj(doc)) throw new Error("the YAML must be a mapping with nodes (and optionally edges, zones, direction)");

  const reg = new Registry();
  const rawNodes = doc.nodes;
  const entries: Array<[string | undefined, unknown]> = Array.isArray(rawNodes)
    ? rawNodes.map((n) => [undefined, n])
    : isObj(rawNodes)
      ? Object.entries(rawNodes)
      : [];
  if (!entries.length) throw new Error("the YAML needs a `nodes` list (or map)");
  for (const [key, n] of entries) {
    if (typeof n === "string" || typeof n === "number") reg.add(String(n), {}, key);
    else if (isObj(n)) {
      const { id, label, name, text: t, ...rest } = n;
      const idText = id !== undefined ? String(id) : key;
      const lab = label ?? name ?? t;
      if (idText === undefined && lab === undefined) throw new Error("every node needs an id or a name");
      reg.add(lab !== undefined ? String(lab) : String(idText), rest, idText);
    } else throw new Error(`a node must be a name or a mapping, got ${JSON.stringify(n)}`);
  }

  const edges: Loose[] = [];
  const ensure = (ref: string): string => {
    const hit = reg.find(ref);
    if (hit) return hit;
    warnings.push(`"${ref}" is used in an edge but not listed under nodes: added as a node`);
    return reg.add(ref);
  };
  const rawEdges = Array.isArray(doc.edges) ? doc.edges : doc.edges === undefined ? [] : null;
  if (!rawEdges) throw new Error("`edges` must be a list");
  for (const item of rawEdges) {
    // Unquoted `- web -> db: SQL` is read by YAML as the mapping {"web -> db": "SQL"}: accept that as the string.
    const keys = isObj(item) ? Object.keys(item) : [];
    const e =
      isObj(item) && keys.length === 1 && item.from === undefined && EDGE_TEXT.test(keys[0]) && (item[keys[0]] === null || typeof item[keys[0]] === "string" || typeof item[keys[0]] === "number")
        ? `${keys[0]}${item[keys[0]] === null ? "" : `: ${item[keys[0]]}`}`
        : item;
    if (typeof e === "string") {
      const m = EDGE_TEXT.exec(e);
      if (!m) throw new Error(`can't read the edge "${e}": write it like "web -> db" or "web -> db: SQL"`);
      let [, a, arrow, b] = m;
      if (arrow === "<-" || arrow === "<--") [a, b] = [b, a];
      edges.push({ from: ensure(a), to: ensure(b), ...(m[4] ? { label: m[4] } : {}), ...(arrow === "<->" || arrow === "<-->" ? { arrow: "both" } : arrow === "--" ? { arrow: "none" } : {}) });
    } else if (isObj(e)) {
      if (e.from === undefined || e.to === undefined) throw new Error('an edge needs "from" and "to"');
      edges.push({ ...e, from: ensure(String(e.from)), to: ensure(String(e.to)) });
    } else throw new Error(`an edge must be a string or a mapping, got ${JSON.stringify(e)}`);
  }

  let zones: unknown = doc.zones;
  if (isObj(zones)) zones = Object.entries(zones).map(([id, z]) => (typeof z === "string" ? { id, label: z } : { id, ...(isObj(z) ? z : {}) }));
  const { nodes: _n, edges: _e, zones: _z, ...options } = doc;
  return { spec: { ...options, nodes: reg.nodes, edges, ...(Array.isArray(zones) && zones.length ? { zones } : {}) }, warnings };
}

/** Format guess from a file name. */
export function importFormatForPath(p: string): "csv" | "yaml" | "mermaid" | null {
  const ext = p.toLowerCase().split(".").pop() ?? "";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (ext === "yaml" || ext === "yml") return "yaml";
  if (ext === "mmd" || ext === "mermaid") return "mermaid";
  return null;
}
