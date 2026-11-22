// Quick connect (draw.io style): hovering a shape shows four "+" handles around it. Click one to add
// a connected copy on that side; Shift-click (or right-click) to pick a stencil for the new node.
// The handles are a DOM overlay over the active tab's canvas, never part of the scene.
import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { getCommonBounds, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { libraryFileUrl, searchItems, type LibraryIndex, type LibraryItem } from "../../shared/library";
import { QUICK_SIDES, type QuickSide } from "../../shared/quickConnect";
import { addConnectedCopy, addConnectedStencil, isQuickSource, quickSourceAt } from "./quickConnectOps";

interface Props {
  tabId: string;
  getApi(): ExcalidrawImperativeAPI | undefined;
  library: LibraryIndex | null;
  /** A dialog, palette, find bar or pick mode is open. */
  blocked: boolean;
  onToast(text: string, error?: boolean): void;
}

/** Distance of a handle's centre from the shape's edge (screen px); more when the shape is selected, to clear its resize/rotate handles. */
const HANDLE_OFFSET = 26;
const HANDLE_OFFSET_SELECTED = 42;
/** The pointer may stray this far (screen px) outside the shape on its way to a handle. */
const HOVER_SLACK = HANDLE_OFFSET_SELECTED + 18;
const MAX_RESULTS = 8;

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
  const el = api.getSceneElements().find((e) => e.id === id);
  if (!isQuickSource(el) || suppressed(api)) return null;
  const st = api.getAppState();
  const [x1, y1, x2, y2] = getCommonBounds([el]);
  const z = st.zoom.value;
  const sx = (x: number) => (x + st.scrollX) * z + st.offsetLeft;
  const sy = (y: number) => (y + st.scrollY) * z + st.offsetTop;
  const v: View = { id, x1: sx(x1), y1: sy(y1), x2: sx(x2), y2: sy(y2), selected: !!st.selectedElementIds[id], sides: [] };
  v.sides = QUICK_SIDES.filter((side) => onCanvas(handlePoint(v, side), overlay));
  return v.sides.length ? v : null;
}

/** Is a screen point over the drawing canvas itself (not under Excalidraw's toolbars or panels)? */
function onCanvas(p: { x: number; y: number }, overlay: Element | null): boolean {
  const hit = document.elementsFromPoint(p.x, p.y).find((e) => !overlay?.contains(e));
  return hit instanceof HTMLCanvasElement;
}

function handlePoint(v: View, side: QuickSide): { x: number; y: number } {
  const off = v.selected ? HANDLE_OFFSET_SELECTED : HANDLE_OFFSET;
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

const SIDE_NAME: Record<QuickSide, string> = { top: "above", right: "to the right", bottom: "below", left: "to the left" };

export function QuickConnect({ tabId, getApi, library, blocked, onToast }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [search, setSearch] = useState<Search | null>(null);
  const hoverRef = useRef<string | null>(null);
  const viewRef = useRef<View | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  const setHover = useCallback((id: string | null) => {
    hoverRef.current = id;
    setHoverId(id);
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
        if (hoverRef.current) setHover(null);
        return;
      }
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const src = quickSourceAt(api, p.x, p.y);
      if (src) {
        if (src.id !== hoverRef.current) setHover(src.id);
        return;
      }
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
      if (hoverRef.current) setHover(null);
    };
    const onLeave = (e: PointerEvent) => {
      if (e.relatedTarget instanceof Node && overlayRef.current?.contains(e.relatedTarget)) return;
      if (hoverRef.current) setHover(null);
    };
    root.addEventListener("pointermove", onMove, { capture: true, passive: true });
    root.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove, { capture: true });
      root.removeEventListener("pointerdown", onDown, { capture: true });
      root.removeEventListener("pointerleave", onLeave);
    };
  }, [tabId, getApi, setHover]);

  // While handles are up, follow scrolling/zooming/edits and hide them when Excalidraw gets busy.
  useEffect(() => {
    if (!hoverId || blocked) {
      viewRef.current = null;
      setView(null);
      return;
    }
    let frame = 0;
    let key = "";
    const tick = () => {
      const api = getApi();
      const v = api ? viewOf(api, hoverId, overlayRef.current) : null;
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
  }, [hoverId, blocked, getApi]);

  const connectCopy = (side: QuickSide) => {
    const api = getApi();
    const id = hoverRef.current;
    if (!api || !id) return;
    setHover(null);
    try {
      if (!addConnectedCopy(api, id, side)) onToast("That shape can't be connected from here.", true);
    } catch (e) {
      onToast(`Quick connect failed: ${(e as Error).message}`, true);
    }
    focusCanvas();
  };

  const openSearch = (side: QuickSide, at: { x: number; y: number }) => {
    const id = hoverRef.current;
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
      {view &&
        !search &&
        view.sides.map((side) => {
          const p = handlePoint(view, side);
          return (
            <button
              key={side}
              className="md-qc-handle"
              data-side={side}
              tabIndex={-1}
              style={{ left: p.x, top: p.y }}
              title={`Add a connected copy ${SIDE_NAME[side]}\nShift-click or right-click: pick a stencil`}
              aria-label={`Add a connected copy ${SIDE_NAME[side]}`}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.preventDefault() /* keep focus on the canvas */}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey) openSearch(side, p);
                else connectCopy(side);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openSearch(side, p);
              }}
            >
              <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          );
        })}
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
