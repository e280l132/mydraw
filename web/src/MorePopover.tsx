// Sub-windows of the style panel: the "More…" popovers (Fill, Stroke style, Shadow) and the fine-tune
// sliders (web/src/FineTune.tsx). Each opens to the right of the panel, next to its button. Its title
// bar can be dragged: a moved window becomes *floating*: it stays where it was put (also the next time
// it opens, per kind, `localStorage mydraw.floatPos`), it stays open when the canvas is clicked, and Esc
// closes it only while focus is inside it. The dock button puts it back beside the panel, × closes it.
// Rendered inside the drawing's Excalidraw root so the app's and Excalidraw's theme variables apply.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Pos = { left: number; top: number };

const FLOAT_KEY = "mydraw.floatPos";
/** How much of a window must stay on screen (px) so its title bar can always be grabbed again. */
const KEEP = 48;

function readAll(): Record<string, Pos> {
  try {
    const v = JSON.parse(localStorage.getItem(FLOAT_KEY) ?? "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function savedPos(kind: string): Pos | null {
  const p = readAll()[kind];
  return p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : null;
}
function savePos(kind: string, p: Pos | null) {
  const all = readAll();
  if (p) all[kind] = { left: Math.round(p.left), top: Math.round(p.top) };
  else delete all[kind];
  try {
    localStorage.setItem(FLOAT_KEY, JSON.stringify(all));
  } catch {
    /* private mode: positions just aren't kept */
  }
}

/** Keep the title bar reachable: at least KEEP px of the window inside the viewport, top never above 0. */
function onScreen(p: Pos, w: number): Pos {
  return {
    left: Math.min(window.innerWidth - KEEP, Math.max(KEEP - w, p.left)),
    top: Math.min(window.innerHeight - KEEP, Math.max(0, p.top)),
  };
}

/** Beside the panel, level with the button that opened it (the old popover placement). */
function besidePanel(anchor: HTMLElement, h: number): Pos {
  const r = anchor.getBoundingClientRect();
  const island = anchor.closest(".App-menu__left")?.getBoundingClientRect();
  return { left: (island?.right ?? r.right) + 8, top: Math.max(8, Math.min(r.top - 12, window.innerHeight - h - 8)) };
}

export interface Floating {
  pos: Pos | null;
  floating: boolean;
  /** Title bar pointerdown: drag the window (buttons and inputs in the bar are left alone). */
  onHeadPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  /** Back beside the panel; forgets the saved position. */
  dock(): void;
}

/**
 * Placement + dragging + dismissal for a style-panel sub-window. `onClose` runs on an outside click
 * (docked windows only) or Esc; `onOutside` (optional) runs first, e.g. to cancel a slider preview.
 */
export function useFloating(kind: string, anchor: HTMLElement | null, box: RefObject<HTMLDivElement | null>, onClose: () => void, onOutside?: () => void): Floating {
  const [pos, setPos] = useState<Pos | null>(null);
  const [floating, setFloating] = useState(() => savedPos(kind) !== null);
  const posRef = useRef(pos);
  posRef.current = pos;

  useLayoutEffect(() => {
    const w = box.current?.offsetWidth ?? 260;
    const h = box.current?.offsetHeight ?? 160;
    const saved = savedPos(kind);
    if (saved) setPos(onScreen(saved, w));
    else if (anchor) setPos(besidePanel(anchor, h));
  }, [anchor, kind, box]);

  // A window resize must not strand a floating window off screen.
  useEffect(() => {
    if (!floating) return;
    const on = () => setPos((p) => (p ? onScreen(p, box.current?.offsetWidth ?? 260) : p));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [floating, box]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor?.contains(t)) return;
      if (floating) return; // a floating window stays until closed
      onOutside?.();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (floating && !box.current?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      onOutside?.();
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose, onOutside, floating, box]);

  const onHeadPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea")) return;
      const start = posRef.current;
      if (!start) return;
      e.preventDefault();
      const head = e.currentTarget;
      head.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY;
      const w = box.current?.offsetWidth ?? 260;
      let moved = false;
      let last = start;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0, dy = ev.clientY - y0;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        last = onScreen({ left: start.left + dx, top: start.top + dy }, w);
        setPos(last);
      };
      // The release point counts too: the last pointermove may have been coalesced away.
      const up = (ev: PointerEvent) => {
        move(ev);
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        head.removeEventListener("pointercancel", up);
        if (!moved) return;
        savePos(kind, last);
        setFloating(true);
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
      head.addEventListener("pointercancel", up);
    },
    [kind, box],
  );

  const dock = useCallback(() => {
    savePos(kind, null);
    setFloating(false);
    if (anchor) setPos(besidePanel(anchor, box.current?.offsetHeight ?? 160));
  }, [kind, anchor, box]);

  return { pos, floating, onHeadPointerDown, dock };
}

/** The draggable title bar: title, extra content (e.g. the current value), dock (when floating) and close. */
export function FloatHead({ title, f, onClose, children }: { title: string; f: Floating; onClose(): void; children?: ReactNode }) {
  return (
    <div className="md-ft-head md-float-head" onPointerDown={f.onHeadPointerDown} title={f.floating ? undefined : "Drag to move this window anywhere"}>
      <span className="md-float-grip" aria-hidden="true">
        <svg viewBox="0 0 8 12" width="8" height="12">
          {[2, 6].map((x) => [2, 6, 10].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="currentColor" />))}
        </svg>
      </span>
      <span className="md-float-title">{title}</span>
      {children}
      {f.floating && (
        <button type="button" className="md-float-btn md-float-dock" title="Put it back next to the panel" aria-label="Dock next to the panel" onClick={f.dock}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M6 3v10" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      )}
      <button type="button" className="md-float-btn md-float-close" title="Close" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

interface PopoverProps {
  title: string;
  kind: string;
  anchor: HTMLElement | null;
  onClose(): void;
  /**
   * Nothing is selected: the window sets the default for shapes drawn next. Shown as a banner at the
   * top (a floating window stays open when the selection is cleared, so the switch must be obvious),
   * with `onClear` = a button that turns the default off.
   */
  newShapes?: { text: string; clearLabel?: string; onClear?(): void } | null;
  children: ReactNode;
}

/** A "More…" sub-window (Fill, Stroke style, Shadow). */
export function MorePopover({ title, kind, anchor, onClose, newShapes, children }: PopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const f = useFloating(kind, anchor, box, onClose);

  return createPortal(
    <div
      ref={box}
      className={`md-ft-pop md-more-pop${f.floating ? " md-floating" : ""}${newShapes ? " md-new-mode" : ""}`}
      data-more-pop={kind}
      data-mode={newShapes ? "new" : "selection"}
      role="dialog"
      aria-label={title}
      style={f.pos ? { left: f.pos.left, top: f.pos.top } : { visibility: "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <FloatHead title={newShapes ? `${title} · new shapes` : title} f={f} onClose={onClose} />
      {newShapes && (
        <div className="md-new-banner" role="note">
          <span>{newShapes.text}</span>
          {newShapes.onClear && (
            <button type="button" className="md-chip md-new-clear" onClick={newShapes.onClear}>
              {newShapes.clearLabel ?? "None"}
            </button>
          )}
        </div>
      )}
      {children}
    </div>,
    // Inside the drawing's Excalidraw root, so the app's and Excalidraw's theme variables (dark mode) apply.
    anchor?.closest<HTMLElement>(".excalidraw") ?? document.body,
  );
}
