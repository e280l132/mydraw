// ⌘-click (or ⌘-drag) on a quick connect handle: draw an arrow to another shape, routed around the
// shapes in between. While picking:
//   - the real route is previewed as the pointer moves;
//   - over a shape: near one of its sides, that side (and the nearest quarter point) is used; over
//     its middle, the best side is picked automatically;
//   - click the target to connect (Shift-click: connect and keep going from the same shape);
//   - click empty canvas to add a bend point the route must pass; Backspace removes the last one;
//   - double-click empty canvas (or Enter) ends the arrow there, unattached;
//   - R: route style (around shapes / elbow / straight / curved), A: arrowheads, D: dashed (defaults; the keys are settings);
//   - Esc or right-click cancels. Scrolling and zooming keep working.
// Pointer events are read on the window (capture) so the canvas keeps its wheel; the overlay itself
// never takes pointer events.
import { useEffect, useMemo, useRef, useState } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Point } from "../../shared/geometry";
import { nearestSide, snapRatio } from "../../shared/avoidRoute";
import type { QuickSide } from "../../shared/quickConnect";
import type { LinkKeys } from "../../shared/quickBindings";
import { createLink, LINK_HEADS, LINK_ROUTINGS, LinkPlanner, loadLinkStyle, saveLinkStyle, type LinkEnd, type LinkPlan, type LinkStyle } from "./linkOps";
import { quickSourceAt, unitById } from "./quickConnectOps";
import { pickAnchor } from "../../shared/quickConnect";
import { boxOf } from "./agent/sceneOps";

interface Props {
  getApi(): ExcalidrawImperativeAPI | undefined;
  sourceId: string;
  side: QuickSide;
  /** Keys that switch routing / arrow heads / dashed (Settings.quickConnect.linkKeys). */
  keys: LinkKeys;
  /** Where the pointer was pressed when linking started with a drag from the handle (release over a target connects). */
  pressedAt: { x: number; y: number } | null;
  /** `refocus`: give the canvas the keyboard back (not when the user clicked into a panel or input). */
  onEnd(refocus?: boolean): void;
  onToast(text: string, error?: boolean): void;
}

type Box4 = { x1: number; y1: number; x2: number; y2: number };

interface Frame {
  path: Point[];
  ok: boolean;
  source: Box4;
  target: Box4 | null;
  /** The port the arrow arrives at (when on a target), and the quarter points the user can aim at. */
  port: Point | null;
  ports: Point[];
  waypoints: Point[];
  pointer: Point | null;
  onTarget: boolean;
  explicitSide: boolean;
}

const ROUTING_LABEL: Record<LinkStyle["routing"], string> = { around: "Around shapes", elbow: "Elbow", straight: "Straight", curved: "Curved" };
const HEADS_LABEL: Record<LinkStyle["heads"], string> = { end: "→", both: "↔", none: "—" };
/** How close (screen px) to a target's side the pointer must be to choose that side. */
const SIDE_BAND = 22;

const next = <T,>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length];

/**
 * Excalidraw starts a new text on a double-click on empty canvas. A double-click that ends a link
 * (or two quick bend-point clicks) must not do that: swallow the dblclick that follows.
 */
function swallowNext(type: "dblclick" | "contextmenu", ms = 600): void {
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener(type, stop, true);
  window.setTimeout(() => window.removeEventListener(type, stop, true), ms);
}

function swallowDoubleClick(): void {
  swallowNext("dblclick");
}

function toScreen(st: AppState, p: Point): Point {
  const z = st.zoom.value;
  return { x: (p.x + st.scrollX) * z + st.offsetLeft, y: (p.y + st.scrollY) * z + st.offsetTop };
}

function boxToScreen(st: AppState, b: { x: number; y: number; width: number; height: number }): Box4 {
  const a = toScreen(st, b);
  const c = toScreen(st, { x: b.x + b.width, y: b.y + b.height });
  return { x1: a.x, y1: a.y, x2: c.x, y2: c.y };
}

/** SVG path for the preview: straight segments, or a smooth curve for curved links. */
function pathData(points: Point[], curved: boolean): string {
  if (points.length < 2) return "";
  if (curved && points.length === 3) {
    const [s, c, e] = points;
    // A quadratic curve that passes through the middle point.
    const q = { x: 2 * c.x - (s.x + e.x) / 2, y: 2 * c.y - (s.y + e.y) / 2 };
    return `M${s.x},${s.y} Q${q.x},${q.y} ${e.x},${e.y}`;
  }
  return points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
}

export function LinkMode({ getApi, sourceId, side, keys, pressedAt, onEnd, onToast }: Props) {
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const [style, setStyleState] = useState<LinkStyle>(loadLinkStyle);
  const styleRef = useRef(style);
  styleRef.current = style;
  const setStyle = (s: LinkStyle) => {
    saveLinkStyle(s);
    styleRef.current = s;
    setStyleState(s);
  };
  const planner = useMemo(() => {
    const api = getApi();
    try {
      return api ? new LinkPlanner(api, sourceId, side) : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const waypoints = useRef<Point[]>([]);
  const lastEmpty = useRef<{ t: number; p: Point } | null>(null);
  const spaceHeld = useRef(false);
  const pointer = useRef<{ x: number; y: number; onCanvas: boolean } | null>(pressedAt ? { ...pressedAt, onCanvas: false } : null);
  const pressed = useRef(pressedAt);
  const [frame, setFrame] = useState<Frame | null>(null);
  const endRef = useRef<(refocus?: boolean) => void>(onEnd);
  endRef.current = onEnd;

  /** Where the link would end for the pointer (client coords). */
  const endFor = (api: ExcalidrawImperativeAPI, clientX: number, clientY: number, onCanvas: boolean): { end: LinkEnd; explicit: boolean } => {
    const st = api.getAppState();
    const p = viewportCoordsToSceneCoords({ clientX, clientY }, st);
    const u = onCanvas ? quickSourceAt(api, p.x, p.y) : null;
    if (!u || u.id === planner?.sourceId || (planner && u.members.some((m) => m.id === sourceId))) return { end: { point: p }, explicit: false };
    const { side: s } = nearestSide(u.box, p);
    const horizontalSide = s === "top" || s === "bottom";
    const edgeDist =
      s === "left" ? p.x - u.box.x : s === "right" ? u.box.x + u.box.width - p.x : s === "top" ? p.y - u.box.y : u.box.y + u.box.height - p.y;
    const depth = horizontalSide ? u.box.height : u.box.width;
    const band = Math.min(SIDE_BAND / st.zoom.value, depth * 0.35);
    if (edgeDist <= band) {
      // The position along the side is measured on the element the arrow binds to on that side (an
      // icon's container, a stencil's image or caption), the same box the ports are drawn on.
      const anchor = pickAnchor(u.members, s);
      const ab = anchor ? boxOf(anchor) : u.box;
      const along = horizontalSide ? (p.x - ab.x) / Math.max(ab.width, 1) : (p.y - ab.y) / Math.max(ab.height, 1);
      return { end: { unitId: u.id, side: s, ratio: snapRatio(Math.min(1, Math.max(0, along)), horizontalSide ? ab.width : ab.height) }, explicit: true };
    }
    return { end: { unitId: u.id, side: "auto", ratio: 0.5 }, explicit: false };
  };

  const plan = (api: ExcalidrawImperativeAPI, end: LinkEnd): LinkPlan | null =>
    planner ? planner.plan(end, waypoints.current, styleRef.current.routing, (id) => unitById(api, id)) : null;

  const finish = (end: LinkEnd, keepGoing: boolean) => {
    const api = getApi();
    if (!api || !planner) return endRef.current();
    const p = plan(api, end);
    if (!p) {
      onToast("Those two can't be connected.", true);
      return;
    }
    try {
      createLink(api, p, styleRef.current);
    } catch (e) {
      onToast(`Could not connect: ${(e as Error).message}`, true);
    }
    waypoints.current = [];
    if (!keepGoing) endRef.current();
  };

  // Crosshair over the canvas while picking.
  useEffect(() => {
    document.body.classList.add("md-linking");
    return () => document.body.classList.remove("md-linking");
  }, []);

  // Pointer and keys, on the window in the capture phase (before Excalidraw sees them).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, onCanvas: e.target instanceof HTMLCanvasElement };
    };
    const onDown = (e: PointerEvent) => {
      const api = getApi();
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        // The contextmenu event comes after this one, when link mode is gone: don't let it open
        // Excalidraw's menu.
        swallowNext("contextmenu");
        endRef.current();
        return;
      }
      // A click on the toolbar, a panel or a dialog ends linking and does its normal thing (and
      // keeps the focus it gives, e.g. to an input).
      if (!(e.target instanceof HTMLCanvasElement) || !api) {
        endRef.current(false);
        return;
      }
      // Space held: Excalidraw is panning the canvas.
      if (spaceHeld.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      pointer.current = { x: e.clientX, y: e.clientY, onCanvas: true };
      const { end } = endFor(api, e.clientX, e.clientY, true);
      if ("unitId" in end) return finish(end, e.shiftKey);
      const z = api.getAppState().zoom.value;
      // A second click on the same spot soon after (a double-click) ends the arrow there, unattached.
      // (Pointer events carry no click count, so this is detected here.) The first click added a
      // bend point at that spot: it goes.
      const prev = lastEmpty.current;
      const now = performance.now();
      if (prev && now - prev.t < 450 && Math.hypot(prev.p.x - end.point.x, prev.p.y - end.point.y) < 8 / z) {
        lastEmpty.current = null;
        swallowDoubleClick();
        waypoints.current = waypoints.current.slice(0, -1);
        return finish(end, false);
      }
      lastEmpty.current = { t: now, p: end.point };
      waypoints.current = [...waypoints.current, end.point];
    };
    const onUp = (e: PointerEvent) => {
      const start = pressed.current;
      pressed.current = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return; // a click: keep picking
      const api = getApi();
      if (!api) return;
      const { end } = endFor(api, e.clientX, e.clientY, e.target instanceof HTMLCanvasElement);
      if ("unitId" in end) finish(end, false); // dragged from the handle onto a target
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    // Double-clicks on the canvas would start a new text in Excalidraw.
    const onDouble = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return; // zoom and other ⌘ shortcuts keep working
      const k = e.key;
      if (k === " ") {
        spaceHeld.current = true; // Space-drag pans the canvas, as usual
        return;
      }
      const s = styleRef.current;
      let handled = true;
      if (k === "Escape") endRef.current();
      else if (k === "Backspace" || k === "Delete") waypoints.current = waypoints.current.slice(0, -1);
      else if (k.toLowerCase() === keysRef.current.routing) setStyle({ ...s, routing: next(LINK_ROUTINGS, s.routing) });
      else if (k.toLowerCase() === keysRef.current.heads) setStyle({ ...s, heads: next(LINK_HEADS, s.heads) });
      else if (k.toLowerCase() === keysRef.current.dashed) setStyle({ ...s, dashed: !s.dashed });
      else if (k === "Enter") {
        const api = getApi();
        const ptr = pointer.current;
        if (api && ptr) finish(endFor(api, ptr.x, ptr.y, ptr.onCanvas).end, false);
      } else if (k.length === 1 || k === "Tab") {
        // Swallow other letters: they would switch Excalidraw tools in the middle of linking.
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("dblclick", onDouble, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("dblclick", onDouble, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Preview: re-plan when the pointer, bend points, style or view change.
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const api = getApi();
      if (!api || !planner) return;
      const st = api.getAppState();
      const ptr = pointer.current;
      const key = JSON.stringify([ptr, waypoints.current.length, waypoints.current.at(-1), styleRef.current, st.scrollX, st.scrollY, st.zoom.value]);
      if (key === lastKey) return;
      lastKey = key;
      const sourceUnit = unitById(api, sourceId);
      if (!sourceUnit) return endRef.current();
      let f: Frame = {
        path: [],
        ok: true,
        source: boxToScreen(st, sourceUnit.box),
        target: null,
        port: null,
        ports: [],
        waypoints: waypoints.current.map((w) => toScreen(st, w)),
        pointer: ptr ? { x: ptr.x, y: ptr.y } : null,
        onTarget: false,
        explicitSide: false,
      };
      if (ptr) {
        const { end, explicit } = endFor(api, ptr.x, ptr.y, ptr.onCanvas);
        const p = plan(api, end);
        if (p) {
          f = { ...f, path: p.points.map((q) => toScreen(st, q)), ok: p.ok, explicitSide: explicit };
          if ("unitId" in end) {
            const u = unitById(api, end.unitId);
            if (u) {
              f.onTarget = true;
              f.target = boxToScreen(st, u.box);
              f.port = f.path.at(-1) ?? null;
              // The quarter points of each side, on the element the arrow binds to on that side.
              const quarter = (len: number) => (len < 60 ? [0.5] : [0.25, 0.5, 0.75]);
              const sideBox = (sd: "left" | "right" | "top" | "bottom") => {
                const a = pickAnchor(u.members, sd);
                return a ? boxOf(a) : u.box;
              };
              const t = sideBox("top");
              const bt = sideBox("bottom");
              const l = sideBox("left");
              const r = sideBox("right");
              f.ports = [
                ...quarter(t.width).map((q) => toScreen(st, { x: t.x + t.width * q, y: t.y })),
                ...quarter(bt.width).map((q) => toScreen(st, { x: bt.x + bt.width * q, y: bt.y + bt.height })),
                ...quarter(l.height).map((q) => toScreen(st, { x: l.x, y: l.y + l.height * q })),
                ...quarter(r.height).map((q) => toScreen(st, { x: r.x + r.width, y: r.y + r.height * q })),
              ];
            }
          }
        }
      }
      setFrame(f);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!planner) return null;
  const heads = style.heads;
  const action = !frame?.pointer
    ? "Move to a shape or icon"
    : frame.onTarget
      ? frame.explicitSide
        ? "Click to connect to this side · Shift-click: connect and keep going"
        : "Click to connect (best side) · point at a side to choose it"
      : frame.waypoints.length
        ? "Click: another bend · double-click: end here · ⌫ removes the last bend"
        : "Click a shape to connect · click empty space to add a bend";
  return (
    <div className="md-qc-linkmode" data-routing={style.routing}>
      <svg className="md-qc-link-svg" width="100%" height="100%">
        <defs>
          <marker id="md-qc-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="md-qc-headpath" />
          </marker>
        </defs>
        {frame && <rect className="md-qc-src" x={frame.source.x1 - 4} y={frame.source.y1 - 4} width={frame.source.x2 - frame.source.x1 + 8} height={frame.source.y2 - frame.source.y1 + 8} rx="6" />}
        {frame?.target && (
          <rect className="md-qc-target" x={frame.target.x1 - 4} y={frame.target.y1 - 4} width={frame.target.x2 - frame.target.x1 + 8} height={frame.target.y2 - frame.target.y1 + 8} rx="6" />
        )}
        {frame?.ports.map((p, i) => <circle key={i} className="md-qc-port-option" cx={p.x} cy={p.y} r="3" />)}
        {frame && frame.path.length > 1 && (
          <path
            className={`md-qc-path${frame.ok ? "" : " blocked"}${style.dashed ? " dashed" : ""}`}
            d={pathData(frame.path, style.routing === "curved")}
            markerEnd={heads === "none" ? undefined : "url(#md-qc-head)"}
            markerStart={heads === "both" ? "url(#md-qc-head)" : undefined}
          />
        )}
        {frame?.port && <circle className="md-qc-port" cx={frame.port.x} cy={frame.port.y} r="5" />}
        {frame?.waypoints.map((w, i) => <rect key={i} className="md-qc-wp" x={w.x - 4} y={w.y - 4} width="8" height="8" />)}
      </svg>
      {frame?.pointer && (
        <div
          className="md-qc-link-hint"
          // Near the right edge the hint goes to the left of the pointer, so it stays readable.
          style={frame.pointer.x > window.innerWidth - 420 ? { right: window.innerWidth - frame.pointer.x + 16, top: frame.pointer.y + 18 } : { left: frame.pointer.x + 16, top: frame.pointer.y + 18 }}
        >
          <div>{action}</div>
          <div className="md-qc-link-keys">
            <b>{ROUTING_LABEL[style.routing]}</b> {keys.routing.toUpperCase()} · <b>{HEADS_LABEL[heads]}</b> {keys.heads.toUpperCase()} · <b>{style.dashed ? "dashed" : "solid"}</b> {keys.dashed.toUpperCase()} · Esc cancels
          </div>
          {!frame.ok && <div className="md-qc-link-warn">No clear way around: drawn as a plain elbow</div>}
        </div>
      )}
    </div>
  );
}
