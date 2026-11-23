// Align & distribute = Excalidraw's own actions (its "Align" section in the properties panel,
// shown for 2+ selected items; distribute needs 3+). The panel section sits just above Excalidraw's
// Edges section by default (panel section order, web/src/panelOrder.ts); the command palette entries
// below press the same buttons, found by their English aria-labels (see EXCALIDRAW-UPGRADE.md).

export const ARRANGE_ACTIONS = [
  { label: "Align left", keys: "⇧⌘←" },
  { label: "Center horizontally", keys: "" },
  { label: "Align right", keys: "⇧⌘→" },
  { label: "Align top", keys: "⇧⌘↑" },
  { label: "Center vertically", keys: "" },
  { label: "Align bottom", keys: "⇧⌘↓" },
  { label: "Distribute horizontally", keys: "⌥H" },
  { label: "Distribute vertically", keys: "⌥V" },
] as const;

/**
 * Tags Excalidraw's Align section `.md-arrange` (classes only, never moving nodes: React owns them).
 * Its place in the panel comes from the section order (web/src/panelOrder.ts): by default just above
 * Edges (`nativeOrder` in shared/panelOrder.ts).
 */
export function tagArrangeSection(column: HTMLElement): void {
  for (const k of column.children) {
    const want = k.tagName === "FIELDSET" && !!k.querySelector('button[aria-label="Align left"]');
    if (k.classList.contains("md-arrange") !== want) k.classList.toggle("md-arrange", want);
  }
}

/** Press Excalidraw's button for `label` in the tab's panel. False when it isn't shown (too few selected). */
export function runArrange(tabId: string, label: string): boolean {
  const btn = document.querySelector<HTMLButtonElement>(`[data-md-tab="${tabId}"] .App-menu__left button[aria-label="${label}"]`);
  if (!btn) return false;
  btn.click();
  return true;
}
