// Quick connect (draw.io style): four "+" handles around the selected shape/stencil/group (or
// around several selected ones), or around one the pointer rests on for a moment (passing over
// things shows nothing). On a handle (the keys are settings, shared/quickBindings.ts):
//   click            -> a copy on that side, close by, no arrow
//   Option-click     -> a copy on that side joined by an arrow (in the link style)
//   ⌘-click / ⌘-drag -> draw an arrow to something already there, routed around shapes (LinkMode.tsx:
//                       live preview, choose the side, bend points, style keys and bar)
//   Shift-click      -> pick a basic shape or a stencil for a new connected node
//   right-click      -> the quick connect menu (QuickMenu.tsx): connect with an arrow or a line, add
//   drag a handle    -> drop a connected copy where the pointer is let go, or connect to the shape there
// Hovering a handle shows where the copy would go. ⌥⌘+arrow adds a connected copy from the keyboard
// (⇧⌥⌘+arrow: a plain copy), Tab / ⇧Tab walks to connected shapes.
// The handles are a DOM overlay over the active tab's canvas, never part of the scene.
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { libraryFileUrl, searchItems, type LibraryIndex, type LibraryItem } from "../../shared/library";
import { QUICK_SIDES, unionBox, type QuickSide } from "../../shared/quickConnect";
import type { Box, Point } from "../../shared/geometry";
import { heldKeys, onHeldKeys } from "./heldKeys";
import { actionFor, describeBinding, IS_MAC_PLATFORM, QUICK_ACTIONS, type QuickAction, type QuickConnectSettings } from "../../shared/quickBindings";
import type { IconSketch } from "../../shared/iconSketch";
import type { CaptionPrefs } from "./library/captionFont";
import {
  addConnectedCopies,
  addConnectedShape,
  addConnectedStencil,
  connectMany,
  neighboursOf,
  previewCopies,
  QUICK_SHAPE_LABEL,
  QUICK_SHAPES,
  quickSourceAt,
  selectedUnits,
  selectUnit,
  unitById,
  type QuickShape,
} from "./quickConnectOps";
import { loadLinkStyle, saveLinkStyle, type LinkStyle } from "./linkOps";
import { LinkMode } from "./LinkMode";
import { QuickMenu, type MenuAdd } from "./QuickMenu";

interface Props {
  /** Look of inserted icons (Settings.iconStyle resolved); null = original. */
  insertSketch: IconSketch | null;
  /** Caption font settings (Settings.captionFont / captionHandFont). */
  captionPrefs: CaptionPrefs | null;
  tabId: string;
  getApi(): ExcalidrawImperativeAPI | undefined;
  library: LibraryIndex | null;
  /** A dialog, palette, find bar or pick mode is open. */
  blocked: boolean;
  /** Which modifier + click does what (Settings.quickConnect). */
  quick: QuickConnectSettings;
  onToast(text: string, error?: boolean): void;
  /** Open the quick connect shortcuts dialog (from the menu). */
  onOpenSettings(): void;
}

/**
 * Distance of a handle's centre from the shape's edge (screen px). Close, so a handle never lands on
 * a neighbour; a selected shape has Excalidraw's resize handles up to 10px out on every side and its
 * rotate handle up to 26px above the top, so ours sit just beyond those.
 */
const HANDLE_OFFSET = 16;
const HANDLE_OFFSET_SELECTED = 22;
const HANDLE_OFFSET_SELECTED_TOP = 38;
/** The pointer may stray this far (screen px) outside the shape on its way to a handle. */
const HOVER_SLACK = HANDLE_OFFSET_SELECTED_TOP + 18;
const MAX_RESULTS = 8;
/** The pointer must rest on a shape this long (ms) before its handles appear (selected shapes show them at once). */
const HOVER_DELAY_MS = 600;
/** How long the pointer rests on a handle before the preview of the copy shows (ms). */
const GHOST_DELAY_MS = 150;
/** Pointer travel (screen px) that counts as moving rather than resting. */
const REST_JITTER = 6;
/** Pointer travel (screen px) from a handle that turns a press into a drag. */
const DRAG_START = 5;
/** How often the selection is checked (ms). */
const SELECTION_POLL_MS = 120;

interface View {
  /** The units the handles act on (several when several are selected). */
  ids: string[];
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  selected: boolean;
  /** Sides whose handle would be on the bare canvas (not under a toolbar or panel). */
  sides: QuickSide[];
}

/** ⌘-click / ⌘-drag on a handle: picking the shape to connect to (see LinkMode.tsx). */
interface Link {
  sourceIds: string[];
  side: QuickSide;
  /** Set when started by pressing on the handle: releasing over a target after a drag connects. */
  pressedAt: { x: number; y: number } | null;
}

/** A popup at a handle (stencil picker or menu). */
interface Popup {
  sourceIds: string[];
  side: QuickSide;
  x: number;
  y: number;
}

/** Where a copy would go (scene coordinates), or the shape a drag would connect to. */
interface Ghost {
  boxes: Box[];
  routes: Point[][];
  target: Box | null;
}

const isIcon = (i: LibraryItem) => i.kind === "svg" || i.kind === "png";
const PLAIN_SHAPES = new Set<QuickShape>(["rectangle", "rounded", "ellipse", "diamond"]);
const ARROW_SIDE: Record<string, QuickSide> = { ArrowUp: "top", ArrowRight: "right", ArrowDown: "bottom", ArrowLeft: "left" };

/** Is Excalidraw busy with something the handles must not get in the way of? */
function suppressed(api: ExcalidrawImperativeAPI): boolean {
  const st = api.getAppState() as AppState & { contextMenu?: unknown };
  return !!(
    st.activeTool.type !== "selection" ||
    st.viewModeEnabled ||
    st.editingTextElement ||
    st.editingLinearElement ||
    st.newElement ||
    st.multiElement ||
    st.resizingElement ||
    st.selectionElement ||
    st.selectedElementsAreBeingDragged ||
    st.isResizing ||
    st.isRotating ||
    st.openDialog ||
    st.contextMenu ||
    st.showHyperlinkPopup === "editor" ||
    st.cursorButton === "down"
  );
}

function viewOf(api: ExcalidrawImperativeAPI, ids: string[], overlay: Element | null): View | null {
  const units = ids.map((id) => unitById(api, id));
  if (!units.length || units.some((u) => !u) || suppressed(api)) return null;
  const box = unionBox(units.map((u) => u!.box));
  if (!box) return null;
  const st = api.getAppState();
  const z = st.zoom.value;
  const sx = (x: number) => (x + st.scrollX) * z + st.offsetLeft;
  const sy = (y: number) => (y + st.scrollY) * z + st.offsetTop;
  const v: View = {
    ids,
    x1: sx(box.x),
    y1: sy(box.y),
    x2: sx(box.x + box.width),
    y2: sy(box.y + box.height),
    selected: units.some((u) => u!.members.some((m) => st.selectedElementIds[m.id])),
    sides: [],
  };
  v.sides = QUICK_SIDES.filter((side) => onCanvas(handlePoint(v, side), overlay));
  return v.sides.length ? v : null;
}

/** Is a screen point over the drawing canvas itself (not under Excalidraw's toolbars or panels)? */
function onCanvas(p: { x: number; y: number }, overlay: Element | null): boolean {
  const hit = document.elementsFromPoint(p.x, p.y).find((e) => !overlay?.contains(e));
  return hit instanceof HTMLCanvasElement;
}

function handlePoint(v: View, side: QuickSide): { x: number; y: number } {
  const off = !v.selected ? HANDLE_OFFSET : side === "top" ? HANDLE_OFFSET_SELECTED_TOP : HANDLE_OFFSET_SELECTED;
  const cx = (v.x1 + v.x2) / 2;
  const cy = (v.y1 + v.y2) / 2;
  switch (side) {
    case "top":
      return { x: cx, y: v.y1 - off };
    case "right":
      return { x: v.x2 + off, y: cy };
    case "bottom":
      return { x: cx, y: v.y2 + off };
    case "left":
      return { x: v.x1 - off, y: cy };
  }
}

/** Off a Mac, Ctrl counts as the `meta` modifier (on a Mac Ctrl-click is a right-click). */
export const IS_MAC = IS_MAC_PLATFORM;

const SIDE_NAME: Record<QuickSide, string> = { top: "above", right: "to the right", bottom: "below", left: "to the left" };

function handleTitle(q: QuickConnectSettings, side: QuickSide): string {
  const text: Record<QuickAction, string> = {
    copy: `add a copy ${SIDE_NAME[side]}`,
    connectedCopy: "add a copy joined by an arrow",
    linkTo: "draw an arrow to another shape (around shapes in between)",
    pickStencil: "pick a shape or stencil",
    menu: "more: connect with an arrow or a line, add a shape",
  };
  return [...QUICK_ACTIONS.map((a) => `${describeBinding(q.bindings[a], IS_MAC)}: ${text[a]}`), "Drag: drop a connected copy, or onto a shape to connect"].join("\n");
}

function handleLabel(action: QuickAction | null, side: QuickSide): string {
  switch (action) {
    case "linkTo":
      return `Connect ${SIDE_NAME[side]} to another shape`;
    case "connectedCopy":
      return `Add a connected copy ${SIDE_NAME[side]}`;
    case "pickStencil":
      return `Pick a shape or stencil ${SIDE_NAME[side]}`;
    case "menu":
      return `Quick connect menu ${SIDE_NAME[side]}`;
    default:
      return `Add a copy ${SIDE_NAME[side]}`;
  }
}

function toScreen(st: AppState, p: Point): Point {
  const z = st.zoom.value;
  return { x: (p.x + st.scrollX) * z + st.offsetLeft, y: (p.y + st.scrollY) * z + st.offsetTop };
}

/** "Elbow arrow, dashed", "Curved line", "Arrow around shapes, both ends". */
export function describeLinkStyle(s: LinkStyle): string {
  const line = s.heads === "none";
  const name =
    s.routing === "around"
      ? line ? "Line around shapes" : "Arrow around shapes"
      : `${s.routing === "elbow" ? "Elbow" : s.routing === "straight" ? "Straight" : "Curved"} ${line ? "line" : "arrow"}`;
  return [name, s.dashed ? "dashed" : "", s.heads === "both" ? "both ends" : ""].filter(Boolean).join(", ");
}

/**
 * Open the label of a new plain shape for typing, as a double-click on it would (Excalidraw has no
 * API to start text editing). Grouped units (icons, stencils, groups) are left alone.
 */
function editLabelOf(getApi: () => ExcalidrawImperativeAPI | undefined, id: string): void {
  requestAnimationFrame(() => {
    const api = getApi();
    const el = api?.getSceneElements().find((e) => e.id === id);
    if (!api || !el || el.groupIds.length || !["rectangle", "ellipse", "diamond"].includes(el.type)) return;
    const p = toScreen(api.getAppState(), { x: el.x + el.width / 2, y: el.y + el.height / 2 });
    const canvas = document.elementsFromPoint(p.x, p.y).find((e) => e instanceof HTMLCanvasElement);
    canvas?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, view: window }));
  });
}

function swallowContextMenu(ms = 600): void {
  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("contextmenu", stop, true);
  window.setTimeout(() => window.removeEventListener("contextmenu", stop, true), ms);
}

export function QuickConnect({ tabId, getApi, library, blocked, quick, insertSketch, captionPrefs, onToast, onOpenSettings }: Props) {
  /** The unit the pointer has rested on (handles shown). */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** The selected units (handles shown around them). */
  const [selIds, setSelIds] = useState<string[]>([]);
  /** What a click on a handle would do with the modifiers held right now (shown as the handle's icon). */
  const [held, setHeld] = useState<QuickAction | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [search, setSearch] = useState<Popup | null>(null);
  const [menu, setMenu] = useState<Popup | null>(null);
  /** The handle the pointer is on (for the preview). */
  const [overSide, setOverSide] = useState<QuickSide | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [dragging, setDragging] = useState(false);
  /** While dragging from a handle: where the pointer is (screen), the link style, and what a release does. */
  const [dragHint, setDragHint] = useState<{ x: number; y: number; style: LinkStyle; onTarget: boolean } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const candidateRef = useRef<{ id: string; timer: number; at: { x: number; y: number } } | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef<View | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const quickRef = useRef(quick);
  quickRef.current = quick;
  const busyRef = useRef(false);
  busyRef.current = !!(link || search || menu);

  const setHover = useCallback((id: string | null) => {
    hoverRef.current = id;
    setHoverId(id);
  }, []);

  const cancelCandidate = useCallback(() => {
    if (!candidateRef.current) return;
    window.clearTimeout(candidateRef.current.timer);
    candidateRef.current = null;
  }, []);

  const focusCanvas = useCallback(() => {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-md-tab="${tabId}"] .excalidraw`)?.focus());
  }, [tabId]);

  // Hover detection on the tab's canvas.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(`[data-md-tab="${tabId}"]`);
    if (!root) return;
    const onMove = (e: PointerEvent) => {
      const api = getApi();
      if (!api || blockedRef.current || e.buttons !== 0 || !(e.target instanceof HTMLCanvasElement)) {
        cancelCandidate();
        if (hoverRef.current) setHover(null);
        return;
      }
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      pointRef.current = p;
      const src = quickSourceAt(api, p.x, p.y);
      if (src) {
        if (src.id === hoverRef.current) return cancelCandidate();
        // Another unit: the handles of the one we left go, and the new one's wait for the pointer to rest.
        if (hoverRef.current) setHover(null);
        const at = { x: e.clientX, y: e.clientY };
        const waiting = candidateRef.current;
        // Still resting on the same unit (small jitter is fine): keep waiting. Travelling restarts the wait.
        if (waiting?.id === src.id && Math.hypot(at.x - waiting.at.x, at.y - waiting.at.y) <= REST_JITTER) return;
        cancelCandidate();
        const id = src.id;
        candidateRef.current = {
          id,
          at,
          timer: window.setTimeout(() => {
            candidateRef.current = null;
            const a = getApi();
            const pt = pointRef.current;
            if (!a || !pt || blockedRef.current) return;
            if (quickSourceAt(a, pt.x, pt.y)?.id === id) setHover(id); // still there
          }, HOVER_DELAY_MS),
        };
        return;
      }
      cancelCandidate();
      // Off the shape: keep the handles while the pointer is still near it (on its way to a handle).
      const v = viewRef.current;
      const near =
        v &&
        v.ids.includes(hoverRef.current ?? "") &&
        e.clientX >= v.x1 - HOVER_SLACK &&
        e.clientX <= v.x2 + HOVER_SLACK &&
        e.clientY >= v.y1 - HOVER_SLACK &&
        e.clientY <= v.y2 + HOVER_SLACK;
      if (!near && hoverRef.current) setHover(null);
    };
    const onDown = () => {
      cancelCandidate();
      if (hoverRef.current) setHover(null);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.relatedTarget instanceof Node && overlayRef.current?.contains(e.relatedTarget)) return;
      cancelCandidate();
      if (hoverRef.current) setHover(null);
    };
    root.addEventListener("pointermove", onMove, { capture: true, passive: true });
    root.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove, { capture: true });
      root.removeEventListener("pointerdown", onDown, { capture: true });
      root.removeEventListener("pointerleave", onLeave);
      cancelCandidate();
    };
  }, [tabId, getApi, setHover, cancelCandidate]);

  // The selected units show their handles at once. Polled (cheaply) because Excalidraw has no selection event.
  useEffect(() => {
    let key = "";
    const poll = () => {
      const api = getApi();
      const sel = api && !blockedRef.current ? api.getAppState().selectedElementIds : null;
      // Ids plus their groups: grouping or ungrouping the selection leaves the ids alone but changes the units.
      const k = api && sel && Object.keys(sel).length
        ? api
            .getSceneElements()
            .filter((e) => sel[e.id])
            .map((e) => `${e.id}:${e.groupIds.join("/")}`)
            .sort()
            .join(",")
        : "";
      if (k === key) return;
      key = k;
      setSelIds(api && k ? selectedUnits(api).map((u) => u.id) : []);
    };
    poll();
    const timer = window.setInterval(poll, SELECTION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [getApi]);

  // Held keys change what a handle does; the icon shows it.
  useEffect(() => {
    const update = () => setHeld(actionFor(quickRef.current, heldKeys(), "left", IS_MAC));
    update();
    return onHeldKeys(update);
  }, [quick]);

  /** The action chosen when a handle was pressed; it runs when the button is released on that handle. */
  const pendingRef = useRef<{ side: QuickSide; action: QuickAction } | null>(null);

  // Whose handles to show: the unit the pointer rests on (all selected ones when it is one of them),
  // else the selected ones.
  const activeKey = hoverId && !selIds.includes(hoverId) ? hoverId : selIds.join(",");

  // While handles are up, follow scrolling/zooming/edits and hide them when Excalidraw gets busy.
  useEffect(() => {
    const ids = activeKey ? activeKey.split(",") : [];
    if (!ids.length || blocked) {
      viewRef.current = null;
      setView(null);
      return;
    }
    let frame = 0;
    let key = "";
    const tick = () => {
      const api = getApi();
      const v = api ? viewOf(api, ids, overlayRef.current) : null;
      const st = api?.getAppState();
      // The scroll and zoom too: a preview drawn in screen coordinates follows them.
      const k = v ? `${v.x1}:${v.y1}:${v.x2}:${v.y2}:${v.selected}:${v.sides.join()}:${st?.scrollX}:${st?.scrollY}:${st?.zoom.value}` : "";
      if (k !== key) {
        key = k;
        viewRef.current = v;
        setView(v);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [activeKey, blocked, getApi]);

  const afterAdd = (ids: string[]) => {
    if (ids.length === 1 && quickRef.current.editLabel) editLabelOf(getApi, ids[0]);
    else focusCanvas();
  };

  const copyFrom = (ids: string[], side: QuickSide, connect: boolean, at?: Point) => {
    const api = getApi();
    if (!api || !ids.length) return;
    setHover(null);
    setGhost(null);
    try {
      const made = addConnectedCopies(api, ids, side, { connect, at });
      if (!made.length) onToast("That shape can't be copied from here.", true);
      else return afterAdd(made);
    } catch (e) {
      onToast(`Quick connect failed: ${(e as Error).message}`, true);
    }
    focusCanvas();
  };

  // ---------- preview of the copy (hovering a handle) ----------

  useEffect(() => {
    const v = viewRef.current;
    if (!overSide || !v || dragging || link || search || menu || (held !== "copy" && held !== "connectedCopy")) {
      if (!dragging) setGhost(null);
      return;
    }
    const ids = v.ids;
    const timer = window.setTimeout(() => {
      const api = getApi();
      const p = api ? previewCopies(api, ids, overSide, held === "connectedCopy") : null;
      setGhost(p ? { ...p, target: null } : null);
    }, GHOST_DELAY_MS);
    return () => window.clearTimeout(timer);
    // view?.ids: the handles moved to another unit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overSide, held, dragging, link, search, menu, activeKey]);

  // ---------- dragging a handle: drop a connected copy, or connect to the shape under the pointer ----------

  const beginPress = (side: QuickSide, start: { x: number; y: number }) => {
    const ids = viewRef.current?.ids;
    if (!ids) return;
    let started = false;
    let raf = 0;
    let last: PointerEvent | null = null;
    const style = loadLinkStyle();
    const isSource = (u: { id: string; members: { id: string }[] }) => ids.includes(u.id) || u.members.some((m) => ids.includes(m.id));
    const update = () => {
      raf = 0;
      const api = getApi();
      const e = last;
      if (!api || !e) return;
      const hint = (onTarget: boolean) => setDragHint({ x: e.clientX, y: e.clientY, style, onTarget });
      if (!(e.target instanceof HTMLCanvasElement)) {
        hint(false);
        return setGhost(null);
      }
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const u = quickSourceAt(api, p.x, p.y);
      hint(!!u && !isSource(u));
      if (u && !isSource(u)) return setGhost({ boxes: [], routes: [], target: u.box });
      if (u) return setGhost(null);
      const prev = previewCopies(api, ids, side, true, p);
      setGhost(prev ? { ...prev, target: null } : null);
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("keydown", onKey, true);
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove("md-qc-dragging");
      setDragging(false);
      setDragHint(null);
      setGhost(null);
    };
    const onMove = (e: PointerEvent) => {
      if (!started) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_START) return;
        started = true;
        pendingRef.current = null; // a drag, not a click
        setDragging(true);
        document.body.classList.add("md-qc-dragging");
      }
      e.preventDefault();
      e.stopPropagation();
      last = e;
      if (!raf) raf = requestAnimationFrame(update);
    };
    const onUp = (e: PointerEvent) => {
      stop();
      if (!started) return; // a click: the handle's own pointerup runs the action
      e.preventDefault();
      e.stopPropagation();
      const api = getApi();
      if (!api || !(e.target instanceof HTMLCanvasElement)) return focusCanvas();
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const u = quickSourceAt(api, p.x, p.y);
      if (u && isSource(u)) return focusCanvas(); // dropped back on itself
      if (u) {
        try {
          if (!connectMany(api, ids, side, u.id).length) onToast("Those can't be connected.", true);
        } catch (err) {
          onToast(`Could not connect: ${(err as Error).message}`, true);
        }
        return focusCanvas();
      }
      copyFrom(ids, side, true, p);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = null;
      stop();
      focusCanvas();
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("keydown", onKey, true);
  };

  // ---------- ⌘-click: connect to an existing shape ----------

  const startLink = (side: QuickSide, pressedAt: { x: number; y: number } | null, ids = viewRef.current?.ids) => {
    if (!ids?.length) return;
    cancelCandidate();
    setHover(null);
    setGhost(null);
    setLink({ sourceIds: ids, side, pressedAt });
  };

  const endLink = useCallback(
    (refocus = true) => {
      setLink(null);
      if (refocus) focusCanvas();
    },
    [focusCanvas],
  );

  // A dialog opening (or the tab going away) ends linking.
  useEffect(() => {
    if (link && blocked) endLink();
  }, [link, blocked, endLink]);

  /** Do what the user bound to `action` on a handle (⌘-style link starts on pointerdown, see below). */
  const run = (action: QuickAction, side: QuickSide, at: { x: number; y: number }) => {
    const ids = viewRef.current?.ids ?? [];
    if (action === "copy") copyFrom(ids, side, false);
    else if (action === "connectedCopy") copyFrom(ids, side, true);
    else if (action === "linkTo") startLink(side, null);
    else if (action === "menu") {
      // Off a Mac the browser's contextmenu event comes after the release, when the handle is gone:
      // keep it from opening Excalidraw's own menu over ours.
      swallowContextMenu();
      openPopup(setMenu, ids, side, at);
    }
    else openPopup(setSearch, ids, side, at);
  };

  const openPopup = (set: (p: Popup) => void, ids: string[], side: QuickSide, at: { x: number; y: number }) => {
    if (!ids.length) return;
    setHover(null);
    setGhost(null);
    set({ sourceIds: ids, side, x: at.x, y: at.y });
  };

  const closeSearch = useCallback(() => {
    setSearch(null);
    focusCanvas();
  }, [focusCanvas]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    focusCanvas();
  }, [focusCanvas]);

  const pick = (item: LibraryItem) => {
    const s = search;
    const api = getApi();
    closeSearch();
    if (!s || !api) return;
    addConnectedStencil(api, s.sourceIds, s.side, item, insertSketch, captionPrefs).then(
      (id) => {
        if (id) void window.mydraw.libraryMarkUsed(item.id);
        else onToast("The shape is gone; nothing was added.", true);
      },
      (e: Error) => onToast(`Could not add “${item.name}”: ${e.message}`, true),
    );
  };

  const pickShape = (shape: QuickShape) => {
    const s = search;
    const api = getApi();
    setSearch(null);
    if (!s || !api) return;
    addConnectedShape(api, s.sourceIds, s.side, shape).then(
      (id) => {
        if (!id) return onToast("The shape is gone; nothing was added.", true);
        // A new shape has no label yet: type it straight away.
        if (s.sourceIds.length === 1 && PLAIN_SHAPES.has(shape)) editLabelOf(getApi, id);
        else focusCanvas();
      },
      (e: Error) => onToast(`Could not add the shape: ${e.message}`, true),
    );
  };

  // Close a popup on a click elsewhere, or when the tab is blocked by a dialog.
  useEffect(() => {
    if (!search && !menu) return;
    if (blocked) {
      setSearch(null);
      setMenu(null);
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && (searchRef.current?.contains(e.target) || menuRef.current?.contains(e.target))) return;
      setSearch(null);
      setMenu(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [search, menu, blocked]);

  // ---------- keyboard: ⌥⌘+arrow adds, Tab walks to connected shapes ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blockedRef.current || busyRef.current || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true']") || t.isContentEditable)) return;
      const root = document.querySelector(`[data-md-tab="${tabId}"]`);
      if (document.activeElement && document.activeElement !== document.body && !root?.contains(document.activeElement)) return;
      const api = getApi();
      if (!api) return;
      const st = api.getAppState();
      if (st.editingTextElement || st.activeTool.type !== "selection" || st.openDialog) return;
      const cmd = IS_MAC ? e.metaKey : e.ctrlKey;
      const side = ARROW_SIDE[e.key];
      if (side && cmd && e.altKey) {
        const units = selectedUnits(api);
        if (!units.length) return;
        e.preventDefault();
        e.stopPropagation();
        copyFrom(
          units.map((u) => u.id),
          side,
          !e.shiftKey,
        );
        return;
      }
      if (e.key === "Tab" && !cmd && !e.altKey) {
        const units = selectedUnits(api);
        if (units.length !== 1) return;
        const here = units[0];
        const near = neighboursOf(api, here.id);
        if (!near.length) return;
        e.preventDefault();
        e.stopPropagation();
        // Reading order (top to bottom, left to right): Tab = the next one after this shape, ⇧Tab = the one before.
        const after = (u: typeof here) => u.box.y > here.box.y || (u.box.y === here.box.y && u.box.x > here.box.x);
        const next = e.shiftKey ? ([...near].reverse().find((u) => !after(u)) ?? near.at(-1)!) : (near.find(after) ?? near[0]);
        selectUnit(api, next);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, getApi]);

  const st = getApi()?.getAppState();
  const hints: Partial<Record<MenuAdd, string>> = {
    connectedCopy: describeBinding(quick.bindings.connectedCopy, IS_MAC),
    copy: describeBinding(quick.bindings.copy, IS_MAC),
    pick: describeBinding(quick.bindings.pickStencil, IS_MAC),
  };

  return (
    <div className="md-qc" ref={overlayRef}>
      {/* Which thing the handles belong to (a selected one already has Excalidraw's selection box). */}
      {view && !search && !menu && !link && !view.selected && (
        <div className="md-qc-outline" style={{ left: view.x1 - 4, top: view.y1 - 4, width: view.x2 - view.x1 + 8, height: view.y2 - view.y1 + 8 }} />
      )}
      {ghost && st && (
        <svg className="md-qc-ghost" width="100%" height="100%" data-count={ghost.boxes.length}>
          {ghost.routes.map((r, i) => (
            <path key={`r${i}`} className="md-qc-ghost-path" d={r.map((p, j) => `${j ? "L" : "M"}${toScreen(st, p).x},${toScreen(st, p).y}`).join(" ")} />
          ))}
          {ghost.boxes.map((b, i) => {
            const a = toScreen(st, b);
            const z = st.zoom.value;
            return <rect key={`b${i}`} className="md-qc-ghost-box" x={a.x} y={a.y} width={b.width * z} height={b.height * z} rx="4" />;
          })}
          {ghost.target &&
            (() => {
              const a = toScreen(st, ghost.target);
              const z = st.zoom.value;
              return <rect className="md-qc-ghost-target" x={a.x - 4} y={a.y - 4} width={ghost.target.width * z + 8} height={ghost.target.height * z + 8} rx="6" />;
            })()}
        </svg>
      )}
      {view &&
        !search &&
        !menu &&
        !link &&
        !dragging &&
        view.sides.map((side) => {
          const p = handlePoint(view, side);
          return (
            <button
              key={side}
              className="md-qc-handle"
              data-side={side}
              data-units={view.ids.length}
              tabIndex={-1}
              style={{ left: p.x, top: p.y }}
              title={handleTitle(quick, side)}
              aria-label={handleLabel(held, side)}
              onPointerEnter={() => setOverSide(side)}
              onPointerLeave={() => setOverSide((s) => (s === side ? null : s))}
              // The action is chosen on press (a Mac sends no click for Control-click, only a context menu)
              // from the physical keys held (heldKeys.ts: sides, Fn, F-keys), and runs on release.
              onPointerDown={(e) => {
                e.stopPropagation();
                pendingRef.current = null;
                const button = e.button === 0 ? "left" : e.button === 2 ? "right" : null;
                const action = button && actionFor(quickRef.current, heldKeys(e.nativeEvent), button, IS_MAC);
                if (!action) return;
                if (action === "linkTo") {
                  // Starts at once, so dragging from the handle onto a target works too.
                  e.preventDefault();
                  startLink(side, { x: e.clientX, y: e.clientY });
                  return;
                }
                pendingRef.current = { side, action };
                // A left press that moves becomes a drag (drop a connected copy, or connect).
                if (button === "left" && (action === "copy" || action === "connectedCopy")) beginPress(side, { x: e.clientX, y: e.clientY });
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                const pending = pendingRef.current;
                pendingRef.current = null;
                if (pending?.side === side) run(pending.action, side, p);
              }}
              onMouseDown={(e) => e.preventDefault() /* keep focus on the canvas */}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {held === "linkTo" ? (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-icon="link">
                  <circle cx="3.5" cy="12.5" r="2" fill="currentColor" />
                  <path d="M5 11l7-7M8 4h4v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : held === "pickStencil" ? (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-icon="search">
                  <circle cx="7" cy="7" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              ) : held === "menu" ? (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-icon="menu">
                  <circle cx="3.5" cy="8" r="1.6" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.6" fill="currentColor" />
                  <circle cx="12.5" cy="8" r="1.6" fill="currentColor" />
                </svg>
              ) : held === "connectedCopy" ? (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-icon="arrow">
                  <path d="M2.5 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-icon="plus">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>
          );
        })}
      {dragging && dragHint && quick.dragHint && (
        <div
          className="md-qc-link-hint md-qc-drag-hint"
          // Near the right edge the hint goes to the left of the pointer, so it stays readable.
          style={dragHint.x > window.innerWidth - 380 ? { right: window.innerWidth - dragHint.x + 16, top: dragHint.y + 18 } : { left: dragHint.x + 16, top: dragHint.y + 18 }}
        >
          <div>{dragHint.onTarget ? "Release to connect to this shape" : "Release to drop a connected copy"}</div>
          <div className="md-qc-link-keys">
            <b data-drag-style>{describeLinkStyle(dragHint.style)}</b>
          </div>
          <div className="md-qc-link-keys">Right-click a “+” to change the style · Esc cancels</div>
          <div className="md-qc-link-keys">Turn this tip off in Preferences → Quick connect shortcuts…</div>
        </div>
      )}
      {link && (
        <LinkMode
          key={`${link.sourceIds.join(",")}:${link.side}`}
          getApi={getApi}
          keys={quick.linkKeys}
          sourceIds={link.sourceIds}
          side={link.side}
          pressedAt={link.pressedAt}
          onEnd={endLink}
          onToast={onToast}
        />
      )}
      {search && <StencilSearch ref={searchRef} at={search} library={library} onPick={pick} onShape={pickShape} onClose={closeSearch} />}
      {menu && (
        <QuickMenu
          ref={menuRef}
          at={menu}
          current={loadLinkStyle()}
          onStyle={saveLinkStyle}
          count={menu.sourceIds.length}
          hints={hints}
          onConnect={(style) => {
            const m = menu;
            saveLinkStyle(style);
            setMenu(null);
            startLink(m.side, null, m.sourceIds);
          }}
          onAdd={(what) => {
            const m = menu;
            setMenu(null);
            if (what === "pick") openPopup(setSearch, m.sourceIds, m.side, m);
            else copyFrom(m.sourceIds, m.side, what === "connectedCopy");
          }}
          onSettings={() => {
            setMenu(null);
            onOpenSettings();
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}

interface SearchProps {
  at: Popup;
  library: LibraryIndex | null;
  onPick(item: LibraryItem): void;
  onShape(shape: QuickShape): void;
  onClose(): void;
  ref: Ref<HTMLDivElement>;
}

/** Small outlines of the basic shapes for the picker's first row. */
function ShapeIcon({ shape }: { shape: QuickShape }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 18" width="22" height="17" aria-hidden="true">
      {shape === "rectangle" && <rect x="2" y="3" width="20" height="12" {...common} />}
      {shape === "rounded" && <rect x="2" y="3" width="20" height="12" rx="4" {...common} />}
      {shape === "ellipse" && <ellipse cx="12" cy="9" rx="10" ry="6.5" {...common} />}
      {shape === "diamond" && <path d="M12 1.5L22 9l-10 7.5L2 9z" {...common} />}
      {shape === "cylinder" && <path d="M5 4.5v9c0 1.7 3.1 3 7 3s7-1.3 7-3v-9M5 4.5c0 1.7 3.1 3 7 3s7-1.3 7-3-3.1-3-7-3-7 1.3-7 3z" {...common} />}
      {shape === "cloud" && <path d="M7 15h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.4-1.3A4.7 4.7 0 0 0 7 15z" {...common} />}
      {shape === "document" && <path d="M3 2.5h18v11.5c-3 -2.5-6 2.5-9 1s-6-2.5-9 0z" {...common} />}
      {shape === "hexagon" && <path d="M6 2.5h12l4 6.5-4 6.5H6L2 9z" {...common} />}
    </svg>
  );
}

function StencilSearch({ at, library, onPick, onShape, onClose, ref }: SearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const items = (library?.items ?? []).filter(isIcon);
    if (query.trim()) return searchItems(items, query, MAX_RESULTS);
    // Nothing typed yet: recently used icons, then favorites.
    const byId = new Map(items.map((i) => [i.id, i]));
    const ids = [...new Set([...(library?.recent ?? []), ...(library?.favorites ?? [])])];
    return ids
      .map((id) => byId.get(id))
      .filter((i): i is LibraryItem => !!i)
      .slice(0, MAX_RESULTS);
  }, [library, query]);
  useEffect(() => setActive(0), [query]);

  const width = 280;
  const left = Math.max(8, Math.min(at.x - width / 2, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(at.y + 14, window.innerHeight - 360));
  const many = at.sourceIds.length > 1;

  return (
    <div
      ref={ref}
      className="md-qc-search"
      role="dialog"
      aria-label={many ? `Pick a shape or stencil to connect to ${at.sourceIds.length} shapes` : "Pick a shape or stencil to connect"}
      style={{ left, top, width }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(a + 1, results.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(a - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (results[active]) onPick(results[active]);
        }
      }}
    >
      <div className="md-qc-shapes" role="toolbar" aria-label="Basic shapes">
        {QUICK_SHAPES.map((shape) => (
          <button key={shape} className="md-qc-shape" data-shape={shape} title={QUICK_SHAPE_LABEL[shape]} aria-label={QUICK_SHAPE_LABEL[shape]} onClick={() => onShape(shape)}>
            <ShapeIcon shape={shape} />
          </button>
        ))}
      </div>
      <input
        ref={input}
        className="md-qc-input"
        placeholder="Search stencils to connect…"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="md-qc-results" role="listbox">
        {!query.trim() && results.length > 0 && <div className="md-qc-collection">Recently used</div>}
        {results.map((item, i) => (
          <button
            key={item.id}
            role="option"
            aria-selected={i === active}
            className={`md-qc-result${i === active ? " active" : ""}`}
            title={[item.collection, ...item.groups].join(" › ")}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(item)}
          >
            <img src={`${libraryFileUrl(item.file)}?v=${item.mtime}`} alt="" draggable={false} />
            <span className="md-qc-name">{item.name}</span>
            <span className="md-qc-collection">{item.collection}</span>
          </button>
        ))}
        {!results.length && (
          <div className="md-qc-empty">{query.trim() ? "No icons match." : library?.items.some(isIcon) ? "Type to search the stencil library." : "The stencil library has no icons yet."}</div>
        )}
      </div>
    </div>
  );
}
