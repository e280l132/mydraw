// ⌘-click links (quick connect): an arrow from a unit to another unit (or to a free point), routed
// around the shapes in between, through optional bend points. `LinkPlanner` is used for the live
// preview (scene coordinates, no scene changes); `createLink` commits the arrow as one undo step;
// `routeArrowsAround` re-routes existing arrows the same way.
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Box, Point } from "../../shared/geometry";
import { alignedPorts, portPoint, routeAround } from "../../shared/avoidRoute";
import { pickAnchor } from "../../shared/quickConnect";
import { curvedPoints, ELBOW_GAP, type Side } from "../../shared/routing";
import {
  addBound,
  aroundFields,
  avoidObstacles,
  bindingsFor,
  arrowShape,
  boxOf,
  buildElements,
  randomId,
  rerouteAround,
  type El,
  type ElMap,
} from "./agent/sceneOps";
import { unitById, type QuickUnit } from "./quickConnectOps";
import { commitElements, selectedIds } from "./uiActions";

type Loose = Record<string, unknown>;

/** How the arrow is drawn. "around" goes around shapes; "elbow" is orthogonal but straight through. */
export type LinkRouting = "around" | "elbow" | "straight" | "curved";
export type LinkHeads = "end" | "both" | "none";

export interface LinkStyle {
  routing: LinkRouting;
  heads: LinkHeads;
  dashed: boolean;
}

export const DEFAULT_LINK_STYLE: LinkStyle = { routing: "around", heads: "end", dashed: false };
export const LINK_ROUTINGS: readonly LinkRouting[] = ["around", "elbow", "straight", "curved"];
export const LINK_HEADS: readonly LinkHeads[] = ["end", "both", "none"];

const STYLE_KEY = "mydraw.linkStyle";

export function loadLinkStyle(): LinkStyle {
  try {
    const s = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "{}") as Partial<LinkStyle>;
    return {
      routing: LINK_ROUTINGS.includes(s.routing as LinkRouting) ? (s.routing as LinkRouting) : DEFAULT_LINK_STYLE.routing,
      heads: LINK_HEADS.includes(s.heads as LinkHeads) ? (s.heads as LinkHeads) : DEFAULT_LINK_STYLE.heads,
      dashed: s.dashed === true,
    };
  } catch {
    return DEFAULT_LINK_STYLE;
  }
}

export function saveLinkStyle(style: LinkStyle): void {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    // not important
  }
}

/** Where the arrow arrives: a unit (a side, or "auto" for the best one, and a position along it) or a free point. */
export type LinkEnd = { unitId: string; side: Side | "auto"; ratio: number } | { point: Point };

export interface LinkPlan {
  /** The route, scene coordinates. */
  points: Point[];
  /** False when no clear path around the shapes was found (a plain elbow is drawn instead). */
  ok: boolean;
  fromId: string;
  fromSide: Side;
  /** The element the arrow binds to at the end, and the side it arrives on (when it ends on a unit). */
  toId?: string;
  toSide?: Side;
  waypoints: Point[];
  routing: LinkRouting;
}

const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];

const liveMap = (els: readonly El[]): ElMap => new Map(els.filter((e) => !e.isDeleted).map((e) => [e.id, e]));

/**
 * Plans links from one unit and side. Keeps the scene snapshot it was made with, so the preview can
 * re-plan on every pointer move cheaply.
 */
export class LinkPlanner {
  private map: ElMap;
  private source: QuickUnit;
  private fromEl: El;
  private fromBox: Box;
  private obstacleCache = new Map<string, Box[]>();

  constructor(
    api: ExcalidrawImperativeAPI,
    readonly sourceId: string,
    readonly side: Side,
  ) {
    this.map = liveMap(api.getSceneElements());
    const unit = unitById(api, sourceId);
    if (!unit) throw new Error("the shape is gone");
    this.source = unit;
    const anchor = pickAnchor(unit.members, side);
    if (!anchor) throw new Error("there is nothing to connect from");
    this.fromEl = anchor;
    this.fromBox = boxOf(anchor);
  }

  get sourceBox(): Box {
    return this.source.box;
  }

  /** Obstacles for a link to `target` (cached per target). */
  private obstacles(target: QuickUnit | null, toBox: Box | null): Box[] {
    const key = target?.id ?? "";
    let list = this.obstacleCache.get(key);
    if (!list) {
      const exclude = new Set([...this.source.members.map((m) => m.id), ...(target ? target.members.map((m) => m.id) : [])]);
      const ends = [this.source.box, this.fromBox, ...(target ? [target.box] : []), ...(toBox ? [toBox] : [])];
      list = avoidObstacles(this.map, exclude, ends);
      this.obstacleCache.set(key, list);
    }
    return list;
  }

  private route(routing: LinkRouting, start: Point, end: Point, endSide: Side | undefined, toBox: Box | undefined, waypoints: Point[], target: QuickUnit | null): { points: Point[]; ok: boolean; cost: number } {
    if (routing === "straight") return { points: [start, ...waypoints, end], ok: true, cost: 0 };
    if (routing === "curved") return { points: waypoints.length ? [start, ...waypoints, end] : curvedPoints(start, end), ok: true, cost: 0 };
    const r = routeAround({
      start,
      startSide: this.side,
      end,
      endSide,
      startBox: this.fromBox,
      endBox: toBox,
      waypoints,
      obstacles: routing === "around" ? this.obstacles(target, toBox ?? null) : [],
    });
    return r;
  }

  plan(end: LinkEnd, waypoints: Point[], routing: LinkRouting, unitOf: (id: string) => QuickUnit | null): LinkPlan | null {
    const base = { fromId: this.fromEl.id, fromSide: this.side, waypoints, routing };
    if ("point" in end) {
      const r = this.route(routing, portPoint(this.fromBox, this.side, 0.5, ELBOW_GAP), end.point, undefined, undefined, waypoints, null);
      return { ...base, points: r.points, ok: r.ok };
    }
    const target = unitOf(end.unitId);
    if (!target || target.id === this.source.id) return null;
    const sides = end.side === "auto" ? SIDES : [end.side];
    let best: (LinkPlan & { cost: number }) | null = null;
    for (const side of sides) {
      const toEl = pickAnchor(target.members, side);
      if (!toEl) continue;
      const toBox = boxOf(toEl);
      const ratio = end.side === "auto" ? 0.5 : end.ratio;
      // Facing sides that overlap across get ports on one line: a straight arrow, not a small jog.
      // (Not with bend points, and not for curved links, which are meant to bend.)
      const ports =
        waypoints.length || routing === "curved"
          ? { start: portPoint(this.fromBox, this.side, 0.5, ELBOW_GAP), end: portPoint(toBox, side, ratio, ELBOW_GAP) }
          : alignedPorts(this.fromBox, this.side, toBox, side, ratio, { explicit: end.side !== "auto", gap: ELBOW_GAP });
      const r = this.route(routing, ports.start, ports.end, side, toBox, waypoints, target);
      // Straight and curved links pick the side nearest to the source instead (they have no cost).
      const cost = routing === "straight" || routing === "curved" ? distance(this.fromBox, toBox, side) : r.cost + (r.ok ? 0 : 1e6);
      if (!best || cost < best.cost) best = { ...base, points: r.points, ok: r.ok, toId: toEl.id, toSide: side, cost };
    }
    if (!best) return null;
    const { cost: _cost, ...plan } = best;
    return plan;
  }
}

/** Distance from `a`'s centre to the middle of `b`'s `side` (for picking a side for straight links). */
function distance(a: Box, b: Box, side: Side): number {
  const p = portPoint(b, side);
  return Math.hypot(a.x + a.width / 2 - p.x, a.y + a.height / 2 - p.y);
}

/** Commit a planned link as one undo step. Returns the arrow id. */
export function createLink(api: ExcalidrawImperativeAPI, plan: LinkPlan, style: LinkStyle): string {
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  const st: AppState = api.getAppState();
  const from = map.get(plan.fromId);
  if (!from) throw new Error("the shape is gone");
  const to = plan.toId ? map.get(plan.toId) : undefined;
  if (plan.toId && !to) throw new Error("the target is gone");
  const id = randomId();
  const points = plan.points;

  // Let buildElements make a properly styled arrow (current stroke, width, roughness, font) and the
  // boundElements bookkeeping; then put our route and bindings on it.
  const routingForBuild = style.routing === "straight" ? "straight" : style.routing === "curved" ? "curved" : "elbow";
  const r = to
    ? buildElements([{ type: "arrow", id, from: from.id, to: to.id, routing: routingForBuild }], scene, st)
    : buildElements([{ type: "arrow", id, x: points[0].x, y: points[0].y, points: [[0, 0], [1, 0]] }], scene, st);
  const made = r.added.find((e) => e.id === id);
  if (!made) throw new Error("could not make the arrow");
  const changed = [...r.changed];
  if (!to) changed.push(addBound(from, { id, type: "arrow" }));

  let geometry: Loose;
  if (style.routing === "around" || style.routing === "elbow") {
    geometry = aroundFields(points, from, to);
    // A plain elbow without bend points may be re-routed by Excalidraw freely; anything else keeps its segments.
    if (style.routing === "elbow" && plan.waypoints.length === 0) geometry = { ...geometry, fixedSegments: null };
  } else {
    geometry = {
      ...arrowShape(points),
      ...bindingsFor(points, from, to, false),
      elbowed: false,
      roundness: style.routing === "curved" ? { type: 2 } : null,
    };
  }
  const data: Loose = { ...((made.customData as Loose | undefined) ?? {}) };
  delete data.mydrawRouting;
  delete data.mydrawAvoid;
  if (style.routing === "around") data.mydrawAvoid = true;
  if (style.routing === "curved") data.mydrawRouting = "curved";
  // Inside one frame the arrow belongs to it too; across frames it stays outside both.
  const frameId = from.frameId && (!to || from.frameId === to.frameId) ? from.frameId : null;
  const arrow = {
    ...made,
    ...geometry,
    frameId,
    startArrowhead: style.heads === "both" ? "arrow" : null,
    endArrowhead: style.heads === "none" ? null : "arrow",
    strokeStyle: style.dashed ? "dashed" : "solid",
    customData: Object.keys(data).length ? data : undefined,
  } as El;
  commitElements(api, changed, [arrow, ...r.added.filter((e) => e.id !== id)]);
  return id;
}

/**
 * Re-route arrows around the shapes in their way (keeping where they leave and arrive). `ids`:
 * these arrows. Default: the selected arrows plus the arrows attached to the selected shapes; with
 * nothing selected, every arrow in the drawing. One undo step.
 */
export function routeArrowsAround(api: ExcalidrawImperativeAPI, ids?: readonly string[]): { count: number; scope: "given" | "selection" | "all" } {
  const scene = api.getSceneElements();
  const map = liveMap(scene);
  let targets: El[];
  let scope: "given" | "selection" | "all";
  if (ids) {
    targets = ids.map((i) => map.get(i)).filter((e): e is El => !!e && e.type === "arrow");
    scope = "given";
  } else {
    const sel = new Set(selectedIds(api));
    const bound = (e: El) => {
      const a = e as El & { startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null };
      return (!!a.startBinding && sel.has(a.startBinding.elementId)) || (!!a.endBinding && sel.has(a.endBinding.elementId));
    };
    targets = sel.size ? (scene.filter((e) => e.type === "arrow" && !e.isDeleted && (sel.has(e.id) || bound(e as El))) as El[]) : (scene.filter((e) => e.type === "arrow" && !e.isDeleted) as El[]);
    scope = sel.size ? "selection" : "all";
  }
  const changed: El[] = [];
  for (const arrow of targets) {
    for (const e of rerouteAround(map.get(arrow.id) ?? arrow, map)) {
      changed.push(e);
      map.set(e.id, e);
    }
  }
  if (changed.length) commitElements(api, changed);
  return { count: targets.length, scope };
}
