// Quick connect (draw.io style): four "+" handles around the selected shape/stencil/group, or around
// one the pointer rests on for a moment (passing over things shows nothing). On a handle:
//   click          -> a copy on that side, close by, no arrow
//   Option-click   -> a copy on that side joined by an arrow
//   ⌘-click / ⌘-drag -> draw an arrow to something already there, routed around shapes (LinkMode.tsx:
//                     live preview, choose the side, bend points, style keys)
//   Shift-click / right-click -> pick a stencil for a new connected node
// The handles are a DOM overlay over the active tab's canvas, never part of the scene.
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { libraryFileUrl, searchItems, type LibraryIndex, type LibraryItem } from "../../shared/library";
import { QUICK_SIDES, type QuickSide } from "../../shared/quickConnect";
import { addConnectedCopy, addConnectedStencil, quickSourceAt, selectedUnit, unitById } from "./quickConnectOps";
import { LinkMode } from "./LinkMode";

interface Props {
  tabId: string;
  getApi(): ExcalidrawImperativeAPI | undefined;
  library: LibraryIndex | null;
  /** A dialog, palette, find bar or pick mode is open. */
  blocked: boolean;
  onToast(text: string, error?: boolean): void;
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
/** Pointer travel (screen px) that counts as moving rather than resting. */
const REST_JITTER = 6;
/** How often the selection is checked (ms). */
const SELECTION_POLL_MS = 120;

interface View {
  id: string;
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
  sourceId: string;
  side: QuickSide;
  /** Set when started by pressing on the handle: releasing over a target after a drag connects. */
  pressedAt: { x: number; y: number } | null;
}

interface Search {
  sourceId: string;
  side: QuickSide;
  x: number;
  y: number;
}

const isIcon = (i: LibraryItem) => i.kind === "svg" || i.kind === "png";

/** Is Excalidraw busy with something the handles must not get in the way of? */
function suppressed(api: ExcalidrawImperativeAPI): boolean {
  const st = api.getAppState() as AppState & { contextMenu?: unknown };
  if (
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
  )
    return true;
  // More than one thing selected (a group, e.g. an icon node, counts as one).
  const units = new Set<string>();
  for (const el of api.getSceneElements()) {
    if (!st.selectedElementIds[el.id]) continue;
    if (el.type === "text" && el.containerId) continue;
    units.add(el.groupIds.at(-1) ?? el.id);
  }
  return units.size > 1;
}

function viewOf(api: ExcalidrawImperativeAPI, id: string, overlay: Element | null): View | null {
  const unit = unitById(api, id);
  if (!unit || suppressed(api)) return null;
  const st = api.getAppState();
  const z = st.zoom.value;
  const sx = (x: number) => (x + st.scrollX) * z + st.offsetLeft;
  const sy = (y: number) => (y + st.scrollY) * z + st.offsetTop;
  const v: View = {
    id,
    x1: sx(unit.box.x),
    y1: sy(unit.box.y),
    x2: sx(unit.box.x + unit.box.width),
    y2: sy(unit.box.y + unit.box.height),
    selected: unit.members.some((m) => st.selectedElementIds[m.id]),
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

/** ⌘ on a Mac (Ctrl-click is a right-click there), Ctrl elsewhere. */
const IS_MAC = /Mac/i.test(navigator.platform);
const linkModifier = (e: { metaKey: boolean; ctrlKey: boolean }) => (IS_MAC ? e.metaKey : e.metaKey || e.ctrlKey);

const SIDE_NAME: Record<QuickSide, string> = { top: "above", right: "to the right", bottom: "below", left: "to the left" };

export function QuickConnect({ tabId, getApi, library, blocked, onToast }: Props) {
  /** The unit the pointer has rested on (handles shown). */
  const [hoverId, setHoverId] = useState<string | null>(null);
  /** The one unit that is selected (handles shown). */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Modifier held: changes what a click on a handle does (and its icon). */
  const [mods, setMods] = useState<"none" | "alt" | "meta">("none");
  const [link, setLink] = useState<Link | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const hoverRef = useRef<string | null>(null);
  const candidateRef = useRef<{ id: string; timer: number; at: { x: number; y: number } } | null>(null);
  const pointRef = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef<View | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

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
        v.id === hoverRef.current &&
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

  // The selected unit shows its handles at once. Polled (cheaply) because Excalidraw has no selection event.
  useEffect(() => {
    let key = "";
    const poll = () => {
      const api = getApi();
      const sel = api && !blockedRef.current ? api.getAppState().selectedElementIds : null;
      // Ids plus their groups: grouping or ungrouping the selection leaves the ids alone but changes the unit.
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
      setSelectedId(api && k ? (selectedUnit(api)?.id ?? null) : null);
    };
    poll();
    const timer = window.setInterval(poll, SELECTION_POLL_MS);
    return () => window.clearInterval(timer);
  }, [getApi]);

  // Option / ⌘ change what a handle does; the icon shows it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setMods(linkModifier(e) ? "meta" : e.altKey ? "alt" : "none");
    const off = () => setMods("none");
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", off);
    };
  }, []);

  // Whose handles to show: the unit the pointer rests on, else the selected one.
  const activeId = hoverId ?? selectedId;

  // While handles are up, follow scrolling/zooming/edits and hide them when Excalidraw gets busy.
  useEffect(() => {
    if (!activeId || blocked) {
      viewRef.current = null;
      setView(null);
      return;
    }
    let frame = 0;
    let key = "";
    const tick = () => {
      const api = getApi();
      const v = api ? viewOf(api, activeId, overlayRef.current) : null;
      const k = v ? `${v.x1}:${v.y1}:${v.x2}:${v.y2}:${v.selected}:${v.sides.join()}` : "";
      if (k !== key) {
        key = k;
        viewRef.current = v;
        setView(v);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [activeId, blocked, getApi]);

  const connectCopy = (side: QuickSide, connect: boolean) => {
    const api = getApi();
    const id = viewRef.current?.id;
    if (!api || !id) return;
    setHover(null);
    try {
      if (!addConnectedCopy(api, id, side, { connect })) onToast("That shape can't be copied from here.", true);
    } catch (e) {
      onToast(`Quick connect failed: ${(e as Error).message}`, true);
    }
    focusCanvas();
  };

  // ---------- ⌘-click: connect to an existing shape ----------

  const startLink = (side: QuickSide, pressedAt: { x: number; y: number } | null) => {
    const v = viewRef.current;
    if (!v) return;
    cancelCandidate();
    setHover(null);
    setLink({ sourceId: v.id, side, pressedAt });
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

  const openSearch = (side: QuickSide, at: { x: number; y: number }) => {
    const id = viewRef.current?.id;
    if (!id) return;
    setHover(null);
    setSearch({ sourceId: id, side, x: at.x, y: at.y });
  };

  const closeSearch = useCallback(() => {
    setSearch(null);
    focusCanvas();
  }, [focusCanvas]);

  const pick = (item: LibraryItem) => {
    const s = search;
    const api = getApi();
    closeSearch();
    if (!s || !api) return;
    addConnectedStencil(api, s.sourceId, s.side, item).then(
      (id) => {
        if (id) void window.mydraw.libraryMarkUsed(item.id);
        else onToast("The shape is gone; nothing was added.", true);
      },
      (e: Error) => onToast(`Could not add “${item.name}”: ${e.message}`, true),
    );
  };

  // Close the stencil search on a click elsewhere, or when the tab is blocked by a dialog.
  useEffect(() => {
    if (!search) return;
    if (blocked) return setSearch(null);
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && searchRef.current?.contains(e.target)) return;
      setSearch(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [search, blocked]);

  return (
    <div className="md-qc" ref={overlayRef}>
      {/* Which thing the handles belong to (a selected one already has Excalidraw's selection box). */}
      {view && !search && !link && !view.selected && (
        <div className="md-qc-outline" style={{ left: view.x1 - 4, top: view.y1 - 4, width: view.x2 - view.x1 + 8, height: view.y2 - view.y1 + 8 }} />
      )}
      {view &&
        !search &&
        !link &&
        view.sides.map((side) => {
          const p = handlePoint(view, side);
          return (
            <button
              key={side}
              className="md-qc-handle"
              data-side={side}
              tabIndex={-1}
              style={{ left: p.x, top: p.y }}
              title={`Click: add a copy ${SIDE_NAME[side]}\nOption-click: add a copy joined by an arrow\n⌘-click or ⌘-drag: draw an arrow to another shape (around shapes in between)\nShift-click or right-click: pick a stencil`}
              aria-label={
                mods === "meta" ? `Connect ${SIDE_NAME[side]} to another shape` : mods === "alt" ? `Add a connected copy ${SIDE_NAME[side]}` : `Add a copy ${SIDE_NAME[side]}`
              }
              onPointerDown={(e) => {
                e.stopPropagation();
                // ⌘-press starts linking at once, so dragging from the handle onto a target works too.
                if (e.button === 0 && linkModifier(e) && !e.shiftKey) {
                  e.preventDefault();
                  startLink(side, { x: e.clientX, y: e.clientY });
                }
              }}
              onMouseDown={(e) => e.preventDefault() /* keep focus on the canvas */}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) openSearch(side, p);
                else if (linkModifier(e)) return; // linking already started on pointerdown
                else connectCopy(side, e.altKey);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openSearch(side, p);
              }}
            >
              {mods === "meta" ? (
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" data-icon="link">
                  <circle cx="3.5" cy="12.5" r="2" fill="currentColor" />
                  <path d="M5 11l7-7M8 4h4v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : mods === "alt" ? (
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
      {link && <LinkMode key={`${link.sourceId}:${link.side}`} getApi={getApi} sourceId={link.sourceId} side={link.side} pressedAt={link.pressedAt} onEnd={endLink} onToast={onToast} />}
      {search && <StencilSearch ref={searchRef} at={search} library={library} onPick={pick} onClose={closeSearch} />}
    </div>
  );
}

interface SearchProps {
  at: Search;
  library: LibraryIndex | null;
  onPick(item: LibraryItem): void;
  onClose(): void;
  ref: Ref<HTMLDivElement>;
}

function StencilSearch({ at, library, onPick, onClose, ref }: SearchProps) {
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
  const top = Math.max(8, Math.min(at.y + 14, window.innerHeight - 320));

  return (
    <div
      ref={ref}
      className="md-qc-search"
      role="dialog"
      aria-label="Pick a stencil to connect"
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
      <input
        ref={input}
        className="md-qc-input"
        placeholder="Search stencils to connect…"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="md-qc-results" role="listbox">
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
