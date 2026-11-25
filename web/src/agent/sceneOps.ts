// Element-level helpers for agent commands: compact descriptions, building elements from skeletons,
// binding arrows, relabeling and rerouting. Functions here never call updateScene; the executor
// collects their results and applies each command as one scene update (= one undo step).
import { iconSketchPreset, storedIconSketch, type IconSketch } from "../../../shared/iconSketch";
import { requireFillStyle } from "../../../shared/fills";
import { dashPatch, isDashId, requireStrokeStyle, strokeStyleName } from "../../../shared/dash";
import { canGradient, gradientOf, gradientPatch, gradientPresetOf, resolveGradientInput } from "../../../shared/gradient";
import { fontIdByName } from "../fontRegistry";
import { convertToExcalidrawElements, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { boxFromBounds, connectorEndpoints, outlinePoint, type Box, type OutlineShape, type Point } from "../../../shared/geometry";
import { labelOffsetLimit } from "../../../shared/edgeTidy";
import { distToPolyline, labelPoint } from "../../../shared/labelGuard";
import { linkProblem } from "../../../shared/links";
import { requireColor } from "../../../shared/palettes";
import { normalizeOutline, outlineOf, withOutline, type TextOutline } from "../../../shared/textOutline";
import { canShadow, describeShadow, resolveShadowInput, shadowOf, withShadow, type Shadow } from "../../../shared/shadow";
import { curvedPoints, ELBOW_GAP, elbowRoute, fixedPointFor, isOrthogonal, type Routing, type Side } from "../../../shared/routing";
import { fixedSegmentsFor, nearestSide, portPoint, routeAround } from "../../../shared/avoidRoute";

/** An icon's style for get_scene: "original", a preset name ("pen", "marker", …) or the full settings. */
function iconStyleName(el: El): string | IconSketch {
  const s = storedIconSketch(el.customData?.mydrawIconSketch);
  if (!s) return "original";
  const preset = iconSketchPreset(s);
  if (preset) return preset;
  const { preset: _p, ...rest } = s;
  void _p;
  return rest;
}

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

/**
 * The text as typed. A label inside a shape is stored wrapped: `text` has a line break wherever the
 * current width forced one, `originalText` is what was typed. Re-fitting a label (new size, new font,
 * new shape width) must start from `originalText`, or the old wrapping becomes permanent line breaks.
 */
export function typedText(t: object | undefined): string {
  if (!t) return "";
  const x = t as { text?: unknown; originalText?: unknown };
  return String(x.originalText ?? x.text ?? "");
}

export function boundTextOf(el: El, map: ElMap): El | undefined {
  const ref = el.boundElements?.find((b) => b.type === "text");
  const text = ref ? map.get(ref.id) : undefined;
  return text && !text.isDeleted ? text : undefined;
}

// ---------- icon nodes and zones ----------
// An icon node is a stencil icon with its caption: a borderless container rectangle (the caption is
// its bound text, at the bottom) plus the image on top, grouped. Arrows bind to the container, so
// they stop at the edge of icon + caption instead of crossing the caption.
// A zone is a locked, tinted rectangle with a title text (VPC, subnet, VLAN, ...); elements inside
// carry customData.mydrawZoneId, and moving a zone moves them too.

export function isIconNode(el: El | undefined): boolean {
  return el?.customData?.mydrawNode === "icon";
}

export function isZone(el: El | undefined): boolean {
  return !!el?.customData?.mydrawZone;
}

export function zoneOf(el: El): string | null {
  return (el.customData?.mydrawZoneId as string | undefined) ?? null;
}

/** The icon node an element belongs to (its container), if any. */
export function iconNodeOf(el: El, map: ElMap): El | undefined {
  if (isIconNode(el)) return el;
  const g = el.groupIds[0];
  if (!g || (el.type !== "image" && el.type !== "text")) return undefined;
  if (el.type === "text" && (el as El & Loose).containerId) return iconNodeOf(map.get((el as El & Loose).containerId as string)!, map);
  for (const m of map.values()) if (!m.isDeleted && isIconNode(m) && m.groupIds[0] === g) return m;
  return undefined;
}

/** The image of an icon node. */
export function iconImageOf(node: El, map: ElMap): El | undefined {
  const g = node.groupIds[0];
  if (!g) return undefined;
  for (const m of map.values()) if (!m.isDeleted && m.type === "image" && m.groupIds[0] === g) return m;
  return undefined;
}

/** The title text of a zone. */
export function zoneTitleOf(zone: El, map: ElMap): El | undefined {
  for (const m of map.values()) if (!m.isDeleted && m.type === "text" && m.customData?.mydrawZoneTitle === zone.id) return m;
  return undefined;
}

/** Everything inside a zone, including nested zones and their contents. */
export function zoneContents(zoneId: string, live: readonly El[]): El[] {
  const out: El[] = [];
  const zones = [zoneId];
  const seen = new Set(zones);
  while (zones.length) {
    const z = zones.pop()!;
    for (const el of live) {
      if (zoneOf(el) !== z || seen.has(el.id)) continue;
      seen.add(el.id);
      out.push(el);
      if (isZone(el)) zones.push(el.id);
    }
  }
  return out;
}

/** Element an arrow should bind to when asked to connect to `el` (icon image -> its node). */
export function bindTarget(el: El, map: ElMap): El {
  return el.type === "image" || el.type === "text" ? (iconNodeOf(el, map) ?? el) : el;
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
  if (label) o.label = typedText(label as El & Loose);
  const labelOutline = label ? outlineOf(label as El & Loose) : null;
  if (labelOutline) o.labelOutline = labelOutline;
  // An icon node's shadow sits on its image.
  const gradient = gradientOf(el as never);
  if (gradient) o.gradient = gradientPresetOf(gradient) ?? gradient;
  const shadow = describeShadow(shadowOf(isIconNode(el) ? (iconImageOf(el, map) ?? el) : el));
  if (shadow) o.shadow = shadow;
  const labelShadow = label ? describeShadow(shadowOf(label)) : undefined;
  if (labelShadow) o.labelShadow = labelShadow;
  if (el.type === "text") {
    o.text = e.text;
    o.fontSize = e.fontSize;
    if (e.containerId) o.containerId = e.containerId;
    const outline = outlineOf(e);
    if (outline) o.textOutline = outline;
  }
  o.strokeColor = el.strokeColor;
  if (el.backgroundColor !== "transparent") o.backgroundColor = el.backgroundColor;
  if (el.type !== "text" && el.type !== "image") {
    if (el.backgroundColor !== "transparent") o.fillStyle = el.fillStyle;
    o.strokeWidth = el.strokeWidth;
    if (el.strokeStyle !== "solid") o.strokeStyle = strokeStyleName(el);
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
    o.icon = { color: (el.customData?.mydrawIconColor as string | undefined) ?? "original", style: iconStyleName(el) };
    const node = iconNodeOf(el, map);
    if (node) o.node = node.id;
  }
  if (isIconNode(el) && el.customData?.mydrawShape) {
    // A drawn shape (database, cloud, person, ...): one node with its label.
    o.type = "shape-node";
    o.shape = el.customData.mydrawShape;
    const img = iconImageOf(el, map);
    if (img && storedIconSketch(img.customData?.mydrawIconSketch)) o.iconStyle = iconStyleName(img);
    delete o.backgroundColor;
    delete o.fillStyle;
  } else if (isIconNode(el)) {
    // Present the node as one thing: its caption, its icon, and where to connect.
    o.type = "icon-node";
    delete o.strokeColor;
    delete o.backgroundColor;
    delete o.fillStyle;
    delete o.strokeWidth;
    const img = iconImageOf(el, map);
    const stencil = el.customData?.mydrawStencil as { name?: string } | undefined;
    o.icon = {
      image: img?.id ?? null,
      stencil: stencil?.name ?? null,
      color: (img?.customData?.mydrawIconColor as string | undefined) ?? "original",
      style: img ? iconStyleName(img) : "original",
    };
  }
  if (isZone(el)) {
    o.type = "zone";
    const title = zoneTitleOf(el, map) as (El & { text: string }) | undefined;
    if (title) o.label = title.text;
  }
  const zone = zoneOf(el);
  if (zone) o.zone = zone;
  if (el.type === "text" && el.customData?.mydrawZoneTitle) o.titleOf = el.customData.mydrawZoneTitle;
  if (isLinear(el)) {
    const routing = routingOf(el);
    if (routing !== "straight") o.routing = routing;
  }
  if (el.customData?.mydrawKind) o.kind = el.customData.mydrawKind;
  if (el.customData?.mydrawSubtitle) o.subtitle = el.customData.mydrawSubtitle;
  if (el.type === "frame" || el.type === "magicframe") o.name = e.name ?? null;
  if (el.groupIds.length) o.groupIds = el.groupIds;
  if (el.frameId) o.frameId = el.frameId;
  if (el.link) o.link = el.link;
  if (el.locked) o.locked = true;
  const data = hasCustomData(el);
  if (data) o.data = data;
  return o;
}

/**
 * Elements worth listing on their own: everything except deleted ones, text bound inside a
 * container, zone titles (shown as the zone's label) and icon-node images (shown on the node).
 */
export function listable(els: readonly El[]): El[] {
  const nodeGroups = new Set(els.filter((e) => !e.isDeleted && isIconNode(e)).map((e) => e.groupIds[0]));
  return els.filter(
    (el) =>
      !el.isDeleted &&
      !(el.type === "text" && ((el as El & Loose).containerId || el.customData?.mydrawZoneTitle)) &&
      !(el.type === "image" && el.groupIds[0] && nodeGroups.has(el.groupIds[0])),
  );
}

export function routingOf(el: El): Routing {
  if ((el as El & { elbowed?: boolean }).elbowed) return "elbow";
  const r = el.customData?.mydrawRouting;
  if (r === "curved" || r === "elbow") return r;
  return "straight";
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

/** A font given by id or by name ("Caveat", "Inter Bold"; see list_fonts) -> Excalidraw's font id. */
export function resolveFontFamily(v: unknown): number {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string" && v.trim()) {
    const id = fontIdByName(v);
    if (id === undefined) throw new Error(`unknown font "${v}" (list_fonts shows the font names)`);
    return id;
  }
  throw new Error("fontFamily must be a font name (list_fonts) or a font id");
}

/** Agent `textOutline`: {color (name or hex), width?} or null (none). */
export function parseTextOutline(v: unknown): TextOutline | null {
  if (v === null || v === false) return null;
  if (typeof v === "string") v = { color: v };
  if (!v || typeof v !== "object") throw new Error("textOutline must be {color, width?} or null");
  const raw = v as Loose;
  const color = requireColor(String(raw.color ?? ""), "textOutline color");
  if (color === "transparent") return null;
  const o = normalizeOutline({ color, width: raw.width });
  if (!o) throw new Error(`textOutline color "${String(raw.color)}" can't be used`);
  return o;
}

/** Agent `shadow`: true, a preset name, {preset?, color (name or hex)?, opacity?, blur?, distance?, angle?, amount?} or null (none). */
export function parseShadow(v: unknown): Shadow | null | undefined {
  if (v && typeof v === "object" && typeof (v as Loose).color === "string") {
    v = { ...(v as Loose), color: requireColor(String((v as Loose).color), "shadow color") };
  }
  return resolveShadowInput(v);
}

/** Agent `gradient`: a preset name, {preset?, from, to (names or hex), kind, angle} or null (none). */
function parseGradient(v: unknown) {
  if (v && typeof v === "object") {
    const o = { ...(v as Loose) };
    for (const k of ["from", "to"] as const) if (o[k] !== undefined) o[k] = requireColor(String(o[k]), `gradient ${k}`);
    v = o;
  }
  return resolveGradientInput(v);
}

function withDefaults(sk: Loose, st: AppState): Loose {
  const out: Loose = { ...styleDefaults(st, String(sk.type)), ...sk };
  if (sk.textOutline !== undefined) {
    if (sk.type !== "text") throw new Error(`textOutline applies to text (use update_elements on a shape or arrow to outline its label)`);
    delete out.textOutline;
    out.customData = withOutline(out.customData as Loose | undefined, parseTextOutline(sk.textOutline));
  }
  if (sk.shadow !== undefined) {
    if (!canShadow(String(sk.type))) throw new Error(`shadow applies to shapes, text, lines, arrows, freedraw and images, not ${String(sk.type)}`);
    delete out.shadow;
    out.customData = withShadow(out.customData as Loose | undefined, parseShadow(sk.shadow) ?? null);
  }
  if (sk.fontFamily !== undefined) out.fontFamily = resolveFontFamily(sk.fontFamily);
  if (sk.fillStyle !== undefined) out.fillStyle = requireFillStyle(sk.fillStyle);
  if (sk.gradient !== undefined) {
    if (!canGradient(String(sk.type))) throw new Error(`gradient applies to rectangles, diamonds and ellipses, not ${String(sk.type)}`);
    delete out.gradient;
    Object.assign(out, gradientPatch(out.customData as Loose | undefined, parseGradient(sk.gradient) ?? null));
  }
  if (sk.strokeStyle !== undefined) {
    // Extra dash styles (shared/dash.ts): strokeStyle keeps the dashed/dotted fallback, the pattern goes in customData.
    const name = requireStrokeStyle(sk.strokeStyle);
    Object.assign(out, dashPatch(out.customData as Loose | undefined, isDashId(name) ? name : null, isDashId(name) ? "dashed" : name));
  }
  if (typeof out.link === "string" && out.link) {
    const bad = linkProblem(out.link);
    if (bad) throw new Error(`${sk.type} "${sk.id ?? ""}": ${bad}`);
  }
  for (const k of ["strokeColor", "backgroundColor"]) if (typeof out[k] === "string") out[k] = requireColor(out[k], k);
  const label = sk.label;
  if (typeof label === "string") out.label = { text: label };
  if (out.label && typeof out.label === "object") {
    out.label = { fontFamily: st.currentItemFontFamily, fontSize: st.currentItemFontSize, ...(out.label as Loose) };
    const lf = (out.label as Loose).fontFamily;
    if (lf !== undefined) (out.label as Loose).fontFamily = resolveFontFamily(lf);
    const lc = (out.label as Loose).strokeColor;
    if (typeof lc === "string") (out.label as Loose).strokeColor = requireColor(lc, "label color");
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

export function addBound(el: El, ref: { id: string; type: "arrow" | "text" }): El {
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

/** Absolute route between two elements for a routing style (`given`: a layout's orthogonal route). */
export function routeBetween(a: El, b: El, routing: Routing, given?: Point[]): Point[] {
  if (routing === "elbow") {
    if (given && given.length >= 2 && isOrthogonal(given)) return given;
    return elbowRoute(boxOf(a), boxOf(b), ELBOW_GAP).points;
  }
  const g = arrowGeometry(a, b);
  const start = { x: g.x, y: g.y };
  const end = { x: g.x + g.points[1][0], y: g.y + g.points[1][1] };
  return routing === "curved" ? curvedPoints(start, end) : [start, end];
}

/** Element fields for an arrow along absolute `route`. */
export function arrowShape(route: readonly Point[]): { x: number; y: number; width: number; height: number; points: [number, number][] } {
  const s = route[0];
  const points = route.map((p) => [p.x - s.x, p.y - s.y] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x: s.x, y: s.y, points, width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Bindings for an arrow along `route` from `a` to `b` (elbow arrows use Excalidraw's fixed points). */
export function bindingsFor(route: readonly Point[], a: El | undefined, b: El | undefined, elbowed: boolean): Loose {
  const bind = (el: El | undefined, p: Point) =>
    !el
      ? null
      : elbowed
        ? { elementId: el.id, focus: 0, gap: 0, fixedPoint: fixedPointFor(boxOf(el), p) }
        : { elementId: el.id, focus: 0, gap: BIND_GAP };
  return { startBinding: bind(a, route[0]), endBinding: bind(b, route[route.length - 1]) };
}

/**
 * Fields that make a connector elbowed / curved / straight. Only arrows can be Excalidraw elbow
 * arrows; an elbow line is a plain line with orthogonal points (customData.mydrawRouting).
 */
export function routingFields(routing: Routing, type: string, customData: Loose | undefined): Loose {
  const data = { ...(customData ?? {}) };
  delete data.mydrawAvoid; // an explicit routing style replaces "around shapes"
  const elbowed = routing === "elbow" && type === "arrow";
  if (routing === "curved" || (routing === "elbow" && !elbowed)) data.mydrawRouting = routing;
  else delete data.mydrawRouting;
  return {
    elbowed,
    roundness: routing === "curved" ? { type: 2 } : null,
    ...(elbowed ? { fixedSegments: null, startIsSpecial: null, endIsSpecial: null } : {}),
    customData: Object.keys(data).length ? data : undefined,
  };
}

/**
 * Recompute the route of an arrow bound to shapes (after a shape moved or resized). Straight: each
 * bound end sits on its shape's outline, aimed at the other end. Elbow: a fresh orthogonal route.
 * Curved: fresh ends with the bend recomputed. Returns the changed arrow and its label.
 */
export function reroute(arrow: El, map: ElMap): El[] {
  if (arrow.type === "arrow" && arrow.customData?.mydrawAvoid) return rerouteAround(arrow, map);
  const a = arrow as El & { points: [number, number][]; startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };
  const from = a.startBinding ? map.get(a.startBinding.elementId) : undefined;
  const to = a.endBinding ? map.get(a.endBinding.elementId) : undefined;
  const pts = a.points;
  const routing = routingOf(arrow);
  // Elbow/curved arrows are routed even when attached to nothing (e.g. just switched to elbow).
  if (routing !== "straight") {
    const startPt: Point = { x: a.x + pts[0][0], y: a.y + pts[0][1] };
    const endPt: Point = { x: a.x + pts[pts.length - 1][0], y: a.y + pts[pts.length - 1][1] };
    const pointEl = (p: Point) => ({ ...arrow, x: p.x, y: p.y, width: 0, height: 0, type: "rectangle" }) as El;
    const route = routeBetween(from ?? pointEl(startPt), to ?? pointEl(endPt), routing);
    const elbowed = !!(arrow as El & { elbowed?: boolean }).elbowed;
    // A fresh route: fixed segments of the old one would no longer match its points.
    const updated = newElementWith(arrow, { ...arrowShape(route), ...bindingsFor(route, from, to, elbowed), ...(elbowed ? { fixedSegments: null, startIsSpecial: null, endIsSpecial: null } : {}) } as never);
    const out: El[] = [updated];
    const label = boundTextOf(arrow, map);
    if (label) {
      const mid = labelPoint(route);
      out.push(newElementWith(label, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 }));
    }
    return out;
  }
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

// ---------- routing around shapes ----------

/** Bounds of an element as drawn (rotation, arrows' points). */
function drawnBox(el: El): Box {
  return boxFromBounds(getCommonBounds([el]));
}

const containsBox = (outer: Box, inner: Box) =>
  outer.x <= inner.x + 0.5 && outer.y <= inner.y + 0.5 && outer.x + outer.width >= inner.x + inner.width - 0.5 && outer.y + outer.height >= inner.y + inner.height - 0.5;

/**
 * Boxes an arrow between `ends` should go around: shapes, images, icons and free text. Not arrows,
 * lines, freehand, frames, text inside shapes, the `exclude` elements (the arrow, its ends), what
 * sits inside an end (an icon's image and caption), or anything drawn around an end (a zone or box
 * the end lives in: the arrow may run inside it).
 */
export function avoidObstacles(map: ElMap, exclude: ReadonlySet<string>, ends: readonly Box[]): Box[] {
  const out: Box[] = [];
  for (const el of map.values()) {
    if (el.isDeleted || exclude.has(el.id) || isLinear(el) || el.type === "freedraw" || el.type === "frame" || el.type === "magicframe" || el.type === "selection") continue;
    if (el.type === "text" && (el as El & Loose).containerId) continue;
    const box = drawnBox(el);
    if (ends.some((e) => containsBox(box, e) || containsBox(e, box))) continue;
    out.push(box);
  }
  return out;
}

/**
 * Element fields for an arrow that goes around shapes along `route` from `a` to `b`: a native elbow
 * arrow whose middle segments are "fixed", so Excalidraw keeps them when a shape moves.
 */
export function aroundFields(route: readonly Point[], a: El | undefined, b: El | undefined): Loose {
  const fixed = fixedSegmentsFor(route);
  return {
    ...arrowShape(route),
    ...bindingsFor(route, a, b, true),
    elbowed: true,
    roundness: null,
    fixedSegments: fixed.length ? fixed : null,
    startIsSpecial: false,
    endIsSpecial: false,
  };
}

/**
 * Re-route an arrow around the shapes in its way, keeping the sides (and positions along them)
 * where it leaves and arrives. Returns the changed arrow and its label.
 */
export function rerouteAround(arrow: El, map: ElMap): El[] {
  const a = arrow as El & { points: [number, number][]; startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };
  const from = a.startBinding ? map.get(a.startBinding.elementId) : undefined;
  const to = a.endBinding ? map.get(a.endBinding.elementId) : undefined;
  const pts = a.points;
  const startPt: Point = { x: a.x + pts[0][0], y: a.y + pts[0][1] };
  const endPt: Point = { x: a.x + pts[pts.length - 1][0], y: a.y + pts[pts.length - 1][1] };
  // Where the arrow meets a shape: from the binding's fixed point (a ratio of the shape's box, so it
  // is right even when the shape has just moved), else from the old end point.
  const port = (el: El | undefined, p: Point, binding: { fixedPoint?: [number, number] | null } | null): { point: Point; side?: Side; box?: Box } => {
    if (!el) return { point: p };
    const box = boxOf(el);
    const fp = binding?.fixedPoint;
    const at = fp ? { x: box.x + fp[0] * box.width, y: box.y + fp[1] * box.height } : p;
    const { side, ratio } = nearestSide(box, at);
    return { point: portPoint(box, side, ratio, ELBOW_GAP), side, box };
  };
  const s = port(from, startPt, a.startBinding as { fixedPoint?: [number, number] | null } | null);
  const e = port(to, endPt, a.endBinding as { fixedPoint?: [number, number] | null } | null);
  const exclude = new Set([arrow.id, ...(from ? [from.id] : []), ...(to ? [to.id] : [])]);
  const label = boundTextOf(arrow, map);
  if (label) exclude.add(label.id);
  const ends = [s.box, e.box].filter((b): b is Box => !!b);
  const route = routeAround({
    start: s.point,
    startSide: s.side,
    end: e.point,
    endSide: e.side,
    startBox: s.box,
    endBox: e.box,
    obstacles: avoidObstacles(map, exclude, ends),
  });
  const data = { ...(arrow.customData ?? {}), mydrawAvoid: true };
  delete (data as Loose).mydrawRouting;
  const updated = newElementWith(arrow, { ...aroundFields(route.points, from, to), customData: data } as never);
  const out: El[] = [updated];
  if (label) {
    const mid = labelPoint(route.points);
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

/** Size of a text in the given font. */
export function measureText(text: string, fontSize: number, fontFamily: number): { width: number; height: number } {
  const [t] = convertToExcalidrawElements([{ type: "text", x: 0, y: 0, text, fontSize, fontFamily: fontFamily as never }]);
  return { width: t.width, height: t.height };
}

/** Re-measure a standalone text element after its text or font changed. */
export function remeasureText(el: El, patch: Loose): El {
  const t = { ...(el as El & Loose), ...patch };
  const [made] = convertToExcalidrawElements([
    {
      type: "text",
      x: el.x,
      y: el.y,
      // The new text if one is given, else what was typed (not its current wrapping).
      text: "text" in patch ? String(patch.text ?? "") : typedText(el as El & Loose),
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
    const a = bindTarget(assertBindable(current(from), from), map);
    const b = bindTarget(assertBindable(current(to), to), map);
    if (a.id === b.id) throw new Error(`${sk.type} "${sk.id}": from and to are the same element`);
    const routing = parseRouting(sk.routing, "straight");
    delete sk.routing;
    const route = (sk.route as Point[] | undefined) ?? undefined;
    delete sk.route;
    const made = connectorElements(sk, a, b, routing, route);
    for (const v of made) {
      added.push(v);
      map.set(v.id, v);
    }
    replace(addBound(current(a.id)!, { id: sk.id as string, type: "arrow" }));
    replace(addBound(current(b.id)!, { id: sk.id as string, type: "arrow" }));
  }

  return { added, changed: [...changed.values()], ids };
}

export function parseRouting(v: unknown, fallback: Routing): Routing {
  if (v === undefined || v === null) return fallback;
  if (v === "elbow" || v === "straight" || v === "curved") return v;
  throw new Error('routing must be "straight", "elbow" or "curved"');
}

/**
 * A bound connector (arrow or line, plus its label) from `a` to `b`. `sk` is an Excalidraw arrow
 * skeleton with id and style; `route` an optional absolute route from a layout. Callers add the
 * arrow to `a` and `b`'s boundElements.
 */
export function connectorElements(sk: Loose, a: El, b: El, routing: Routing, route?: Point[], labelAt?: Point): El[] {
  const path = routeBetween(a, b, routing, route);
  const fields = routingFields(routing, String(sk.type), sk.customData as Loose | undefined);
  const skeleton: Loose = { ...sk, ...arrowShape(path) };
  if (routing !== "straight") skeleton.roundness = fields.roundness;
  const made = convertToExcalidrawElements([skeleton as never], { regenerateIds: false });
  return made.map((el) =>
    // The converter normalizes points (e.g. shifts the first one); keep our route exactly.
    el.id === sk.id ? ({ ...el, ...arrowShape(path), ...fields, roundness: (el as El).roundness, ...bindingsFor(path, a, b, fields.elbowed === true) } as El) : el,
  ).map((el) => {
    // Re-centre the label on the route: at `labelAt` (a free stretch picked by the layout) when that
    // lies on the route, else at Excalidraw's own label point.
    if (el.type !== "text" || (el as El & Loose).containerId !== sk.id) return el;
    const mid = labelAt && distToPolyline(labelAt, path) <= labelOffsetLimit(el.width) ? labelAt : labelPoint(path);
    return { ...el, x: mid.x - el.width / 2, y: mid.y - el.height / 2 } as El;
  });
}

// Where Excalidraw puts an arrow's label (shared with the label guard, shared/labelGuard.ts).
export { labelPoint };

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
      if (k === "id" || k === "label" || k === "dx" || k === "dy" || k === "data" || k === "routing" || k === "textOutline" || k === "shadow" || k === "shadowLabel" || k === "strokeStyle" || k === "gradient") continue;
      if (!UPDATABLE.has(k)) throw new Error(`"${k}" can't be updated here (use raw_update for other fields)`);
      patch[k] =
        (k === "strokeColor" || k === "backgroundColor") && typeof v === "string"
          ? requireColor(v, k)
          : k === "fontFamily"
            ? resolveFontFamily(v)
            : k === "fillStyle"
              ? requireFillStyle(v)
              : v;
    }
    if ("link" in patch) {
      if (patch.link === "" || patch.link === undefined) patch.link = null;
      if (patch.link !== null) {
        const bad = typeof patch.link === "string" ? linkProblem(patch.link) : "link must be a string (or null to remove it)";
        if (bad) throw new Error(`element "${id}": ${bad}`);
      }
    }
    if (typeof u.dx === "number") patch.x = (typeof patch.x === "number" ? patch.x : el.x) + u.dx;
    if (typeof u.dy === "number") patch.y = (typeof patch.y === "number" ? patch.y : el.y) + u.dy;
    if (u.data && typeof u.data === "object") patch.customData = { ...(el.customData ?? {}), ...(u.data as Loose) };
    if (u.gradient !== undefined) {
      if (!canGradient(el.type)) throw new Error(`"${id}" is a ${el.type}; gradients apply to rectangles, diamonds and ellipses`);
      Object.assign(patch, gradientPatch((patch.customData as Loose | undefined) ?? (el.customData as Loose | undefined), parseGradient(u.gradient) ?? null));
    }
    if (u.strokeStyle !== undefined) {
      const name = requireStrokeStyle(u.strokeStyle);
      Object.assign(patch, dashPatch((patch.customData as Loose | undefined) ?? (el.customData as Loose | undefined), isDashId(name) ? name : null, isDashId(name) ? "dashed" : name));
    }
    if (u.textOutline !== undefined) {
      // On text: its own outline. On a shape or arrow: its label's.
      const outline = parseTextOutline(u.textOutline);
      if (el.type === "text") patch.customData = withOutline((patch.customData as Loose | undefined) ?? (el.customData as Loose | undefined), outline);
      else {
        const label = boundTextOf(el, map);
        if (!label) throw new Error(`"${id}" is a ${el.type} without a label; textOutline applies to text and labels`);
        set(newElementWith(label, { customData: withOutline(label.customData as Loose | undefined, outline) } as never));
      }
    }
    if (u.shadow !== undefined || u.shadowLabel !== undefined) {
      // An icon node's shadow goes on its image (the container is an invisible box).
      const sh = parseShadow(u.shadow);
      if (sh !== undefined) {
        const image = isIconNode(el) ? iconImageOf(el, map) : undefined;
        if (image) set(newElementWith(map.get(image.id) ?? image, { customData: withShadow((map.get(image.id) ?? image).customData as Loose | undefined, sh) } as never));
        else {
          if (!canShadow(el.type)) throw new Error(`"${id}" is a ${el.type}; shadows apply to shapes, text, lines, arrows, freedraw and images`);
          patch.customData = withShadow((patch.customData as Loose | undefined) ?? (el.customData as Loose | undefined), sh);
        }
      }
      // shadowLabel: true = the label (or icon caption) gets the same shadow; false = its shadow is removed.
      if (u.shadowLabel !== undefined) {
        const label = boundTextOf(el, map);
        if (!label) throw new Error(`"${id}" has no label; shadowLabel needs a shape, arrow or icon node with a label`);
        const own = isIconNode(el) ? iconImageOf(el, map) : el;
        const lsh = u.shadowLabel ? (sh ?? shadowOf(own ? (map.get(own.id) ?? own) : undefined) ?? parseShadow(true)!) : null;
        set(newElementWith(label, { customData: withShadow(label.customData as Loose | undefined, lsh) } as never));
      }
    }
    if (u.routing !== undefined) {
      if (!isLinear(el)) throw new Error(`"${id}" is a ${el.type}; routing applies to arrows and lines`);
      const routing = parseRouting(u.routing, "straight");
      const f = routingFields(routing, el.type, (patch.customData as Loose | undefined) ?? (el.customData as Loose | undefined));
      Object.assign(patch, f);
      if (routing === "straight") {
        const pts = (el as El & { points: [number, number][] }).points;
        patch.points = [pts[0], pts[pts.length - 1]];
      }
      geometryChanged.add(id);
    }
    // Icon node caption: widen the node (around its centre) so the caption stays on one line.
    if (isIconNode(el) && typeof u.label === "string" && u.label) {
      const img = iconImageOf(el, map);
      const st0 = boundTextOf(el, map) as (El & Loose) | undefined;
      const w = Math.max((img?.width ?? 0) + 8, measureText(u.label, (st0?.fontSize as number) ?? 14, (st0?.fontFamily as number) ?? st.currentItemFontFamily).width + 14);
      patch.x = (typeof patch.x === "number" ? patch.x : el.x) + (el.width - w) / 2;
      patch.width = w;
    }
    // Zone title lives in its own text element.
    if (isZone(el) && u.label !== undefined) {
      const title = zoneTitleOf(el, map);
      if (title && u.label) set(remeasureText(title, { text: String(u.label) }));
      else if (title) set(newElementWith(title, { isDeleted: true }));
      else if (u.label) {
        // A zone made without a label has no title yet: add one in the zone's group, top left.
        const [made] = convertToExcalidrawElements(
          [
            {
              type: "text",
              id: `${el.id}.title`,
              x: (typeof patch.x === "number" ? patch.x : el.x) + 14,
              y: (typeof patch.y === "number" ? patch.y : el.y) + 10,
              text: String(u.label),
              fontSize: 16,
              fontFamily: st.currentItemFontFamily as never,
              strokeColor: el.strokeColor,
            } as never,
          ],
          { regenerateIds: false },
        );
        const t = { ...made, locked: el.locked, groupIds: el.groupIds, customData: { mydrawZoneTitle: el.id } } as El;
        added.push(t);
        map.set(t.id, t);
      }
    }

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
    if (u.label !== undefined && !isZone(el)) applyLabel(el, u.label === null ? null : String(u.label));
    else if (geometryChanged.has(id) && !isLinear(el) && boundTextOf(el, map)) {
      applyLabel(el, typedText(boundTextOf(el, map) as El & Loose));
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
    // An icon node goes as a whole (container, image, caption); a zone takes its title along.
    const node = iconNodeOf(el, map);
    if (node) {
      for (const m of map.values()) if (m.groupIds[0] === node.groupIds[0] && node.groupIds[0]) doomed.add(m.id);
      doomed.add(node.id);
      const caption = boundTextOf(node, map);
      if (caption) doomed.add(caption.id);
    }
    if (isZone(el)) {
      const title = zoneTitleOf(el, map);
      if (title) doomed.add(title.id);
    }
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
    // Contents of a deleted zone stay (like a frame's) and move up to the zone's parent zone.
    const z = zoneOf(el);
    if (z && doomed.has(z)) {
      let parent: string | null = zoneOf(map.get(z)!);
      while (parent && doomed.has(parent)) parent = zoneOf(map.get(parent)!) ?? null;
      const data = { ...(el.customData ?? {}) };
      if (parent) data.mydrawZoneId = parent;
      else delete data.mydrawZoneId;
      patch.customData = data;
    }
    if (Object.keys(patch).length) out.push(newElementWith(el, patch as never));
  }
  return out;
}

/** Elements plus their bound labels, and every member of the outermost groups they belong to. */
export function withGroupsAndLabels(ids: readonly string[], scene: readonly El[], opts: { contents?: boolean } = {}): El[] {
  const contents = opts.contents !== false;
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
  // A zone brings its title and contents (with their groups).
  const zones = [...pick].filter((id) => isZone(map.get(id)));
  if (zones.length) {
    // (styling passes contents:false: a zone's style must not spill onto what is inside it)
    const inner = contents ? zones.flatMap((z) => zoneContents(z, live)) : [];
    const innerGroups = new Set(inner.map((el) => el.groupIds.at(-1)).filter((g): g is string => !!g));
    for (const el of inner) pick.add(el.id);
    for (const el of live) {
      if (el.groupIds.some((g) => innerGroups.has(g))) pick.add(el.id);
      if (el.type === "text" && el.customData?.mydrawZoneTitle && pick.has(el.customData.mydrawZoneTitle as string)) pick.add(el.id);
    }
  }
  // A frame brings its contents (and their groups), like moving or exporting a frame in Excalidraw.
  const frames = new Set(contents ? [...pick].filter((id) => map.get(id)!.type === "frame" || map.get(id)!.type === "magicframe") : []);
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
