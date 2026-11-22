// draw.io file -> Excalidraw elements + files, using the pure reader (shared/drawioReader.ts) and
// the same builders as the agent tools: zones are mydraw zones (makeZone), labelled images are icon
// nodes (makeIconNode), shapes/text/edges go through buildElements (bound arrows). Several pages
// become frames stacked top to bottom. Used by the CLI (`mydraw convert x.drawio`).
import { linkProblem } from "../../shared/links";
import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import { readDrawio, type ImportEdge, type ImportPage, type ImportShape } from "../../shared/drawioReader";
import { makeIconNode, makeZone } from "./agent/diagram";
import { boundsOf, buildElements, measureText, type El } from "./agent/sceneOps";
import { trueColorFile } from "./library/trueColor";

type Loose = Record<string, unknown>;

const INK = "#1e1e1e";
const PAGE_GAP = 200;
const FRAME_PAD = 40;

export interface DrawioScene {
  elements: El[];
  files: BinaryFileData[];
  warnings: string[];
  pages: number;
}

async function fileFromDataUrl(dataURL: string): Promise<BinaryFileData | null> {
  // data:<mime>[;param=value...][;base64],<data>; parameters such as charset or name are ignored.
  const m = /^data:([^;,]+)((?:;[^;,]*)*),(.*)$/s.exec(dataURL);
  if (!m) return null;
  const base64 = m[2].split(";").some((p) => p.trim().toLowerCase() === "base64");
  let bytes: Uint8Array;
  try {
    bytes = base64 ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  } catch {
    return null;
  }
  const digest = await crypto.subtle.digest("SHA-1", bytes as Uint8Array<ArrayBuffer>);
  const id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const mime = m[1].toLowerCase();
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml|bmp|x-icon|avif)$/.test(mime)) return null;
  // Normalise to a base64 data URL (Excalidraw expects one).
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const file: BinaryFileData = {
    id: id as FileId,
    mimeType: mime as BinaryFileData["mimeType"],
    dataURL: `data:${mime};base64,${btoa(bin)}` as DataURL,
    created: Date.now(),
  };
  return trueColorFile(file);
}

function zoneDepth(s: ImportShape, byId: Map<string, ImportShape>): number {
  let d = 0;
  const seen = new Set<string>();
  for (let z = s.zone; z && !seen.has(z); z = byId.get(z)?.zone) {
    seen.add(z);
    d++;
  }
  return d;
}

/** draw.io links can be anything (mailto:, page ids, ...). Keep the ones mydraw can follow, drop the rest with a warning. */
function keepLink(link: string | undefined | null, warnings: Set<string>): string | null {
  if (!link) return null;
  if (linkProblem(link)) {
    warnings.add("dropped links that are not web addresses or .excalidraw drawings");
    return null;
  }
  return link;
}

async function buildPage(page: ImportPage, st: AppState, ids: (id: string) => string, dy: number, warnings: Set<string>) {
  const font = st.currentItemFontFamily;
  const out: El[] = [];
  const files: BinaryFileData[] = [];
  const byId = new Map(page.shapes.map((s) => [s.id, s]));
  const data = (s: ImportShape | ImportEdge, zone?: string): Loose => {
    const d: Loose = { ...s.data };
    if (zone) d.mydrawZoneId = ids(zone);
    return d;
  };
  const zoneOf = (s: ImportShape) => (s.zone && byId.get(s.zone)?.kind === "zone" ? s.zone : undefined);

  // Frames (mydraw frames written by our own exporter) and zones, outermost first.
  const frames: El[] = [];
  for (const s of page.shapes.filter((x) => x.kind === "frame")) {
    const [f] = convertToExcalidrawElements([{ type: "frame", id: ids(s.id), x: s.x, y: s.y + dy, width: s.width, height: s.height, name: s.label || null, children: [] } as never], {
      regenerateIds: false,
    });
    frames.push(f as El);
  }
  const zones = page.shapes.filter((x) => x.kind === "zone").sort((a, b) => zoneDepth(a, byId) - zoneDepth(b, byId));
  for (const z of zones) {
    out.push(
      ...makeZone({
        id: ids(z.id),
        label: z.label || null,
        box: { x: z.x, y: z.y + dy, width: z.width, height: z.height },
        stroke: z.stroke && z.stroke !== "transparent" ? z.stroke : INK,
        fill: z.fill ?? "transparent",
        style: z.dashed ? "dashed" : "solid",
        strokeWidth: z.strokeWidth,
        roughness: z.sketch ? 1 : 0,
        fontFamily: font,
        parent: zoneOf(z) ? ids(zoneOf(z)!) : null,
        customData: { ...z.data },
      }),
    );
  }

  // Images: labelled -> icon node (arrows bind to it), else a plain image.
  const bindable = new Set<string>();
  for (const s of page.shapes.filter((x) => x.kind === "image")) {
    const file = s.image ? await fileFromDataUrl(s.image) : null;
    if (!file) {
      warnings.add("skipped images in unsupported formats");
      continue;
    }
    files.push(file);
    const [image] = convertToExcalidrawElements(
      [{ type: "image", id: s.label ? `${ids(s.id)}.img` : ids(s.id), x: s.x, y: s.y + dy, width: s.width, height: s.height, fileId: file.id } as never],
      { regenerateIds: false },
    );
    const zone = zoneOf(s);
    if (!s.label) {
      out.push({ ...image, customData: Object.keys(data(s, zone)).length ? data(s, zone) : undefined, link: keepLink(s.link, warnings) } as El);
      bindable.add(s.id);
      continue;
    }
    const node = makeIconNode({
      id: ids(s.id),
      image: image as El,
      caption: s.label,
      fontSize: s.fontSize,
      fontFamily: font,
      strokeColor: s.fontColor ?? INK,
      x: s.x,
      y: s.y + dy,
      customData: data(s, zone),
    });
    // makeIconNode centres the image in the node; move the node so the image keeps its place.
    const img = node.find((e) => e.type === "image")!;
    const ddx = s.x - img.x;
    const ddy = s.y + dy - img.y;
    for (const e of node) out.push({ ...e, x: e.x + ddx, y: e.y + ddy, ...(e === node[0] && keepLink(s.link, warnings) ? { link: keepLink(s.link, warnings) } : {}) } as El);
    bindable.add(s.id);
  }

  // Shapes and text.
  const skeletons: Loose[] = [];
  for (const s of page.shapes) {
    if (s.kind !== "rectangle" && s.kind !== "ellipse" && s.kind !== "diamond" && s.kind !== "text") continue;
    const zone = zoneOf(s);
    const common: Loose = {
      id: ids(s.id),
      opacity: s.opacity !== undefined ? Math.max(0, Math.min(100, s.opacity)) : undefined,
      angle: s.rotation ? (s.rotation * Math.PI) / 180 : undefined,
      customData: data(s, zone),
      link: keepLink(s.link, warnings),
    };
    if (s.kind === "text") {
      if (!s.label) continue;
      const fontSize = s.fontSize ?? 12;
      const m = measureText(s.label, fontSize, font);
      const align = s.align ?? "center";
      const valign = s.verticalAlign ?? "middle";
      skeletons.push({
        ...common,
        type: "text",
        text: s.label,
        fontSize,
        fontFamily: font,
        textAlign: align,
        strokeColor: s.fontColor ?? INK,
        x: align === "left" ? s.x : align === "right" ? s.x + s.width - m.width : s.x + (s.width - m.width) / 2,
        y: dy + (valign === "top" ? s.y : valign === "bottom" ? s.y + s.height - m.height : s.y + (s.height - m.height) / 2),
      });
      continue;
    }
    skeletons.push({
      ...common,
      type: s.kind,
      x: s.x,
      y: s.y + dy,
      width: s.width,
      height: s.height,
      strokeColor: s.stroke ?? INK,
      backgroundColor: s.fill ?? "transparent",
      fillStyle: "solid",
      strokeWidth: s.strokeWidth ?? 1,
      strokeStyle: s.dashed ? "dashed" : "solid",
      roughness: s.sketch ? 1 : 0,
      roundness: s.rounded && s.kind !== "ellipse" ? { type: 3 } : null,
      ...(s.label
        ? {
            label: {
              text: s.label,
              fontSize: s.fontSize ?? 12,
              fontFamily: font,
              strokeColor: s.fontColor ?? INK,
              textAlign: s.align ?? "center",
              verticalAlign: s.verticalAlign ?? "middle",
            },
          }
        : {}),
    });
    bindable.add(s.id);
  }

  // Edges: bound when both ends were imported as shapes, else free arrows along their points.
  for (const e of page.edges) {
    const style: Loose = {
      id: ids(e.id),
      strokeColor: e.stroke && e.stroke !== "transparent" ? e.stroke : INK,
      strokeWidth: e.strokeWidth ?? 1,
      strokeStyle: e.dashed ? "dashed" : "solid",
      roughness: 0,
      startArrowhead: e.startArrow,
      endArrowhead: e.endArrow,
      customData: Object.keys(e.data).length ? { ...e.data } : undefined,
      ...(e.label ? { label: { text: e.label, fontSize: e.fontSize ?? 12, fontFamily: font } } : {}),
    };
    if (e.from && e.to && bindable.has(e.from) && bindable.has(e.to) && e.from !== e.to) {
      skeletons.push({ ...style, type: e.line ? "line" : "arrow", from: ids(e.from), to: ids(e.to), routing: e.routing === "curved" && e.line ? "straight" : e.routing });
      continue;
    }
    if (e.points.length < 2) {
      warnings.add("skipped edges with no position");
      continue;
    }
    const [p0] = e.points;
    skeletons.push({
      ...style,
      type: e.line ? "line" : "arrow",
      x: p0.x,
      y: p0.y + dy,
      points: e.points.map((p) => [p.x - p0.x, p.y - p0.y]),
    });
  }
  for (const s of skeletons) for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];

  const built = buildElements(skeletons, out, st);
  const all = [...out, ...built.added];
  // Members of mydraw frames written by our exporter.
  const frameOf = new Map(page.shapes.filter((s) => s.frame).map((s) => [ids(s.id), ids(s.frame!)]));
  const placed = all.map((el) => {
    const owner = (el as El & { containerId?: string | null }).containerId ?? el.id;
    const base = owner.replace(/\.(img|title)$/, ""); // icon image / zone title -> its node / zone
    const f = frameOf.get(base);
    return f ? newElementWith(el, { frameId: f }) : el;
  });
  return { elements: [...placed, ...frames], files };
}

/** Convert draw.io XML into elements (+ image files) for a new drawing. */
export async function drawioToScene(xml: string, st: AppState): Promise<DrawioScene> {
  const doc = await readDrawio(xml);
  const warnings = new Set(doc.warnings);
  const many = doc.pages.length > 1;
  const elements: El[] = [];
  const files: BinaryFileData[] = [];
  let y = 0;
  for (const [i, page] of doc.pages.entries()) {
    const prefix = many ? `p${i + 1}-` : "";
    const ids = (id: string) => `${prefix}${id}`;
    // Pages after the first go below the previous one.
    let dy = 0;
    if (many && page.shapes.length) {
      const top = Math.min(...page.shapes.map((s) => s.y), ...page.edges.flatMap((e) => e.points.map((p) => p.y)));
      dy = y - top + FRAME_PAD;
    }
    const { elements: els, files: fs } = await buildPage(page, st, ids, dy, warnings);
    if (!els.length) continue;
    files.push(...fs);
    const b = boundsOf(els);
    if (many && els.some((e) => e.type === "frame")) {
      // The page holds frames of its own (our exporter writes one page per mydraw frame): keep
      // them as they are. Wrapping them in a page frame would nest frames, which Excalidraw
      // does not support.
      elements.push(...els);
      y = b.y + b.height + PAGE_GAP;
    } else if (many) {
      // Each page becomes a frame around its content.
      const frameId = `page-${i + 1}`;
      const [frame] = convertToExcalidrawElements(
        [{ type: "frame", id: frameId, x: b.x - FRAME_PAD, y: b.y - FRAME_PAD, width: b.width + 2 * FRAME_PAD, height: b.height + 2 * FRAME_PAD, name: page.name, children: [] } as never],
        { regenerateIds: false },
      );
      elements.push(...els.map((e) => (e.frameId ? e : newElementWith(e, { frameId }))), frame as El);
      y = b.y + b.height + FRAME_PAD + PAGE_GAP;
    } else {
      elements.push(...els);
    }
  }
  if (!elements.length) throw new Error("the draw.io file has nothing that can be imported");
  return { elements, files, warnings: [...warnings], pages: doc.pages.length };
}
