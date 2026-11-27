// Diagram generation for agent commands: icon nodes, zones, ELK-laid-out diagrams (build_diagram,
// mermaid_to_scene, apply_template), legends and auto layout of existing elements. Like sceneOps,
// nothing here calls updateScene: callers commit the returned elements as one undo step.
import { resolveShadowInput, withShadow } from "../../../shared/shadow";
import { inferRole, isNodeRole, ROLE_STYLES, type RoleStyle } from "../../../shared/nodeRoles";
import { DASH_KEY, dashPatch, isDashId, type StrokeStyleName } from "../../../shared/dash";
import { canGradient, gradientPatch } from "../../../shared/gradient";
import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImageElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import { zoneColors, zoneDepths, type DiagramNode, type DiagramSpec } from "../../../shared/diagram";
import type { Box, Point } from "../../../shared/geometry";
import { translateLayout, type LayoutAlgorithm, type LayoutDirection, type LayoutResult } from "../../../shared/layout";
import { layoutBest, qualitySummary, translateRoutes, VARIANTS } from "../../../shared/layoutBest";
import { measureQuality } from "../../../shared/diagramQuality";
import { qualityInputOf } from "../../../shared/lintQuality";
import { byReadingOrder, inferDirection, nodeOverlaps, OVERLAP_WEIGHT, overlapArea, tidyLayout } from "../../../shared/tidy";
import { labelOffsetLimit } from "../../../shared/edgeTidy";
import { distToPolyline } from "../../../shared/labelGuard";
import type { LibraryItem } from "../../../shared/library";
import { resolveColor } from "../../../shared/palettes";
import type { Routing } from "../../../shared/routing";
import { isRecolorableIcon, recoloredIcon, restyledIcon } from "../library/iconColor";
import { DEFAULT_ICON_SKETCH } from "../../../shared/iconSketch";
import { loadStencil } from "../library/stencilContent";
import type { IconSketch } from "../../../shared/iconSketch";
import { TRUE_COLOR_SVG_MIME, trueColorFile } from "../library/trueColor";
import { svgToDataURL } from "../../../shared/recolor";
import { CAPTION_SHAPES, CAPTION_SHAPE_SIZE, isSvgShape, SHAPE_PADDING, shapeSvg, type ShapeSvgOptions, type SvgShape } from "../../../shared/shapeSvgs";
import { edgeLook, kindStyles, lookOf, type TextStyle } from "../../../shared/diagramLook";
import { fontIdByName } from "../fontRegistry";
import {
  applyUpdates,
  boundsOf,
  boundTextOf,
  boxOf,
  connectorElements,
  iconImageOf,
  isIconNode,
  isLinear,
  isZone,
  listable,
  measureText,
  randomId,
  labelPoint,
  routeBetween,
  arrowShape,
  bindingsFor,
  routingOf,
  zoneOf,
  zoneTitleOf,
  type El,
  type ElMap,
  rerouteAround,
} from "./sceneOps";

type Loose = Record<string, unknown>;

export const NODE_FONT_SIZE = 16;
export const CAPTION_FONT_SIZE = 14;
export const ZONE_FONT_SIZE = 16;
export const EDGE_FONT_SIZE = 14;
const DEFAULT_ICON_SIZE = 64;
/** A legend lists icon types only up to this many (beyond that, only arrow and shape kinds). */
const MAX_LEGEND_ICONS = 10;
/** Gap between a new diagram and existing content. */
const PLACE_GAP = 120;
const ZONE_TITLE_X = 14;
const ZONE_TITLE_Y = 10;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// ---------- icon nodes ----------

/** Load a stencil icon as an image element (at 0,0) and its file, sized and optionally recolored. */
export async function loadIconImage(
  item: LibraryItem,
  opts: { size?: number; color?: string; fontFamily: number; strokeColor: string; sketch?: IconSketch | null },
): Promise<{ image: ExcalidrawImageElement; files: BinaryFileData[] }> {
  if (item.kind !== "svg" && item.kind !== "png") throw new Error(`"${item.name}" is not an icon`);
  const content = await loadStencil(item, { label: false, fontFamily: opts.fontFamily, strokeColor: opts.strokeColor, sketch: opts.sketch });
  let image = content.elements.find((e) => e.type === "image") as ExcalidrawImageElement | undefined;
  if (!image) throw new Error(`stencil "${item.name}" has no image`);
  const files = new Map<string, BinaryFileData>(content.files.map((f) => [f.id, trueColorFile(f)]));
  image = { ...image, id: randomId(), groupIds: [], x: 0, y: 0 } as ExcalidrawImageElement;
  if (opts.size && opts.size > 0) {
    const k = opts.size / Math.max(image.width, image.height);
    image = { ...image, width: image.width * k, height: image.height * k };
  }
  if (opts.color) {
    const resolved = resolveColor(opts.color);
    if (!resolved || !HEX.test(resolved)) throw new Error("color must be a hex color like #ff9900 or a palette name like blue-600");
    const file = files.get(image.fileId!);
    if (!file || !isRecolorableIcon(image, Object.fromEntries(files) as BinaryFiles)) throw new Error("only SVG icons can be recolored");
    const r = await recoloredIcon(image, file, resolved);
    if (r.file) files.set(r.file.id, r.file);
    image = r.element as ExcalidrawImageElement;
  }
  return { image, files: [...files.values()] };
}

export interface IconNodeOptions {
  id?: string;
  image: El;
  caption: string | null;
  fontSize?: number;
  fontFamily: number;
  strokeColor: string;
  /** Top-left corner of the node. */
  x: number;
  y: number;
  /** Fill behind icon + caption (hides lines under a node that sits on a zone border). */
  mask?: string | null;
  customData?: Loose;
  stencil?: { id: string; name: string };
  /** Make the node at least this wide (equal widths in a row); the icon stays centred. */
  width?: number;
  /** Caption under the icon (default) or centred on it (a drawn shape with its label inside). */
  labelInside?: boolean;
  /** Opacity of icon and caption (muted nodes). */
  opacity?: number;
}

/** Size of an icon node for an image size and caption (without building it). */
export function iconNodeSize(iw: number, ih: number, caption: { width: number; height: number } | null): { width: number; height: number } {
  return {
    width: Math.max(iw + 8, caption ? caption.width + 14 : 0),
    height: 4 + ih + (caption ? 6 + caption.height + 5 : 4),
  };
}

/**
 * An icon node: borderless container (caption as its bottom-aligned bound text) + the image, as
 * one group. Returns [container, image, caption?]; arrows bind to the container.
 */
export function makeIconNode(o: IconNodeOptions): El[] {
  const fontSize = o.fontSize ?? CAPTION_FONT_SIZE;
  const cap = o.caption ? measureText(o.caption, fontSize, o.fontFamily) : null;
  const natural = o.labelInside ? { width: o.image.width, height: o.image.height } : iconNodeSize(o.image.width, o.image.height, cap);
  const width = Math.max(natural.width, o.width ?? 0);
  const height = natural.height;
  const id = o.id ?? randomId();
  const made = convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id,
        x: o.x,
        y: o.y,
        width,
        height,
        strokeColor: "transparent",
        backgroundColor: o.mask ?? "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: 0,
        roundness: null,
        ...(o.caption
          ? {
              label: {
                text: o.caption,
                fontSize,
                fontFamily: o.fontFamily as never,
                strokeColor: o.strokeColor,
                textAlign: "center",
                verticalAlign: o.labelInside ? "middle" : "bottom",
              },
            }
          : {}),
      } as never,
    ],
    { regenerateIds: false },
  );
  const g = randomId();
  const container = {
    ...made[0],
    groupIds: [g],
    customData: { ...(o.customData ?? {}), mydrawNode: "icon", ...(o.stencil ? { mydrawStencil: o.stencil } : {}) },
  } as El;
  const image = {
    ...o.image,
    x: o.x + (container.width - o.image.width) / 2,
    y: o.labelInside ? o.y : o.y + 4,
    groupIds: [g],
    frameId: null,
    ...(o.opacity !== undefined ? { opacity: o.opacity } : {}),
  } as El;
  const out: El[] = [container, image];
  const text = made.find((e) => e.type === "text");
  if (text) out.push({ ...text, groupIds: [g], ...(o.opacity !== undefined ? { opacity: o.opacity } : {}) } as El);
  return out;
}

// ---------- drawn shapes (database, cloud, person, ...) ----------

async function sha1Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A drawn shape, hand-drawn when `sketch` is given (the original stays in customData, like icons). */
async function sketchedShape(drawn: { image: El; file: BinaryFileData }, sketch: IconSketch | null): Promise<{ image: El; file: BinaryFileData }> {
  if (!sketch) return drawn;
  const r = await restyledIcon(drawn.image as ExcalidrawImageElement, drawn.file, { sketch });
  return r ? { image: r.element as El, file: r.file ?? drawn.file } : drawn;
}

/** A drawn shape (shared/shapeSvgs.ts) as an image element at (0,0) and its file. */
export async function shapeImage(kind: SvgShape, o: ShapeSvgOptions): Promise<{ image: El; file: BinaryFileData }> {
  const svg = shapeSvg(kind, o);
  const fileId = (await sha1Text(svg)) as FileId;
  const now = Date.now();
  const [image] = convertToExcalidrawElements([{ type: "image", fileId, x: 0, y: 0, width: o.width, height: o.height }]);
  return {
    image: { ...image, status: "saved", roughness: 0 } as El,
    file: { id: fileId, dataURL: svgToDataURL(svg) as DataURL, mimeType: TRUE_COLOR_SVG_MIME, created: now, lastRetrieved: now },
  };
}

// ---------- zones ----------

export interface ZoneOptions {
  id?: string;
  label?: string | null;
  box: Box;
  stroke: string;
  fill: string;
  style?: StrokeStyleName;
  strokeWidth?: number;
  roughness: number;
  fontFamily: number;
  fontSize?: number;
  locked?: boolean;
  parent?: string | null;
  customData?: Loose;
}

/** A zone: tinted rectangle + title text (grouped, locked by default). Returns [rect, title?]. */
export function makeZone(o: ZoneOptions): El[] {
  const id = o.id ?? randomId();
  const locked = o.locked !== false;
  const g = randomId();
  const [rect] = convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id,
        ...o.box,
        strokeColor: o.stroke,
        backgroundColor: o.fill,
        fillStyle: "solid",
        strokeWidth: o.strokeWidth ?? 2,
        // Extra dash styles: the fallback here, the pattern in customData (below).
        strokeStyle: dashPatch(null, isDashId(o.style) ? o.style : null, isDashId(o.style) ? "dashed" : (o.style ?? "solid")).strokeStyle,
        roughness: o.roughness,
        roundness: { type: 3 },
      } as never,
    ],
    { regenerateIds: false },
  );
  const data: Loose = { ...(o.customData ?? {}), mydrawZone: true, ...(isDashId(o.style) ? { [DASH_KEY]: o.style } : {}) };
  if (o.parent) data.mydrawZoneId = o.parent;
  const out: El[] = [{ ...rect, locked, groupIds: [g], customData: data } as El];
  if (o.label) {
    const [title] = convertToExcalidrawElements([
      {
        type: "text",
        id: `${id}.title`,
        x: o.box.x + ZONE_TITLE_X,
        y: o.box.y + ZONE_TITLE_Y,
        text: o.label,
        fontSize: o.fontSize ?? ZONE_FONT_SIZE,
        fontFamily: o.fontFamily as never,
        strokeColor: o.stroke,
      } as never,
    ], { regenerateIds: false });
    out.push({ ...title, locked, groupIds: [g], customData: { mydrawZoneTitle: id } } as El);
  }
  return out;
}

export function zoneTitleSize(label: string | undefined, fontFamily: number, fontSize = ZONE_FONT_SIZE): { titleHeight: number; minWidth: number } {
  if (!label) return { titleHeight: 4, minWidth: 80 };
  const m = measureText(label, fontSize, fontFamily);
  return { titleHeight: m.height + ZONE_TITLE_Y + 4, minWidth: m.width + ZONE_TITLE_X * 2 + 16 };
}

// ---------- diagrams ----------

export interface DiagramBuild {
  added: El[];
  files: BinaryFileData[];
  result: Loose;
}

interface NodePlan {
  node: DiagramNode;
  width: number;
  height: number;
  icon?: { image: El; files: BinaryFileData[]; item: LibraryItem };
  /** A drawn shape (shared/shapeSvgs.ts); `captionBelow` for the person and server. */
  shape?: { kind: SvgShape; captionBelow: boolean };
  /** Size of the subtitle line, when the node has one. */
  sub?: { width: number; height: number } | null;
}


/**
 * Lay out a diagram with ELK and turn it into elements: zones (behind), arrows, then nodes.
 * `items` maps each node's `icon` reference to a library item (null: not found -> plain shape).
 */
export async function buildDiagram(
  scene: readonly El[],
  st: AppState,
  spec: DiagramSpec,
  items: Record<string, LibraryItem | null>,
): Promise<DiagramBuild> {
  // The look (polished by default, professional or sketch) sets fonts, sizes, strokes, roughness
  // and, when polished, colours by node role and soft shadows.
  const look = lookOf(spec.look);
  /** Icons and drawn shapes: the node's iconStyle, else hand-drawn when the look is rough (sketch). */
  const sketchOf = (n: DiagramNode): IconSketch | null => (n.iconStyle !== undefined ? n.iconStyle : look.roughness > 0 ? { ...DEFAULT_ICON_SKETCH } : null);
  const fontFor = (t: TextStyle): number => fontIdByName(t.font) ?? fontIdByName(t.fallback) ?? (st.currentItemFontFamily as number);
  const fonts = {
    title: fontFor(look.title),
    subtitle: fontFor(look.diagramSubtitle),
    zone: fontFor(look.zoneTitle),
    node: fontFor(look.nodeLabel),
    nodeBold: fontFor(look.nodeLabelBold),
    caption: fontFor(look.caption),
    nodeSub: fontFor(look.nodeSubtitle),
    edge: fontFor(look.edgeLabel),
  };
  const font = fonts.caption;
  const ink = st.currentItemStrokeColor;
  const roughness = look.roughness;
  const warnings: string[] = [];
  const taken = new Set(scene.map((e) => e.id));
  // Edge ids numbered automatically (e1, e2, ...) by normalizeSpec must not collide with an earlier
  // diagram in this drawing; ids the caller chose still do.
  if (spec.edges?.some((e) => /^e\d+$/.test(e.id ?? "") && taken.has(e.id!))) {
    const used = new Set([...taken, ...(spec.edges ?? []).map((e) => e.id!)]);
    let n = 1;
    const fresh = () => {
      while (used.has(`e${n}`)) n++;
      used.add(`e${n}`);
      return `e${n}`;
    };
    spec = { ...spec, edges: spec.edges.map((e) => (/^e\d+$/.test(e.id ?? "") && taken.has(e.id!) ? { ...e, id: fresh() } : e)) };
  }
  const clash = [
    ...spec.nodes.map((n) => n.id),
    ...(spec.zones ?? []).flatMap((z) => [z.id, `${z.id}.title`]),
    ...(spec.edges ?? []).map((e) => e.id!),
  ].filter((id) => taken.has(id));
  if (clash.length) throw new Error(`ids already used in this drawing: ${clash.join(", ")} (pick other ids)`);

  // Text styles of a node: emphasis makes the label bold; muted nodes are grey.
  const labelText = (n: DiagramNode) => (n.emphasis === "primary" ? { f: fonts.nodeBold, size: look.nodeLabelBold.size } : { f: fonts.node, size: look.nodeLabel.size });
  const captionText = (n: DiagramNode) => (n.emphasis === "primary" ? { f: fonts.nodeBold, size: look.caption.size + 1 } : { f: fonts.caption, size: look.caption.size });
  /** Polished look: the node's role colours (fill tint + deeper stroke), unless the node names its own. */
  const roleOf = (n: DiagramNode): RoleStyle | null => (look.roleColors ? ROLE_STYLES[inferRole({ ...n, icon: n.icon ? (items[n.icon]?.name ?? n.icon) : undefined })] : null);
  /** Icon nodes keep their own colours: the role colours only shapes. */
  const isIconPlan = (n: DiagramNode) => !!(n.icon && items[n.icon]);
  const strokeOf = (n: DiagramNode) => (n.emphasis === "muted" ? look.muted : (n.color ?? (isIconPlan(n) ? undefined : roleOf(n)?.stroke) ?? ink));
  const fillOf = (n: DiagramNode) => n.fill ?? roleOf(n)?.fill ?? "#ffffff";
  const defaultShadow = (n: DiagramNode) => resolveShadowInput(n.emphasis === "primary" ? look.primaryShadow : n.emphasis === "muted" ? null : look.nodeShadow) ?? null;
  const opacityOf = (n: DiagramNode) => (n.emphasis === "muted" ? look.faded : undefined);
  const subtitleSize = (n: DiagramNode) => (n.subtitle ? measureText(n.subtitle, look.nodeSubtitle.size, fonts.nodeSub) : null);

  // Measure nodes; load icons; plan drawn shapes.
  const plans = new Map<string, NodePlan>();
  for (const n of spec.nodes) {
    const label = n.label ?? n.id;
    const sub = subtitleSize(n);
    const item = n.icon ? items[n.icon] : undefined;
    if (n.icon && !item) warnings.push(`no icon found for "${n.icon}" (node ${n.id}); drew a ${n.shape ?? "rectangle"} instead`);
    if (item) {
      try {
        const c = captionText(n);
        const icon = await loadIconImage(item, { size: spec.iconSize ?? DEFAULT_ICON_SIZE, color: n.iconColor, fontFamily: c.f, strokeColor: ink, sketch: sketchOf(n) });
        const cap = label ? measureText(label, c.size, c.f) : null;
        const size = iconNodeSize(icon.image.width, icon.image.height, cap);
        // A subtitle goes under the caption, inside the node's layout box.
        plans.set(n.id, { node: n, width: Math.max(size.width, sub ? sub.width + 8 : 0), height: size.height + (sub ? sub.height + 4 : 0), icon: { ...icon, item }, sub });
        continue;
      } catch (e) {
        warnings.push(`icon "${item.name}" for node ${n.id} failed (${e instanceof Error ? e.message : e}); drew a shape instead`);
      }
    }
    const shape = n.shape ?? "rectangle";
    if (isSvgShape(shape)) {
      if (CAPTION_SHAPES.has(shape)) {
        const img = CAPTION_SHAPE_SIZE[shape as "actor" | "server"];
        const c = captionText(n);
        const cap = label ? measureText(label, c.size, c.f) : null;
        const size = iconNodeSize(img.width, img.height, cap);
        plans.set(n.id, { node: n, width: Math.max(size.width, sub ? sub.width + 8 : 0), height: size.height + (sub ? sub.height + 4 : 0), shape: { kind: shape, captionBelow: true }, sub });
      } else {
        const t = labelText(n);
        const m = measureText(label, t.size, t.f);
        const pad = SHAPE_PADDING[shape];
        plans.set(n.id, {
          node: n,
          width: n.width ?? Math.max(120, m.width + pad.x, sub ? sub.width + pad.x : 0),
          height: n.height ?? Math.max(shape === "cylinder" ? 90 : 64, m.height + pad.y) + (sub ? sub.height + 6 : 0),
          shape: { kind: shape, captionBelow: false },
          sub,
        });
      }
      continue;
    }
    const native = shape as "rectangle" | "ellipse" | "diamond";
    const t = labelText(n);
    const m = measureText(label, t.size, t.f);
    const k = native === "diamond" ? 1.7 : native === "ellipse" ? 1.35 : 1;
    plans.set(n.id, {
      node: n,
      width: n.width ?? Math.max(120, (m.width + 36) * k, sub ? (sub.width + 36) * k : 0),
      height: (n.height ?? Math.max(native === "diamond" ? 80 : 60, (m.height + 26) * k)) + (sub ? sub.height + 6 : 0),
      sub,
    });
  }

  // Equal sizes: nodes of one type in one zone share the widest width (and, for shapes, height),
  // so rows and columns line up. Sizes the caller gave are kept.
  const groups = new Map<string, NodePlan[]>();
  for (const plan of plans.values()) {
    const n = plan.node;
    const type = plan.icon ? "icon" : plan.shape ? `shape:${plan.shape.kind}` : `native:${n.shape ?? "rectangle"}`;
    const key = `${n.zone ?? ""}|${type}`;
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const w = Math.max(...list.map((p) => p.width));
    const h = Math.max(...list.map((p) => p.height));
    for (const p of list) {
      if (p.node.width === undefined) p.width = w;
      if (!p.icon && !p.shape?.captionBelow && p.node.height === undefined) p.height = h;
    }
  }

  const edges = (spec.edges ?? []).filter((e) => {
    if (e.from !== e.to) return true;
    warnings.push(`edge ${e.id} from "${e.from}" to itself was skipped`);
    return false;
  });
  const zoneSizes = new Map((spec.zones ?? []).map((z) => [z.id, zoneTitleSize(z.label, fonts.zone, look.zoneTitle.size)]));
  const best = await layoutBest({
    nodes: spec.nodes.map((n) => ({ id: n.id, width: plans.get(n.id)!.width, height: plans.get(n.id)!.height, zone: n.zone })),
    zones: (spec.zones ?? []).map((z) => ({ id: z.id, parent: z.parent, ...zoneSizes.get(z.id)! })),
    edges: edges.map((e) => {
      const m = e.label ? measureText(e.label, look.edgeLabel.size, fonts.edge) : null;
      return { id: e.id!, from: e.from, to: e.to, label: m ? { width: m.width + 8, height: m.height + 4 } : undefined };
    }),
    direction: spec.direction,
    algorithm: spec.algorithm,
    spacing: spec.spacing,
  });
  let layout: LayoutResult = best.layout;

  // Where: given, else right of the existing content, top-aligned.
  const live = scene.filter((e) => !e.isDeleted);
  let origin: Point;
  if (spec.x !== undefined || spec.y !== undefined) origin = { x: spec.x ?? 0, y: spec.y ?? 0 };
  else if (live.length) {
    const b = boundsOf(live);
    origin = { x: b.x + b.width + PLACE_GAP, y: b.y };
  } else origin = { x: 0, y: 0 };

  const added: El[] = [];
  const files: BinaryFileData[] = [];
  let titleId: string | null = null;
  if (spec.title) {
    const [t] = convertToExcalidrawElements([
      { type: "text", x: origin.x, y: origin.y, text: spec.title, fontSize: look.title.size, fontFamily: fonts.title as never, strokeColor: ink },
    ]);
    added.push(t);
    titleId = t.id;
    origin = { x: origin.x, y: origin.y + t.height + (spec.subtitle ? 6 : 24) };
  }
  if (spec.subtitle) {
    const [t] = convertToExcalidrawElements([
      { type: "text", x: origin.x, y: origin.y, text: spec.subtitle, fontSize: look.diagramSubtitle.size, fontFamily: fonts.subtitle as never, strokeColor: look.muted },
    ]);
    added.push(t);
    origin = { x: origin.x, y: origin.y + t.height + 24 };
  }
  layout = translateLayout(layout, origin);
  // The tidied routes (arrows moved apart, labels on free stretches) move with the layout.
  const tidied = new Map(translateRoutes(best.routes, layout.bounds.x - best.layout.bounds.x, layout.bounds.y - best.layout.bounds.y).map((r) => [r.id, r]));

  const byId: ElMap = new Map();
  // Zones, outermost first so inner ones draw on top.
  const depths = zoneDepths(spec.zones ?? []);
  const colors = zoneColors(spec.zones ?? []);
  for (const z of [...(spec.zones ?? [])].sort((a, b) => depths.get(a.id)! - depths.get(b.id)!)) {
    const c = colors.get(z.id)!;
    const els = makeZone({
      id: z.id,
      label: z.label,
      box: layout.zones.get(z.id)!,
      stroke: c.stroke,
      fill: c.fill,
      style: z.style,
      strokeWidth: depths.get(z.id) === 0 ? look.zoneStroke.outer : look.zoneStroke.inner,
      roughness,
      fontFamily: fonts.zone,
      fontSize: look.zoneTitle.size,
      locked: z.locked,
      parent: z.parent,
    });
    added.push(...els);
    byId.set(z.id, els[0]);
  }

  /** The grey second line of a node, centred at `cx` with its top at `y`, in the node's group. */
  const subtitleEl = (n: DiagramNode, cx: number, y: number, groupIds: readonly string[]): El => {
    const [t] = convertToExcalidrawElements([
      { type: "text", x: cx, y, text: n.subtitle!, fontSize: look.nodeSubtitle.size, fontFamily: fonts.nodeSub as never, strokeColor: look.muted, textAlign: "center" } as never,
    ]);
    return { ...t, x: cx - t.width / 2, groupIds: [...groupIds], customData: { mydrawSubtitleOf: n.id }, ...(opacityOf(n) !== undefined ? { opacity: opacityOf(n) } : {}) } as El;
  };

  // Nodes (created now so arrows can bind to them; added after the arrows so lines go underneath).
  const nodeEls: El[] = [];
  for (const n of spec.nodes) {
    const plan = plans.get(n.id)!;
    const box = layout.nodes.get(n.id)!;
    const data: Loose = { ...(n.data ?? {}) };
    if (n.kind) data.mydrawKind = n.kind;
    if (n.zone) data.mydrawZoneId = n.zone;
    if (n.subtitle) data.mydrawSubtitle = n.subtitle;
    if (look.roleColors) data.mydrawRole = inferRole({ ...n, icon: n.icon ? (items[n.icon]?.name ?? n.icon) : undefined });
    const stroke = strokeOf(n);
    if (plan.icon || plan.shape?.captionBelow) {
      // Icon, or a drawn shape with its label underneath (person, server).
      let image: El;
      if (plan.icon) {
        image = plan.icon.image;
        files.push(...plan.icon.files);
      } else {
        const size = CAPTION_SHAPE_SIZE[plan.shape!.kind as "actor" | "server"];
        const drawn = await sketchedShape(await shapeImage(plan.shape!.kind, { ...size, stroke, fill: fillOf(n), strokeWidth: look.nodeStroke[n.emphasis ?? "normal"] }), sketchOf(n));
        image = drawn.image;
        files.push(drawn.file);
        data.mydrawShape = plan.shape!.kind;
      }
      const c = captionText(n);
      const els = makeIconNode({
        id: n.id,
        image,
        caption: n.label ?? n.id,
        fontFamily: c.f,
        fontSize: c.size,
        strokeColor: stroke,
        x: box.x,
        y: box.y,
        width: box.width,
        customData: data,
        opacity: opacityOf(n),
        ...(plan.icon ? { stencil: { id: plan.icon.item.id, name: plan.icon.item.name } } : {}),
      });
      if (n.link) els[0] = { ...els[0], link: n.link } as El;
      if (n.subtitle) els.push(subtitleEl(n, box.x + els[0].width / 2, box.y + els[0].height + 2, els[0].groupIds));
      nodeEls.push(...els);
      byId.set(n.id, els[0]);
    } else if (plan.shape) {
      // A drawn shape with its label inside (database, cloud, queue, ...).
      data.mydrawShape = plan.shape.kind;
      const drawn = await sketchedShape(await shapeImage(plan.shape.kind, { width: box.width, height: box.height, stroke, fill: fillOf(n), strokeWidth: look.nodeStroke[n.emphasis ?? "normal"] }), sketchOf(n));
      files.push(drawn.file);
      const t = labelText(n);
      const els = makeIconNode({
        id: n.id,
        image: drawn.image,
        caption: n.label ?? n.id,
        fontFamily: t.f,
        fontSize: t.size,
        strokeColor: stroke,
        x: box.x,
        y: box.y,
        labelInside: true,
        customData: data,
        opacity: opacityOf(n),
      });
      if (n.link) els[0] = { ...els[0], link: n.link } as El;
      if (n.subtitle) {
        const label = els.find((e) => e.type === "text");
        const below = label ? label.y + label.height + 3 : box.y + box.height / 2;
        els.push(subtitleEl(n, box.x + box.width / 2, below, els[0].groupIds));
      }
      // The shape image goes first: Excalidraw draws a bound label right after its container, so
      // with the container first the (filled) image would cover the label.
      const [container, image, ...rest] = els;
      nodeEls.push(image, container, ...rest);
      byId.set(n.id, container);
    } else {
      const shape = (n.shape ?? "rectangle") as "rectangle" | "ellipse" | "diamond";
      const t = labelText(n);
      const made: El[] = convertToExcalidrawElements(
        [
          {
            type: shape,
            id: n.id,
            ...box,
            strokeColor: stroke,
            backgroundColor: fillOf(n),
            fillStyle: "solid",
            strokeWidth: look.nodeStroke[n.emphasis ?? "normal"],
            roughness,
            roundness: shape === "ellipse" ? null : { type: 3 },
            link: n.link ?? null,
            ...(opacityOf(n) !== undefined ? { opacity: opacityOf(n) } : {}),
            label: { text: n.label ?? n.id, fontSize: t.size, fontFamily: t.f as never, strokeColor: stroke },
          } as never,
        ],
        { regenerateIds: false },
      );
      made[0] = { ...made[0], customData: Object.keys(data).length ? data : undefined } as El;
      if (n.subtitle) {
        // Shape, label and subtitle move together.
        const g = randomId();
        for (let i = 0; i < made.length; i++) made[i] = { ...made[i], groupIds: [g] } as El;
        const label = made.find((e) => e.type === "text");
        const below = label ? label.y + label.height + 3 : box.y + box.height / 2;
        made.push(subtitleEl(n, box.x + box.width / 2, below, [g]));
      }
      nodeEls.push(...made);
      byId.set(n.id, made[0]);
    }
  }

  // Fill pattern, gradient and border style of plain shape nodes (icon and drawn-shape nodes are images).
  // (External systems in the polished look get a dashed border unless the node says otherwise.)
  for (const n of spec.nodes) {
    const strokeStyle = n.strokeStyle ?? (n.color === undefined ? roleOf(n)?.strokeStyle : undefined);
    if (n.gradient === undefined && n.fillStyle === undefined && strokeStyle === undefined) continue;
    const i = nodeEls.findIndex((e) => e.id === n.id);
    if (i < 0 || nodeEls[i].customData?.mydrawNode) continue;
    let el = nodeEls[i] as El & Loose;
    if (n.fillStyle) el = { ...el, fillStyle: n.fillStyle as never };
    if (strokeStyle) el = { ...el, ...dashPatch(el.customData as Loose | undefined, isDashId(strokeStyle) ? strokeStyle : null, isDashId(strokeStyle) ? "dashed" : (strokeStyle as "solid" | "dashed" | "dotted")) };
    if (n.gradient !== undefined && canGradient(el.type)) el = { ...el, ...gradientPatch(el.customData as Loose | undefined, n.gradient) };
    nodeEls[i] = el as El;
    byId.set(n.id, nodeEls[i]);
  }

  // Shadows: a node's own, else the diagram's, else the look's (polished: soft, lifted for primary
  // nodes). Icon and drawn-shape nodes carry it on their image.
  for (const n of spec.nodes) {
    const sh = n.shadow !== undefined ? n.shadow : spec.shadow !== undefined ? spec.shadow : defaultShadow(n);
    if (!sh) continue;
    const container = byId.get(n.id);
    if (!container) continue;
    const g = container.groupIds[0];
    const i = container.customData?.mydrawNode === "icon" && g ? nodeEls.findIndex((e) => e.type === "image" && e.groupIds[0] === g) : nodeEls.findIndex((e) => e.id === container.id);
    if (i < 0) continue;
    nodeEls[i] = { ...nodeEls[i], customData: withShadow(nodeEls[i].customData as Loose | undefined, sh) } as El;
    if (nodeEls[i].id === container.id) byId.set(n.id, nodeEls[i]);
  }

  // Arrows: colour, dash, width, opacity and arrowheads from the edge, its kind and the look.
  const kinds = kindStyles(edges.map((e) => e.kind), spec.kinds);
  const arrowEls: El[] = [];
  const boundTo = new Map<string, { id: string; type: "arrow" }[]>();
  for (const e of edges) {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    const routing: Routing = e.routing ?? spec.routing ?? "elbow";
    const given = layout.orthogonal && routing === "elbow" ? tidied.get(e.id!) : undefined;
    const L = edgeLook(e, look, kinds, ink);
    const sk: Loose = {
      type: "arrow",
      id: e.id,
      strokeColor: L.color,
      strokeWidth: L.width,
      ...dashPatch(e.kind ? { mydrawKind: e.kind } : null, isDashId(L.style) ? L.style : null, isDashId(L.style) ? "dashed" : (L.style as "solid" | "dashed" | "dotted")),
      opacity: L.opacity,
      roughness,
      startArrowhead: L.startArrowhead,
      endArrowhead: L.endArrowhead,
      ...(e.label ? { label: { text: e.label, fontSize: look.edgeLabel.size, fontFamily: fonts.edge, strokeColor: L.color } } : {}),
    };
    arrowEls.push(...connectorElements(sk, a, b, routing, given?.points, given?.label?.center));
    for (const id of [a.id, b.id]) boundTo.set(id, [...(boundTo.get(id) ?? []), { id: e.id!, type: "arrow" }]);
  }
  const withArrows = (el: El) => {
    const refs = boundTo.get(el.id);
    return refs ? ({ ...el, boundElements: [...(el.boundElements ?? []), ...refs] } as El) : el;
  };
  for (let i = 0; i < added.length; i++) added[i] = withArrows(added[i]);
  added.push(...arrowEls, ...nodeEls.map(withArrows));

  let legend: El[] = [];
  if (spec.legend) {
    try {
      legend = buildLegend(added, {
        title: typeof spec.legend === "string" ? spec.legend : "Legend",
        fontFamily: font,
        roughness,
        ink,
      });
      added.push(...legend);
    } catch (e) {
      // An empty legend must not throw away the whole diagram.
      warnings.push(`no legend drawn: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    added,
    files,
    result: {
      nodes: spec.nodes.map((n) => n.id),
      zones: (spec.zones ?? []).map((z) => z.id),
      edges: edges.map((e) => e.id),
      title: titleId,
      legend: legend[0]?.id ?? null,
      bounds: boundsOf(added),
      quality: qualitySummary(best),
      warnings: warnings.length ? warnings : undefined,
    },
  };
}

// ---------- legend ----------

interface LegendEntry {
  label: string;
  sample: (x: number, y: number) => El[];
}

/**
 * A legend for `elements`: one row per icon (by kind or stencil name), per shape kind and per arrow
 * kind. Placed under the elements, right-aligned, as one group (customData.mydrawLegend).
 */
export function buildLegend(
  elements: readonly El[],
  o: { title: string; fontFamily: number; roughness: number; ink: string; x?: number; y?: number },
): El[] {
  const live = elements.filter((e) => !e.isDeleted && !e.customData?.mydrawLegend);
  const map: ElMap = new Map(live.map((e) => [e.id, e]));
  const entries = new Map<string, LegendEntry>();
  const ROW = 40;
  for (const el of live) {
    const kind = el.customData?.mydrawKind as string | undefined;
    if (isIconNode(el)) {
      const img = iconImageOf(el, map);
      const name = kind ?? (el.customData?.mydrawStencil as { name?: string } | undefined)?.name;
      if (!img || !name || entries.has(`i:${name}`)) continue;
      entries.set(`i:${name}`, {
        label: name,
        sample: (x, y) => {
          const k = 30 / Math.max(img.width, img.height);
          const w = img.width * k;
          const h = img.height * k;
          return [{ ...img, id: randomId(), x: x + (48 - w) / 2, y: y + (ROW - h) / 2, width: w, height: h, groupIds: [], locked: false } as El];
        },
      });
    } else if (kind && isLinear(el)) {
      if (entries.has(`a:${kind}`)) continue;
      const a = el as El & Loose;
      entries.set(`a:${kind}`, {
        label: kind,
        sample: (x, y) =>
          convertToExcalidrawElements([
            {
              type: el.type as "arrow",
              x,
              y: y + ROW / 2,
              points: [
                [0, 0],
                [48, 0],
              ],
              strokeColor: el.strokeColor,
              strokeWidth: el.strokeWidth,
              strokeStyle: el.strokeStyle,
              roughness: o.roughness,
              ...(el.type === "arrow" ? { startArrowhead: a.startArrowhead ?? null, endArrowhead: a.endArrowhead ?? null } : {}),
            } as never,
          ]),
      });
    } else if (kind && (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") && !isZone(el)) {
      if (entries.has(`s:${kind}`)) continue;
      entries.set(`s:${kind}`, {
        label: kind,
        sample: (x, y) =>
          convertToExcalidrawElements([
            {
              type: el.type as "rectangle",
              x: x + 6,
              y: y + 8,
              width: 36,
              height: ROW - 16,
              strokeColor: el.strokeColor,
              backgroundColor: el.backgroundColor,
              fillStyle: el.fillStyle,
              strokeWidth: el.strokeWidth,
              roughness: o.roughness,
              roundness: el.roundness,
            } as never,
          ]),
      });
    }
  }
  // Polished diagrams: one row per node role (colour swatch), when there are two or more roles and
  // the shapes carry no kinds of their own.
  const roles = new Map<string, El>();
  for (const el of live) {
    const role = el.customData?.mydrawRole;
    if (isNodeRole(role) && !el.customData?.mydrawKind && (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") && !isZone(el) && !roles.has(role)) roles.set(role, el);
  }
  if (roles.size >= 2) {
    for (const [role, el] of roles) {
      const st = ROLE_STYLES[role as keyof typeof ROLE_STYLES];
      entries.set(`r:${role}`, {
        label: st.title,
        sample: (x, y) =>
          convertToExcalidrawElements([
            { type: "rectangle", x: x + 6, y: y + 8, width: 36, height: ROW - 16, strokeColor: st.stroke, backgroundColor: st.fill, fillStyle: "solid", strokeWidth: el.strokeWidth, roughness: o.roughness, roundness: { type: 3 } } as never,
          ]),
      });
    }
  }
  // Many icon types make a legend as long as the diagram, and every icon has its caption anyway:
  // then the legend lists only the kinds (arrows and shapes).
  const iconKeys = [...entries.keys()].filter((k) => k.startsWith("i:"));
  if (iconKeys.length > MAX_LEGEND_ICONS && entries.size > iconKeys.length) for (const k of iconKeys) entries.delete(k);
  if (!entries.size) {
    throw new Error("nothing for a legend: no icons, and no shapes or arrows with a kind (set kind on nodes/edges, or data.mydrawKind)");
  }

  const pad = 16;
  const title = measureText(o.title, ZONE_FONT_SIZE, o.fontFamily);
  const labels = [...entries.values()].map((e) => measureText(e.label, CAPTION_FONT_SIZE, o.fontFamily));
  const width = Math.max(title.width, ...labels.map((l) => 48 + 12 + l.width)) + pad * 2;
  const height = pad + title.height + 8 + entries.size * ROW + pad / 2;
  let x = o.x;
  let y = o.y;
  if (x === undefined || y === undefined) {
    const b = live.length ? boundsOf(live) : { x: 0, y: 0, width: 0, height: 0 };
    x ??= b.x + b.width - width;
    y ??= b.y + b.height + 40;
  }
  const out: El[] = [];
  out.push(
    ...convertToExcalidrawElements([
      {
        type: "rectangle",
        x,
        y,
        width,
        height,
        strokeColor: "#868e96",
        backgroundColor: "#ffffff",
        fillStyle: "solid",
        strokeWidth: 1,
        roughness: o.roughness,
        roundness: { type: 3 },
      } as never,
      { type: "text", x: x + pad, y: y + pad, text: o.title, fontSize: ZONE_FONT_SIZE, fontFamily: o.fontFamily as never, strokeColor: o.ink },
    ]),
  );
  let rowY = y + pad + title.height + 8;
  [...entries.values()].forEach((e, i) => {
    out.push(...e.sample(x! + pad, rowY));
    out.push(
      ...convertToExcalidrawElements([
        {
          type: "text",
          x: x! + pad + 48 + 12,
          y: rowY + (ROW - labels[i].height) / 2,
          text: e.label,
          fontSize: CAPTION_FONT_SIZE,
          fontFamily: o.fontFamily as never,
          strokeColor: o.ink,
        },
      ]),
    );
    rowY += ROW;
  });
  const g = randomId();
  return out.map((el) => ({ ...el, groupIds: [g], customData: { ...(el.customData ?? {}), mydrawLegend: true } }) as El);
}

// ---------- auto layout of existing elements ----------

interface Unit {
  id: string;
  /** Element arrows bind to when its box is the unit's box (shape, icon node, zone). */
  main: El | null;
  members: El[];
  box: Box;
  zone?: string;
}

/**
 * Re-layout existing elements with ELK: nodes (shapes, icon nodes, groups) and zones, using the
 * arrows between them as edges. The result keeps the current top-left corner. Returns the changed
 * elements (one commit) and a summary.
 */
/** What a layout or tidy works on: units (nodes and groups), zones, the arrows between units, and
 *  free text (notes) that stays with the unit it sits next to. */
interface Collected {
  live: El[];
  map: ElMap;
  units: Unit[];
  zones: El[];
  zoneIds: Set<string>;
  owner: Map<string, string>;
  edges: { id: string; from: string; to: string; arrow: El }[];
}

function collectUnits(scene: readonly El[], ids: string[] | undefined): Collected {
  const live = scene.filter((e) => !e.isDeleted);
  const map: ElMap = new Map(live.map((e) => [e.id, e]));
  let scope = live;
  if (ids?.length) {
    const want = new Set<string>();
    for (const id of ids) {
      const el = map.get(id);
      if (!el) throw new Error(`no element with id "${id}"`);
      want.add(id);
      if (isZone(el)) for (const m of live) if (zoneOf(m) && isInside(m, id, map)) want.add(m.id);
    }
    const groups = new Set(live.filter((e) => want.has(e.id)).map((e) => e.groupIds.at(-1)).filter(Boolean));
    scope = live.filter((e) => want.has(e.id) || e.groupIds.some((g) => groups.has(g)));
  }

  // Zones.
  const zones = scope.filter(isZone);
  const zoneIds = new Set(zones.map((z) => z.id));
  const owner = new Map<string, string>(); // element id -> unit id
  const units: Unit[] = [];
  const handled = new Set<string>();
  for (const z of zones) {
    handled.add(z.id);
    owner.set(z.id, z.id);
    const title = zoneTitleOf(z, map);
    if (title) handled.add(title.id);
  }
  // Nodes: outermost group (incl. icon nodes) or single element.
  const skip = (el: El) =>
    handled.has(el.id) ||
    isLinear(el) ||
    el.type === "frame" ||
    el.type === "magicframe" ||
    !!el.frameId ||
    !!el.customData?.mydrawLegend ||
    (el.type === "text" && !!(el as El & Loose).containerId);
  const byGroup = new Map<string, El[]>();
  const loose: El[] = [];
  for (const el of scope) {
    if (skip(el)) continue;
    const g = el.groupIds.at(-1);
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), el]);
    else if (el.type === "text") loose.push(el);
    else {
      units.push({ id: el.id, main: el, members: [el], box: boxOf(el), zone: zoneIn(el, zoneIds) });
      owner.set(el.id, el.id);
    }
  }
  for (const [g, members] of byGroup) {
    if (members.some((m) => isZone(m))) continue;
    const node = members.find(isIconNode);
    const all = live.filter((e) => e.groupIds.includes(g) && !isLinear(e));
    const box = boundsOf(all);
    const main = node && all.length <= 3 ? node : all.length === 1 ? all[0] : null;
    const id = main?.id ?? `group:${g}`;
    const zone = all.map((m) => zoneIn(m, zoneIds)).find(Boolean);
    units.push({ id, main, members: all, box, zone });
    for (const m of all) owner.set(m.id, id);
  }
  // Free text: a note close to a unit travels with it (members only, the unit's box is unchanged);
  // text far from everything is a unit of its own.
  for (const t of loose) {
    const tb = boxOf(t);
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const u of units) {
      const gx = Math.max(0, u.box.x - (tb.x + tb.width), tb.x - (u.box.x + u.box.width));
      const gy = Math.max(0, u.box.y - (tb.y + tb.height), tb.y - (u.box.y + u.box.height));
      const d = Math.hypot(gx, gy);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    if (best && bestD <= NOTE_DISTANCE && best.zone === zoneIn(t, zoneIds)) {
      best.members.push(t);
      owner.set(t.id, best.id);
    } else {
      units.push({ id: t.id, main: t, members: [t], box: tb, zone: zoneIn(t, zoneIds) });
      owner.set(t.id, t.id);
    }
  }

  // Edges: arrows between different units.
  const arrows = live.filter((e) => e.type === "arrow" || e.type === "line");
  const edges: Collected["edges"] = [];
  for (const a of arrows) {
    const e = a as El & { startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };
    const from = e.startBinding && owner.get(e.startBinding.elementId);
    const to = e.endBinding && owner.get(e.endBinding.elementId);
    if (!from || !to || from === to) continue;
    edges.push({ id: a.id, from, to, arrow: a });
  }
  return { live, map, units, zones, zoneIds, owner, edges };
}

/** A free text this close to a unit (px) is its note and moves with it. */
const NOTE_DISTANCE = 30;

/** Score of the drawing as it is now, on the same scale as a layout's (plus overlapping nodes). */
function currentScore(c: Collected): number {
  const all = [...c.units.flatMap((u) => u.members), ...c.zones];
  const ids = new Set(all.map((e) => e.id));
  for (const e of c.edges) {
    ids.add(e.id);
    const label = boundTextOf(e.arrow, c.map);
    if (label) ids.add(label.id);
  }
  const input = qualityInputOf(c.live.filter((e) => ids.has(e.id) || (e.type === "text" && !!e.customData?.mydrawZoneTitle)) as never);
  return measureQuality(input).score + nodeOverlaps(c.units.map((u) => u.box)) * OVERLAP_WEIGHT;
}

/** Push units that are not part of a change out of the way of boxes that grew there (one pass). */
function makeRoom(c: Collected, scene: readonly El[], scopeIds: Set<string>, before: Box, after: Box): Loose[] {
  if (after.width <= before.width + 1 && after.height <= before.height + 1) return [];
  const others = collectUnits(scene, undefined).units.filter((u) => !u.members.some((m) => scopeIds.has(m.id)) && !u.zone);
  const updates: Loose[] = [];
  const growX = after.x + after.width - (before.x + before.width);
  const growY = after.y + after.height - (before.y + before.height);
  for (const u of others) {
    if (!overlapArea(u.box, after, PLACE_GAP / 3)) continue;
    // Right of the old area: shift right; below it: shift down; else whichever the growth allows.
    const right = u.box.x >= before.x + before.width - 1;
    const below = u.box.y >= before.y + before.height - 1;
    const dx = right && growX > 0 ? growX : 0;
    const dy = !dx && (below || growY > 0) ? Math.max(growY, after.y + after.height + PLACE_GAP / 3 - u.box.y) : 0;
    if (!dx && !dy) continue;
    for (const m of u.members) if (!(m.type === "text" && (m as El & Loose).containerId)) updates.push({ id: m.id, dx, dy });
  }
  void c;
  return updates;
}

/** Excalidraw's own selection ids, widened to whole units by collectUnits. */
export async function autoLayout(
  scene: readonly El[],
  st: AppState,
  p: { ids?: string[]; direction?: LayoutDirection; algorithm?: LayoutAlgorithm; spacing?: number; routing?: Routing; onlyIfBetter?: boolean; makeRoom?: boolean },
): Promise<{ changed: El[]; added: El[]; result: Loose }> {
  const c = collectUnits(scene, p.ids);
  const { live, map, zones, zoneIds, owner, edges } = c;
  if (c.units.length < 2 && !zones.length) throw new Error("nothing to lay out: need at least two shapes, icons or groups");
  // The drawing's own direction and order: ELK keeps the input order, so the result looks like it.
  const unitBoxes = new Map(c.units.map((u) => [u.id, u.box]));
  const inferred = p.direction ?? inferDirection(unitBoxes, edges);
  const units = byReadingOrder(c.units, inferred ?? "right");
  const font = st.currentItemFontFamily as number;
  const startBox = boundsOf([...units.flatMap((u) => u.members), ...zones]);
  const zoneParent = (z: El) => {
    const pz = zoneOf(z);
    return pz && zoneIds.has(pz) ? pz : undefined;
  };
  const best = await layoutBest(
    {
      nodes: units.map((u) => ({ id: u.id, width: u.box.width, height: u.box.height, zone: u.zone })),
      zones: zones.map((z) => {
        const title = zoneTitleOf(z, map) as (El & { text: string }) | undefined;
        // The title as drawn (its own font and size), not re-measured in the drawing's font.
        const size = title ? { titleHeight: title.height + ZONE_TITLE_Y + 4, minWidth: title.width + ZONE_TITLE_X * 2 + 16 } : zoneTitleSize(undefined, font);
        return { id: z.id, parent: zoneParent(z), ...size };
      }),
      edges: edges.map((e) => {
        const label = boundTextOf(e.arrow, map);
        return { id: e.id, from: e.from, to: e.to, label: label ? { width: label.width + 8, height: label.height + 4 } : undefined };
      }),
      // Only a direction the drawing clearly has; otherwise layoutBest also tries the other one.
      direction: inferred,
      algorithm: p.algorithm,
      spacing: p.spacing,
    },
    // A re-layout of existing work is worth a bit more search than a fresh build: all variants.
    { maxVariants: VARIANTS.length },
  );
  // Never replace a drawing with a layout that measures worse (the user asked for tidier, not different).
  const before = p.onlyIfBetter ? currentScore(c) : undefined;
  if (before !== undefined && best.quality.score >= before - Math.max(5, before * 0.05)) {
    return { changed: [], added: [], result: { nodes: units.length, zones: zones.length, edges: edges.length, unchanged: true, scoreBefore: before, scoreLayout: best.quality.score, quality: qualitySummary(best) } };
  }
  const layout = translateLayout(best.layout, { x: startBox.x, y: startBox.y });
  const tidied = new Map(translateRoutes(best.routes, layout.bounds.x - best.layout.bounds.x, layout.bounds.y - best.layout.bounds.y).map((r) => [r.id, r]));

  // Move units and zones.
  const updates: Loose[] = [];
  for (const u of units) {
    const nb = layout.nodes.get(u.id)!;
    const dx = nb.x - u.box.x;
    const dy = nb.y - u.box.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    for (const m of u.members) if (!(m.type === "text" && (m as El & Loose).containerId)) updates.push({ id: m.id, dx, dy });
  }
  for (const z of zones) {
    const nb = layout.zones.get(z.id)!;
    updates.push({ id: z.id, x: nb.x, y: nb.y, width: nb.width, height: nb.height });
    const title = zoneTitleOf(z, map);
    if (title) updates.push({ id: title.id, x: nb.x + ZONE_TITLE_X, y: nb.y + ZONE_TITLE_Y });
  }
  // A re-laid-out selection that grew pushes the shapes around it away instead of covering them.
  if (p.ids?.length && p.makeRoom !== false) {
    const scopeIds = new Set([...units.flatMap((u) => u.members.map((m) => m.id)), ...zones.map((z) => z.id)]);
    updates.push(...makeRoom(c, live, scopeIds, startBox, layout.bounds));
  }
  const r = applyUpdates(updates, live, st);

  // Arrows: change routing if asked; elbow arrows between a unit's main elements follow ELK's route.
  const after: ElMap = new Map(live.map((e) => [e.id, e]));
  for (const c of [...r.changed, ...r.added]) after.set(c.id, c);
  const changed = new Map(r.changed.map((c) => [c.id, c]));
  for (const e of edges) {
    let arrow = after.get(e.id)!;
    // Arrows that go around shapes keep doing so on the new layout (unless a routing is asked for).
    if (arrow.customData?.mydrawAvoid && p.routing === undefined) {
      for (const x of rerouteAround(arrow, after)) {
        after.set(x.id, x);
        changed.set(x.id, x);
      }
      continue;
    }
    const want = p.routing ?? routingOf(arrow);
    const a = after.get((arrow as El & { startBinding: { elementId: string } }).startBinding.elementId)!;
    const b = after.get((arrow as El & { endBinding: { elementId: string } }).endBinding.elementId)!;
    const given = layout.orthogonal && want === "elbow" && a.id === unitMain(units, e.from) && b.id === unitMain(units, e.to) ? tidied.get(e.id) : undefined;
    const route = routeBetween(a, b, want, given?.points);
    const elbowed = want === "elbow" && arrow.type === "arrow";
    const data = { ...(arrow.customData ?? {}) };
    delete data.mydrawAvoid;
    if (want === "curved" || (want === "elbow" && !elbowed)) data.mydrawRouting = want;
    else delete data.mydrawRouting;
    arrow = newElementWith(arrow, {
      ...arrowShape(route),
      ...bindingsFor(route, a, b, elbowed),
      // A fresh route: Excalidraw's fixed segments of the old one would no longer match it.
      ...(elbowed ? { fixedSegments: null, startIsSpecial: null, endIsSpecial: null } : {}),
      elbowed,
      roundness: want === "curved" ? { type: 2 } : want === "elbow" ? null : arrow.roundness,
      customData: Object.keys(data).length ? data : undefined,
    } as never);
    after.set(arrow.id, arrow);
    changed.set(arrow.id, arrow);
    // Re-centre the label on the route just applied (reroute() would compute a different one).
    const label = boundTextOf(arrow, after);
    if (label) {
      const at = given?.label?.center;
      const mid = at && distToPolyline(at, route) <= labelOffsetLimit(label.width) ? at : labelPoint(route);
      changed.set(label.id, newElementWith(label, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 }));
    }
  }
  const bounds = boundsOf(listable([...after.values()]).filter((e) => owner.has(e.id) || zoneIds.has(e.id)));

  // An existing legend follows the diagram: bottom-right corner, below it (where add_legend puts one).
  let legends = 0;
  if (!p.ids?.length) {
    const byLegend = new Map<string, El[]>();
    for (const el of after.values()) {
      if (el.isDeleted || !el.customData?.mydrawLegend) continue;
      const g = el.groupIds.at(-1) ?? el.id;
      byLegend.set(g, [...(byLegend.get(g) ?? []), el]);
    }
    for (const members of byLegend.values()) {
      const box = boundsOf(members);
      const dx = bounds.x + bounds.width - box.width - box.x;
      const dy = bounds.y + bounds.height + 40 - box.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      for (const m of members) changed.set(m.id, newElementWith(changed.get(m.id) ?? m, { x: m.x + dx, y: m.y + dy }));
      legends++;
    }
  }
  return {
    changed: [...changed.values()],
    added: r.added,
    result: { nodes: units.length, zones: zones.length, edges: edges.length, bounds, direction: inferred ?? (best.variant === "other-direction" ? "down" : "right"), legendsMoved: legends || undefined, ...(before !== undefined ? { scoreBefore: before } : {}), quality: qualitySummary(best) },
  };
}

/**
 * Tidy without re-laying out (the "Tidy" command, MCP `tidy`): the arrangement stays; rows and
 * columns that nearly line up are lined up, nearly even gaps evened, overlapping nodes pushed apart,
 * zones grown to fit, then arrows re-routed between their (possibly moved) ends. Applied only when
 * it measures at least as clean as before (fixing overlaps always counts). One commit.
 */
export function tidyDrawing(scene: readonly El[], st: AppState, p: { ids?: string[] } = {}): { changed: El[]; added: El[]; result: Loose } {
  const c = collectUnits(scene, p.ids);
  const { live, map, units, zones, zoneIds } = c;
  if (units.length < 2 && !zones.length) throw new Error("nothing to tidy: need at least two shapes, icons or groups");
  const zoneParent = (z: El) => {
    const pz = zoneOf(z);
    return pz && zoneIds.has(pz) ? pz : undefined;
  };
  const t = tidyLayout(
    units.map((u) => ({ id: u.id, box: u.box, zone: u.zone })),
    zones.map((z) => {
      const title = zoneTitleOf(z, map);
      return { id: z.id, box: boxOf(z), parent: zoneParent(z), titleRoom: title ? title.height + ZONE_TITLE_Y + 12 : 40 };
    }),
  );
  const before = currentScore(c);
  const updates: Loose[] = [];
  for (const u of units) {
    const m = t.moves.get(u.id);
    if (!m) continue;
    for (const el of u.members) if (!(el.type === "text" && (el as El & Loose).containerId)) updates.push({ id: el.id, dx: m.dx, dy: m.dy });
  }
  for (const z of zones) {
    const nb = t.zones.get(z.id);
    if (!nb) continue;
    // Zones are moved by box (applyUpdates would carry their contents along with a dx/dy).
    updates.push({ id: z.id, x: nb.x, y: nb.y, width: nb.width, height: nb.height });
    const title = zoneTitleOf(z, map);
    if (title) updates.push({ id: title.id, x: nb.x + ZONE_TITLE_X, y: nb.y + ZONE_TITLE_Y });
  }
  const stats = t.stats;
  const summary = { nodes: units.length, zones: zones.length, ...stats };
  if (!updates.length) return { changed: [], added: [], result: { ...summary, unchanged: true, scoreBefore: before } };
  const r = applyUpdates(updates, live, st);
  const after = collectUnits(
    live.map((e) => r.changed.find((x) => x.id === e.id) ?? e),
    p.ids,
  );
  const score = currentScore(after);
  if (score > before + 1 && !stats.overlaps) {
    return { changed: [], added: [], result: { ...summary, unchanged: true, scoreBefore: before, scoreTidied: score } };
  }
  return { changed: r.changed, added: r.added, result: { ...summary, scoreBefore: before, score } };
}

function unitMain(units: Unit[], id: string): string | null {
  const u = units.find((x) => x.id === id);
  return u?.main?.id ?? null;
}

function zoneIn(el: El, zoneIds: Set<string>): string | undefined {
  const z = zoneOf(el);
  return z && zoneIds.has(z) ? z : undefined;
}

function isInside(el: El, zoneId: string, map: ElMap): boolean {
  const seen = new Set<string>();
  for (let z = zoneOf(el); z && !seen.has(z); z = map.get(z) ? zoneOf(map.get(z)!) : null) {
    if (z === zoneId) return true;
    seen.add(z);
  }
  return false;
}
