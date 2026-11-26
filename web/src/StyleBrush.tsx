// Style Brush: the look picked up with "Copy look" (⌥⌘C) is painted onto other shapes.
//   - hover a shape: it shows the result (no undo entry) and is outlined; a shape that can't take
//     the chosen parts gets a red dashed outline instead;
//   - click: paint it (one undo step); the brush stays loaded;
//   - drag on the canvas: paint every shape inside the rectangle (one undo step);
//   - ⌥-click a shape: pick up its look instead;
//   - the chips in the bar choose what is copied (fill by default; stroke, shadow, text on demand);
//   - Esc, right-click, Done, or a click outside the canvas ends it.
// Like LinkMode, pointer and keys are read on the window in the capture phase and the overlay takes
// no pointer events (except the bar), so scrolling, zooming and Space-panning keep working.
import { useEffect, useRef, useState } from "react";
import { getCommonBounds, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { LOOK_PART_LABELS, LOOK_PARTS, lookSwatchCss, type LookPart } from "../../shared/styleCopy";
import { elementAt } from "./library/pickColor";
import type { El, ElMap } from "./agent/sceneOps";
import { BrushPreview, brushParts, loadedLook, onLoadedLook, paintableUnits, paintLook, pickUpLook, setBrushParts, setLoadedLook, unitOf } from "./styleBrushOps";

interface Props {
  getApi(): ExcalidrawImperativeAPI | undefined;
  /** `refocus`: give the canvas the keyboard back (not when the user clicked into a panel). */
  onEnd(refocus?: boolean): void;
  onToast(text: string, error?: boolean): void;
}

type Rect = { x1: number; y1: number; x2: number; y2: number };

/** Below this many screen px between press and release, it is a click, not a marquee. */
const DRAG_MIN = 6;

function unitRect(api: ExcalidrawImperativeAPI, id: string): Rect | null {
  const els = api.getSceneElements();
  const map: ElMap = new Map((els as unknown as El[]).map((e) => [e.id, e]));
  const u = map.get(id);
  if (!u) return null;
  // An icon node: its container already covers image + caption.
  const [x1, y1, x2, y2] = getCommonBounds([u as unknown as ExcalidrawElement]);
  const st = api.getAppState();
  const z = st.zoom.value;
  const s = (x: number, y: number) => ({ x: (x + st.scrollX) * z + st.offsetLeft, y: (y + st.scrollY) * z + st.offsetTop });
  const a = s(x1, y1);
  const b = s(x2, y2);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** The unit (shape, icon node, ...) under a client point, if any. */
function unitAt(api: ExcalidrawImperativeAPI, clientX: number, clientY: number): string | null {
  const st: AppState = api.getAppState();
  const p = viewportCoordsToSceneCoords({ clientX, clientY }, st);
  const el = elementAt(api, p.x, p.y, { area: true });
  if (!el) return null;
  const map: ElMap = new Map((api.getSceneElements() as unknown as El[]).map((e) => [e.id, e]));
  return unitOf(el as unknown as El, map).id;
}

/** Units whose box lies inside the scene rectangle. */
function unitsInside(api: ExcalidrawImperativeAPI, a: { x: number; y: number }, b: { x: number; y: number }): string[] {
  const x1 = Math.min(a.x, b.x);
  const x2 = Math.max(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const y2 = Math.max(a.y, b.y);
  const els = api.getSceneElements();
  const map: ElMap = new Map((els as unknown as El[]).map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const e of els) {
    const [ex1, ey1, ex2, ey2] = getCommonBounds([e]);
    if (ex1 >= x1 && ex2 <= x2 && ey1 >= y1 && ey2 <= y2) out.add(unitOf(e as unknown as El, map).id);
  }
  return [...out];
}

export function StyleBrush({ getApi, onEnd, onToast }: Props) {
  const [loaded, setLoaded] = useState(loadedLook);
  const [parts, setPartsState] = useState<LookPart[]>(brushParts);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const toastRef = useRef(onToast);
  toastRef.current = onToast;
  const preview = useRef<BrushPreview | null>(null);
  const hover = useRef<{ id: string; ok: boolean } | null>(null);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const spaceHeld = useRef(false);
  const busy = useRef(false);
  const [frame, setFrame] = useState<{ hover: Rect | null; ok: boolean; marquee: Rect | null }>({ hover: null, ok: true, marquee: null });

  useEffect(() => onLoadedLook(() => setLoaded(loadedLook())), []);

  const setParts = (next: LookPart[]) => {
    setBrushParts(next);
    partsRef.current = next;
    setPartsState(next);
    // Re-preview the hovered shape with the new parts.
    const h = hover.current;
    hover.current = null;
    if (h) void hoverUnit(h.id);
  };

  const togglePart = (p: LookPart) => {
    const cur = partsRef.current;
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : LOOK_PARTS.filter((x) => x === p || cur.includes(x));
    if (next.length) setParts(next);
  };

  /** Hover moved onto `id` (or off everything): preview there. */
  const hoverUnit = async (id: string | null) => {
    const api = getApi();
    const l = loadedLook();
    if (!api || !l) return;
    if ((hover.current?.id ?? null) === id) return;
    if (!preview.current) preview.current = new BrushPreview(api);
    preview.current.clear();
    if (!id || id === l.sourceId) {
      hover.current = null;
      return;
    }
    const ok = paintableUnits(api, l.look, [id], partsRef.current, l.sourceId).length > 0;
    hover.current = { id, ok };
    if (ok) await preview.current.show(l.look, [id], partsRef.current, l.sourceId);
  };

  const paint = async (ids: string[]) => {
    const api = getApi();
    const l = loadedLook();
    if (!api || !l || busy.current) return;
    busy.current = true;
    preview.current?.clear();
    hover.current = null;
    try {
      const done = await paintLook(api, l.look, ids, partsRef.current, l.sourceId);
      if (!done.length && ids.length) toastRef.current("Nothing there can take this look.", true);
    } catch (e) {
      toastRef.current(`Could not paint: ${(e as Error).message}`, true);
    } finally {
      busy.current = false;
    }
  };

  // Bucket cursor over the canvas.
  useEffect(() => {
    document.body.classList.add("md-brushing");
    return () => {
      document.body.classList.remove("md-brushing");
      preview.current?.clear();
    };
  }, []);

  useEffect(() => {
    const inBar = (t: EventTarget | null) => t instanceof Element && !!t.closest(".md-brush-hud");
    const onMove = (e: PointerEvent) => {
      const api = getApi();
      if (!api || busy.current) return;
      if (pressed.current) return; // marquee: drawn by the frame loop
      void hoverUnit(e.target instanceof HTMLCanvasElement ? unitAt(api, e.clientX, e.clientY) : null);
    };
    const onDown = (e: PointerEvent) => {
      if (inBar(e.target)) return;
      const api = getApi();
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        const stop = (ev: MouseEvent) => ev.preventDefault();
        window.addEventListener("contextmenu", stop, { capture: true, once: true });
        endRef.current();
        return;
      }
      if (!(e.target instanceof HTMLCanvasElement) || !api) {
        endRef.current(false);
        return;
      }
      if (spaceHeld.current) return; // Space-drag pans
      e.preventDefault();
      e.stopPropagation();
      if (e.button !== 0) return;
      if (e.altKey) {
        // ⌥-click: pick up this shape's look instead.
        const id = unitAt(api, e.clientX, e.clientY);
        const l = id ? pickUpLook(api, id) : null;
        if (l) {
          preview.current?.clear();
          hover.current = null;
          setLoadedLook(l);
          toastRef.current("Picked up a new look.");
        }
        return;
      }
      pressed.current = { x: e.clientX, y: e.clientY };
      preview.current?.clear();
      hover.current = null;
    };
    const onUp = (e: PointerEvent) => {
      const start = pressed.current;
      pressed.current = null;
      const api = getApi();
      if (!start || !api) return;
      e.preventDefault();
      e.stopPropagation();
      setFrame((f) => ({ ...f, marquee: null }));
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_MIN) {
        const id = unitAt(api, e.clientX, e.clientY);
        if (id) void paint([id]);
        return;
      }
      const st = api.getAppState();
      const a = viewportCoordsToSceneCoords({ clientX: start.x, clientY: start.y }, st);
      const b = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
      const ids = unitsInside(api, a, b);
      if (ids.length) void paint(ids);
    };
    // Excalidraw would start a text on a double-click and open its menu on right-click.
    const onDouble = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endRef.current();
        return;
      }
      if (e.metaKey || e.ctrlKey) return; // ⌘Z, zoom, ⌥⌘C (re-load) keep working
      if (e.key === " ") {
        spaceHeld.current = true;
        return;
      }
      // Letters would switch Excalidraw tools in the middle of painting.
      if (e.key.length === 1 || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("dblclick", onDouble, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("dblclick", onDouble, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outlines follow the hovered shape and the marquee (also while scrolling / zooming).
  useEffect(() => {
    let raf = 0;
    let lastKey = "";
    let ptr: { x: number; y: number } | null = null;
    const track = (e: PointerEvent) => (ptr = { x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", track, true);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const api = getApi();
      if (!api) return;
      const st = api.getAppState();
      const h = hover.current;
      const p = pressed.current;
      const key = JSON.stringify([h, p, p && ptr, st.scrollX, st.scrollY, st.zoom.value]);
      if (key === lastKey) return;
      lastKey = key;
      const marquee = p && ptr && Math.hypot(ptr.x - p.x, ptr.y - p.y) >= DRAG_MIN ? { x1: Math.min(p.x, ptr.x), y1: Math.min(p.y, ptr.y), x2: Math.max(p.x, ptr.x), y2: Math.max(p.y, ptr.y) } : null;
      setFrame({ hover: h && !p ? unitRect(api, h.id) : null, ok: h?.ok ?? true, marquee });
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", track, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return null;
  const swatch = lookSwatchCss(loaded.look);
  const r = frame.hover;
  return (
    <div className="md-brush">
      {r && <div className={`md-brush-target${frame.ok ? "" : " md-brush-nope"}`} style={{ left: r.x1 - 4, top: r.y1 - 4, width: r.x2 - r.x1 + 8, height: r.y2 - r.y1 + 8 }} />}
      {frame.marquee && (
        <div className="md-brush-marquee" style={{ left: frame.marquee.x1, top: frame.marquee.y1, width: frame.marquee.x2 - frame.marquee.x1, height: frame.marquee.y2 - frame.marquee.y1 }} />
      )}
      <div className="md-brush-hud" role="toolbar" aria-label="Style brush">
        <span className="md-brush-swatch" data-empty={swatch ? undefined : ""} style={swatch ? { background: swatch } : undefined} title="Loaded look" />
        <span className="md-brush-chips">
          {LOOK_PARTS.map((p) => (
            <button
              key={p}
              type="button"
              className={`md-brush-chip${parts.includes(p) ? " active" : ""}`}
              data-brush-part={p}
              aria-pressed={parts.includes(p)}
              disabled={!loaded.look[p]}
              title={loaded.look[p] ? `Copy the ${LOOK_PART_LABELS[p].toLowerCase()}` : `The source has no ${LOOK_PART_LABELS[p].toLowerCase()} to copy`}
              onClick={() => togglePart(p)}
            >
              {LOOK_PART_LABELS[p]}
            </button>
          ))}
        </span>
        <span className="md-brush-hint">
          {parts.some((p) => loaded.look[p]) ? "Click to paint · drag to paint many · ⌥-click picks up · Esc done" : "Turn on a part this shape has"}
        </span>
        <button type="button" className="md-brush-done" onClick={() => endRef.current()}>
          Done
        </button>
      </div>
    </div>
  );
}
