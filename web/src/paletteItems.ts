// Builds the list of things the command palette can run, from the current app state.
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { TEMPLATES } from "../../shared/templates";
import type { LibraryIndex, LibraryItem } from "../../shared/library";
import type { MenuCommand, Settings } from "../../shared/types";
import type { PaletteItem } from "./CommandPalette";
import { FORMAT_LABEL } from "./ExportDialog";
import { EXPORT_FORMATS, listFrames, type ExportFormat } from "./exportImage";
import { allPresets, allThemes } from "./styleStore";
import { applyPresetTo, applyThemeTo, selectedIds } from "./uiActions";

export interface PaletteContext {
  api: ExcalidrawImperativeAPI | undefined;
  settings: Settings | null;
  tabs: ReadonlyArray<{ id: string; title: string }>;
  activeId: string;
  library: LibraryIndex | null;
  command(cmd: MenuCommand): void;
  exportAs(format: ExportFormat): void;
  insertItem(item: LibraryItem): void;
  setActive(id: string): void;
  toast(text: string, error?: boolean): void;
  onSettings(patch: Partial<Settings>): void;
  linkSelection(): void;
  clearLinks(): void;
}

/** Most elements offered as "Go to" entries (a big drawing would flood the list). */
const MAX_JUMP = 400;

export function buildPaletteItems(c: PaletteContext): PaletteItem[] {
  const items: PaletteItem[] = [];
  const add = (category: string, title: string, run: () => void | Promise<void>, extra: Partial<PaletteItem> = {}) =>
    items.push({ id: `${category}:${title}:${items.length}`, category, title, run, ...extra });
  const cmd = (category: string, title: string, command: MenuCommand, extra: Partial<PaletteItem> = {}) =>
    add(category, title, () => c.command(command), extra);

  // ----- file / app -----
  cmd("File", "New drawing", { type: "new" }, { hint: "⌘N" });
  cmd("File", "Open…", { type: "open" }, { hint: "⌘O" });
  cmd("File", "Save", { type: "save" }, { hint: "⌘S" });
  cmd("File", "Save as…", { type: "saveAs" }, { hint: "⇧⌘S" });
  cmd("File", "Close tab", { type: "closeTab" }, { hint: "⌘W" });
  cmd("File", "Next tab", { type: "nextTab" });
  cmd("File", "Previous tab", { type: "prevTab" });
  for (const t of c.tabs) {
    if (t.id !== c.activeId) add("Tabs", `Switch to “${t.title}”`, () => c.setActive(t.id), { keywords: "tab go open" });
  }

  cmd("View", "Show / hide pages panel", { type: "togglePages" }, { hint: "⌥⌘P", keywords: "frames navigator slides" });
  cmd("View", "Show / hide diagram lint", { type: "toggleLint" }, { hint: "⌥⌘L", keywords: "check problems review overlap unconnected arrows palette colors fix" });
  add("Edit", "Link selection to a drawing…", c.linkSelection, { keywords: "hyperlink drill down open diagram" });
  add("Edit", "Remove links from selection", c.clearLinks, { keywords: "hyperlink unlink" });
  cmd("Edit", "Find and replace…", { type: "findReplace" }, { hint: "⌥⌘F", keywords: "search text rename" });

  // ----- export -----
  cmd("Export", "Export…", { type: "export" }, { hint: "⇧⌘E" });
  for (const f of EXPORT_FORMATS) add("Export", `Export as ${FORMAT_LABEL[f]}…`, () => c.exportAs(f), { keywords: `save ${f}` });
  cmd("Export", "Copy as PNG", { type: "copyAs", format: "png" }, { keywords: "clipboard" });
  cmd("Export", "Copy as SVG", { type: "copyAs", format: "svg" }, { keywords: "clipboard" });
  cmd("Export", "Copy as Mermaid", { type: "copyAs", format: "mermaid" }, { keywords: "clipboard" });

  // ----- stencils panel -----
  cmd("Stencils", "Show / hide stencils panel", { type: "toggleStencils" }, { hint: "⇧⌘Y" });
  cmd("Stencils", "Save selection as stencil…", { type: "saveStencil" });

  // ----- preferences -----
  const s = c.settings;
  if (s) {
    for (const theme of ["system", "light", "dark"] as const) {
      if (s.theme !== theme) add("Preferences", `App theme: ${theme}`, () => c.onSettings({ theme }), { keywords: "appearance dark light mode" });
    }
    for (const drawingStyle of ["clean", "sketch"] as const) {
      if (s.drawingStyle !== drawingStyle) add("Preferences", `Drawing style: ${drawingStyle}`, () => c.onSettings({ drawingStyle }), { keywords: "rough hand-drawn" });
    }
    add("Preferences", s.autosave ? "Turn autosave off" : "Turn autosave on", () => c.onSettings({ autosave: !s.autosave }));
  }

  // ----- drawing themes and style presets -----
  if (c.api) {
    const api = c.api;
    for (const t of allThemes()) {
      add(
        "Themes",
        `Theme: ${t.title}`,
        () => {
          const scoped = selectedIds(api).length > 0;
          const n = applyThemeTo(api, t);
          c.toast(`Applied “${t.title}”${scoped ? " to the selection" : ""} (${n} restyled)`);
        },
        { keywords: `${t.category} ${t.description} style look` },
      );
    }
    for (const p of allPresets()) {
      add(
        "Style presets",
        `Style: ${p.title}`,
        () => {
          if (!selectedIds(api).length) return c.toast("Select something first, then apply a style preset.", true);
          applyPresetTo(api, p);
        },
        { keywords: `${p.category} ${p.description}` },
      );
    }
    // ----- jump to an element by its text -----
    const scene = api.getSceneElements();
    const byId = new Map(scene.map((e) => [e.id, e]));
    const seen = new Set<string>();
    for (const t of scene) {
      if (t.type !== "text") continue;
      const target = (t.containerId && byId.get(t.containerId)) || t;
      const label = (t.originalText || t.text).replace(/\s+/g, " ").trim();
      if (!label || seen.has(target.id) || seen.size >= MAX_JUMP) continue;
      seen.add(target.id);
      add(
        "Elements",
        `Go to: ${label.length > 60 ? `${label.slice(0, 57)}…` : label}`,
        () => {
          api.updateScene({ appState: { selectedElementIds: { [target.id]: true } } as never, captureUpdate: "NEVER" as never });
          api.scrollToContent(target, { animate: true });
        },
        { keywords: "jump find element select" },
      );
    }
    // ----- frames (pages) -----
    for (const f of listFrames(api)) {
      add(
        "Frames",
        `Go to frame: ${f.name}`,
        () => {
          const el = api.getSceneElements().find((e) => e.id === f.id);
          if (el) api.scrollToContent(el, { fitToContent: true, animate: true });
        },
        { keywords: "page slide" },
      );
    }
  }

  // ----- templates -----
  for (const t of TEMPLATES) {
    add(
      "Templates",
      `Template: ${t.title}`,
      async () => {
        try {
          await window.mydraw.applyTemplate(t.name);
        } catch (e) {
          c.toast(`Template failed: ${(e as Error).message}`, true);
        }
      },
      { keywords: `${t.name} ${t.description} diagram starter` },
    );
  }

  // ----- stencils -----
  for (const item of c.library?.items ?? []) {
    add(item.collection, `Insert ${item.name}`, () => c.insertItem(item), {
      keywords: `stencil icon ${item.groups.join(" ")} ${item.tags.join(" ")}`,
    });
  }
  return items;
}
