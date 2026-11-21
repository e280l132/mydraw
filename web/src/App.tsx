import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  getCommonBounds,
  getLibraryItemsHash,
  loadLibraryFromBlob,
  serializeLibraryAsJSON,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import type { LibraryIndex, LibraryItem } from "../../shared/library";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { safeFileName, titleFromPath } from "../../shared/names";
import type { DrawingStyle, MenuCommand, OpenedFile, Settings } from "../../shared/types";
import { AppMenu } from "./AppMenu";
import { drawingStyleAppState } from "./drawingStyle";
import { ExportDialog, loadExportOptions } from "./ExportDialog";
import { PacksDialog, RenameDialog, SaveStencilDialog } from "./library/dialogs";
import { CUSTOM_COLOR_KEY } from "./library/IconColorSection";
import { StyleSection } from "./StyleSection";
import { followZones, type Positions } from "./zoneFollow";
import { colorOfElement, elementAt } from "./library/pickColor";
import { normalizeHex } from "../../shared/colorMath";
import { IconRecolorSession, NO_ICONS, iconSelection, recolorSelectedIcons, type IconSelection } from "./library/iconColor";
import { STENCIL_DRAG_TYPE, StencilPanel } from "./library/StencilPanel";
import {
  insertStencil,
  loadStencil,
  selectionForStencil,
  type StencilContent,
} from "./library/stencilContent";
import { DEFAULT_EXPORT_OPTIONS, renderClipboard, renderExport, type ExportOptions } from "./exportImage";
import { apiSceneHash, parseDrawing, sceneHash, serializeScene, type LoadedScene } from "./scene";
import { TabBar, type TabInfo } from "./TabBar";
import { createAgentExecutor } from "./agent/executor";
import type { AgentReply } from "../../shared/agent";

const bridge = window.mydraw;

const AUTOSAVE_DELAY = 1500;
const RECOVERY_DELAY = 2000;
/** Baseline for tabs restored after a crash: never equal to a real hash, so they stay dirty until saved. */
const RECOVERED = "recovered";

interface Tab extends TabInfo {
  initialData: ExcalidrawInitialDataState;
  /** Created by an agent: never silently replaced by the next opened file (the agent holds its id). */
  keep?: boolean;
  /** Set when the file changed on disk while this tab had unsaved edits. */
  conflict: OpenedFile | null;
}

const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false as const,
    saveAsImage: false,
    toggleTheme: null,
  },
};

const newId = () => crypto.randomUUID().replace(/-/g, "");

let untitledCount = 0;
function nextUntitled(): string {
  untitledCount += 1;
  return untitledCount === 1 ? "Untitled" : `Untitled ${untitledCount}`;
}

/** Items of Excalidraw's own Library panel, shared by every tab and saved in the library folder. */
let sharedLibraryItems: LibraryItems = [];
let sharedLibraryHash = getLibraryItemsHash([]);

async function parseLibrary(content: string): Promise<LibraryItems> {
  if (!content.trim()) return [];
  return loadLibraryFromBlob(new Blob([content], { type: "application/json" }), "unpublished");
}

function initialDataFor(scene: LoadedScene | null, style: DrawingStyle): ExcalidrawInitialDataState {
  return {
    libraryItems: sharedLibraryItems,
    elements: scene?.elements ?? [],
    appState: { viewBackgroundColor: "#ffffff", ...scene?.appState, ...drawingStyleAppState(style) },
    files: scene?.files ?? {},
    scrollToContent: true,
  };
}

function useSystemTheme(): "light" | "dark" {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark ? "dark" : "light";
}

interface DrawingViewProps {
  tab: Tab;
  hidden: boolean;
  theme: "light" | "dark";
  settings: Settings | null;
  onApi(id: string, api: ExcalidrawImperativeAPI): void;
  onChange(id: string, elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): void;
  onCommand(cmd: MenuCommand): void;
  onSettings(patch: Partial<Settings>): void;
  onResolveConflict(id: string, reload: boolean): void;
  onLibraryChange(id: string, items: LibraryItems): void;
}

const DrawingView = memo(function DrawingView({
  tab,
  hidden,
  theme,
  settings,
  onApi,
  onChange,
  onCommand,
  onSettings,
  onResolveConflict,
  onLibraryChange,
}: DrawingViewProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    if (!hidden) apiRef.current?.refresh();
  }, [hidden]);

  return (
    <div className="md-drawing" data-md-tab={tab.id} style={{ display: hidden ? "none" : undefined }}>
      {tab.conflict && (
        <div className="md-banner">
          <span>“{tab.title}” changed on disk while you had unsaved edits.</span>
          <button onClick={() => onResolveConflict(tab.id, true)}>Reload from disk</button>
          <button onClick={() => onResolveConflict(tab.id, false)}>Keep my version</button>
        </div>
      )}
      <div className="md-canvas">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
            onApi(tab.id, api);
          }}
          initialData={tab.initialData}
          onChange={(elements, appState, files) => onChange(tab.id, elements, appState, files)}
          onLibraryChange={(items) => onLibraryChange(tab.id, items)}
          theme={theme}
          name={tab.title}
          UIOptions={UI_OPTIONS}
        >
          <AppMenu settings={settings} onCommand={onCommand} onSettings={onSettings} />
        </Excalidraw>
      </div>
    </div>
  );
});

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveIdState] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const systemTheme = useSystemTheme();
  const theme = !settings || settings.theme === "system" ? systemTheme : settings.theme;
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [libraryIndex, setLibraryIndex] = useState<LibraryIndex | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem("mydraw.panelOpen") !== "0");
  const [addLabels, setAddLabels] = useState(() => localStorage.getItem("mydraw.addLabels") !== "0");
  const [saveSelection, setSaveSelection] = useState<(StencilContent & { suggestedName: string }) | null>(null);
  const [renaming, setRenaming] = useState<LibraryItem | null>(null);
  const [packsOpen, setPacksOpen] = useState(false);
  const [icons, setIcons] = useState<IconSelection>(NO_ICONS);
  const [customColor, setCustomColorState] = useState<string | null>(() =>
    normalizeHex(localStorage.getItem(CUSTOM_COLOR_KEY) ?? ""),
  );
  const setCustomColor = useCallback((hex: string) => {
    localStorage.setItem(CUSTOM_COLOR_KEY, hex);
    setCustomColorState(hex);
  }, []);
  const [picking, setPicking] = useState(false);
  const iconsKey = useRef("");
  const selKey = useRef("");
  const zonePositions = useRef(new Map<string, Positions>());
  const [selTick, setSelTick] = useState(0);

  // Refs hold the latest values for callbacks fired by Excalidraw, IPC and timers.
  const tabsRef = useRef<Tab[]>([]);
  const activeRef = useRef("");
  const settingsRef = useRef<Settings | null>(null);
  const apis = useRef(new Map<string, ExcalidrawImperativeAPI>());
  const baselines = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, { autosave?: number; recovery?: number }>());
  const saveChains = useRef(new Map<string, Promise<boolean>>());
  const started = useRef(false);
  const libraryRef = useRef<LibraryIndex | null>(null);
  const addLabelsRef = useRef(addLabels);
  addLabelsRef.current = addLabels;
  const librarySaveTimer = useRef<number | undefined>(undefined);

  const commitTabs = useCallback((update: (prev: Tab[]) => Tab[]) => {
    tabsRef.current = update(tabsRef.current);
    setTabs(tabsRef.current);
  }, []);
  const patchTab = useCallback(
    (id: string, patch: Partial<Tab>) => commitTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t))),
    [commitTabs],
  );
  const getTab = (id: string) => tabsRef.current.find((t) => t.id === id);
  const setActive = useCallback((id: string) => {
    activeRef.current = id;
    setActiveIdState(id);
    iconsKey.current = "";
    setIcons(NO_ICONS);
  }, []);

  const showToast = useCallback((text: string, error = false) => setToast({ text, error }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.error ? 8000 : 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const clearTimers = (id: string) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t.autosave);
      window.clearTimeout(t.recovery);
    }
    timers.current.delete(id);
  };

  // ---------- saving ----------

  /** Per-file setting: also write a PNG/SVG next to the saved drawing. Never fails the save. */
  const autoExport = useCallback(
    async (api: ExcalidrawImperativeAPI, filePath: string, now?: "png" | "svg") => {
      const format = now ?? settingsRef.current?.autoExport[filePath];
      if (!format || !api.getSceneElements().length) return;
      try {
        const out = await renderExport(api, { ...loadExportOptions(), format, scope: "all" });
        await bridge.autoExportFile({ path: filePath, extension: format, data: out.data });
      } catch (e) {
        showToast(`Auto-export failed: ${(e as Error).message}`, true);
      }
    },
    [showToast],
  );

  const doSave = useCallback(
    async (id: string, saveAs: boolean): Promise<boolean> => {
      const tab = getTab(id);
      const api = apis.current.get(id);
      if (!tab || !api) return false;
      const t = timers.current.get(id);
      if (t) window.clearTimeout(t.autosave);

      const content = serializeScene(api);
      const hash = apiSceneHash(api);
      let filePath = tab.filePath;
      try {
        if (!filePath || saveAs) {
          const chosen = await bridge.saveFileAs(safeFileName(tab.title), content);
          if (!chosen) return false;
          if (tab.filePath && tab.filePath !== chosen) void bridge.unwatchFile(tab.filePath);
          filePath = chosen;
        } else {
          await bridge.saveFile(filePath, content);
        }
      } catch (e) {
        showToast(`Save failed: ${(e as Error).message}`, true);
        return false;
      }
      baselines.current.set(id, hash);
      // Edits made while the save was in flight keep the tab dirty.
      const unchanged = apiSceneHash(api) === hash;
      patchTab(id, { filePath, title: titleFromPath(filePath), dirty: !unchanged, conflict: null });
      if (unchanged) void bridge.deleteRecovery(id);
      void bridge.watchFile(filePath);
      void autoExport(api, filePath);
      return true;
    },
    [autoExport, patchTab, showToast],
  );

  /** Saves for one tab run one after another, never in parallel. */
  const save = useCallback(
    (id: string, saveAs = false): Promise<boolean> => {
      const prev = saveChains.current.get(id) ?? Promise.resolve(true);
      const next = prev.then(() => doSave(id, saveAs));
      saveChains.current.set(id, next);
      return next;
    },
    [doSave],
  );

  const writeRecoveryNow = useCallback((id: string) => {
    const tab = getTab(id);
    const api = apis.current.get(id);
    if (!tab || !api || !tab.dirty) return;
    void bridge.writeRecovery({
      tabId: id,
      filePath: tab.filePath,
      title: tab.title,
      content: serializeScene(api),
      savedAt: Date.now(),
    });
  }, []);

  const scheduleBackground = useCallback(
    (id: string) => {
      const tab = getTab(id);
      if (!tab) return;
      const t = timers.current.get(id) ?? {};
      window.clearTimeout(t.recovery);
      t.recovery = window.setTimeout(() => writeRecoveryNow(id), RECOVERY_DELAY);
      window.clearTimeout(t.autosave);
      if (settingsRef.current?.autosave && tab.filePath && !tab.conflict) {
        t.autosave = window.setTimeout(() => void save(id), AUTOSAVE_DELAY);
      }
      timers.current.set(id, t);
    },
    [save, writeRecoveryNow],
  );

  // ---------- Excalidraw callbacks ----------

  const onApi = useCallback((id: string, api: ExcalidrawImperativeAPI) => {
    apis.current.set(id, api);
  }, []);

  const onChange = useCallback(
    (id: string, elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (appState.isLoading) return;
      const zoneApi = apis.current.get(id);
      if (zoneApi) zonePositions.current.set(id, followZones(zoneApi, zonePositions.current.get(id), elements, appState));
      if (id === activeRef.current) {
        const sel = appState.viewModeEnabled ? NO_ICONS : iconSelection(elements, appState, files);
        const sk = Object.keys(appState.selectedElementIds).sort().join(",");
        if (sk !== selKey.current) {
          selKey.current = sk;
          setSelTick((n) => n + 1);
        }
        const key = `${sel.count}:${sel.raster}:${sel.color}`;
        if (key !== iconsKey.current) {
          iconsKey.current = key;
          setIcons(sel);
        }
      }
      const hash = sceneHash(elements, appState);
      const base = baselines.current.get(id);
      if (base === undefined) {
        // First change event after the scene loaded: this is the saved state.
        baselines.current.set(id, hash);
        return;
      }
      const dirty = hash !== base;
      const tab = getTab(id);
      if (!tab) return;
      if (tab.dirty !== dirty) patchTab(id, { dirty });
      if (dirty) scheduleBackground(id);
    },
    [patchTab, scheduleBackground],
  );

  // ---------- Excalidraw Library panel (shared by all tabs, saved in the library folder) ----------

  const applySharedLibrary = useCallback((items: LibraryItems, exceptTab?: string) => {
    sharedLibraryItems = items;
    sharedLibraryHash = getLibraryItemsHash(items);
    for (const [id, api] of apis.current) {
      if (id !== exceptTab) void api.updateLibrary({ libraryItems: items, merge: false });
    }
  }, []);

  const onLibraryChange = useCallback(
    (id: string, items: LibraryItems) => {
      if (getLibraryItemsHash(items) === sharedLibraryHash) return; // echo of a sync, or no change
      applySharedLibrary(items, id);
      window.clearTimeout(librarySaveTimer.current);
      librarySaveTimer.current = window.setTimeout(() => {
        bridge.excalidrawLibrarySave(serializeLibraryAsJSON(sharedLibraryItems)).catch((e: Error) =>
          showToast(`Could not save the library: ${e.message}`, true),
        );
      }, 400);
    },
    [applySharedLibrary, showToast],
  );

  // ---------- stencils ----------

  const labelOptions = () => {
    const st = apis.current.get(activeRef.current)?.getAppState();
    return {
      label: addLabelsRef.current,
      fontFamily: (st?.currentItemFontFamily as number | undefined) ?? 6,
      strokeColor: st?.currentItemStrokeColor ?? "#1e1e1e",
    };
  };

  /** Where the last click-insert went, so repeated clicks lay stencils out in a row. */
  const lastPlacement = useRef<{
    tab: string;
    view: string;
    right: number;
    y: number;
    rowLeft: number;
    rowBottom: number;
  } | null>(null);

  /** Insert a stencil into the active drawing, at scene point `at` or the middle of the view. */
  const insertItem = useCallback(
    async (item: LibraryItem, at?: { x: number; y: number }) => {
      const api = apis.current.get(activeRef.current);
      if (!api) return;
      try {
        const content = await loadStencil(item, labelOptions());
        const st = api.getAppState();
        const view = `${st.scrollX}:${st.scrollY}:${st.zoom.value}`;
        let target = at;
        const last = lastPlacement.current;
        let newRow = false;
        if (!target && last && last.tab === activeRef.current && last.view === view) {
          const [minX, minY, maxX, maxY] = getCommonBounds(content.elements);
          const w = maxX - minX;
          const visibleRight = st.width / st.zoom.value - st.scrollX - 40;
          if (last.right + 40 + w > visibleRight) {
            // Wrap to a new row under the previous one.
            newRow = true;
            target = { x: last.rowLeft + w / 2, y: last.rowBottom + 50 + (maxY - minY) / 2 };
          } else {
            target = { x: last.right + 40 + w / 2, y: last.y };
          }
        }
        const placed = insertStencil(api, content, target);
        if (placed.length) {
          const [minX, minY, maxX, maxY] = getCommonBounds(placed);
          const continuing = last && !newRow && target && !at;
          lastPlacement.current = at
            ? null
            : {
                tab: activeRef.current,
                view,
                right: maxX,
                y: (minY + maxY) / 2,
                rowLeft: continuing ? last.rowLeft : minX,
                rowBottom: continuing ? Math.max(last.rowBottom, maxY) : maxY,
              };
        }
        void bridge.libraryMarkUsed(item.id);
      } catch (e) {
        showToast(`Could not insert “${item.name}”: ${(e as Error).message}`, true);
      }
    },
    [showToast],
  );

  const recolorSession = useRef<IconRecolorSession | null>(null);
  const recolorIcons = useCallback(
    (color: string | null, preview = false) => {
      recolorSession.current ??= new IconRecolorSession(
        () => apis.current.get(activeRef.current),
        (e) => showToast(`Could not recolor: ${e.message}`, true),
      );
      recolorSession.current.apply(color, preview);
    },
    [showToast],
  );

  // Eyedropper: the next click on the canvas copies that element's color into the custom swatch.
  // The click is swallowed so Excalidraw doesn't change the selection.
  useEffect(() => {
    const root = contentRef.current;
    if (!picking || !root) return;
    const isCanvas = (t: EventTarget | null) => t instanceof HTMLCanvasElement;
    const onPointerDown = (e: PointerEvent) => {
      if (!isCanvas(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      setPicking(false);
      const api = apis.current.get(activeRef.current);
      if (!api) return;
      const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const el = elementAt(api, x, y);
      if (!el) return showToast("Nothing there. Click an icon or shape to copy its color.", true);
      colorOfElement(api, el).then(
        (hex) => {
          if (!hex) return showToast("That item has no color to copy (it's white or transparent).", true);
          setCustomColor(hex);
          showToast(`Copied ${hex} to the custom swatch. Click it to apply.`);
        },
        (err: Error) => showToast(`Could not read the color: ${err.message}`, true),
      );
    };
    const swallow = (e: Event) => {
      if (isCanvas(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPicking(false);
      }
    };
    root.classList.add("md-picking");
    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("pointerup", swallow, true);
    root.addEventListener("click", swallow, true);
    root.addEventListener("dblclick", swallow, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      root.classList.remove("md-picking");
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("pointerup", swallow, true);
      root.removeEventListener("click", swallow, true);
      root.removeEventListener("dblclick", swallow, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [picking, setCustomColor, showToast]);

  // The "Colors & styles" section lives inside Excalidraw's properties panel (left side). Excalidraw
  // has no API for adding panel sections, so we keep a host <div> at the top of its panel column and
  // render into it with a portal; a MutationObserver re-attaches it when Excalidraw re-renders.
  const [styleHost, setStyleHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const attach = () => {
      const column = root.querySelector<HTMLElement>(".md-drawing:not([style*='none']) .App-menu__left .panelColumn");
      if (!column) return setStyleHost(null);
      let host = column.querySelector<HTMLElement>(":scope > .md-style-host");
      if (!host) {
        root.querySelectorAll(".md-style-host").forEach((n) => n.remove());
        host = document.createElement("div");
        host.className = "md-style-host";
      }
      if (column.firstElementChild !== host) column.prepend(host);
      // Our Colors tab replaces Excalidraw's Stroke and Background rows (same job, bigger palettes).
      column.querySelectorAll<HTMLElement>(".color-picker__top-picks").forEach((picks) => {
        let section: HTMLElement | null = picks;
        while (section && section.parentElement !== column) section = section.parentElement;
        if (section && !section.classList.contains("md-style-host")) section.classList.add("md-native-color");
      });
      setStyleHost((prev) => (prev === host ? prev : host));
    };
    attach();
    const mo = new MutationObserver(attach);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [activeId]);

  const openSaveStencil = useCallback(() => {
    const api = apis.current.get(activeRef.current);
    if (!api) return;
    const sel = selectionForStencil(api);
    if (!sel.elements.length) {
      showToast("Select the shapes you want to save as a stencil first.", true);
      return;
    }
    setSaveSelection(sel);
  }, [showToast]);

  const togglePanel = useCallback(() => {
    setPanelOpen((v) => {
      localStorage.setItem("mydraw.panelOpen", v ? "0" : "1");
      return !v;
    });
  }, []);

  // Dropping a stencil from the panel onto the canvas (handled before Excalidraw sees the drop).
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const isStencil = (e: DragEvent) => e.dataTransfer?.types.includes(STENCIL_DRAG_TYPE);
    const onDragOver = (e: DragEvent) => {
      if (!isStencil(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!isStencil(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer!.getData(STENCIL_DRAG_TYPE);
      const item = libraryRef.current?.items.find((i) => i.id === id);
      const api = apis.current.get(activeRef.current);
      if (!item || !api) return;
      const at = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      void insertItem(item, at);
    };
    el.addEventListener("dragover", onDragOver, true);
    el.addEventListener("drop", onDrop, true);
    return () => {
      el.removeEventListener("dragover", onDragOver, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, [insertItem]);

  // ---------- tabs ----------

  const addTab = useCallback(
    (tab: Tab) => {
      const active = getTab(activeRef.current);
      const activeApi = apis.current.get(activeRef.current);
      // Replace an untouched empty "Untitled" tab instead of piling up blank tabs.
      const replace =
        active && !active.keep && !active.filePath && !active.dirty && activeApi && activeApi.getSceneElements().length === 0;
      if (replace) {
        apis.current.delete(active.id);
        baselines.current.delete(active.id);
        clearTimers(active.id);
      }
      commitTabs((ts) => {
        const rest = replace ? ts.filter((t) => t.id !== active.id) : ts;
        const idx = replace ? ts.findIndex((t) => t.id === active.id) : rest.length;
        return [...rest.slice(0, idx), tab, ...rest.slice(idx)];
      });
      setActive(tab.id);
    },
    [commitTabs, setActive],
  );

  const newTab = useCallback((title?: string, keep = false): string => {
    const style = settingsRef.current?.drawingStyle ?? "clean";
    const tab: Tab = {
      id: newId(),
      title: title ?? nextUntitled(),
      keep,
      filePath: null,
      dirty: false,
      conflict: null,
      initialData: initialDataFor(null, style),
    };
    commitTabs((ts) => [...ts, tab]);
    setActive(tab.id);
    return tab.id;
  }, [commitTabs, setActive]);

  const openFiles = useCallback(
    async (files: OpenedFile[]) => {
      const style = settingsRef.current?.drawingStyle ?? "clean";
      for (const f of files) {
        const existing = tabsRef.current.find((t) => t.filePath === f.path);
        if (existing) {
          setActive(existing.id);
          continue;
        }
        let scene: LoadedScene;
        try {
          scene = await parseDrawing(f.content);
        } catch (e) {
          showToast(`Could not open ${f.path}: ${(e as Error).message}`, true);
          continue;
        }
        addTab({
          id: newId(),
          title: titleFromPath(f.path),
          filePath: f.path,
          dirty: false,
          conflict: null,
          initialData: initialDataFor(scene, style),
        });
        void bridge.watchFile(f.path);
      }
    },
    [addTab, setActive, showToast],
  );

  const removeTab = useCallback(
    (id: string) => {
      const tab = getTab(id);
      if (!tab) return;
      clearTimers(id);
      apis.current.delete(id);
      baselines.current.delete(id);
      saveChains.current.delete(id);
      void bridge.deleteRecovery(id);
      if (tab.filePath) void bridge.unwatchFile(tab.filePath);
      const idx = tabsRef.current.findIndex((t) => t.id === id);
      commitTabs((ts) => ts.filter((t) => t.id !== id));
      if (!tabsRef.current.length) {
        newTab();
      } else if (activeRef.current === id) {
        setActive(tabsRef.current[Math.min(idx, tabsRef.current.length - 1)].id);
      }
    },
    [commitTabs, newTab, setActive],
  );

  /** Tabs whose unsaved edits would be lost (autosave covers file-backed tabs without conflicts). */
  const needsPrompt = (t: Tab) => t.dirty && !(t.filePath && settingsRef.current?.autosave && !t.conflict);

  const closeTab = useCallback(
    async (id: string) => {
      const tab = getTab(id);
      if (!tab) return;
      if (needsPrompt(tab)) {
        setActive(id);
        const choice = await bridge.askUnsaved([tab.title]);
        if (choice === "cancel") return;
        if (choice === "save" && !(await save(id))) return;
      } else if (tab.dirty && !(await save(id))) {
        return;
      }
      removeTab(id);
    },
    [removeTab, save, setActive],
  );

  const reloadFromContent = useCallback(
    async (id: string, content: string) => {
      const api = apis.current.get(id);
      if (!api) return;
      let scene: LoadedScene;
      try {
        scene = await parseDrawing(content);
      } catch (e) {
        showToast(`Could not reload: ${(e as Error).message}`, true);
        return;
      }
      api.addFiles(Object.values(scene.files));
      api.updateScene({
        elements: scene.elements,
        appState: scene.appState as AppState,
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      api.history.clear();
      baselines.current.set(id, apiSceneHash(api));
      patchTab(id, { dirty: false, conflict: null });
      void bridge.deleteRecovery(id);
    },
    [patchTab, showToast],
  );

  const onResolveConflict = useCallback(
    (id: string, reload: boolean) => {
      const tab = getTab(id);
      if (!tab?.conflict) return;
      if (reload) void reloadFromContent(id, tab.conflict.content);
      else {
        patchTab(id, { conflict: null });
        scheduleBackground(id);
      }
    },
    [patchTab, reloadFromContent, scheduleBackground],
  );

  // ---------- commands ----------

  const onCommand = useCallback(
    async (cmd: MenuCommand) => {
      const ts = tabsRef.current;
      const idx = ts.findIndex((t) => t.id === activeRef.current);
      switch (cmd.type) {
        case "new":
          return void newTab();
        case "open":
          return openFiles(await bridge.openDialog());
        case "save":
          return void (await save(activeRef.current));
        case "saveAs":
          return void (await save(activeRef.current, true));
        case "export":
          if (apis.current.get(activeRef.current)) setExportOpen(true);
          return;
        case "copyAs": {
          const api = apis.current.get(activeRef.current);
          if (!api) return;
          try {
            await bridge.copyToClipboard(await renderClipboard(api, cmd.format, loadExportOptions()));
            showToast(`Copied as ${cmd.format === "mermaid" ? "Mermaid" : cmd.format.toUpperCase()}`);
          } catch (e) {
            showToast(`Copy failed: ${(e as Error).message}`, true);
          }
          return;
        }
        case "closeTab":
          return closeTab(activeRef.current);
        case "nextTab":
          if (ts.length) setActive(ts[(idx + 1) % ts.length].id);
          return;
        case "prevTab":
          if (ts.length) setActive(ts[(idx - 1 + ts.length) % ts.length].id);
          return;
        case "selectTab":
          if (ts[cmd.index]) setActive(ts[cmd.index].id);
          return;
        case "openRecent":
          return openFiles(await bridge.openRecent(cmd.path));
        case "clearRecent":
          return bridge.clearRecent();
        case "toggleStencils":
          return togglePanel();
        case "saveStencil":
          return openSaveStencil();
      }
    },
    [closeTab, newTab, openFiles, openSaveStencil, save, setActive, showToast, togglePanel],
  );

  // Main process saves settings and broadcasts them back (settings:changed), which updates state.
  const onSettings = useCallback((patch: Partial<Settings>) => void bridge.updateSettings(patch), []);

  const onCommandSync = useCallback((cmd: MenuCommand) => void onCommand(cmd), [onCommand]);

  const closing = useRef(false);
  const beforeClose = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await runCloseFlowRef.current();
    } finally {
      closing.current = false;
    }
  }, []);

  const runCloseFlow = async () => {
    // Flush autosave for file-backed tabs first.
    for (const t of tabsRef.current) {
      if (t.dirty && !needsPrompt(t)) await save(t.id);
    }
    const unsaved = tabsRef.current.filter((t) => t.dirty);
    if (unsaved.length) {
      const choice = await bridge.askUnsaved(unsaved.map((t) => t.title));
      if (choice === "cancel") return;
      if (choice === "save") {
        for (const t of unsaved) {
          setActive(t.id);
          if (!(await save(t.id))) return;
        }
      }
    }
    for (const t of tabsRef.current) {
      clearTimers(t.id);
      await bridge.deleteRecovery(t.id);
    }
    bridge.readyToClose();
  };
  const runCloseFlowRef = useRef(runCloseFlow);
  runCloseFlowRef.current = runCloseFlow;

  // ---------- startup + IPC subscriptions ----------

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const settings = await bridge.getSettings();
      settingsRef.current = settings;
      setSettings(settings);

      // Library first, so every tab starts with the shared Excalidraw Library items.
      try {
        const [index, xlib] = await Promise.all([bridge.libraryIndex(), bridge.excalidrawLibraryGet()]);
        libraryRef.current = index;
        setLibraryIndex(index);
        sharedLibraryItems = await parseLibrary(xlib);
        sharedLibraryHash = getLibraryItemsHash(sharedLibraryItems);
      } catch (e) {
        showToast(`Could not load the stencil library: ${(e as Error).message}`, true);
      }

      const recovered = await bridge.listRecovery();
      for (const r of recovered) {
        try {
          const scene = await parseDrawing(r.content);
          const id = newId();
          baselines.current.set(id, RECOVERED);
          commitTabs((ts) => [
            ...ts,
            {
              id,
              title: r.title,
              filePath: r.filePath,
              dirty: true,
              conflict: null,
              initialData: initialDataFor(scene, settings.drawingStyle),
            },
          ]);
          await bridge.writeRecovery({ ...r, tabId: id });
          if (r.filePath) void bridge.watchFile(r.filePath);
        } catch {
          // unreadable recovery entry: drop it
        }
        await bridge.deleteRecovery(r.tabId);
      }
      if (tabsRef.current.length) {
        setActive(tabsRef.current[0].id);
        showToast(`Recovered ${tabsRef.current.length} unsaved drawing(s) from last session.`);
      }

      await openFiles(await bridge.takePendingFiles());
      if (!tabsRef.current.length) newTab();
    })();
  }, [commitTabs, newTab, openFiles, setActive, showToast]);

  useEffect(() => {
    const offs = [
      bridge.onMenu((cmd) => void onCommand(cmd)),
      bridge.onOpenFiles((files) => void openFiles(files)),
      bridge.onBeforeClose(() => void beforeClose()),
      bridge.onFileChangedOnDisk((file) => {
        const tab = tabsRef.current.find((t) => t.filePath === file.path);
        if (!tab) return;
        if (tab.dirty) patchTab(tab.id, { conflict: file });
        else void reloadFromContent(tab.id, file.content);
      }),
      bridge.onLibraryChanged((index) => {
        libraryRef.current = index;
        setLibraryIndex(index);
      }),
      bridge.onExcalidrawLibraryChanged((content) => {
        parseLibrary(content).then(
          (items) => getLibraryItemsHash(items) !== sharedLibraryHash && applySharedLibrary(items),
          () => showToast("The Excalidraw library file changed on disk but could not be read.", true),
        );
      }),
      bridge.onSettingsChanged((s) => {
        const prev = settingsRef.current;
        settingsRef.current = s;
        setSettings(s);
        if (prev?.drawingStyle !== s.drawingStyle) {
          for (const api of apis.current.values()) {
            api.updateScene({
              appState: drawingStyleAppState(s.drawingStyle) as AppState,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
        if (s.autosave && !prev?.autosave) {
          for (const t of tabsRef.current) if (t.dirty) scheduleBackground(t.id);
        }
      }),
    ];
    // Excalidraw's own ⇧⌘E opens its export dialog; route it to ours.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (apis.current.get(activeRef.current)) setExportOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("keydown", onKey, true);
    };
  }, [applySharedLibrary, beforeClose, onCommand, openFiles, patchTab, reloadFromContent, scheduleBackground, showToast]);

  const active = tabs.find((t) => t.id === activeId);
  useEffect(() => {
    if (active) bridge.setWindowState({ title: `${active.title} — mydraw`, edited: active.dirty });
  }, [active?.title, active?.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- agent control (MCP): commands forwarded by the main process ----------

  useEffect(() => {
    const run = createAgentExecutor(
      {
        tabs: () => tabsRef.current.map(({ id, title, filePath, dirty }) => ({ id, title, filePath, dirty })),
        activeId: () => activeRef.current,
        api: (id) => apis.current.get(id),
        activate: (id) => setActive(id),
        newDrawing: (title) => newTab(title, true),
        openFiles: (files) => openFiles(files),
        save: async (id, path) => {
          const tab = getTab(id);
          if (!tab) throw new Error("drawing is closed");
          if (!path || path === tab.filePath) {
            if (!tab.filePath) throw new Error("this drawing has never been saved: pass a path");
            if (!(await save(id))) throw new Error("save failed");
            return tab.filePath;
          }
          // Save under the new path; if that fails, the tab keeps its old file (and watcher).
          const prev = { filePath: tab.filePath, title: tab.title };
          patchTab(id, { filePath: path, title: titleFromPath(path) });
          if (!(await save(id))) {
            if (getTab(id)) patchTab(id, prev);
            throw new Error(`could not save to ${path}`);
          }
          if (prev.filePath && prev.filePath !== path) void bridge.unwatchFile(prev.filePath);
          return path;
        },
        markStencilUsed: (id) => void bridge.libraryMarkUsed(id),
      },
      (r) => bridge.agentReply(r as AgentReply),
    );
    return bridge.onAgentCommand(run);
  }, [newTab, openFiles, patchTab, save, setActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- test hook (only when launched by the smoke test) ----------

  useEffect(() => {
    if (!bridge.isTest) return;
    const api = () => apis.current.get(activeRef.current)!;
    window.__mydrawTest = {
      state: () => ({
        activeId: activeRef.current,
        tabs: tabsRef.current.map(({ id, title, filePath, dirty, conflict }) => ({
          id,
          title,
          filePath,
          dirty,
          conflict: !!conflict,
        })),
      }),
      elementCount: () => api()?.getSceneElements().length ?? -1,
      currentItemRoughness: () => api()?.getAppState().currentItemRoughness,
      addSample: (label = "Router") => {
        const els = convertToExcalidrawElements([
          { type: "rectangle", x: 100 + Math.random() * 300, y: 100, width: 160, height: 80, label: { text: label } },
        ]);
        api().updateScene({
          elements: [...api().getSceneElementsIncludingDeleted(), ...els],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
      },
      saveAs: async (path: string) => {
        await bridge.writeFileForTest(path, "");
        patchTab(activeRef.current, { filePath: path });
        return save(activeRef.current);
      },
      exportTo: async (path: string, opts: Partial<ExportOptions>) => {
        const out = await renderExport(api(), { ...DEFAULT_EXPORT_OPTIONS, ...opts });
        await bridge.writeFileForTest(path, out.data);
      },
      newTab: () => newTab(),
      tabApiReady: (id: string) => !!apis.current.get(id),
      openExportDialog: () => setExportOpen(true),
      command: (cmd: MenuCommand) => onCommand(cmd),
      library: () => libraryRef.current,
      insertStencil: (id: string) => {
        const item = libraryRef.current?.items.find((i) => i.id === id);
        if (!item) throw new Error(`no stencil ${id}`);
        return insertItem(item);
      },
      selectedCount: () => {
        const sel = api().getAppState().selectedElementIds;
        return api().getSceneElements().filter((e) => sel[e.id]).length;
      },
      saveSelectionAsStencil: (name: string, collection: string) => {
        const sel = selectionForStencil(api());
        return bridge.librarySaveStencil({
          collection,
          name,
          tags: ["test"],
          elements: sel.elements,
          files: Object.fromEntries(sel.files.map((f) => [f.id, f])),
        });
      },
      imageFileCount: () => Object.keys(api().getFiles()).length,
      iconSelection: () => iconsKey.current,
      /** Screen position of the centre of the n-th element of a type (for clicking it in tests). */
      screenCenter: (type: string, n = 0, leftEdge = false) => {
        const a = api();
        const all = a.getSceneElements().filter((e) => e.type === type);
        const el = all[n < 0 ? all.length + n : n];
        if (!el) return null;
        const [x1, y1, x2, y2] = getCommonBounds([el]);
        const st = a.getAppState();
        return {
          x: ((leftEdge ? x1 + 1 : (x1 + x2) / 2) + st.scrollX) * st.zoom.value + st.offsetLeft,
          y: ((y1 + y2) / 2 + st.scrollY) * st.zoom.value + st.offsetTop,
        };
      },
      /** Screen position of a scene point (for dragging things in tests). */
      toScreen: (x: number, y: number) => {
        const st = api().getAppState();
        return { x: (x + st.scrollX) * st.zoom.value + st.offsetLeft, y: (y + st.scrollY) * st.zoom.value + st.offsetTop };
      },
      recolor: (color: string | null, preview = false) => recolorSelectedIcons(api(), color, preview),
      selectImages: () =>
        api().updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              api()
                .getSceneElements()
                .filter((e) => e.type === "image")
                .map((e) => [e.id, true]),
            ),
          } as Partial<AppState> as AppState,
        }),
      selectType: (type: string) =>
        api().updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(
              api()
                .getSceneElements()
                .filter((e) => e.type === type)
                .map((e) => [e.id, true]),
            ),
          } as Partial<AppState> as AppState,
        }),
      elementProps: (type: string) =>
        api()
          .getSceneElements()
          .filter((e) => e.type === type)
          .map((e) => ({ id: e.id, strokeColor: e.strokeColor, backgroundColor: e.backgroundColor, roughness: e.roughness, strokeStyle: e.strokeStyle })),
      viewBackground: () => api().getAppState().viewBackgroundColor,
      imageColors: () =>
        api()
          .getSceneElements()
          .filter((e) => e.type === "image")
          .map((e) => e.customData?.mydrawIconColor ?? "original"),
      excalidrawLibraryCount: async () => (await api().updateLibrary({ libraryItems: [], merge: true })).length,
      addToExcalidrawLibrary: async () => {
        const els = api().getSceneElements();
        await api().updateLibrary({
          libraryItems: [{ id: newId(), status: "unpublished", created: Date.now(), elements: els, name: "Test item" }],
          merge: true,
        });
      },
    };
  }, [insertItem, newTab, patchTab, save]);

  const activeApi = apis.current.get(activeId);
  return (
    <div className={`md-app theme-${theme}`}>
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActive}
        onClose={(id) => void closeTab(id)}
        onNew={() => void newTab()}
        panelOpen={panelOpen}
        onTogglePanel={togglePanel}
      />
      <div className="md-main">
      <div className="md-content" ref={contentRef}>
        {tabs.map((t) => (
          <DrawingView
            key={t.id}
            tab={t}
            hidden={t.id !== activeId}
            theme={theme}
            settings={settings}
            onApi={onApi}
            onChange={onChange}
            onCommand={onCommandSync}
            onSettings={onSettings}
            onResolveConflict={onResolveConflict}
            onLibraryChange={onLibraryChange}
          />
        ))}
        {styleHost && createPortal(<StyleSection api={apis.current.get(activeId)} tick={selTick} onToast={showToast} custom={customColor} onCustomChange={setCustomColor} onPick={() => setPicking((v) => !v)} picking={picking} icons={icons} onIconColor={recolorIcons} />, styleHost)}
      </div>
      {panelOpen && (
        <StencilPanel
          index={libraryIndex}
          addLabels={addLabels}
          onAddLabelsChange={(v) => {
            localStorage.setItem("mydraw.addLabels", v ? "1" : "0");
            setAddLabels(v);
          }}
          onInsert={(item) => void insertItem(item)}
          onSaveSelection={openSaveStencil}
          onOpenPacks={() => setPacksOpen(true)}
          onRename={setRenaming}
          onToast={showToast}
          onClose={togglePanel}
        />
      )}
      </div>
      {exportOpen && activeApi && active && (
        <ExportDialog
          api={activeApi}
          title={safeFileName(active.title)}
          filePath={active.filePath}
          autoExport={(active.filePath && settings?.autoExport[active.filePath]) || null}
          onAutoExport={(format) => {
            const path = active.filePath;
            if (!path) return;
            const next = { ...(settingsRef.current?.autoExport ?? {}) };
            if (format) next[path] = format;
            else delete next[path];
            onSettings({ autoExport: next });
            if (format) void autoExport(activeApi, path, format); // write the image right away
          }}
          onClose={() => setExportOpen(false)}
          onDone={(msg) => showToast(msg)}
        />
      )}
      {saveSelection && (
        <SaveStencilDialog
          index={libraryIndex}
          selection={saveSelection}
          onClose={() => setSaveSelection(null)}
          onSaved={(m) => showToast(m)}
        />
      )}
      {renaming && <RenameDialog item={renaming} onClose={() => setRenaming(null)} onDone={showToast} />}
      {packsOpen && <PacksDialog onClose={() => setPacksOpen(false)} onDone={showToast} />}
      {toast && <div className={`md-toast${toast.error ? " error" : ""}`}>{toast.text}</div>}
    </div>
  );
}
