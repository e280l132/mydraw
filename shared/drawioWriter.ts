// Excalidraw scene -> draw.io (.drawio, mxGraph XML). Pure, works on loose element JSON.
// Mapping (approximate; Excalidraw styles don't map 1:1):
// - rectangle/ellipse/diamond -> vertex (rounded / ellipse / rhombus); bound text -> the cell's label
// - text -> text vertex; image -> shape=image with the file embedded as a data URI
// - icon node (container + image + caption) -> one image vertex labelled below the icon
// - zone (customData.mydrawZone + title) -> container vertex; members become its children
// - frame -> container vertex labelled above; children inside it
// - arrow/line -> edge (source/target when bound, waypoints, arrowheads, dashed, elbow/curved)
// - user customData (keys not starting with "mydraw") and links -> <object> attributes
// - freedraw, embeds and iframes are skipped (reported in `warnings`)
import { userData, type SceneEl } from "./sceneGraph";
import { escapeXml } from "./xml";

export interface DrawioEl extends SceneEl {
  angle?: number;
  opacity?: number;
  roughness?: number;
  fillStyle?: string;
  strokeWidth?: number;
  roundness?: { type: number; value?: number } | null;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  points?: readonly (readonly [number, number])[];
  fileId?: string | null;
  frameId?: string | null;
  name?: string | null;
  groupIds?: readonly string[];
  elbowed?: boolean;
}

export interface DrawioFile {
  dataURL: string;
  mimeType?: string;
}

export interface DrawioPage {
  name: string;
  elements: readonly DrawioEl[];
}

export interface DrawioOptions {
  /** Canvas background color (written as the page background, also used behind edge labels). */
  background?: string;
  /** Names of fonts outside Excalidraw's own set (mydraw's extra fonts), by font id. */
  fontNames?: Record<number, string>;
}

export interface DrawioResult {
  xml: string;
  warnings: string[];
}

const FONTS: Record<number, string> = {
  1: "Virgil",
  2: "Helvetica",
  3: "Courier New",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
};

const r2 = (n: number | undefined) => Math.round((n ?? 0) * 100) / 100;

/** draw.io color: #rrggbb, or "none" for transparent. */
export function drawioColor(c: string | undefined | null): string | undefined {
  if (!c) return undefined;
  if (c === "transparent") return "none";
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) {
    if (m[2] === "00") return "none";
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
    return `#${h.toLowerCase()}`;
  }
  return /^[a-z]+$/i.test(c) ? c : undefined;
}

export function styleString(s: Record<string, string | number | null | undefined>): string {
  return Object.entries(s)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => (v === null ? k : `${k}=${v}`))
    .join(";") + ";";
}

/** Escape text for an html=1 label: entities for markup characters, <br> for line breaks. */
export function htmlLabel(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
}

/**
 * draw.io style data URI for an image: `data:<mime>,<base64>` (draw.io drops ";base64" because ";"
 * separates style entries).
 */
export function drawioImageUri(dataURL: string): string | null {
  const comma = dataURL.indexOf(",");
  if (comma < 0 || !dataURL.startsWith("data:")) return null;
  const meta = dataURL.slice(5, comma);
  const mime = meta.split(";")[0] || "application/octet-stream";
  let body = dataURL.slice(comma + 1);
  if (!/;base64/i.test(meta)) {
    const bytes = new TextEncoder().encode(decodeURIComponent(body));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    body = btoa(bin);
  }
  return `data:${mime},${body.replace(/\s/g, "")}`;
}

function arrowhead(h: string | null | undefined): { arrow: string; fill?: number } {
  switch (h) {
    case null:
    case undefined:
      return { arrow: "none" };
    case "arrow":
      return { arrow: "open" };
    case "triangle":
      return { arrow: "block", fill: 1 };
    case "triangle_outline":
      return { arrow: "block", fill: 0 };
    case "dot":
    case "circle":
      return { arrow: "oval", fill: 1 };
    case "circle_outline":
      return { arrow: "oval", fill: 0 };
    case "diamond":
      return { arrow: "diamond", fill: 1 };
    case "diamond_outline":
      return { arrow: "diamond", fill: 0 };
    case "bar":
      return { arrow: "dash" };
    case "crowfoot_one":
      return { arrow: "ERone" };
    case "crowfoot_many":
      return { arrow: "ERmany" };
    case "crowfoot_one_or_many":
      return { arrow: "ERoneToMany" };
    default:
      return { arrow: "classic", fill: 1 };
  }
}

function strokeStyle(el: DrawioEl): Record<string, string | number | undefined> {
  if (el.strokeStyle === "dashed") return { dashed: 1 };
  if (el.strokeStyle === "dotted") return { dashed: 1, dashPattern: "1 4" };
  return {};
}

function sketch(el: DrawioEl): Record<string, string | number | undefined> {
  if (!el.roughness) return {};
  const fill = el.fillStyle && el.fillStyle !== "solid" ? el.fillStyle : "solid";
  return { sketch: 1, curveFitting: 1, jiggle: 2, fillStyle: fill };
}

function common(el: DrawioEl): Record<string, string | number | undefined> {
  return {
    rotation: el.angle ? r2((el.angle * 180) / Math.PI) : undefined,
    opacity: el.opacity !== undefined && el.opacity < 100 ? el.opacity : undefined,
  };
}

function font(t: DrawioEl | undefined, names: Record<number, string> = {}): Record<string, string | number | undefined> {
  if (!t) return {};
  return {
    fontSize: t.fontSize ? r2(t.fontSize) : undefined,
    fontFamily: t.fontFamily ? (FONTS[t.fontFamily] ?? names[t.fontFamily]) : undefined,
    fontColor: drawioColor(t.strokeColor),
  };
}

const NAME_OK = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const RESERVED = new Set(["id", "label", "placeholders", "parent", "style", "vertex", "edge", "source", "target"]);

interface Cell {
  id: string;
  parent: string;
  value: string;
  style: string;
  kind: "vertex" | "edge";
  geometry: string;
  /** Extra <object> attributes (user properties, link). */
  props: Record<string, string>;
  source?: string;
  target?: string;
}

// Cells keep their element ids, except that the two root cells own "0" and "1": internally the
// default layer is LAYER, and `cellId` moves element ids "0"/"1" (and, to stay one-to-one, ids that
// already start with the prefix) out of the way when writing.
const LAYER = "\u0000layer";
const ID_PREFIX = "mydraw-";
const cellId = (id: string): string => (id === LAYER ? "1" : id === "0" || id === "1" || id.startsWith(ID_PREFIX) ? `${ID_PREFIX}${id}` : id);
const withCellIds = (c: Cell): Cell => ({
  ...c,
  id: cellId(c.id),
  parent: cellId(c.parent),
  source: c.source === undefined ? undefined : cellId(c.source),
  target: c.target === undefined ? undefined : cellId(c.target),
});

function cellXml(c: Cell): string {
  const kindAttr = c.kind === "vertex" ? 'vertex="1"' : 'edge="1"';
  const ends = `${c.source ? ` source="${escapeXml(c.source)}"` : ""}${c.target ? ` target="${escapeXml(c.target)}"` : ""}`;
  const propNames = Object.keys(c.props);
  if (!propNames.length) {
    return `<mxCell id="${escapeXml(c.id)}" value="${escapeXml(c.value)}" style="${escapeXml(c.style)}" ${kindAttr} parent="${escapeXml(c.parent)}"${ends}>${c.geometry}</mxCell>`;
  }
  const attrs = propNames.map((k) => ` ${k}="${escapeXml(c.props[k])}"`).join("");
  return `<object label="${escapeXml(c.value)}"${attrs} id="${escapeXml(c.id)}"><mxCell style="${escapeXml(c.style)}" ${kindAttr} parent="${escapeXml(c.parent)}"${ends}>${c.geometry}</mxCell></object>`;
}

function props(el: DrawioEl): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(userData(el))) if (NAME_OK.test(k) && !RESERVED.has(k)) out[k] = v;
  if (el.link) out.link = el.link;
  return out;
}

function pageXml(page: DrawioPage, files: Record<string, DrawioFile>, opts: DrawioOptions, warnings: Set<string>, index: number): string {
  const fontOf = (t: DrawioEl | undefined) => font(t, opts.fontNames);
  const live = page.elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const consumed = new Set<string>();
  const skipped: Record<string, number> = {};
  const labelOf = (el: DrawioEl): DrawioEl | undefined => {
    const ref = el.boundElements?.find((b) => b.type === "text");
    const t = ref ? byId.get(ref.id) : undefined;
    return t && t.type === "text" ? t : undefined;
  };

  // Icon nodes: container + image (same innermost group) + caption.
  const iconImage = new Map<string, DrawioEl>();
  for (const el of live) {
    if (el.customData?.mydrawNode !== "icon") continue;
    const g = el.groupIds?.[0];
    const img = g ? live.find((m) => m.type === "image" && m.groupIds?.[0] === g) : undefined;
    if (img) {
      iconImage.set(el.id, img);
      consumed.add(img.id);
    }
  }
  // Which cell an element id maps to (an icon's image or caption -> the icon node).
  const cellIdOf = new Map<string, string>();
  for (const [node, img] of iconImage) cellIdOf.set(img.id, node);

  for (const el of live) {
    if (el.type === "text" && el.containerId && byId.has(el.containerId)) consumed.add(el.id);
    if (el.type === "text" && typeof el.customData?.mydrawZoneTitle === "string" && byId.has(el.customData.mydrawZoneTitle)) consumed.add(el.id);
  }

  const isZone = (el: DrawioEl) => !!el.customData?.mydrawZone;
  const isFrame = (el: DrawioEl) => el.type === "frame" || el.type === "magicframe";
  const containers = new Set(live.filter((e) => isZone(e) || isFrame(e)).map((e) => e.id));

  // Parent cell: zone membership first, then frame.
  const parentOf = (el: DrawioEl): string => {
    const z = el.customData?.mydrawZoneId;
    if (typeof z === "string" && containers.has(z) && z !== el.id) return z;
    if (el.frameId && containers.has(el.frameId) && el.frameId !== el.id && !isFrame(el)) return el.frameId;
    return LAYER;
  };
  // Guard against membership cycles: walk up, drop the link that closes a loop.
  const parent = new Map<string, string>();
  for (const id of containers) {
    let p = parentOf(byId.get(id)!);
    const seen = new Set([id]);
    for (let q = p; q !== LAYER; q = parentOf(byId.get(q)!)) {
      if (seen.has(q)) {
        p = LAYER;
        break;
      }
      seen.add(q);
    }
    parent.set(id, p);
  }
  const parentId = (el: DrawioEl) => (containers.has(el.id) ? parent.get(el.id)! : parentOf(el));
  const depth = (id: string): number => {
    let d = 0;
    for (let p = parent.get(id) ?? LAYER; p !== LAYER; p = parent.get(p) ?? LAYER) d++;
    return d;
  };
  const origin = (pid: string): { x: number; y: number } => {
    const p = byId.get(pid);
    return p ? { x: p.x ?? 0, y: p.y ?? 0 } : { x: 0, y: 0 };
  };
  const geom = (el: DrawioEl, pid: string, box?: DrawioEl) => {
    const b = box ?? el;
    const o = origin(pid);
    return `<mxGeometry x="${r2((b.x ?? 0) - o.x)}" y="${r2((b.y ?? 0) - o.y)}" width="${r2(b.width)}" height="${r2(b.height)}" as="geometry"/>`;
  };

  const cells: Cell[] = [];

  // Containers first (frames, then zones by depth) so parents precede their children.
  const containerEls = live
    .filter((e) => containers.has(e.id))
    .sort((a, b) => Number(isZone(a)) - Number(isZone(b)) || depth(a.id) - depth(b.id));
  for (const el of containerEls) {
    const pid = parentId(el);
    if (isFrame(el)) {
      cells.push({
        id: el.id,
        parent: pid,
        value: htmlLabel(el.name ?? ""),
        kind: "vertex",
        geometry: geom(el, pid),
        props: props(el),
        style: styleString({
          rounded: 0,
          whiteSpace: "wrap",
          html: 1,
          container: 1,
          collapsible: 0,
          fillColor: "none",
          strokeColor: "#bbbbbb",
          verticalLabelPosition: "top",
          verticalAlign: "bottom",
          align: "left",
          fontColor: "#666666",
          mydrawFrame: 1,
        }),
      });
      continue;
    }
    const title = live.find((t) => t.type === "text" && t.customData?.mydrawZoneTitle === el.id);
    cells.push({
      id: el.id,
      parent: pid,
      value: htmlLabel(title?.text ?? ""),
      kind: "vertex",
      geometry: geom(el, pid),
      props: props(el),
      style: styleString({
        rounded: el.roundness ? 1 : 0,
        arcSize: el.roundness ? 4 : undefined,
        whiteSpace: "wrap",
        html: 1,
        container: 1,
        collapsible: 0,
        recursiveResize: 0,
        fillColor: drawioColor(el.backgroundColor),
        strokeColor: drawioColor(el.strokeColor),
        strokeWidth: el.strokeWidth,
        ...strokeStyle(el),
        verticalAlign: "top",
        align: "left",
        spacingLeft: 10,
        spacingTop: 2,
        fontStyle: 1,
        ...fontOf(title),
        ...common(el),
        mydrawZone: 1,
      }),
    });
  }

  const edges: DrawioEl[] = [];
  for (const el of live) {
    if (consumed.has(el.id) || containers.has(el.id)) continue;
    if (el.type === "arrow" || el.type === "line") {
      edges.push(el);
      continue;
    }
    const pid = parentId(el);
    const base = { id: el.id, parent: pid, kind: "vertex" as const, props: props(el) };
    if (el.customData?.mydrawNode === "icon") {
      const img = iconImage.get(el.id);
      const caption = labelOf(el);
      const uri = img?.fileId ? files[img.fileId]?.dataURL : undefined;
      const imageUri = uri ? drawioImageUri(uri) : null;
      if (!img || !imageUri) {
        warnings.add("icon nodes without an image file were written as plain boxes");
      }
      cells.push({
        ...base,
        value: htmlLabel(caption?.text ?? ""),
        geometry: geom(el, pid, img ?? el),
        style: imageUri
          ? styleString({
              shape: "image",
              html: 1,
              verticalLabelPosition: "bottom",
              verticalAlign: "top",
              labelBackgroundColor: "none",
              imageAspect: 0,
              aspect: "fixed",
              image: imageUri,
              ...fontOf(caption),
              ...common(img!),
              mydrawIcon: 1,
            })
          : styleString({ rounded: 0, whiteSpace: "wrap", html: 1, ...fontOf(caption) }),
      });
      continue;
    }
    if (el.type === "image") {
      const uri = el.fileId ? files[el.fileId]?.dataURL : undefined;
      const imageUri = uri ? drawioImageUri(uri) : null;
      if (!imageUri) {
        skipped["images without file data"] = (skipped["images without file data"] ?? 0) + 1;
        continue;
      }
      cells.push({
        ...base,
        value: "",
        geometry: geom(el, pid),
        style: styleString({ shape: "image", html: 1, imageAspect: 0, aspect: "fixed", image: imageUri, ...common(el) }),
      });
      continue;
    }
    if (el.type === "text") {
      cells.push({
        ...base,
        value: htmlLabel(el.text ?? ""),
        geometry: geom(el, pid),
        style: styleString({
          text: null,
          html: 1,
          align: el.textAlign ?? "left",
          verticalAlign: "top",
          strokeColor: "none",
          fillColor: "none",
          spacing: 0,
          ...fontOf(el),
          ...common(el),
        }),
      });
      continue;
    }
    if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
      const label = labelOf(el);
      const shape = el.type === "ellipse" ? { ellipse: null } : el.type === "diamond" ? { rhombus: null } : {};
      cells.push({
        ...base,
        value: htmlLabel(label?.text ?? ""),
        geometry: geom(el, pid),
        style: styleString({
          ...shape,
          rounded: el.type === "rectangle" ? (el.roundness ? 1 : 0) : undefined,
          // Custom corner radius (fine-tune slider): draw.io's absolute arcSize is the corner diameter.
          ...(el.type === "rectangle" && el.roundness?.type === 3 && el.roundness.value !== undefined
            ? { absoluteArcSize: 1, arcSize: Math.round(2 * Math.min(el.roundness.value, Math.min(Math.abs(el.width ?? 0), Math.abs(el.height ?? 0)) / 4)) }
            : {}),
          whiteSpace: "wrap",
          html: 1,
          fillColor: drawioColor(el.backgroundColor),
          strokeColor: drawioColor(el.strokeColor),
          strokeWidth: el.strokeWidth,
          ...strokeStyle(el),
          ...sketch(el),
          align: label?.textAlign,
          verticalAlign: label?.verticalAlign,
          ...fontOf(label),
          ...common(el),
        }),
      });
      continue;
    }
    const kind = el.type === "freedraw" ? "freehand drawings" : `${el.type} elements`;
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  }

  const exported = new Set(cells.map((c) => c.id));
  const endCell = (b: { elementId: string } | null | undefined): string | undefined => {
    if (!b) return undefined;
    const id = cellIdOf.get(b.elementId) ?? b.elementId;
    return exported.has(id) ? id : undefined;
  };
  for (const el of edges) {
    const pts = (el.points ?? [[0, 0]]).map(([px, py]) => ({ x: r2((el.x ?? 0) + px), y: r2((el.y ?? 0) + py) }));
    const first = pts[0];
    const last = pts[pts.length - 1];
    const source = endCell(el.startBinding);
    const target = endCell(el.endBinding);
    const routing = el.elbowed || el.customData?.mydrawRouting === "elbow" ? "elbow" : el.customData?.mydrawRouting === "curved" || (el.roundness && !el.elbowed) ? "curved" : "straight";
    const isLine = el.type === "line";
    const start = arrowhead(isLine ? null : el.startArrowhead);
    const end = arrowhead(isLine ? null : el.endArrowhead);
    const label = labelOf(el);
    const waypoints = pts.slice(1, -1);
    cells.push({
      id: el.id,
      parent: LAYER,
      value: htmlLabel(label?.text ?? ""),
      kind: "edge",
      source,
      target,
      props: props(el),
      geometry:
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${first.x}" y="${first.y}" as="sourcePoint"/><mxPoint x="${last.x}" y="${last.y}" as="targetPoint"/>` +
        (waypoints.length ? `<Array as="points">${waypoints.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join("")}</Array>` : "") +
        `</mxGeometry>`,
      style: styleString({
        edgeStyle: routing === "elbow" ? "orthogonalEdgeStyle" : "none",
        curved: routing === "curved" ? 1 : undefined,
        rounded: 0,
        html: 1,
        strokeColor: drawioColor(el.strokeColor),
        strokeWidth: el.strokeWidth,
        ...strokeStyle(el),
        ...sketch(el),
        endArrow: end.arrow,
        endFill: end.fill,
        startArrow: start.arrow,
        startFill: start.fill,
        labelBackgroundColor: drawioColor(opts.background) ?? "#ffffff",
        ...fontOf(label),
        ...common(el),
      }),
    });
  }

  for (const [what, n] of Object.entries(skipped)) warnings.add(`skipped ${n} ${what}`);

  const bg = drawioColor(opts.background);
  const model =
    `<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"${bg && bg !== "none" ? ` background="${bg}"` : ""}>` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    cells.map((c) => cellXml(withCellIds(c))).join("") +
    `</root></mxGraphModel>`;
  return `<diagram id="page-${index + 1}" name="${escapeXml(page.name || `Page-${index + 1}`)}">${model}</diagram>`;
}

/** Write a .drawio file (uncompressed XML, one diagram page per entry in `pages`). */
export function toDrawio(pages: readonly DrawioPage[], files: Record<string, DrawioFile>, opts: DrawioOptions = {}): DrawioResult {
  if (!pages.length) throw new Error("nothing to export");
  const warnings = new Set<string>();
  const body = pages.map((p, i) => pageXml(p, files, opts, warnings, i)).join("");
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="mydraw" agent="mydraw" version="1" type="device">${body}</mxfile>\n`,
    warnings: [...warnings],
  };
}
