// Align & distribute = Excalidraw's own actions (its "Align" section in the properties panel,
// shown for 2+ selected items; distribute needs 3+). The panel section is moved up to just above
// Excalidraw's Edges section with CSS (tagged in App's panel observer); the command palette entries
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
 * Puts Excalidraw's Align section directly above its Edges section (Sharp/Round) with CSS `order`:
 * Align gets `.md-arrange` (order 1), Edges and everything after it `.md-after-arrange` (order 2).
 * Without an Edges section (e.g. only icons or text selected) Align stays where Excalidraw puts it.
 * Classes only, never moving nodes: React owns them.
 */
export function tagArrangeSection(column: HTMLElement): void {
  const kids = [...column.children] as HTMLElement[];
  const arrange = kids.find((k) => k.tagName === "FIELDSET" && k.querySelector('button[aria-label="Align left"]'));
  const edgesAt = kids.findIndex((k) => k.tagName === "FIELDSET" && k.querySelector('input[name="edges"]'));
  const lift = !!arrange && edgesAt >= 0;
  kids.forEach((k, i) => {
    const wantArrange = lift && k === arrange;
    const wantAfter = lift && k !== arrange && i >= edgesAt;
    if (k.classList.contains("md-arrange") !== wantArrange) k.classList.toggle("md-arrange", wantArrange);
    if (k.classList.contains("md-after-arrange") !== wantAfter) k.classList.toggle("md-after-arrange", wantAfter);
  });
}

/** Press Excalidraw's button for `label` in the tab's panel. False when it isn't shown (too few selected). */
export function runArrange(tabId: string, label: string): boolean {
  const btn = document.querySelector<HTMLButtonElement>(`[data-md-tab="${tabId}"] .App-menu__left button[aria-label="${label}"]`);
  if (!btn) return false;
  btn.click();
  return true;
}
