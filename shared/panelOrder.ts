// Order of the sections in the properties panel (left side): a global user setting
// (`Settings.panelOrder`), changed by dragging a section by its title. Pure, unit-tested.
//
// Keys are stable, language-independent section names (see `sectionKey` in web/src/panelOrder.ts).
// The saved list may name sections that are not shown right now (they depend on the selection);
// they keep their place for when they come back. Sections never saved keep their native place,
// right after the section that precedes them natively.

export const MAX_PANEL_KEYS = 64;
const KEY_RE = /^[a-z0-9][a-z0-9 _.-]{0,39}$/;

/** Validate untrusted input (settings file / renderer patch): strings in key form, de-duplicated, capped. */
export function normalizePanelOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !KEY_RE.test(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length >= MAX_PANEL_KEYS) break;
  }
  return out;
}

/**
 * Native order of the shown sections, as mydraw presents them without a saved order: Excalidraw's
 * DOM order, except that its Align section sits just above Edges (it is far below otherwise).
 */
export function nativeOrder(present: readonly string[]): string[] {
  const out = [...present];
  const a = out.indexOf("align");
  const e = out.indexOf("edges");
  if (a > e && e >= 0) {
    out.splice(a, 1);
    out.splice(e, 0, "align");
  }
  return out;
}

/**
 * Full order: the saved keys, plus every shown key that was never saved, inserted after the
 * nearest key that precedes it in `present` (native order) and is already placed (else first).
 */
export function mergeOrder(saved: readonly string[], present: readonly string[]): string[] {
  const full = [...saved];
  present.forEach((k, i) => {
    if (full.includes(k)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = full.indexOf(present[j]);
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    full.splice(at, 0, k);
  });
  return full;
}

/** The shown sections in display order. `present` is in native order. */
export function displayOrder(saved: readonly string[], present: readonly string[]): string[] {
  const shown = new Set(present);
  return mergeOrder(saved, present).filter((k) => shown.has(k));
}

/**
 * Move shown section `key` to position `to` (0 = top) among the shown sections and return the new
 * order to save. Sections that are not shown keep their slots in the saved order.
 */
export function moveSection(saved: readonly string[], present: readonly string[], key: string, to: number): string[] {
  const full = mergeOrder(saved, present);
  const shown = new Set(present);
  const display = full.filter((k) => shown.has(k));
  const from = display.indexOf(key);
  if (from < 0) return full;
  display.splice(from, 1);
  display.splice(Math.max(0, Math.min(to, display.length)), 0, key);
  let i = 0;
  return full.map((k) => (shown.has(k) ? display[i++] : k));
}
