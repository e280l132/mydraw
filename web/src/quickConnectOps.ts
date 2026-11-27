// Quick connect operations: add a copy of a unit (a shape, an icon node, a stencil from the panel,
// a group) beside it, joined by a bound elbow arrow or not, as ONE undo step. The UI is
// QuickConnect.tsx; placement and anchors are the pure shared/quickConnect.ts. (Not
// "quickConnect.ts": on a case-insensitive disk "./QuickConnect" would resolve to it instead of the
// component.)
import type { IconSketch } from "../../shared/iconSketch";
import { captionFontId, type CaptionPrefs } from "./library/captionFont";
import { CaptureUpdateAction, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Box } from "../../shared/geometry";
import type { LibraryItem } from "../../shared/library";
import { facingSide, growToContain, OPPOSITE_SIDE, pickPrimary, quickConnectBox, QUICK_COPY_GAP, QUICK_COPY_MARGIN, unionBox, type QuickSide } from "../../shared/quickConnect";
import { loadIconImage, makeIconNode, shapeImage } from "./agent/diagram";
import { LinkPlanner, linkArrow, loadLinkStyle, type LinkStyle } from "./linkOps";
import { nextLabel } from "../../shared/labelNumber";
import type { Point } from "../../shared/geometry";
import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import {
  boxOf,
  buildElements,
  iconNodeOf,
  isIconNode,
  relabel,
  remeasureText,
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

export interface AttachOptions {
  /** Centre of the new unit (dropped there by a drag); default: beside the source on `side`. */
  at?: Point;
  /** How the connecting arrow is drawn; default: the link style of ⌘-link mode (`mydraw.linkStyle`). */
  style?: LinkStyle;
}

/** What adding a unit beside another would do (nothing committed). */
export interface AttachPlan {
  /** Where the new unit goes. */
  box: Box;
  /** The new unit's elements, in place. */
  fresh: El[];
  /** The connecting arrow (empty without one). */
  arrows: El[];
  /** Existing elements that change: arrow bindings, zones and frames grown to hold the new unit. */
  changed: El[];
  /** The new unit's main element. */
  primary: El;
  /** The arrow's route (scene coordinates), for previews; null without an arrow. */
  route: Point[] | null;
}

/**
 * Plan placing `els` (a new unit) on `side` of `unit` (or centred on `opts.at`), optionally joined
 * to it by an arrow in the link style. `scene` may include elements not committed yet (earlier
 * units of the same step).
 */
export function planAttach(scene: readonly El[], st: AppState, unit: QuickUnit, side: QuickSide, els: El[], connect: boolean, opts: AttachOptions = {}): AttachPlan {
  const map = liveMap(scene);
  const [bx1, by1, bx2, by2] = getCommonBounds(els);
  const size = { width: bx2 - bx1, height: by2 - by1 };
  // A shape (or zone, frame) drawn around the unit is where it lives, not something to avoid: the
  // copy stays inside it when there is room.
  const containers = containersOf(unit, scene);
  const box = opts.at
    ? { x: opts.at.x - size.width / 2, y: opts.at.y - size.height / 2, ...size }
    : quickConnectBox({
        source: unit.box,
        side,
        size,
        obstacles: obstacleBoxes(unit.primary, scene, map, new Set(containers.map((c) => c.id))),
        within: containers[0] ? boxOf(containers[0]) : undefined,
        // A plain copy sits close beside the original; a connected one leaves room for the arrow.
        ...(connect ? {} : { gap: QUICK_COPY_GAP, margin: QUICK_COPY_MARGIN, minGap: 12 }),
      });
  const dx = box.x - bx1;
  const dy = box.y - by1;
  const frameId = unit.primary.frameId ?? null;
  let fresh = els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy, frameId }) as El);
  const target = pickPrimary(fresh);
  if (!target) throw new Error("there is nothing to add");

  const changed: El[] = [];
  let arrows: El[] = [];
  let route: Point[] | null = null;
  if (connect) {
    const style = opts.style ?? loadLinkStyle();
    const all = [...scene, ...fresh];
    const allMap = liveMap(all);
    const editing = st.editingGroupId ?? null;
    const planner = new LinkPlanner({ elements: all, editingGroupId: editing }, unit.id, side);
    // Beside the source: into the facing side, so the arrow is straight. Dropped elsewhere: the best side.
    const plan = planner.plan({ unitId: target.id, side: opts.at ? "auto" : OPPOSITE_SIDE[side], ratio: 0.5 }, [], style.routing, (id) => unitFor(allMap.get(id), allMap, editing));
    if (!plan) throw new Error("there is nothing to connect");
    const r = linkArrow(all, st, plan, style);
    const freshIds = new Set(fresh.map((e) => e.id));
    changed.push(...r.changed.filter((e) => !freshIds.has(e.id)));
    for (const c of r.changed) if (freshIds.has(c.id)) fresh = fresh.map((e) => (e.id === c.id ? c : e));
    arrows = r.added;
    route = plan.points;
  }
  changed.push(...growContainers(unit.primary, box, map));
  return { box, fresh, arrows, changed, primary: pickPrimary(fresh) ?? target, route };
}

/** Selection that selects the new units as a click would (a group as its group). */
function selectionOf(units: readonly El[][]): Partial<AppState> {
  const ids: Record<string, true> = {};
  const groups: Record<string, true> = {};
  for (const fresh of units) {
    const primary = pickPrimary(fresh);
    const group = primary?.groupIds.at(-1);
    if (group) groups[group] = true;
    for (const e of fresh) if (!(e.type === "text" && (e as El & Loose).containerId && !group)) ids[e.id] = true;
  }
  return { selectedElementIds: ids, selectedGroupIds: groups, editingGroupId: null } as Partial<AppState>;
}

interface Job {
  unit: QuickUnit;
  els: El[];
  /** Centre for this unit's new unit (drag and drop), else beside it. */
  at?: Point;
}

/** Plan several new units (each beside its own source); each placement sees the ones before it. */
function planMany(api: ExcalidrawImperativeAPI, jobs: readonly Job[], side: QuickSide, connect: boolean, opts: AttachOptions = {}) {
  const st = api.getAppState();
  let scene: El[] = [...api.getSceneElements()];
  const added = new Map<string, El>();
  const changed = new Map<string, El>();
  const plans: AttachPlan[] = [];
  for (const job of jobs) {
    const p = planAttach(scene, st, job.unit, side, job.els, connect, { ...opts, at: job.at ?? opts.at });
    for (const c of p.changed) {
      if (added.has(c.id)) added.set(c.id, c);
      else changed.set(c.id, c);
    }
    for (const e of [...p.fresh, ...p.arrows]) added.set(e.id, e);
    const byId = new Map(p.changed.map((c) => [c.id, c]));
    scene = [...scene.map((e) => byId.get(e.id) ?? e), ...p.fresh, ...p.arrows];
    plans.push(p);
  }
  return { plans, changed, added };
}

/**
 * Add several new units at once (each beside its own source), as ONE undo step, selecting them.
 * Returns the new units' main element ids.
 */
function attachMany(api: ExcalidrawImperativeAPI, jobs: readonly Job[], side: QuickSide, connect: boolean, opts: AttachOptions = {}): string[] {
  const { plans, changed, added } = planMany(api, jobs, side, connect, opts);
  commitElements(api, [...changed.values()], [...added.values()], selectionOf(plans.map((p) => p.fresh)));
  return plans.map((p) => p.primary.id);
}

/** Centres for copies dropped at `at`: the first unit's copy there, the others keeping their offsets. */
function dropCentres(units: readonly QuickUnit[], at: Point | undefined): (Point | undefined)[] {
  if (!at || !units.length) return units.map(() => undefined);
  const c0 = { x: units[0].box.x + units[0].box.width / 2, y: units[0].box.y + units[0].box.height / 2 };
  return units.map((u) => ({ x: at.x + u.box.x + u.box.width / 2 - c0.x, y: at.y + u.box.y + u.box.height / 2 - c0.y }));
}

function copyJobs(api: ExcalidrawImperativeAPI, unitIds: readonly string[], side: QuickSide, at?: Point): Job[] {
  const units = unitIds.map((id) => unitById(api, id)).filter((u): u is QuickUnit => !!u);
  // Order along the side, so each copy finds its spot next to the one placed before it.
  const horizontal = side === "top" || side === "bottom";
  if (!at) units.sort((a, b) => (horizontal ? a.box.x - b.box.x : a.box.y - b.box.y));
  const centres = dropCentres(units, at);
  const names: string[] = [];
  return units.map((unit, i) => {
    const els = copyOf(api, unit, names);
    names.push(...textsOf(els));
    return { unit, els, at: centres[i] };
  });
}

/**
 * Where copies of `unitIds` on `side` (or dropped at `at`) would go, and their arrows' routes: for
 * previews, nothing is changed. Null when nothing can be copied.
 */
export function previewCopies(api: ExcalidrawImperativeAPI, unitIds: readonly string[], side: QuickSide, connect: boolean, at?: Point): { boxes: Box[]; routes: Point[][] } | null {
  try {
    const jobs = copyJobs(api, unitIds, side, at);
    if (!jobs.length) return null;
    const { plans } = planMany(api, jobs, side, connect);
    return { boxes: plans.map((p) => p.box), routes: plans.flatMap((p) => (p.route ? [p.route] : [])) };
  } catch {
    return null;
  }
}

/** Copy of a unit's members (fresh ids, no link, only our own customData), labelled for a copy when `count` is on. */
function copyOf(api: ExcalidrawImperativeAPI, unit: QuickUnit, extraNames: string[] = []): El[] {
  const members = unit.members.map((m) => ({ ...m, link: null, customData: copyCustomData(m.customData as Loose | undefined) }) as El);
  const fresh = cloneForInsert(members);
  return countLabel(fresh, [...textsOf(api.getSceneElements()), ...extraNames], api.getAppState());
}

const textsOf = (els: readonly El[]) => els.filter((e) => e.type === "text" && !e.isDeleted).map((e) => String((e as El & Loose).originalText ?? (e as El & Loose).text ?? ""));

/**
 * The copy's label counted up ("web-1" -> "web-2", "Server" -> "Server 2"; see shared/labelNumber.ts).
 * Only for a unit with exactly one text (a shape's label, an icon's caption); groups of labelled
 * shapes are copied as they are.
 */
function countLabel(fresh: El[], existing: string[], st: AppState): El[] {
  const texts = fresh.filter((e) => e.type === "text");
  if (texts.length !== 1) return fresh;
  const label = texts[0] as El & Loose;
  const next = nextLabel(String(label.originalText ?? label.text ?? ""), existing);
  if (!next) return fresh;
  const map = liveMap(fresh);
  const container = label.containerId ? map.get(label.containerId as string) : undefined;
  if (container && !isIconNode(container)) {
    const r = relabel(container, next, map, st);
    const byId = new Map([...r.changed, ...r.added].map((e) => [e.id, e]));
    return fresh.map((e) => byId.get(e.id) ?? e);
  }
  // An icon's caption (bound to the borderless node, or a stencil's free caption): re-measured and
  // kept centred under the icon.
  const t = remeasureText(label, { text: next });
  const moved = newElementWith(t, { x: label.x + label.width / 2 - t.width / 2 } as never);
  return fresh.map((e) => (e.id === label.id ? moved : e));
}

/**
 * Add a copy of the unit `unitId` (same type, size, style; label counted up; a stencil with its
 * caption; a group as a group) on `side`, or centred on `opts.at`. With `connect` (the default) an
 * arrow in the link style joins them; without it the copy just sits beside the original.
 */
export function addConnectedCopy(api: ExcalidrawImperativeAPI, unitId: string, side: QuickSide, opts: { connect?: boolean; at?: Point } = {}): string | null {
  return addConnectedCopies(api, [unitId], side, opts)[0] ?? null;
}

/**
 * The same for several units: each gets its own copy on `side` (or, with `at`, dropped there keeping
 * their arrangement), one undo step. Returns the new units' main element ids.
 */
export function addConnectedCopies(api: ExcalidrawImperativeAPI, unitIds: readonly string[], side: QuickSide, opts: { connect?: boolean; at?: Point } = {}): string[] {
  const jobs = copyJobs(api, unitIds, side, opts.at);
  return jobs.length ? attachMany(api, jobs, side, opts.connect !== false) : [];
}

/** Jobs adding the same new unit (`els`, fresh ids for each) beside each of `unitIds`. */
function sameForEach(api: ExcalidrawImperativeAPI, unitIds: readonly string[], els: El[], at?: Point): Job[] {
  const units = unitIds.map((id) => unitById(api, id)).filter((u): u is QuickUnit => !!u);
  const centres = dropCentres(units, at);
  return units.map((unit, i) => ({ unit, els: i === 0 ? els : cloneForInsert(els), at: centres[i] }));
}

const idList = (ids: string | readonly string[]) => (typeof ids === "string" ? [ids] : ids);

/** Add `item` (an SVG/PNG stencil) as an icon node on `side` of each of `unitIds`, connected by an arrow. Returns the first new node's id. */
export async function addConnectedStencil(
  api: ExcalidrawImperativeAPI,
  unitIds: string | readonly string[],
  side: QuickSide,
  item: LibraryItem,
  sketch: IconSketch | null = null,
  captionPrefs: CaptionPrefs | null = null,
  opts: AttachOptions = {},
): Promise<string | null> {
  if (item.kind !== "svg" && item.kind !== "png") throw new Error(`“${item.name}” is not an icon`);
  const st = api.getAppState();
  const style = { fontFamily: captionFontId(captionPrefs, !!sketch, st.currentItemFontFamily as number), strokeColor: st.currentItemStrokeColor };
  const { image, files } = await loadIconImage(item, { ...style, sketch });
  // The scene may have changed while the icon loaded.
  const unit = unitById(api, idList(unitIds)[0]);
  if (!unit) return null;
  const zone = zoneOf(unit.primary);
  const els = makeIconNode({
    image,
    caption: item.name,
    ...style,
    x: 0,
    y: 0,
    customData: zone ? { mydrawZoneId: zone } : undefined,
    stencil: { id: item.id, name: item.name },
  });
  const [id] = attachMany(api, sameForEach(api, idList(unitIds), els, opts.at), side, true, { style: opts.style });
  // After updateScene: Excalidraw loads images for files added while an element uses them.
  api.addFiles(files);
  return id ?? null;
}

/** Basic shapes the quick connect picker offers besides stencils. */
export type QuickShape = "rectangle" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud" | "document" | "hexagon";
export const QUICK_SHAPES: readonly QuickShape[] = ["rectangle", "rounded", "ellipse", "diamond", "cylinder", "cloud", "document", "hexagon"];
export const QUICK_SHAPE_LABEL: Record<QuickShape, string> = {
  rectangle: "Rectangle",
  rounded: "Rounded rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  cylinder: "Database (cylinder)",
  cloud: "Cloud",
  document: "Document",
  hexagon: "Hexagon",
};

/**
 * Add a new empty shape on `side` of `unitId`, connected by an arrow. Plain shapes take the size of
 * the source when it is a plain shape, and the current style for new shapes; drawn shapes (cylinder,
 * cloud, ...) are icon nodes like build_diagram's. Returns the new shape's id (the element whose
 * label to edit).
 */
export async function addConnectedShape(api: ExcalidrawImperativeAPI, unitIds: string | readonly string[], side: QuickSide, shape: QuickShape, opts: AttachOptions = {}): Promise<string | null> {
  const st = api.getAppState();
  const unitId = idList(unitIds)[0];
  let unit = unitById(api, unitId);
  if (!unit) return null;
  const src = unit.primary;
  const plain = SHAPES.has(src.type) && !isIconNode(src);
  const width = plain ? Math.max(60, Math.round(src.width)) : 140;
  const height = plain ? Math.max(40, Math.round(src.height)) : 70;
  const zone = zoneOf(src);
  const customData = zone ? { mydrawZoneId: zone } : undefined;
  let els: El[];
  let files: BinaryFileData[] = [];
  if (shape === "rectangle" || shape === "rounded" || shape === "ellipse" || shape === "diamond") {
    const r = buildElements(
      [
        {
          type: shape === "rounded" ? "rectangle" : shape,
          id: randomId(),
          x: 0,
          y: 0,
          width,
          height,
          ...(shape === "rounded" ? { roundness: { type: 3 } } : shape === "rectangle" ? { roundness: null } : {}),
          ...(customData ? { customData } : {}),
        },
      ],
      api.getSceneElements(),
      st,
    );
    els = r.added;
  } else {
    const fill = st.currentItemBackgroundColor && st.currentItemBackgroundColor !== "transparent" ? st.currentItemBackgroundColor : "#ffffff";
    const drawn = await shapeImage(shape, { width, height, stroke: st.currentItemStrokeColor, fill, strokeWidth: st.currentItemStrokeWidth });
    files = [drawn.file];
    const node = makeIconNode({
      image: drawn.image as never,
      caption: "",
      fontFamily: st.currentItemFontFamily as number,
      strokeColor: st.currentItemStrokeColor,
      x: 0,
      y: 0,
      labelInside: true,
      customData: { ...(customData ?? {}), mydrawShape: shape },
    });
    // The shape image goes first: Excalidraw draws a bound label right after its container.
    const [container, image, ...rest] = node;
    els = [image, container, ...rest];
    // The scene may have changed while the shape was drawn.
    unit = unitById(api, unitId);
    if (!unit) return null;
  }
  const [id] = attachMany(api, sameForEach(api, idList(unitIds), els, opts.at), side, true, { style: opts.style });
  if (files.length) api.addFiles(files);
  return id ?? null;
}

/**
 * Connect the unit `fromId` (leaving from its `side`) to the existing unit `toId` with an arrow in
 * the link style, arriving on the side of the target that faces the source. One undo step; the
 * selection is left alone so several connections can be made in a row. Returns the arrow id.
 */
export function connectUnits(api: ExcalidrawImperativeAPI, fromId: string, side: QuickSide, toId: string, style: LinkStyle = loadLinkStyle()): string | null {
  return connectMany(api, [fromId], side, toId, style)[0] ?? null;
}

/** Connect each of `fromIds` (leaving from `side`) to `toId`, one undo step. Returns the arrow ids. */
export function connectMany(api: ExcalidrawImperativeAPI, fromIds: readonly string[], side: QuickSide, toId: string, style: LinkStyle = loadLinkStyle()): string[] {
  const st = api.getAppState();
  let scene: El[] = [...api.getSceneElements()];
  const target = unitById(api, toId);
  if (!target) return [];
  const added: El[] = [];
  const changed = new Map<string, El>();
  const ids: string[] = [];
  for (const fromId of fromIds) {
    const a = unitById(api, fromId);
    if (!a || a.id === target.id) continue;
    const map = liveMap(scene);
    let planner: LinkPlanner;
    try {
      planner = new LinkPlanner({ elements: scene, editingGroupId: st.editingGroupId ?? null }, a.id, side);
    } catch {
      continue;
    }
    const plan = planner.plan({ unitId: target.id, side: facingSide(a.box, target.box), ratio: 0.5 }, [], style.routing, (id) => unitFor(map.get(id), map, st.editingGroupId ?? null));
    if (!plan) continue;
    const r = linkArrow(scene, st, plan, style);
    for (const c of r.changed) changed.set(c.id, c);
    added.push(...r.added);
    const byId = new Map(r.changed.map((c) => [c.id, c]));
    scene = [...scene.map((e) => byId.get(e.id) ?? e), ...r.added];
    ids.push(r.id);
  }
  if (ids.length) commitElements(api, [...changed.values()], added);
  return ids;
}

/** Every selected unit (a group counts once), or [] when something that is not a unit is selected too. */
export function selectedUnits(api: ExcalidrawImperativeAPI): QuickUnit[] {
  const st = api.getAppState();
  const sel = st.selectedElementIds;
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const out = new Map<string, QuickUnit>();
  for (const el of scene) {
    if (!sel[el.id]) continue;
    if (el.type === "text" && (el as El & Loose).containerId && sel[(el as El & Loose).containerId as string]) continue;
    const u = unitFor(el, map, st.editingGroupId);
    if (!u) return [];
    out.set(u.id, u);
  }
  return [...out.values()];
}

/** The units directly connected to `unitId` by arrows, in reading order (top to bottom, left to right). */
export function neighboursOf(api: ExcalidrawImperativeAPI, unitId: string): QuickUnit[] {
  const unit = unitById(api, unitId);
  if (!unit) return [];
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const editing = api.getAppState().editingGroupId;
  const own = new Set(unit.members.map((m) => m.id));
  const out = new Map<string, QuickUnit>();
  for (const e of scene) {
    if (e.isDeleted || e.type !== "arrow") continue;
    const a = e as El & { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
    const ends = [a.startBinding?.elementId, a.endBinding?.elementId];
    if (!ends.some((id) => id && own.has(id))) continue;
    for (const id of ends) {
      if (!id || own.has(id)) continue;
      const u = unitFor(map.get(id), map, editing);
      if (u && u.id !== unit.id) out.set(u.id, u);
    }
  }
  return [...out.values()].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
}

/** Select a unit as a click would (a group as its group). */
export function selectUnit(api: ExcalidrawImperativeAPI, u: QuickUnit): void {
  api.updateScene({ appState: { ...api.getAppState(), ...selectionOf([u.members]) } as AppState, captureUpdate: CaptureUpdateAction.NEVER });
}
