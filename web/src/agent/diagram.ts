// Diagram generation for agent commands: icon nodes, zones, ELK-laid-out diagrams (build_diagram,
// mermaid_to_scene, apply_template), legends and auto layout of existing elements. Like sceneOps,
// nothing here calls updateScene: callers commit the returned elements as one undo step.
import { convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import { zoneColors, zoneDepths, type DiagramNode, type DiagramSpec } from "../../../shared/diagram";
import type { Box, Point } from "../../../shared/geometry";
import { layoutGraph, translateLayout, type LayoutAlgorithm, type LayoutDirection, type LayoutResult } from "../../../shared/layout";
import type { LibraryItem } from "../../../shared/library";
import { resolveColor } from "../../../shared/palettes";
import { ELBOW_GAP, inset, tidyRoute, type Routing } from "../../../shared/routing";
import { isRecolorableIcon, recoloredIcon } from "../library/iconColor";
import { loadStencil } from "../library/stencilContent";
import { trueColorFile } from "../library/trueColor";
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
} from "./sceneOps";

type Loose = Record<string, unknown>;

export const NODE_FONT_SIZE = 16;
export const CAPTION_FONT_SIZE = 14;
export const ZONE_FONT_SIZE = 16;
export const EDGE_FONT_SIZE = 14;
const TITLE_FONT_SIZE = 28;
const DEFAULT_ICON_SIZE = 64;
/** Gap between a new diagram and existing content. */
const PLACE_GAP = 120;
const ZONE_TITLE_X = 14;
const ZONE_TITLE_Y = 10;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// ---------- icon nodes ----------

/** Load a stencil icon as an image element (at 0,0) and its file, sized and optionally recolored. */
export async function loadIconImage(
  item: LibraryItem,
  opts: { size?: number; color?: string; fontFamily: number; strokeColor: string },
): Promise<{ image: ExcalidrawImageElement; files: BinaryFileData[] }> {
  if (item.kind !== "svg" && item.kind !== "png") throw new Error(`"${item.name}" is not an icon`);
  const content = await loadStencil(item, { label: false, fontFamily: opts.fontFamily, strokeColor: opts.strokeColor });
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
  const { width, height } = iconNodeSize(o.image.width, o.image.height, cap);
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
                verticalAlign: "bottom",
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
    y: o.y + 4,
    groupIds: [g],
    frameId: null,
  } as El;
  const out: El[] = [container, image];
  const text = made.find((e) => e.type === "text");
  if (text) out.push({ ...text, groupIds: [g] } as El);
  return out;
}

// ---------- zones ----------

export interface ZoneOptions {
  id?: string;
  label?: string | null;
  box: Box;
  stroke: string;
  fill: string;
  style?: "solid" | "dashed" | "dotted";
  strokeWidth?: number;
  roughness: number;
  fontFamily: number;
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
        strokeStyle: o.style ?? "solid",
        roughness: o.roughness,
        roundness: { type: 3 },
      } as never,
    ],
    { regenerateIds: false },
  );
  const data: Loose = { ...(o.customData ?? {}), mydrawZone: true };
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
        fontSize: ZONE_FONT_SIZE,
        fontFamily: o.fontFamily as never,
        strokeColor: o.stroke,
      } as never,
    ], { regenerateIds: false });
    out.push({ ...title, locked, groupIds: [g], customData: { mydrawZoneTitle: id } } as El);
  }
  return out;
}

export function zoneTitleSize(label: string | undefined, fontFamily: number): { titleHeight: number; minWidth: number } {
  if (!label) return { titleHeight: 4, minWidth: 80 };
  const m = measureText(label, ZONE_FONT_SIZE, fontFamily);
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
}

function arrowheads(arrow: "end" | "both" | "none" | undefined): Loose {
  return {
    startArrowhead: arrow === "both" ? "arrow" : null,
    endArrowhead: arrow === "none" ? null : "arrow",
  };
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
  const font = st.currentItemFontFamily as number;
  const ink = st.currentItemStrokeColor;
  const roughness = st.currentItemRoughness;
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

  // Measure nodes; load icons.
  const plans = new Map<string, NodePlan>();
  for (const n of spec.nodes) {
    const label = n.label ?? n.id;
    const item = n.icon ? items[n.icon] : undefined;
    if (n.icon && !item) warnings.push(`no icon found for "${n.icon}" (node ${n.id}); drew a ${n.shape ?? "rectangle"} instead`);
    if (item) {
      try {
        const icon = await loadIconImage(item, { size: spec.iconSize ?? DEFAULT_ICON_SIZE, color: n.iconColor, fontFamily: font, strokeColor: ink });
        const cap = label ? measureText(label, CAPTION_FONT_SIZE, font) : null;
        const size = iconNodeSize(icon.image.width, icon.image.height, cap);
        plans.set(n.id, { node: n, ...size, icon: { ...icon, item } });
        continue;
      } catch (e) {
        warnings.push(`icon "${item.name}" for node ${n.id} failed (${e instanceof Error ? e.message : e}); drew a shape instead`);
      }
    }
    const m = measureText(label, NODE_FONT_SIZE, font);
    const shape = n.shape ?? "rectangle";
    const k = shape === "diamond" ? 1.7 : shape === "ellipse" ? 1.35 : 1;
    plans.set(n.id, {
      node: n,
      width: n.width ?? Math.max(120, (m.width + 36) * k),
      height: n.height ?? Math.max(shape === "diamond" ? 80 : 60, (m.height + 26) * k),
    });
  }

  const edges = (spec.edges ?? []).filter((e) => {
    if (e.from !== e.to) return true;
    warnings.push(`edge ${e.id} from "${e.from}" to itself was skipped`);
    return false;
  });
  const zoneSizes = new Map((spec.zones ?? []).map((z) => [z.id, zoneTitleSize(z.label, font)]));
  let layout: LayoutResult = await layoutGraph({
    nodes: spec.nodes.map((n) => ({ id: n.id, width: plans.get(n.id)!.width, height: plans.get(n.id)!.height, zone: n.zone })),
    zones: (spec.zones ?? []).map((z) => ({ id: z.id, parent: z.parent, ...zoneSizes.get(z.id)! })),
    edges: edges.map((e) => {
      const m = e.label ? measureText(e.label, EDGE_FONT_SIZE, font) : null;
      return { id: e.id!, from: e.from, to: e.to, label: m ? { width: m.width + 8, height: m.height + 4 } : undefined };
    }),
    direction: spec.direction,
    algorithm: spec.algorithm,
    spacing: spec.spacing,
  });

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
      { type: "text", x: origin.x, y: origin.y, text: spec.title, fontSize: TITLE_FONT_SIZE, fontFamily: font as never, strokeColor: ink },
    ]);
    added.push(t);
    titleId = t.id;
    origin = { x: origin.x, y: origin.y + t.height + 24 };
  }
  layout = translateLayout(layout, origin);

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
      strokeWidth: depths.get(z.id) === 0 ? 2 : 1,
      roughness,
      fontFamily: font,
      locked: z.locked,
      parent: z.parent,
    });
    added.push(...els);
    byId.set(z.id, els[0]);
  }

  // Nodes (created now so arrows can bind to them; added after the arrows so lines go underneath).
  const nodeEls: El[] = [];
  for (const n of spec.nodes) {
    const plan = plans.get(n.id)!;
    const box = layout.nodes.get(n.id)!;
    const data: Loose = { ...(n.data ?? {}) };
    if (n.kind) data.mydrawKind = n.kind;
    if (n.zone) data.mydrawZoneId = n.zone;
    if (plan.icon) {
      const els = makeIconNode({
        id: n.id,
        image: plan.icon.image,
        caption: n.label ?? n.id,
        fontFamily: font,
        strokeColor: n.color ?? ink,
        x: box.x,
        y: box.y,
        customData: data,
        stencil: { id: plan.icon.item.id, name: plan.icon.item.name },
      });
      if (n.link) els[0] = { ...els[0], link: n.link } as El;
      nodeEls.push(...els);
      files.push(...plan.icon.files);
      byId.set(n.id, els[0]);
    } else {
      const shape = n.shape ?? "rectangle";
      const made: El[] = convertToExcalidrawElements(
        [
          {
            type: shape,
            id: n.id,
            ...box,
            strokeColor: n.color ?? ink,
            backgroundColor: n.fill ?? "#ffffff",
            fillStyle: "solid",
            strokeWidth: st.currentItemStrokeWidth,
            roughness,
            roundness: shape === "ellipse" ? null : { type: 3 },
            link: n.link ?? null,
            label: { text: n.label ?? n.id, fontSize: NODE_FONT_SIZE, fontFamily: font as never, strokeColor: n.color ?? ink },
          } as never,
        ],
        { regenerateIds: false },
      );
      made[0] = { ...made[0], customData: Object.keys(data).length ? data : undefined } as El;
      nodeEls.push(...made);
      byId.set(n.id, made[0]);
    }
  }

  // Arrows.
  const arrowEls: El[] = [];
  const boundTo = new Map<string, { id: string; type: "arrow" }[]>();
  for (const e of edges) {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    const routing: Routing = e.routing ?? spec.routing ?? "elbow";
    const given = layout.orthogonal && routing === "elbow" ? layout.edges.get(e.id!) : undefined;
    const sk: Loose = {
      type: "arrow",
      id: e.id,
      strokeColor: e.color ?? ink,
      strokeWidth: e.width ?? 2,
      strokeStyle: e.style ?? "solid",
      roughness,
      ...arrowheads(e.arrow),
      ...(e.label ? { label: { text: e.label, fontSize: EDGE_FONT_SIZE, fontFamily: font, strokeColor: e.color ?? ink } } : {}),
      ...(e.kind ? { customData: { mydrawKind: e.kind } } : {}),
    };
    arrowEls.push(...connectorElements(sk, a, b, routing, given ? inset(tidyRoute(given, 20 + ELBOW_GAP), ELBOW_GAP) : undefined));
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
export async function autoLayout(
  scene: readonly El[],
  st: AppState,
  p: { ids?: string[]; direction?: LayoutDirection; algorithm?: LayoutAlgorithm; spacing?: number; routing?: Routing },
): Promise<{ changed: El[]; added: El[]; result: Loose }> {
  const live = scene.filter((e) => !e.isDeleted);
  const map: ElMap = new Map(live.map((e) => [e.id, e]));
  let scope = live;
  if (p.ids?.length) {
    const want = new Set<string>();
    for (const id of p.ids) {
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
  for (const el of scope) {
    if (skip(el)) continue;
    const g = el.groupIds.at(-1);
    if (g) byGroup.set(g, [...(byGroup.get(g) ?? []), el]);
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
  if (units.length < 2 && !zones.length) throw new Error("nothing to lay out: need at least two shapes, icons or groups");

  // Edges: arrows between different units.
  const arrows = live.filter((e) => e.type === "arrow" || e.type === "line");
  const edges: { id: string; from: string; to: string; arrow: El }[] = [];
  for (const a of arrows) {
    const e = a as El & { startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };
    const from = e.startBinding && owner.get(e.startBinding.elementId);
    const to = e.endBinding && owner.get(e.endBinding.elementId);
    if (!from || !to || from === to) continue;
    edges.push({ id: a.id, from, to, arrow: a });
  }

  const font = st.currentItemFontFamily as number;
  const startBox = boundsOf([...units.flatMap((u) => u.members), ...zones]);
  const zoneParent = (z: El) => {
    const pz = zoneOf(z);
    return pz && zoneIds.has(pz) ? pz : undefined;
  };
  const layout = translateLayout(
    await layoutGraph({
      nodes: units.map((u) => ({ id: u.id, width: u.box.width, height: u.box.height, zone: u.zone })),
      zones: zones.map((z) => {
        const title = zoneTitleOf(z, map) as (El & { text: string }) | undefined;
        return { id: z.id, parent: zoneParent(z), ...zoneTitleSize(title?.text, font) };
      }),
      edges: edges.map((e) => {
        const label = boundTextOf(e.arrow, map);
        return { id: e.id, from: e.from, to: e.to, label: label ? { width: label.width + 8, height: label.height + 4 } : undefined };
      }),
      direction: p.direction,
      algorithm: p.algorithm,
      spacing: p.spacing,
    }),
    { x: startBox.x, y: startBox.y },
  );

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
  const r = applyUpdates(updates, live, st);

  // Arrows: change routing if asked; elbow arrows between a unit's main elements follow ELK's route.
  const after: ElMap = new Map(live.map((e) => [e.id, e]));
  for (const c of [...r.changed, ...r.added]) after.set(c.id, c);
  const changed = new Map(r.changed.map((c) => [c.id, c]));
  for (const e of edges) {
    let arrow = after.get(e.id)!;
    const want = p.routing ?? routingOf(arrow);
    const a = after.get((arrow as El & { startBinding: { elementId: string } }).startBinding.elementId)!;
    const b = after.get((arrow as El & { endBinding: { elementId: string } }).endBinding.elementId)!;
    const given = layout.orthogonal && want === "elbow" && a.id === unitMain(units, e.from) && b.id === unitMain(units, e.to) ? layout.edges.get(e.id) : undefined;
    const route = routeBetween(a, b, want, given ? inset(tidyRoute(given, 20 + ELBOW_GAP), ELBOW_GAP) : undefined);
    const elbowed = want === "elbow" && arrow.type === "arrow";
    const data = { ...(arrow.customData ?? {}) };
    if (want === "curved" || (want === "elbow" && !elbowed)) data.mydrawRouting = want;
    else delete data.mydrawRouting;
    arrow = newElementWith(arrow, {
      ...arrowShape(route),
      ...bindingsFor(route, a, b, elbowed),
      elbowed,
      roundness: want === "curved" ? { type: 2 } : want === "elbow" ? null : arrow.roundness,
      customData: Object.keys(data).length ? data : undefined,
    } as never);
    after.set(arrow.id, arrow);
    changed.set(arrow.id, arrow);
    // Re-centre the label on the route just applied (reroute() would compute a different one).
    const label = boundTextOf(arrow, after);
    if (label) {
      const mid = labelPoint(route);
      changed.set(label.id, newElementWith(label, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 }));
    }
  }
  return {
    changed: [...changed.values()],
    added: r.added,
    result: { nodes: units.length, zones: zones.length, edges: edges.length, bounds: boundsOf(listable([...after.values()]).filter((e) => owner.has(e.id) || zoneIds.has(e.id))) },
  };
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
