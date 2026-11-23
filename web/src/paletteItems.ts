// Builds the list of things the command palette can run, from the current app state.
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { TEMPLATES } from "../../shared/templates";
import type { LibraryIndex, LibraryItem } from "../../shared/library";
import type { MenuCommand, Settings } from "../../shared/types";
import { sc } from "../../shared/shortcuts";
import type { PaletteItem } from "./CommandPalette";
import { FORMAT_LABEL } from "./ExportDialog";
import { EXPORT_FORMATS, listFrames, type ExportFormat } from "./exportImage";
import { allPresets, allThemes } from "./styleStore";
import { applyPresetTo, applyThemeTo, selectedIds } from "./uiActions";
import { routeArrowsAround } from "./linkOps";
import { ARRANGE_ACTIONS, runArrange } from "./arrange";

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
  toggleArrangePanel(): void;
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
  cmd("File", "New drawing", { type: "new" }, { hint: sc("newDrawing") });
  cmd("File", "Open…", { type: "open" }, { hint: sc("openFile") });
  cmd("File", "Save", { type: "save" }, { hint: sc("save") });
  cmd("File", "Save as…", { type: "saveAs" }, { hint: sc("saveAs") });
  cmd("File", "Close tab", { type: "closeTab" }, { hint: sc("closeTab") });
  cmd("File", "Next tab", { type: "nextTab" });
  cmd("File", "Previous tab", { type: "prevTab" });
  for (const t of c.tabs) {
    if (t.id !== c.activeId) add("Tabs", `Switch to “${t.title}”`, () => c.setActive(t.id), { keywords: "tab go open" });
  }

  cmd("View", "Show / hide pages panel", { type: "togglePages" }, { hint: sc("pages"), keywords: "frames navigator slides" });
  cmd("View", "Show / hide diagram lint", { type: "toggleLint" }, { hint: sc("lint"), keywords: "check problems review overlap unconnected arrows palette colors fix" });
  cmd("View", "Show / hide grid", { type: "toggleGrid" }, { hint: sc("grid"), keywords: "layout align lines dots guide snap background" });
  cmd("View", "Grid settings (size, color, strength)…", { type: "gridSettings" }, { keywords: "layout align lines dots spacing color opacity light dark major minor" });
  add("View", "Rearrange panel sections (on / off)", c.toggleArrangePanel, { keywords: "properties sidebar sections drag reorder move layout" });
  add("View", "Reset panel section order", () => {
    c.onSettings({ panelOrder: [] });
    c.toast("Panel sections are back in their default order.");
  }, { keywords: "properties sidebar sections drag reorder arrange layout default" });
  for (const a of ARRANGE_ACTIONS) {
    add("Arrange", a.label, () => {
      if (!runArrange(c.activeId, a.label)) {
        c.toast(a.label.startsWith("Distribute") ? "Select at least 3 shapes or icons to distribute." : "Select at least 2 shapes or icons to align.", true);
      }
    }, { hint: a.keys || undefined, keywords: "align distribute arrange line up space evenly layout" });
  }
  cmd("Edit", "Snap selection to grid", { type: "snapToGrid" }, { keywords: "align layout line up round position" });
  add("Edit", "Link selection to a drawing…", c.linkSelection, { keywords: "hyperlink drill down open diagram" });
  add("Edit", "Remove links from selection", c.clearLinks, { keywords: "hyperlink unlink" });
  cmd("View", "Start presentation (frames as slides)", { type: "present" }, { hint: sc("present"), keywords: "slides fullscreen present show pages" });
  cmd("File", "Version history…", { type: "versionHistory" }, { hint: sc("versionHistory"), keywords: "snapshots restore previous older undo save" });
  cmd("Edit", "Fonts…", { type: "fonts" }, { keywords: "font typeface handwriting hand drawn cartoon comic professional serif sans mono download google install" }),
  cmd("Edit", "Quick connect shortcuts…", { type: "quickConnectSettings" }, { keywords: "keyboard modifiers option command shift click handle plus arrow link rebind settings preferences" });
  cmd("File", "Import diagram from text (CSV / YAML / Mermaid)…", { type: "importText" }, { hint: sc("importText"), keywords: "paste hosts list diagram as code build generate" });
  cmd("Edit", "Inventory table…", { type: "inventory" }, { hint: sc("inventory"), keywords: "nodes hosts ip hostname properties grid spreadsheet" });
  cmd("Edit", "Find and replace…", { type: "findReplace" }, { hint: sc("findReplace"), keywords: "search text rename" });
  cmd("Help", "mydraw features and shortcuts…", { type: "help" }, { keywords: "help guide manual shortcuts keys docs what can it do" });
  add("Help", "Excalidraw keyboard shortcuts (drawing tools and editing)…", () => c.api?.updateScene({ appState: { openDialog: { name: "help" } } as never, captureUpdate: CaptureUpdateAction.NEVER }), {
    hint: "?",
    keywords: "help keys tools hotkeys excalidraw",
  });

  // ----- export -----
  cmd("Export", "Export…", { type: "export" }, { hint: sc("export") });
  for (const f of EXPORT_FORMATS) add("Export", `Export as ${FORMAT_LABEL[f]}…`, () => c.exportAs(f), { keywords: `save ${f}` });
  cmd("Export", "Copy as PNG", { type: "copyAs", format: "png" }, { keywords: "clipboard" });
  cmd("Export", "Copy as SVG", { type: "copyAs", format: "svg" }, { keywords: "clipboard" });
  cmd("Export", "Copy as Mermaid", { type: "copyAs", format: "mermaid" }, { keywords: "clipboard" });

  // ----- stencils panel -----
  cmd("Stencils", "Show / hide stencils panel", { type: "toggleStencils" }, { hint: sc("stencils") });
  cmd("Stencils", "Save selection as stencil…", { type: "saveStencil" });
  cmd("Stencils", "Quick save selection as stencil", { type: "quickSaveStencil" }, { hint: sc("quickSaveStencil") });

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
    add(
      "Edit",
      "Route arrows around shapes",
      () => {
        const { count: n, scope } = routeArrowsAround(api);
        const where = scope === "all" ? " (the whole drawing)" : " (the selection and arrows attached to it)";
        c.toast(n ? `Routed ${n} arrow${n === 1 ? "" : "s"} around shapes${where}` : scope === "all" ? "No arrows to route" : "No arrows in or attached to the selection", !n);
      },
      { keywords: "reroute avoid obstacles tidy connectors elbow detour" },
    );
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
