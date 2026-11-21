// draw.io (.drawio / mxGraph XML) -> a neutral list of shapes, zones and edges per page, which the
// renderer turns into Excalidraw elements (web/src/drawioImport.ts). Pure; best effort:
// - vertices: rectangle (also every unknown stencil shape, reported), ellipse, rhombus -> diamond,
//   text, image (embedded data URIs only), containers/swimlanes -> zones, mydraw frames -> frames
// - group cells only offset their children; edge-label cells join their edge's label
// - edges: bound when source/target were imported, else free arrows from their points
// - html labels are reduced to text; <object> attributes become properties (customData)
// - compressed diagrams (base64 + deflate-raw + URI encoding) are inflated
import { childElements, decodeEntities, parseXml, textContent, type XmlElement } from "./xml";

export interface Pt {
  x: number;
  y: number;
}

export type ImportShapeKind = "rectangle" | "ellipse" | "diamond" | "text" | "image" | "zone" | "frame";

export interface ImportShape {
  id: string;
  kind: ImportShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  fill?: string;
  stroke?: string;
  fontColor?: string;
  fontSize?: number;
  strokeWidth?: number;
  dashed?: boolean;
  rounded?: boolean;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  /** data: URL of an image. */
  image?: string;
  /** Innermost zone this shape sits in. */
  zone?: string;
  /** Frame (mydraw frame container) this shape sits in. */
  frame?: string;
  rotation?: number;
  opacity?: number;
  sketch?: boolean;
  link?: string;
  data: Record<string, string>;
}

export type ImportArrowhead = "arrow" | "triangle" | "triangle_outline" | "dot" | "circle_outline" | "diamond" | "diamond_outline" | "bar" | "crowfoot_one" | "crowfoot_many" | "crowfoot_one_or_many" | null;

export interface ImportEdge {
  id: string;
  from?: string;
  to?: string;
  /** Absolute points: start, waypoints, end (ends only when known from the file). */
  points: Pt[];
  label: string;
  stroke?: string;
  strokeWidth?: number;
  fontSize?: number;
  dashed?: boolean;
  startArrow: ImportArrowhead;
  endArrow: ImportArrowhead;
  routing: "straight" | "elbow" | "curved";
  line: boolean;
  data: Record<string, string>;
}

export interface ImportPage {
  name: string;
  shapes: ImportShape[];
  edges: ImportEdge[];
}

export interface DrawioImport {
  pages: ImportPage[];
  warnings: string[];
}

export type Style = Record<string, string>;

/** "rounded=0;whiteSpace=wrap;ellipse;" -> {rounded:"0", whiteSpace:"wrap", ellipse:""}. Flags get "". */
export function parseStyle(s: string | undefined): Style {
  const out: Style = {};
  for (const part of (s ?? "").split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) out[part.trim()] = "";
    else out[part.slice(0, eq).trim()] = part.slice(eq + 1);
  }
  return out;
}

/** HTML label -> plain text (line breaks from <br>, <div>, <p>, <li>). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/\r?\n/g, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(div|p|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function color(v: string | undefined): string | undefined {
  if (v === undefined || v === "" || v === "default" || v === "inherit") return undefined;
  if (v === "none") return "transparent";
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return undefined;
  return m[1].length === 3 ? `#${[...m[1]].map((c) => c + c).join("")}`.toLowerCase() : `#${m[1]}`.toLowerCase();
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function arrowhead(name: string | undefined, fill: string | undefined, isEnd: boolean): ImportArrowhead {
  const n = name ?? (isEnd ? "classic" : "none");
  const open = fill === "0";
  switch (n) {
    case "none":
    case "":
      return null;
    case "block":
    case "blockThin":
      return open ? "triangle_outline" : "triangle";
    case "oval":
    case "circle":
      return open ? "circle_outline" : "dot";
    case "diamond":
    case "diamondThin":
      return open ? "diamond_outline" : "diamond";
    case "dash":
      return "bar";
    case "ERone":
    case "ERmandOne":
      return "crowfoot_one";
    case "ERmany":
    case "ERzeroToMany":
      return "crowfoot_many";
    case "ERoneToMany":
      return "crowfoot_one_or_many";
    default:
      return "arrow"; // classic, classicThin, open, openThin, async, ...
  }
}

/** draw.io image style value -> a data: URL the browser understands, or null if not embedded. */
export function imageDataUrl(v: string | undefined): string | null {
  if (!v || !v.startsWith("data:")) return null;
  const comma = v.indexOf(",");
  if (comma < 0) return null;
  const meta = v.slice(5, comma);
  const body = v.slice(comma + 1);
  if (/;base64/i.test(meta)) return v;
  if (/^[A-Za-z0-9+/=\s]+$/.test(body)) return `data:${meta.split(";")[0]};base64,${body.replace(/\s/g, "")}`;
  return v; // URL-encoded
}

interface RawCell {
  id: string;
  parent?: string;
  value: string;
  style: Style;
  vertex: boolean;
  edge: boolean;
  source?: string;
  target?: string;
  visible: boolean;
  geo?: XmlElement;
  data: Record<string, string>;
  link?: string;
}

const OBJECT_SKIP = new Set(["id", "label", "placeholders", "tooltip", "link"]);

function readCells(model: XmlElement): RawCell[] {
  const root = childElements(model, "root")[0];
  if (!root) throw new Error("draw.io page has no <root>");
  const cells: RawCell[] = [];
  for (const node of childElements(root)) {
    let cell: XmlElement | undefined;
    let id: string | undefined;
    let value: string | undefined;
    const data: Record<string, string> = {};
    let link: string | undefined;
    if (node.name === "mxCell") {
      cell = node;
      id = node.attrs.id;
      value = node.attrs.value;
    } else if (node.name === "object" || node.name === "UserObject") {
      cell = childElements(node, "mxCell")[0];
      id = node.attrs.id;
      value = node.attrs.label ?? "";
      for (const [k, v] of Object.entries(node.attrs)) if (!OBJECT_SKIP.has(k) && v !== "") data[k] = v;
      if (node.attrs.link) link = node.attrs.link;
      if (node.attrs.placeholders === "1" && value) value = value.replace(/%([A-Za-z_][\w.-]*)%/g, (m, k: string) => node.attrs[k] ?? m);
    }
    if (!cell || id === undefined) continue;
    cells.push({
      id,
      parent: cell.attrs.parent,
      value: value ?? "",
      style: parseStyle(cell.attrs.style),
      vertex: cell.attrs.vertex === "1",
      edge: cell.attrs.edge === "1",
      source: cell.attrs.source,
      target: cell.attrs.target,
      visible: cell.attrs.visible !== "0",
      geo: childElements(cell, "mxGeometry")[0],
      data,
      link,
    });
  }
  return cells;
}

function labelText(c: RawCell): string {
  return c.style.html === "1" ? htmlToText(c.value) : c.value.replace(/\r/g, "").trim();
}

function point(el: XmlElement | undefined): Pt | null {
  if (!el) return null;
  return { x: num(el.attrs.x) ?? 0, y: num(el.attrs.y) ?? 0 };
}

/** Parse one mxGraphModel into shapes and edges with absolute coordinates. */
export function readModel(model: XmlElement, name: string, warnings: Set<string>): ImportPage {
  const cells = readCells(model);
  const byId = new Map(cells.map((c) => [c.id, c]));
  const childCount = new Map<string, number>();
  for (const c of cells) if (c.parent) childCount.set(c.parent, (childCount.get(c.parent) ?? 0) + 1);

  const absCache = new Map<string, Pt>();
  const origin = (id: string | undefined, seen = new Set<string>()): Pt => {
    const c = id ? byId.get(id) : undefined;
    if (!c || !c.vertex || seen.has(c.id)) return { x: 0, y: 0 };
    const hit = absCache.get(c.id);
    if (hit) return hit;
    seen.add(c.id);
    const p = origin(c.parent, seen);
    const g = c.geo;
    const out = g?.attrs.relative === "1" ? p : { x: p.x + (num(g?.attrs.x) ?? 0), y: p.y + (num(g?.attrs.y) ?? 0) };
    absCache.set(c.id, out);
    return out;
  };

  const kindOf = (c: RawCell): ImportShapeKind | "group" | "edgeLabel" | null => {
    const s = c.style;
    const parent = c.parent ? byId.get(c.parent) : undefined;
    if (parent?.edge) return "edgeLabel";
    if ("group" in s) return "group";
    if (s.mydrawFrame === "1") return "frame";
    const shape = s.shape;
    if (shape === "image" || "image" in s) return "image";
    if ("swimlane" in s || shape === "swimlane" || s.mydrawZone === "1" || s.container === "1" || (childCount.get(c.id) ?? 0) > 0) {
      // A vertex with children is a container. Containers without a label and without a visible
      // box are plain groups.
      const invisible = (s.fillColor === "none" || s.fillColor === undefined) && s.strokeColor === "none";
      return invisible && !c.value ? "group" : "zone";
    }
    if ("text" in s || shape === "text") return "text";
    if ("ellipse" in s || shape === "ellipse" || "doubleEllipse" in s) return "ellipse";
    if ("rhombus" in s || shape === "rhombus") return "diamond";
    return "rectangle";
  };

  const unknownShapes = new Map<string, number>();
  const kinds = new Map<string, ReturnType<typeof kindOf>>();
  for (const c of cells) if (c.vertex && c.visible) kinds.set(c.id, kindOf(c));

  const enclosing = (c: RawCell, want: ImportShapeKind): string | undefined => {
    const seen = new Set<string>();
    for (let p = c.parent; p && !seen.has(p); p = byId.get(p)?.parent) {
      seen.add(p);
      if (kinds.get(p) === want) return p;
    }
    return undefined;
  };

  const shapes: ImportShape[] = [];
  const edgeLabels = new Map<string, string[]>();
  for (const c of cells) {
    if (!c.vertex || !c.visible) continue;
    const kind = kinds.get(c.id)!;
    if (kind === "group") continue;
    if (kind === "edgeLabel") {
      const t = labelText(c);
      if (t) edgeLabels.set(c.parent!, [...(edgeLabels.get(c.parent!) ?? []), t]);
      continue;
    }
    if (!c.geo) {
      warnings.add("skipped vertices without geometry");
      continue;
    }
    const s = c.style;
    const o = origin(c.parent);
    const x = o.x + (num(c.geo.attrs.x) ?? 0);
    const y = o.y + (num(c.geo.attrs.y) ?? 0);
    const width = num(c.geo.attrs.width) ?? 80;
    const height = num(c.geo.attrs.height) ?? 40;
    let k: ImportShapeKind = kind!;
    let image: string | undefined;
    if (k === "image") {
      const url = imageDataUrl(s.image);
      if (url) image = url;
      else {
        k = "rectangle";
        warnings.add("images that link to a URL (not embedded) were drawn as boxes");
      }
    }
    if (k === "rectangle" && kind === "rectangle" && s.shape && !["rect", "rectangle", "label", "process"].includes(s.shape)) {
      unknownShapes.set(s.shape, (unknownShapes.get(s.shape) ?? 0) + 1);
    }
    const sketch = s.sketch === "1";
    shapes.push({
      id: c.id,
      kind: k,
      x,
      y,
      width,
      height,
      label: labelText(c),
      fill: color(s.fillColor) ?? (k === "text" || k === "image" ? undefined : k === "zone" || k === "frame" ? undefined : "#ffffff"),
      stroke: color(s.strokeColor) ?? (k === "text" || k === "image" ? undefined : "#000000"),
      fontColor: color(s.fontColor),
      fontSize: num(s.fontSize),
      strokeWidth: num(s.strokeWidth),
      dashed: s.dashed === "1",
      rounded: s.rounded === "1",
      align: s.align === "left" || s.align === "right" || s.align === "center" ? s.align : undefined,
      verticalAlign: s.verticalAlign === "top" || s.verticalAlign === "bottom" || s.verticalAlign === "middle" ? s.verticalAlign : undefined,
      image,
      zone: enclosing(c, "zone"),
      frame: enclosing(c, "frame"),
      rotation: num(s.rotation),
      opacity: num(s.opacity),
      sketch,
      link: c.link,
      data: c.data,
    });
  }
  if (unknownShapes.size) {
    const list = [...unknownShapes].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => `${n} (${k})`);
    warnings.add(`drew ${[...unknownShapes.values()].reduce((a, b) => a + b, 0)} stencil shapes as rectangles: ${list.join(", ")}${unknownShapes.size > 8 ? ", ..." : ""}`);
  }

  const imported = new Set(shapes.filter((s) => s.kind !== "zone" && s.kind !== "frame").map((s) => s.id));
  const edges: ImportEdge[] = [];
  let unplaced = 0;
  for (const c of cells) {
    if (!c.edge || !c.visible) continue;
    const s = c.style;
    const o = origin(c.parent);
    const abs = (p: Pt | null) => (p ? { x: p.x + o.x, y: p.y + o.y } : null);
    const g = c.geo;
    const sp = abs(point(g ? childElements(g, "mxPoint").find((p) => p.attrs.as === "sourcePoint") : undefined));
    const tp = abs(point(g ? childElements(g, "mxPoint").find((p) => p.attrs.as === "targetPoint") : undefined));
    const arr = g ? childElements(g, "Array").find((a) => a.attrs.as === "points") : undefined;
    const way = arr ? childElements(arr, "mxPoint").map((p) => abs(point(p))!) : [];
    // Edges to containers (zones) can't bind in mydraw (zones are locked boxes): draw them free.
    const end = (id: string | undefined) => (id && imported.has(id) ? id : undefined);
    const from = end(c.source);
    const to = end(c.target);
    const centerOf = (id: string | undefined): Pt | null => {
      const sh = id ? shapes.find((x) => x.id === id) : undefined;
      return sh ? { x: sh.x + sh.width / 2, y: sh.y + sh.height / 2 } : null;
    };
    const p0 = sp ?? centerOf(c.source);
    const p1 = tp ?? centerOf(c.target);
    if (!(from && to) && (!p0 || !p1)) {
      unplaced++;
      continue;
    }
    const routing: ImportEdge["routing"] =
      s.curved === "1" ? "curved" : s.edgeStyle && s.edgeStyle !== "none" && s.edgeStyle !== "" ? "elbow" : "straight";
    const label = [labelText(c), ...(edgeLabels.get(c.id) ?? [])].filter(Boolean).join("\n");
    const line = s.endArrow === "none" && (s.startArrow === undefined || s.startArrow === "none") && "line" in s;
    edges.push({
      id: c.id,
      from: from && to ? from : undefined,
      to: from && to ? to : undefined,
      points: [p0, ...way, p1].filter((p): p is Pt => !!p),
      label,
      stroke: color(s.strokeColor),
      strokeWidth: num(s.strokeWidth),
      fontSize: num(s.fontSize),
      dashed: s.dashed === "1",
      startArrow: arrowhead(s.startArrow, s.startFill, false),
      endArrow: arrowhead(s.endArrow, s.endFill, true),
      routing,
      line,
      data: c.data,
    });
  }
  if (unplaced) warnings.add(`skipped ${unplaced} edge${unplaced === 1 ? "" : "s"} with no position`);
  return { name, shapes, edges };
}

async function inflateDiagram(text: string): Promise<string> {
  const bin = atob(text.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = await new Response(stream).text();
  return decodeURIComponent(inflated);
}

/** Read a .drawio / mxGraph XML file. */
export async function readDrawio(xml: string): Promise<DrawioImport> {
  const doc = parseXml(xml);
  const warnings = new Set<string>();
  const pages: ImportPage[] = [];
  if (doc.name === "mxGraphModel") {
    pages.push(readModel(doc, "Page-1", warnings));
  } else if (doc.name === "mxfile") {
    const diagrams = childElements(doc, "diagram");
    for (const [i, d] of diagrams.entries()) {
      const name = d.attrs.name || `Page-${i + 1}`;
      let model = childElements(d, "mxGraphModel")[0];
      if (!model) {
        const text = textContent(d).trim();
        if (!text) continue;
        try {
          model = parseXml(await inflateDiagram(text));
        } catch (e) {
          warnings.add(`page "${name}" could not be decompressed: ${(e as Error).message}`);
          continue;
        }
      }
      pages.push(readModel(model, name, warnings));
    }
  } else {
    throw new Error(`not a draw.io file (root element <${doc.name}>)`);
  }
  if (!pages.length) throw new Error("the draw.io file has no pages");
  return { pages, warnings: [...warnings] };
}
