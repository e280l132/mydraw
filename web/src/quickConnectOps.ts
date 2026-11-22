// Quick connect operations: add a connected copy of a shape (or a stencil icon node) beside it,
// joined by a bound elbow arrow, as ONE undo step. The UI is QuickConnect.tsx; placement is the
// pure shared/quickConnect.ts. (Not "quickConnect.ts": on a case-insensitive disk "./QuickConnect"
// would resolve to it instead of the component.)
import { getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Box } from "../../shared/geometry";
import type { LibraryItem } from "../../shared/library";
import { growToContain, quickConnectBox, type QuickSide } from "../../shared/quickConnect";
import { loadIconImage, makeIconNode } from "./agent/diagram";
import {
  boundTextOf,
  boxOf,
  buildElements,
  iconNodeOf,
  isIconNode,
  isLinear,
  isZone,
  randomId,
  zoneOf,
  zoneTitleOf,
  type El,
  type ElMap,
} from "./agent/sceneOps";
import { cloneForInsert } from "./library/stencilContent";
import { elementAt } from "./library/pickColor";
import { commitElements } from "./uiActions";

type Loose = Record<string, unknown>;

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
/** Room kept between a grown zone/frame and the new node (top: below the zone title). */
const CONTAINER_PAD = 24;

const liveMap = (els: readonly El[]): ElMap => new Map(els.filter((e) => !e.isDeleted).map((e) => [e.id, e]));

/** Can quick connect start from this element? Shapes and icon nodes; not zones, locked or legend elements. */
export function isQuickSource(el: El | undefined | null): el is El {
  if (!el || el.isDeleted || el.locked) return false;
  if (!SHAPES.has(el.type) || isZone(el) || el.customData?.mydrawLegend) return false;
  return true;
}

/** The element to quick-connect from for a hovered element (icon image/caption -> its node), or null. */
export function quickSourceFor(el: El | null, map: ElMap): El | null {
  if (!el) return null;
  const node = el.type === "image" || el.type === "text" ? iconNodeOf(el, map) : el;
  return isQuickSource(node) ? node : null;
}

/**
 * The shape under a scene point that quick connect works on. Uses the eyedropper's hit test (topmost
 * element); where that finds nothing (or only a zone, frame or arrow), the inside of a hollow shape
 * counts too, so handles show while the pointer is anywhere over the shape.
 */
export function quickSourceAt(api: ExcalidrawImperativeAPI, x: number, y: number): El | null {
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const hit = elementAt(api, x, y);
  const direct = quickSourceFor(hit, map);
  if (direct) return direct;
  if (hit && !(isZone(hit) || hit.type === "frame" || hit.type === "magicframe" || isLinear(hit))) return null;
  for (let i = scene.length - 1; i >= 0; i--) {
    const el = scene[i];
    if (!isQuickSource(el)) continue;
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) return el;
  }
  return null;
}

/** The source and everything that belongs to it (bound label; an icon node's image and caption). */
function membersOf(node: El, map: ElMap): El[] {
  const out = new Map<string, El>([[node.id, node]]);
  const label = boundTextOf(node, map);
  if (label) out.set(label.id, label);
  const g = node.groupIds[0];
  if (isIconNode(node) && g) for (const m of map.values()) if (m.groupIds[0] === g) out.set(m.id, m);
  return [...out.values()];
}

/** Keep our own markers (node kind, stencil, zone, routing kind) but not user properties or legend flags. */
function copyCustomData(data: Loose | undefined): Loose | undefined {
  if (!data) return undefined;
  const out = Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("mydraw") && k !== "mydrawLegend"));
  return Object.keys(out).length ? out : undefined;
}

/** Zones (innermost first) that contain `el`. */
function zoneChain(el: El, map: ElMap): El[] {
  const out: El[] = [];
  const seen = new Set<string>();
  let z = zoneOf(el);
  while (z && !seen.has(z)) {
    seen.add(z);
    const zone = map.get(z);
    if (!zone) break;
    out.push(zone);
    z = zoneOf(zone);
  }
  return out;
}

/** Boxes the new node must keep clear of: everything except arrows, labels and the source's own zones/frame. */
function obstacleBoxes(source: El, scene: readonly El[], map: ElMap): Box[] {
  const ancestors = new Set(zoneChain(source, map).map((z) => z.id));
  if (source.frameId) ancestors.add(source.frameId);
  const boxes: Box[] = [];
  for (const el of scene) {
    if (el.isDeleted || ancestors.has(el.id) || isLinear(el) || el.type === "freedraw" || el.type === "selection") continue;
    if (el.type === "text" && (el as El & { containerId?: string | null }).containerId) continue;
    const [x1, y1, x2, y2] = getCommonBounds([el]);
    boxes.push({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 });
  }
  return boxes;
}

/**
 * Zones and frame of the source, grown where needed so the new node (`box`) sits inside them.
 * A zone's title moves with its top-left corner.
 */
function growContainers(source: El, box: Box, map: ElMap): El[] {
  const changed: El[] = [];
  let inner = box;
  for (const zone of zoneChain(source, map)) {
    const title = zoneTitleOf(zone, map);
    const top = title ? Math.max(CONTAINER_PAD, title.y + title.height - zone.y + 12) : CONTAINER_PAD;
    const grown = growToContain(boxOf(zone), inner, { top, right: CONTAINER_PAD, bottom: CONTAINER_PAD, left: CONTAINER_PAD });
    if (grown) {
      changed.push(newElementWith(zone, grown));
      if (title) changed.push(newElementWith(title, { x: title.x + grown.x - zone.x, y: title.y + grown.y - zone.y }));
    }
    inner = grown ?? boxOf(zone);
  }
  const frame = source.frameId ? map.get(source.frameId) : undefined;
  if (frame) {
    const grown = growToContain(boxOf(frame), inner, { top: CONTAINER_PAD, right: CONTAINER_PAD, bottom: CONTAINER_PAD, left: CONTAINER_PAD });
    if (grown) changed.push(newElementWith(frame, grown));
  }
  return changed;
}

/**
 * Place `els` (a new node whose main element is `node`) on `side` of `source`, connect them with a
 * bound arrow and commit everything as one undo step, selecting the new node. Returns the node id.
 */
function attach(api: ExcalidrawImperativeAPI, source: El, side: QuickSide, els: El[], node: El): string {
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const st = api.getAppState();
  const box = quickConnectBox({
    source: boxOf(source),
    side,
    size: { width: node.width, height: node.height },
    obstacles: obstacleBoxes(source, scene, map),
  });
  const dx = box.x - node.x;
  const dy = box.y - node.y;
  let fresh = els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy, frameId: source.frameId ?? null }) as El);

  // The arrow (same routing default as build_diagram: elbow, which is straight when in line).
  const arrowId = randomId();
  const r = buildElements([{ type: "arrow", id: arrowId, from: source.id, to: node.id, routing: "elbow" }], [...scene, ...fresh], st);
  const freshIds = new Set(fresh.map((e) => e.id));
  const changed = r.changed.filter((e) => !freshIds.has(e.id));
  for (const c of r.changed) if (freshIds.has(c.id)) fresh = fresh.map((e) => (e.id === c.id ? c : e));
  const arrows = r.added.map((e) => ({ ...e, frameId: source.frameId ?? null }) as El);

  changed.push(...growContainers(source, box, map));

  const group = isIconNode(node) ? node.groupIds[0] : undefined;
  commitElements(api, changed, [...fresh, ...arrows], {
    selectedElementIds: Object.fromEntries(fresh.filter((e) => !(e.type === "text" && (e as El & Loose).containerId && !group)).map((e) => [e.id, true])),
    selectedGroupIds: group ? { [group]: true } : {},
    editingGroupId: null,
  } as Partial<AppState>);
  return node.id;
}

/** Add a copy of `sourceId` (same type, size, style and label) on `side`, connected by an arrow. */
export function addConnectedCopy(api: ExcalidrawImperativeAPI, sourceId: string, side: QuickSide): string | null {
  const map = liveMap(api.getSceneElements());
  const source = map.get(sourceId);
  if (!isQuickSource(source)) return null;
  const members = membersOf(source, map).map(
    (m) =>
      ({
        ...m,
        // An icon node keeps its own group (container + image + caption); a shape stands alone.
        groupIds: isIconNode(source) ? m.groupIds.slice(0, 1) : [],
        link: null,
        customData: copyCustomData(m.customData as Loose | undefined),
      }) as El,
  );
  const copies = cloneForInsert(members);
  const node = copies[members.findIndex((m) => m.id === source.id)];
  return attach(api, source, side, copies, node);
}

/** Add `item` (an SVG/PNG stencil) as an icon node on `side` of `sourceId`, connected by an arrow. */
export async function addConnectedStencil(api: ExcalidrawImperativeAPI, sourceId: string, side: QuickSide, item: LibraryItem): Promise<string | null> {
  if (item.kind !== "svg" && item.kind !== "png") throw new Error(`“${item.name}” is not an icon`);
  const st = api.getAppState();
  const opts = { fontFamily: st.currentItemFontFamily as number, strokeColor: st.currentItemStrokeColor };
  const { image, files } = await loadIconImage(item, opts);
  // The scene may have changed while the icon loaded.
  const source = liveMap(api.getSceneElements()).get(sourceId);
  if (!isQuickSource(source)) return null;
  const zone = zoneOf(source);
  const els = makeIconNode({
    image,
    caption: item.name,
    ...opts,
    x: 0,
    y: 0,
    customData: zone ? { mydrawZoneId: zone } : undefined,
    stencil: { id: item.id, name: item.name },
  });
  const id = attach(api, source, side, els, els[0]);
  // After updateScene: Excalidraw loads images for files added while an element uses them.
  api.addFiles(files);
  return id;
}
