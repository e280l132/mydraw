// Quick connect operations: add a copy of a unit (a shape, an icon node, a stencil from the panel,
// a group) beside it, joined by a bound elbow arrow or not, as ONE undo step. The UI is
// QuickConnect.tsx; placement and anchors are the pure shared/quickConnect.ts. (Not
// "quickConnect.ts": on a case-insensitive disk "./QuickConnect" would resolve to it instead of the
// component.)
import type { IconSketch } from "../../shared/iconSketch";
import { captionFontId, type CaptionPrefs } from "./library/captionFont";
import { getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Box } from "../../shared/geometry";
import type { LibraryItem } from "../../shared/library";
import { facingSide, growToContain, OPPOSITE_SIDE, pickAnchor, pickPrimary, quickConnectBox, QUICK_COPY_GAP, QUICK_COPY_MARGIN, unionBox, type QuickSide } from "../../shared/quickConnect";
import { loadIconImage, makeIconNode } from "./agent/diagram";
import {
  boxOf,
  buildElements,
  iconNodeOf,
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

/**
 * What quick connect starts from: one thing as the user sees it. A shape, an icon node, a stencil from
 * the Stencils panel (a bare image + free caption), or a whole group (the outermost one, which is what
 * a click selects).
 */
export interface QuickUnit {
  /** Id of the main element. Stable: any member of the unit maps to a unit with this id. */
  id: string;
  primary: El;
  /** Everything that gets copied, including text bound inside shapes. */
  members: El[];
  /** Bounds of the unit, in scene coordinates. */
  box: Box;
}

/** Can this element be (part of) a quick connect source? Not arrows, lines, freehand, frames, zones, legend. */
function startsUnit(el: El): boolean {
  if (el.isDeleted || isZone(el) || el.customData?.mydrawLegend) return false;
  return SHAPES.has(el.type) || el.type === "image" || el.type === "text";
}

/** The unit an element belongs to, or null when it isn't part of anything quick connect works on. */
export function unitFor(hit: El | null | undefined, map: ElMap, editingGroupId: string | null = null): QuickUnit | null {
  if (!hit || !startsUnit(hit)) return null;
  let base: El = hit;
  // Text inside a shape belongs to the shape; the pieces of an icon node belong to the node.
  const container = hit.type === "text" && (hit as El & { containerId?: string | null }).containerId ? map.get((hit as El & { containerId: string }).containerId) : undefined;
  if (container) base = container;
  if (!startsUnit(base)) return null;
  const node = base.type === "image" || base.type === "text" ? iconNodeOf(base, map) : undefined;
  if (node) base = node;
  // The outermost group, as a click selects it; inside a group the user entered, the level just below it.
  const levels = base.groupIds;
  const at = editingGroupId ? levels.indexOf(editingGroupId) : -1;
  const group = at >= 0 ? (at > 0 ? levels[at - 1] : undefined) : levels.at(-1);
  // A lone free text is not something to connect from (it has no shape).
  if (!group && base.type === "text" && !(base as El & { containerId?: string | null }).containerId) return null;

  const raw = group ? [...map.values()].filter((m) => m.groupIds.includes(group)) : [base];
  const ids = new Set(raw.map((m) => m.id));
  let members = [...raw];
  for (const m of map.values()) {
    if (m.type === "text" && !ids.has(m.id) && (m as El & { containerId?: string | null }).containerId && ids.has((m as El & { containerId: string }).containerId)) members.push(m);
  }
  // Arrows bound to something outside the unit would be copied loose (their bindings can't follow): leave them out.
  const inside = new Set(members.map((m) => m.id));
  members = members.filter((m) => {
    if (!isLinear(m)) return true;
    const b = m as El & { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
    return (!b.startBinding || inside.has(b.startBinding.elementId)) && (!b.endBinding || inside.has(b.endBinding.elementId));
  });
  if (members.some((m) => m.locked || isZone(m) || m.customData?.mydrawLegend || m.type === "frame" || m.type === "magicframe")) return null;

  const primary = pickPrimary(members);
  if (!primary) return null;
  const box = unionBox(
    members
      .filter((m) => !isLinear(m) && !(m.type === "text" && (m as El & { containerId?: string | null }).containerId))
      .map((m) => {
        const [x1, y1, x2, y2] = getCommonBounds([m]);
        return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
      }),
  );
  return box ? { id: primary.id, primary, members, box } : null;
}

/** The unit with this id (see `QuickUnit.id`), or null if it is gone or no longer usable. */
export function unitById(api: ExcalidrawImperativeAPI, id: string): QuickUnit | null {
  const map = liveMap(api.getSceneElements());
  return unitFor(map.get(id), map, api.getAppState().editingGroupId);
}

/** The one unit that is selected, or null when nothing, several things, or something else (an arrow, a zone) is selected. */
export function selectedUnit(api: ExcalidrawImperativeAPI): QuickUnit | null {
  const st = api.getAppState();
  const sel = st.selectedElementIds;
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  let found: QuickUnit | null = null;
  for (const el of scene) {
    if (!sel[el.id]) continue;
    const u = unitFor(el, map, st.editingGroupId);
    if (!u || (found && found.id !== u.id)) return null;
    found = u;
  }
  return found;
}

/**
 * The unit under a scene point. Uses the eyedropper's hit test (topmost element); where that finds
 * nothing (or only a zone, frame or arrow), the inside of a hollow shape counts too, so the pointer
 * can be anywhere over the shape.
 */
export function quickSourceAt(api: ExcalidrawImperativeAPI, x: number, y: number): QuickUnit | null {
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const editing = api.getAppState().editingGroupId;
  const hit = elementAt(api, x, y);
  const direct = unitFor(hit, map, editing);
  if (direct) return direct;
  if (hit && !(isZone(hit) || hit.type === "frame" || hit.type === "magicframe" || isLinear(hit))) return null;
  for (let i = scene.length - 1; i >= 0; i--) {
    const el = scene[i];
    if (!SHAPES.has(el.type) || el.isDeleted) continue;
    // The empty inside of a shape that holds other things (icons in a box) is not "the box": only
    // its outline and label are (the hit test above), so moving between the icons never picks it.
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height && !holdsOthers(el, scene)) {
      const u = unitFor(el, map, editing);
      if (u) return u;
    }
  }
  return null;
}

/** Does `shape` have other elements (not its own label, not arrows) drawn inside it? */
function holdsOthers(shape: El, scene: readonly El[]): boolean {
  return scene.some((e) => {
    if (e.id === shape.id || e.isDeleted || isLinear(e)) return false;
    if (e.type === "text" && (e as El & { containerId?: string | null }).containerId === shape.id) return false;
    return e.x >= shape.x && e.y >= shape.y && e.x + e.width <= shape.x + shape.width && e.y + e.height <= shape.y + shape.height;
  });
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

/**
 * Shapes, zones and frames drawn around the unit (their box contains it): the unit sits in them.
 * Innermost first.
 */
function containersOf(unit: QuickUnit, scene: readonly El[]): El[] {
  const own = new Set(unit.members.map((m) => m.id));
  const u = unit.box;
  const tol = 1;
  return scene
    .filter((el) => {
      if (el.isDeleted || own.has(el.id)) return false;
      if (!SHAPES.has(el.type) && el.type !== "frame" && el.type !== "magicframe") return false;
      return el.x <= u.x + tol && el.y <= u.y + tol && el.x + el.width >= u.x + u.width - tol && el.y + el.height >= u.y + u.height - tol && el.width * el.height > u.width * u.height;
    })
    .sort((a, b) => a.width * a.height - b.width * b.height);
}

/** Boxes the new node must keep clear of: everything except arrows, labels and what the source sits in (zones, frame, shapes around it). */
function obstacleBoxes(source: El, scene: readonly El[], map: ElMap, around: ReadonlySet<string> = new Set()): Box[] {
  const ancestors = new Set([...around, ...zoneChain(source, map).map((z) => z.id)]);
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
 * Place `els` (a new unit) on `side` of `unit`, optionally connect them with a bound arrow, and
 * commit everything as one undo step, selecting the new unit. Returns the new unit's id.
 */
function attach(api: ExcalidrawImperativeAPI, unit: QuickUnit, side: QuickSide, els: El[], connect: boolean): string {
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const st = api.getAppState();
  const [bx1, by1, bx2, by2] = getCommonBounds(els);
  // A shape (or zone, frame) drawn around the unit is where it lives, not something to avoid: the
  // copy stays inside it when there is room.
  const containers = containersOf(unit, scene);
  const box = quickConnectBox({
    source: unit.box,
    side,
    size: { width: bx2 - bx1, height: by2 - by1 },
    obstacles: obstacleBoxes(unit.primary, scene, map, new Set(containers.map((c) => c.id))),
    within: containers[0] ? boxOf(containers[0]) : undefined,
    // A plain copy sits close beside the original; a connected one leaves room for the arrow.
    ...(connect ? {} : { gap: QUICK_COPY_GAP, margin: QUICK_COPY_MARGIN, minGap: 12 }),
  });
  const dx = box.x - bx1;
  const dy = box.y - by1;
  const frameId = unit.primary.frameId ?? null;
  let fresh = els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy, frameId }) as El);

  const changed: El[] = [];
  let arrows: El[] = [];
  if (connect) {
    // The arrow runs between the facing sides' anchors (a stencil's caption hangs below its image).
    const from = pickAnchor(unit.members, side);
    const to = pickAnchor(fresh, OPPOSITE_SIDE[side]);
    if (!from || !to) throw new Error("there is nothing to connect");
    // Same routing default as build_diagram: elbow, which is straight when in line.
    const r = buildElements([{ type: "arrow", id: randomId(), from: from.id, to: to.id, routing: "elbow" }], [...scene, ...fresh], st);
    const freshIds = new Set(fresh.map((e) => e.id));
    changed.push(...r.changed.filter((e) => !freshIds.has(e.id)));
    for (const c of r.changed) if (freshIds.has(c.id)) fresh = fresh.map((e) => (e.id === c.id ? c : e));
    arrows = r.added.map((e) => ({ ...e, frameId }) as El);
  }

  changed.push(...growContainers(unit.primary, box, map));

  const primary = pickPrimary(fresh);
  if (!primary) throw new Error("there is nothing to add");
  const group = primary.groupIds.at(-1);
  commitElements(api, changed, [...fresh, ...arrows], {
    selectedElementIds: Object.fromEntries(fresh.filter((e) => !(e.type === "text" && (e as El & Loose).containerId && !group)).map((e) => [e.id, true])),
    selectedGroupIds: group ? { [group]: true } : {},
    editingGroupId: null,
  } as Partial<AppState>);
  return primary.id;
}

/**
 * Add a copy of the unit `unitId` (same type, size, style and label; a stencil with its caption; a
 * group as a group) on `side`. With `connect` (the default) an arrow joins them; without it the copy
 * just sits beside the original.
 */
export function addConnectedCopy(api: ExcalidrawImperativeAPI, unitId: string, side: QuickSide, opts: { connect?: boolean } = {}): string | null {
  const unit = unitById(api, unitId);
  if (!unit) return null;
  const members = unit.members.map((m) => ({ ...m, link: null, customData: copyCustomData(m.customData as Loose | undefined) }) as El);
  return attach(api, unit, side, cloneForInsert(members), opts.connect !== false);
}

/** Add `item` (an SVG/PNG stencil) as an icon node on `side` of `unitId`, connected by an arrow. */
export async function addConnectedStencil(
  api: ExcalidrawImperativeAPI,
  unitId: string,
  side: QuickSide,
  item: LibraryItem,
  sketch: IconSketch | null = null,
  captionPrefs: CaptionPrefs | null = null,
): Promise<string | null> {
  if (item.kind !== "svg" && item.kind !== "png") throw new Error(`“${item.name}” is not an icon`);
  const st = api.getAppState();
  const opts = { fontFamily: captionFontId(captionPrefs, !!sketch, st.currentItemFontFamily as number), strokeColor: st.currentItemStrokeColor };
  const { image, files } = await loadIconImage(item, { ...opts, sketch });
  // The scene may have changed while the icon loaded.
  const unit = unitById(api, unitId);
  if (!unit) return null;
  const zone = zoneOf(unit.primary);
  const els = makeIconNode({
    image,
    caption: item.name,
    ...opts,
    x: 0,
    y: 0,
    customData: zone ? { mydrawZoneId: zone } : undefined,
    stencil: { id: item.id, name: item.name },
  });
  const id = attach(api, unit, side, els, true);
  // After updateScene: Excalidraw loads images for files added while an element uses them.
  api.addFiles(files);
  return id;
}

/**
 * Connect the unit `fromId` (leaving from its `side`) to the existing unit `toId` with a bound elbow
 * arrow, arriving on the side of the target that faces the source. One undo step; the selection is
 * left alone so several connections can be made in a row. Returns the arrow id.
 */
export function connectUnits(api: ExcalidrawImperativeAPI, fromId: string, side: QuickSide, toId: string): string | null {
  const a = unitById(api, fromId);
  const b = unitById(api, toId);
  if (!a || !b || a.id === b.id) return null;
  const from = pickAnchor(a.members, side);
  const to = pickAnchor(b.members, facingSide(a.box, b.box));
  if (!from || !to) return null;
  const id = randomId();
  const r = buildElements([{ type: "arrow", id, from: from.id, to: to.id, routing: "elbow" }], api.getSceneElements(), api.getAppState());
  // Inside one frame the arrow belongs to it too; across frames it stays outside both.
  const frameId = a.primary.frameId && a.primary.frameId === b.primary.frameId ? a.primary.frameId : null;
  commitElements(api, r.changed, r.added.map((e) => ({ ...e, frameId }) as El));
  return id;
}
