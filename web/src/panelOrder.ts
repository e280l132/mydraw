// Drag-to-reorder for the sections of Excalidraw's properties panel (left side), plus our own
// sections (Colors & styles, Properties). The order is a global setting (`Settings.panelOrder`,
// logic in shared/panelOrder.ts).
//
// Excalidraw owns its panel DOM (React), so nodes are never moved: every section gets an inline CSS
// `order` (the panel column is a flex column) and a `data-md-key`. Our host div is
// `display: contents`, so its sections are flex items of the column too. A drag starts on a
// section's title (`legend`, or the Opacity label) and is handled by window capture listeners.
import { displayOrder, moveSection, nativeOrder } from "../../shared/panelOrder";

// Rearrange mode (toggled by the button at the bottom of the panel): only then do titles show grips
// and start drags. Body class `md-panel-arrange` drives the CSS.
let arranging = false;
const DRAG_TITLE = "Drag to move this section";

export const isArranging = () => arranging;

/** Turn rearrange mode on/off for every panel (tooltips are refreshed by the next `applyPanelOrder`). */
export function setArranging(on: boolean): void {
  arranging = on;
  document.body.classList.toggle("md-panel-arrange", on);
}

/** Excalidraw button aria-labels (English) that identify a section without a radio group. */
const BUTTON_KEYS: Array<[string, string]> = [
  ["Align left", "align"],
  ["Send to back", "layers"],
  ["Duplicate", "actions"],
  ["Delete", "actions"],
];

const slug = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Stable, language-independent key of one panel section, or null when it can't be identified. */
export function sectionKey(el: HTMLElement): string | null {
  const own = el.dataset.mdSection;
  if (own) return own;
  const radio = el.querySelector<HTMLInputElement>("input[type=radio][name]");
  if (radio) return slug(radio.name) || null;
  const range = el.querySelector<HTMLInputElement>("input[type=range][data-testid]");
  if (range) return slug(range.dataset.testid!) || null;
  for (const [label, key] of BUTTON_KEYS) {
    if (el.querySelector(`button[aria-label="${label}"]`)) return key;
  }
  const legend = el.querySelector(":scope > legend")?.textContent?.trim();
  if (legend) return slug(legend) || null;
  if (el.classList.contains("control-label")) return slug(el.firstChild?.textContent ?? "") || null;
  return null;
}

interface Section {
  el: HTMLElement;
  key: string | null;
}

/** The column's sections in DOM order (our host's children inline). Hidden native color rows skipped. */
function sections(column: HTMLElement): Section[] {
  const out: Section[] = [];
  const visit = (el: HTMLElement) => {
    if (el.classList.contains("md-style-host")) {
      for (const k of el.children) visit(k as HTMLElement);
      return;
    }
    if (el.classList.contains("md-native-color") || el.classList.contains("md-panel-foot-host")) return;
    out.push({ el, key: sectionKey(el) });
  };
  for (const k of column.children) visit(k as HTMLElement);
  return out;
}

/** Keys shown right now in native order (duplicates dropped: the first keeps the key). */
function presentKeys(list: Section[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const s of list) {
    if (!s.key || seen.has(s.key)) {
      s.key = null;
      continue;
    }
    seen.add(s.key);
    keys.push(s.key);
  }
  return nativeOrder(keys);
}

/** Apply the saved order to a panel column with inline `order` values. Idempotent. */
export function applyPanelOrder(column: HTMLElement, saved: readonly string[]): void {
  const list = sections(column);
  const present = presentKeys(list);
  const rank = new Map(displayOrder(saved, present).map((k, i) => [k, (i + 1) * 10]));
  let last = 0;
  for (const s of list) {
    // Unidentified sections stay just after the section before them in the DOM.
    const order = s.key ? rank.get(s.key)! : last + 1;
    if (s.key) last = order;
    const value = String(order);
    if (s.el.style.order !== value) s.el.style.order = value;
    const title = s.el.querySelector<HTMLElement>(":scope > legend") ?? (s.el.classList.contains("control-label") ? s.el : null);
    if (title) {
      if (s.key && arranging && !title.title) title.title = DRAG_TITLE;
      else if (!arranging && title.title === DRAG_TITLE) title.removeAttribute("title");
    }
    const key = s.key ?? "";
    if ((s.el.dataset.mdKey ?? "") !== key) {
      if (key) s.el.dataset.mdKey = key;
      else delete s.el.dataset.mdKey;
    }
  }
}

/** The title a section is dragged by, if `target` is on one. */
function handleSection(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("input, textarea, select, button")) return null;
  const legend = target.closest("legend");
  const host = legend ? legend.parentElement : target.closest<HTMLElement>(".panelColumn > label.control-label");
  if (!host?.dataset.mdKey || !host.closest(".App-menu__left .panelColumn")) return null;
  // Only the title row of a control label (the label text, not the slider area).
  if (!legend && target !== host) return null;
  return host;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

const DRAG_START_PX = 4;

/**
 * Listen for section drags inside `root`. `getOrder` returns the saved order, `onDrop` gets the new one.
 * Returns the cleanup.
 */
export function installPanelDrag(root: HTMLElement, getOrder: () => readonly string[], onDrop: (order: string[]) => void): () => void {
  let drag: {
    pointerId: number;
    section: HTMLElement;
    column: HTMLElement;
    startY: number;
    started: boolean;
    line: HTMLDivElement | null;
    to: number;
    scroller: HTMLElement | null;
  } | null = null;

  const shown = (column: HTMLElement) =>
    [...column.querySelectorAll<HTMLElement>("[data-md-key]")]
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  const finish = (commit: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.line?.remove();
    d.section.classList.remove("md-section-dragging");
    document.body.classList.remove("md-panel-dragging");
    if (!commit || !d.started) return;
    const keys = shown(d.column).map((el) => el.dataset.mdKey!);
    const key = d.section.dataset.mdKey!;
    // Shown keys in their current visual order: unsaved ones then land where they are shown now.
    const next = moveSection(getOrder(), keys, key, d.to);
    applyPanelOrder(d.column, next);
    onDrop(next);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag || !arranging) return;
    const section = handleSection(e.target);
    if (!section || !root.contains(section)) return;
    const column = section.closest<HTMLElement>(".panelColumn")!;
    drag = { pointerId: e.pointerId, section, column, startY: e.clientY, started: false, line: null, to: 0, scroller: scrollParent(column) };
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.started) {
      if (Math.abs(e.clientY - drag.startY) < DRAG_START_PX) return;
      drag.started = true;
      drag.section.classList.add("md-section-dragging");
      document.body.classList.add("md-panel-dragging");
      drag.line = document.createElement("div");
      drag.line.className = "md-drop-line";
      document.body.append(drag.line);
    }
    e.preventDefault();
    e.stopPropagation();
    // Scroll the panel when dragging near its top or bottom edge.
    if (drag.scroller) {
      const r = drag.scroller.getBoundingClientRect();
      if (e.clientY < r.top + 28) drag.scroller.scrollTop -= 10;
      else if (e.clientY > r.bottom - 28) drag.scroller.scrollTop += 10;
    }
    const list = shown(drag.column);
    const others = list.filter((el) => el !== drag!.section);
    let ins = others.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    if (ins < 0) ins = others.length;
    drag.to = ins;
    const colRect = drag.column.getBoundingClientRect();
    const y = ins < others.length ? others[ins].getBoundingClientRect().top - 3 : (others.at(-1)?.getBoundingClientRect().bottom ?? colRect.top) + 3;
    Object.assign(drag.line!.style, { top: `${y - 1}px`, left: `${colRect.left}px`, width: `${colRect.width}px` });
  };

  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const started = drag.started;
    finish(true);
    if (started) {
      e.preventDefault();
      e.stopPropagation();
      // The click that follows a drag must not act (e.g. collapse a section by its title).
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (drag?.started && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  const onCancel = () => finish(false);

  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", onCancel);
  return () => {
    finish(false);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onCancel);
  };
}
