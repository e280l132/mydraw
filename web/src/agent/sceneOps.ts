// Element-level helpers for agent commands: compact descriptions, building elements from skeletons,
// binding arrows, relabeling and rerouting. Functions here never call updateScene; the executor
// collects their results and applies each command as one scene update (= one undo step).
import { convertToExcalidrawElements, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { boxFromBounds, connectorEndpoints, outlinePoint, type Box, type OutlineShape, type Point } from "../../../shared/geometry";

export type El = ExcalidrawElement;
type Loose = Record<string, unknown>;
export type ElMap = Map<string, El>;

/** Gap between an arrow's end and the shape it is bound to. */
export const BIND_GAP = 4;

export const randomId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);

const LINEAR = new Set(["arrow", "line"]);
const NOT_BINDABLE = new Set(["arrow", "line", "freedraw", "selection"]);
const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

const r1 = (n: number) => Math.round(n * 10) / 10;

export function isLinear(el: El): boolean {
  return LINEAR.has(el.type);
}

export function boxOf(el: El): Box {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/** Bounds of a set of elements (as drawn, including arrow points). */
export function boundsOf(els: readonly El[]): Box {
  return boxFromBounds(getCommonBounds(els));
}

function outlineShape(el: El): OutlineShape {
  return el.type === "ellipse" ? "ellipse" : el.type === "diamond" ? "diamond" : "rectangle";
}

export function boundTextOf(el: El, map: ElMap): El | undefined {
  const ref = el.boundElements?.find((b) => b.type === "text");
  const text = ref ? map.get(ref.id) : undefined;
  return text && !text.isDeleted ? text : undefined;
}

function hasCustomData(el: El): Loose | undefined {
  if (!el.customData) return undefined;
  const out = Object.fromEntries(Object.entries(el.customData).filter(([k]) => !k.startsWith("mydraw")));
  return Object.keys(out).length ? out : undefined;
}

/** Compact, agent-friendly description of an element. */
export function describe(el: El, map: ElMap): Loose {
  const e = el as El & Loose;
  const o: Loose = { id: el.id, type: el.type, x: r1(el.x), y: r1(el.y), width: r1(el.width), height: r1(el.height) };
  if (el.angle) o.angle = Math.round(el.angle * 1000) / 1000;
  const label = boundTextOf(el, map);
  if (label) o.label = (label as El & { text: string }).text;
  if (el.type === "text") {
    o.text = e.text;
    o.fontSize = e.fontSize;
    if (e.containerId) o.containerId = e.containerId;
  }
  o.strokeColor = el.strokeColor;
  if (el.backgroundColor !== "transparent") o.backgroundColor = el.backgroundColor;
  if (el.type !== "text" && el.type !== "image") {
    if (el.backgroundColor !== "transparent") o.fillStyle = el.fillStyle;
    o.strokeWidth = el.strokeWidth;
    if (el.strokeStyle !== "solid") o.strokeStyle = el.strokeStyle;
  }
  if (el.opacity !== 100) o.opacity = el.opacity;
  if (isLinear(el)) {
    const pts = (e.points as [number, number][]) ?? [];
    o.points = pts.map(([px, py]) => [r1(el.x + px), r1(el.y + py)]);
    const sb = e.startBinding as { elementId: string } | null;
    const eb = e.endBinding as { elementId: string } | null;
    if (sb) o.from = sb.elementId;
    if (eb) o.to = eb.elementId;
    if (el.type === "arrow") {
      o.startArrowhead = e.startArrowhead ?? null;
      o.endArrowhead = e.endArrowhead ?? null;
    }
  }
  if (el.type === "image") {
    o.icon = { color: (el.customData?.mydrawIconColor as string | undefined) ?? "original" };
  }
  if (el.type === "frame" || el.type === "magicframe") o.name = e.name ?? null;
  if (el.groupIds.length) o.groupIds = el.groupIds;
  if (el.frameId) o.frameId = el.frameId;
  if (el.link) o.link = el.link;
  if (el.locked) o.locked = true;
  const data = hasCustomData(el);
  if (data) o.data = data;
  return o;
}

/** Elements worth listing on their own: everything except deleted ones and text bound inside a container. */
export function listable(els: readonly El[]): El[] {
  return els.filter((el) => !el.isDeleted && !(el.type === "text" && (el as El & Loose).containerId));
}

// ---------- defaults from the drawing's current tool settings ----------

export function styleDefaults(st: AppState, type: string): Loose {
  const common = { strokeColor: st.currentItemStrokeColor, opacity: st.currentItemOpacity };
  if (type === "text") return { ...common, fontFamily: st.currentItemFontFamily, fontSize: st.currentItemFontSize };
  const lines = {
    ...common,
    strokeWidth: st.currentItemStrokeWidth,
    strokeStyle: st.currentItemStrokeStyle,
    roughness: st.currentItemRoughness,
  };
  if (LINEAR.has(type)) return lines;
  if (type === "frame" || type === "image") return {};
  return {
    ...lines,
    backgroundColor: st.currentItemBackgroundColor,
    fillStyle: st.currentItemFillStyle,
    ...(st.currentItemRoundness === "round" && (type === "rectangle" || type === "diamond") ? { roundness: { type: 3 } } : {}),
  };
}

function withDefaults(sk: Loose, st: AppState): Loose {
  const out: Loose = { ...styleDefaults(st, String(sk.type)), ...sk };
  const label = sk.label;
  if (typeof label === "string") out.label = { text: label };
  if (out.label && typeof out.label === "object") {
    out.label = { fontFamily: st.currentItemFontFamily, fontSize: st.currentItemFontSize, ...(out.label as Loose) };
  }
  return out;
}

// ---------- arrows ----------

export function assertBindable(el: El | undefined, id: string): El {
  if (!el || el.isDeleted) throw new Error(`no element with id "${id}"`);
  if (NOT_BINDABLE.has(el.type)) throw new Error(`"${id}" is a ${el.type}; arrows can only connect shapes, text, images and frames`);
  return el;
}

function edgePoint(el: El, toward: Point): Point {
  return outlinePoint(boxOf(el), outlineShape(el), toward, BIND_GAP);
}

/** Straight arrow geometry between two shapes (x, y and points relative to x, y). */
export function arrowGeometry(from: El, to: El): { x: number; y: number; points: [number, number][] } {
  const { start, end } = connectorEndpoints(
    { box: boxOf(from), shape: outlineShape(from) },
    { box: boxOf(to), shape: outlineShape(to) },
    BIND_GAP,
  );
  return { x: start.x, y: start.y, points: [[0, 0], [end.x - start.x, end.y - start.y]] };
}

function addBound(el: El, ref: { id: string; type: "arrow" | "text" }): El {
  const list = el.boundElements ?? [];
  if (list.some((b) => b.id === ref.id)) return el;
  return newElementWith(el, { boundElements: [...list, ref] });
}

function dropBound(el: El, ids: ReadonlySet<string>): El {
  const list = el.boundElements ?? [];
  if (!list.some((b) => ids.has(b.id))) return el;
  return newElementWith(el, { boundElements: list.filter((b) => !ids.has(b.id)) });
}

/** Middle of a polyline (by length), in scene coordinates. */
function polylineMiddle(x: number, y: number, points: readonly (readonly [number, number])[]): Point {
  if (points.length < 2) return { x, y };
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    segs.push(d);
    total += d;
  }
  let left = total / 2;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const t = segs[i] ? left / segs[i] : 0;
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      return { x: x + ax + (bx - ax) * t, y: y + ay + (by - ay) * t };
    }
    left -= segs[i];
  }
  return { x, y };
}

/**
 * Recompute the ends of an arrow bound to shapes (after a shape moved or resized). A bound end
 * sits on its shape's outline, aimed at the other end. Returns the changed arrow and its label.
 */
export function reroute(arrow: El, map: ElMap): El[] {
  const a = arrow as El & { points: [number, number][]; startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };
  const from = a.startBinding ? map.get(a.startBinding.elementId) : undefined;
  const to = a.endBinding ? map.get(a.endBinding.elementId) : undefined;
  const pts = a.points;
  if (!from && !to) {
    // Not attached to anything: the arrow keeps its geometry, only its label is re-centred.
    const label = boundTextOf(arrow, map);
    if (!label) return [];
    const mid = polylineMiddle(a.x, a.y, pts);
    return [arrow, newElementWith(label, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 })];
  }
  let start: Point = { x: a.x + pts[0][0], y: a.y + pts[0][1] };
  let end: Point = { x: a.x + pts[pts.length - 1][0], y: a.y + pts[pts.length - 1][1] };
  if (from && to && pts.length === 2) {
    const g = arrowGeometry(from, to);
    start = { x: g.x, y: g.y };
    end = { x: g.x + g.points[1][0], y: g.y + g.points[1][1] };
  } else {
    const nextAfterStart = pts.length > 2 ? { x: a.x + pts[1][0], y: a.y + pts[1][1] } : end;
    const prevBeforeEnd = pts.length > 2 ? { x: a.x + pts[pts.length - 2][0], y: a.y + pts[pts.length - 2][1] } : start;
    if (from) start = edgePoint(from, to && pts.length === 2 ? boxCenter(to) : nextAfterStart);
    if (to) end = edgePoint(to, from && pts.length === 2 ? boxCenter(from) : prevBeforeEnd);
  }
  const abs = pts.map(([px, py], i) =>
    i === 0 ? start : i === pts.length - 1 ? end : { x: a.x + px, y: a.y + py },
  );
  const points = abs.map((p) => [p.x - start.x, p.y - start.y] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const updated = newElementWith(arrow, {
    x: start.x,
    y: start.y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  } as never);
  const out: El[] = [updated];
  const label = boundTextOf(arrow, map);
  if (label) {
    const mid = polylineMiddle(start.x, start.y, points);
    out.push(newElementWith(label, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 }));
  }
  return out;
}

function boxCenter(el: El): Point {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

// ---------- labels and text ----------

/**
 * Set (or remove, with null/"") the label of a shape or arrow. Excalidraw's own skeleton converter
 * measures and places the text; the container keeps its id and may grow to fit the text.
 */
export function relabel(container: El, text: string | null, map: ElMap, st: AppState): { changed: El[]; added: El[] } {
  const old = boundTextOf(container, map) as (El & Loose) | undefined;
  if (!text) {
    if (!old) return { changed: [], added: [] };
    return {
      changed: [newElementWith(old, { isDeleted: true }), dropBound(container, new Set([old.id]))],
      added: [],
    };
  }
  const c = container as El & Loose;
  const labelStyle: Loose = old
    ? {
        fontSize: old.fontSize,
        fontFamily: old.fontFamily,
        strokeColor: old.strokeColor,
        textAlign: old.textAlign,
        verticalAlign: old.verticalAlign,
      }
    : { fontSize: st.currentItemFontSize, fontFamily: st.currentItemFontFamily, strokeColor: container.strokeColor };
  const skeleton: Loose = {
    type: container.type,
    id: container.id,
    x: container.x,
    y: container.y,
    width: container.width,
    height: container.height,
    label: { text, ...labelStyle },
  };
  if (isLinear(container)) skeleton.points = c.points;
  const made = convertToExcalidrawElements([skeleton as never], { regenerateIds: false });
  const madeContainer = made.find((e) => e.id === container.id);
  const madeText = made.find((e) => e.type === "text") as (El & Loose) | undefined;
  if (!madeContainer || !madeText) throw new Error(`could not label ${container.type}`);

  let textEl: El;
  if (old) {
    const { id: _id, version: _v, versionNonce: _n, ...rest } = madeText;
    textEl = newElementWith(old, { ...rest, containerId: container.id } as never);
  } else {
    textEl = { ...madeText, containerId: container.id } as El;
  }
  const grow: Loose = {};
  if (!isLinear(container)) {
    if (madeContainer.width > container.width) grow.width = madeContainer.width;
    if (madeContainer.height > container.height) grow.height = madeContainer.height;
  }
  // Keep the label in the container's groups and frame so it moves with it.
  textEl = { ...textEl, groupIds: container.groupIds, frameId: container.frameId } as El;
  let newContainer = Object.keys(grow).length ? newElementWith(container, grow as never) : container;
  newContainer = addBound(newContainer, { id: textEl.id, type: "text" });
  return old ? { changed: [newContainer, textEl], added: [] } : { changed: [newContainer], added: [textEl] };
}

/** Re-measure a standalone text element after its text or font changed. */
export function remeasureText(el: El, patch: Loose): El {
  const t = { ...(el as El & Loose), ...patch };
  const [made] = convertToExcalidrawElements([
    {
      type: "text",
      x: el.x,
      y: el.y,
      text: String(t.text ?? ""),
      fontSize: t.fontSize as number,
      fontFamily: t.fontFamily as never,
      textAlign: t.textAlign as never,
      lineHeight: t.lineHeight as never,
    },
  ]);
  const m = made as El & Loose;
  return newElementWith(el, { ...patch, width: m.width, height: m.height, originalText: m.originalText, text: m.text } as never);
}

// ---------- building elements from skeletons ----------

export interface BuildResult {
  /** Elements to add (new), in order. */
  added: El[];
  /** Existing elements that changed (bindings). */
  changed: El[];
  /** Ids of the requested top-level elements, in input order. */
  ids: string[];
}

function bindRef(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && typeof (v as Loose).id === "string" && (v as Loose).type === undefined) {
    return (v as Loose).id as string;
  }
  return null;
}

/**
 * Turn Excalidraw element skeletons into elements. Arrows/lines may use `from`/`to` (or
 * `start: {id}` / `end: {id}`) with ids of elements in this batch or already in the scene; they
 * are drawn edge to edge and bound, so they follow the shapes when moved.
 */
export function buildElements(input: unknown[], scene: readonly El[], st: AppState): BuildResult {
  const map: ElMap = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const taken = new Set(scene.map((e) => e.id));
  const ids: string[] = [];
  const plain: Loose[] = [];
  const connectors: { sk: Loose; from: string; to: string }[] = [];
  const frameChildren: { frame: string; children: string[] }[] = [];

  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("each element must be an object");
    const sk: Loose = { ...(raw as Loose) };
    if (typeof sk.type !== "string") throw new Error("each element needs a type");
    if (sk.id !== undefined) {
      if (typeof sk.id !== "string" || !sk.id) throw new Error("id must be a non-empty string");
      if (taken.has(sk.id)) throw new Error(`id "${sk.id}" is already used in this drawing`);
    } else {
      sk.id = randomId();
    }
    taken.add(sk.id as string);
    ids.push(sk.id as string);

    if (LINEAR.has(sk.type)) {
      const from = bindRef(sk.from) ?? bindRef(sk.start);
      const to = bindRef(sk.to) ?? bindRef(sk.end);
      if (from || to) {
        if (!from || !to) throw new Error(`${sk.type} "${sk.id}": give both from and to, or neither`);
        delete sk.from;
        delete sk.to;
        delete sk.start;
        delete sk.end;
        connectors.push({ sk: withDefaults(sk, st), from, to });
        continue;
      }
    }
    if (sk.type === "frame" || sk.type === "magicframe") {
      const children = Array.isArray(sk.children) ? sk.children.filter((c): c is string => typeof c === "string") : [];
      sk.children = [];
      frameChildren.push({ frame: sk.id as string, children });
    }
    if (typeof sk.x !== "number" || typeof sk.y !== "number") throw new Error(`${sk.type} "${sk.id}" needs numeric x and y`);
    if (SHAPES.has(sk.type) && sk.label === undefined && typeof sk.text === "string") sk.label = sk.text;
    plain.push(withDefaults(sk, st));
  }

  const added: El[] = [...convertToExcalidrawElements(plain as never, { regenerateIds: false })];
  for (const el of added) map.set(el.id, el);
  const changed = new Map<string, El>();
  const current = (id: string) => changed.get(id) ?? map.get(id);
  const replace = (el: El) => {
    const i = added.findIndex((a) => a.id === el.id);
    if (i >= 0) added[i] = el;
    else changed.set(el.id, el);
    map.set(el.id, el);
  };

  // Frames: children in this batch or already in the scene join the frame.
  for (const { frame, children } of frameChildren) {
    for (const cid of children) {
      const child = current(cid);
      if (!child) throw new Error(`frame "${frame}": no element "${cid}"`);
      replace(newElementWith(child, { frameId: frame }));
      const text = boundTextOf(child, map);
      if (text) replace(newElementWith(text, { frameId: frame }));
    }
  }

  for (const { sk, from, to } of connectors) {
    const a = assertBindable(current(from), from);
    const b = assertBindable(current(to), to);
    if (a.id === b.id) throw new Error(`${sk.type} "${sk.id}": from and to are the same element`);
    const geo = arrowGeometry(a, b);
    const made = convertToExcalidrawElements([{ ...sk, ...geo } as never], { regenerateIds: false });
    const arrow = made.find((e) => e.id === sk.id)!;
    const bound = newElementWith(arrow, {
      startBinding: { elementId: a.id, focus: 0, gap: BIND_GAP },
      endBinding: { elementId: b.id, focus: 0, gap: BIND_GAP },
    } as never);
    for (const el of made) {
      const v = el.id === arrow.id ? bound : el;
      added.push(v);
      map.set(v.id, v);
    }
    replace(addBound(current(a.id)!, { id: arrow.id, type: "arrow" }));
    replace(addBound(current(b.id)!, { id: arrow.id, type: "arrow" }));
  }

  return { added, changed: [...changed.values()], ids };
}

// ---------- updates ----------

const UPDATABLE = new Set([
  "x",
  "y",
  "width",
  "height",
  "angle",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
  "text",
  "fontSize",
  "fontFamily",
  "textAlign",
  "verticalAlign",
  "link",
  "locked",
  "name",
  "startArrowhead",
  "endArrowhead",
]);
const GEOMETRY = new Set(["x", "y", "width", "height", "angle"]);
const TEXT_METRICS = new Set(["text", "fontSize", "fontFamily"]);

/**
 * Apply property updates. Moving or resizing a shape keeps its label centred and its arrows
 * attached. `dx`/`dy` move by an offset; `label` sets the label text (null removes it); `data`
 * merges into the element's custom properties.
 */
export function applyUpdates(updates: unknown[], scene: readonly El[], st: AppState): { changed: El[]; added: El[]; ids: string[] } {
  const map: ElMap = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const changed = new Map<string, El>();
  const added: El[] = [];
  const geometryChanged = new Set<string>();
  const set = (el: El) => {
    map.set(el.id, el);
    if (added.some((a) => a.id === el.id)) added.splice(added.findIndex((a) => a.id === el.id), 1, el);
    else changed.set(el.id, el);
  };
  const ids: string[] = [];

  for (const raw of updates) {
    if (!raw || typeof raw !== "object") throw new Error("each update must be an object with an id");
    const u = raw as Loose;
    const id = String(u.id ?? "");
    let el = map.get(id);
    if (!el) throw new Error(`no element with id "${id}"`);
    ids.push(id);
    const patch: Loose = {};
    for (const [k, v] of Object.entries(u)) {
      if (k === "id" || k === "label" || k === "dx" || k === "dy" || k === "data") continue;
      if (!UPDATABLE.has(k)) throw new Error(`"${k}" can't be updated here (use raw_update for other fields)`);
      patch[k] = v;
    }
    if (typeof u.dx === "number") patch.x = (typeof patch.x === "number" ? patch.x : el.x) + u.dx;
    if (typeof u.dy === "number") patch.y = (typeof patch.y === "number" ? patch.y : el.y) + u.dy;
    if (u.data && typeof u.data === "object") patch.customData = { ...(el.customData ?? {}), ...(u.data as Loose) };

    if (el.type === "text" && Object.keys(patch).some((k) => TEXT_METRICS.has(k)) && !(el as El & Loose).containerId) {
      el = remeasureText(el, patch);
    } else if (Object.keys(patch).length) {
      el = newElementWith(el, patch as never);
    }
    set(el);
    if (Object.keys(patch).some((k) => GEOMETRY.has(k))) geometryChanged.add(id);

    // Bound text: a label update, or text edits on the label element itself.
    const containerId = el.type === "text" ? ((el as El & Loose).containerId as string | null) : null;
    if (containerId && patch.text !== undefined) {
      const container = map.get(containerId);
      if (container) applyLabel(container, String(patch.text));
    }
    if (u.label !== undefined) applyLabel(el, u.label === null ? null : String(u.label));
    else if (geometryChanged.has(id) && !isLinear(el) && boundTextOf(el, map)) {
      applyLabel(el, (boundTextOf(el, map) as El & { text: string }).text);
    }
  }

  function applyLabel(container: El, text: string | null) {
    const r = relabel(map.get(container.id) ?? container, text, map, st);
    for (const c of r.changed) set(c);
    for (const a of r.added) {
      added.push(a);
      map.set(a.id, a);
    }
  }

  // Keep arrows attached to anything that moved or was resized.
  for (const el of [...map.values()]) {
    if (el.type !== "arrow" && el.type !== "line") continue;
    const e = el as El & { startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };
    const touched =
      geometryChanged.has(el.id) ||
      (e.startBinding && geometryChanged.has(e.startBinding.elementId)) ||
      (e.endBinding && geometryChanged.has(e.endBinding.elementId));
    if (touched) for (const r of reroute(el, map)) set(r);
  }
  return { changed: [...changed.values()], added, ids };
}

/** Delete elements, their labels, and bindings that point at them. */
export function deleteElements(ids: readonly string[], scene: readonly El[]): El[] {
  const map: ElMap = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const doomed = new Set<string>();
  for (const id of ids) {
    const el = map.get(id);
    if (!el) throw new Error(`no element with id "${id}"`);
    doomed.add(id);
    const text = boundTextOf(el, map);
    if (text) doomed.add(text.id);
    // A stencil icon's caption is a separate text in the icon's group: it goes with the icon.
    const g = el.groupIds.at(-1);
    if (el.type === "image" && g) {
      const members = [...map.values()].filter((m) => m.groupIds.includes(g));
      if (members.every((m) => m.id === el.id || m.type === "text")) for (const m of members) doomed.add(m.id);
    }
  }
  // Deleting a frame keeps its contents (like Excalidraw); they just leave the frame (below).
  const out: El[] = [];
  for (const el of map.values()) {
    if (doomed.has(el.id)) {
      out.push(newElementWith(el, { isDeleted: true }));
      continue;
    }
    const e = el as El & Loose;
    const patch: Loose = {};
    if (el.boundElements?.some((b) => doomed.has(b.id))) patch.boundElements = el.boundElements.filter((b) => !doomed.has(b.id));
    if (isLinear(el)) {
      const sb = e.startBinding as { elementId: string } | null;
      const eb = e.endBinding as { elementId: string } | null;
      if (sb && doomed.has(sb.elementId)) patch.startBinding = null;
      if (eb && doomed.has(eb.elementId)) patch.endBinding = null;
    }
    if (el.frameId && doomed.has(el.frameId)) patch.frameId = null;
    if (Object.keys(patch).length) out.push(newElementWith(el, patch as never));
  }
  return out;
}

/** Elements plus their bound labels, and every member of the outermost groups they belong to. */
export function withGroupsAndLabels(ids: readonly string[], scene: readonly El[]): El[] {
  const live = scene.filter((e) => !e.isDeleted);
  const map: ElMap = new Map(live.map((e) => [e.id, e]));
  const groups = new Set<string>();
  const pick = new Set<string>();
  for (const id of ids) {
    const el = map.get(id);
    if (!el) throw new Error(`no element with id "${id}"`);
    pick.add(id);
    if (el.groupIds.length) groups.add(el.groupIds[el.groupIds.length - 1]);
  }
  for (const el of live) {
    if (el.groupIds.some((g) => groups.has(g))) pick.add(el.id);
  }
  // A frame brings its contents (and their groups), like moving or exporting a frame in Excalidraw.
  const frames = new Set([...pick].filter((id) => map.get(id)!.type === "frame" || map.get(id)!.type === "magicframe"));
  if (frames.size) {
    const inner = live.filter((el) => el.frameId && frames.has(el.frameId));
    const innerGroups = new Set(inner.map((el) => el.groupIds.at(-1)).filter((g): g is string => !!g));
    for (const el of live) {
      if ((el.frameId && frames.has(el.frameId)) || el.groupIds.some((g) => innerGroups.has(g))) pick.add(el.id);
    }
  }
  for (const id of [...pick]) {
    const text = boundTextOf(map.get(id)!, map);
    if (text) pick.add(text.id);
  }
  return live.filter((e) => pick.has(e.id));
}
