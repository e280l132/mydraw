import { CaptureUpdateAction, Excalidraw, MainMenu, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { safeFileName, titleFromPath } from "../../shared/names";
import type { DrawingStyle, MenuCommand, OpenedFile, Settings } from "../../shared/types";
import { drawingStyleAppState } from "./drawingStyle";
import { ExportDialog } from "./ExportDialog";
import { DEFAULT_EXPORT_OPTIONS, renderExport, type ExportOptions } from "./exportImage";
import { apiSceneHash, parseDrawing, sceneHash, serializeScene, type LoadedScene } from "./scene";
import { TabBar, type TabInfo } from "./TabBar";

const bridge = window.mydraw;

const AUTOSAVE_DELAY = 1500;
const RECOVERY_DELAY = 2000;
/** Baseline for tabs restored after a crash: never equal to a real hash, so they stay dirty until saved. */
const RECOVERED = "recovered";

interface Tab extends TabInfo {
  initialData: ExcalidrawInitialDataState;
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

function initialDataFor(scene: LoadedScene | null, style: DrawingStyle): ExcalidrawInitialDataState {
  return {
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
  onApi(id: string, api: ExcalidrawImperativeAPI): void;
  onChange(id: string, elements: readonly ExcalidrawElement[], appState: AppState): void;
  onCommand(cmd: MenuCommand): void;
  onResolveConflict(id: string, reload: boolean): void;
}

const DrawingView = memo(function DrawingView({
  tab,
  hidden,
  theme,
  onApi,
  onChange,
  onCommand,
  onResolveConflict,
}: DrawingViewProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    if (!hidden) apiRef.current?.refresh();
  }, [hidden]);

  return (
    <div className="md-drawing" style={{ display: hidden ? "none" : undefined }}>
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
          onChange={(elements, appState) => onChange(tab.id, elements, appState)}
          theme={theme}
          name={tab.title}
          UIOptions={UI_OPTIONS}
        >
          <MainMenu>
            <MainMenu.Item onSelect={() => onCommand({ type: "new" })} shortcut="⌘N">
              New drawing
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => onCommand({ type: "open" })} shortcut="⌘O">
              Open…
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => onCommand({ type: "save" })} shortcut="⌘S">
              Save
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => onCommand({ type: "saveAs" })} shortcut="⇧⌘S">
              Save as…
            </MainMenu.Item>
            <MainMenu.Item onSelect={() => onCommand({ type: "export" })} shortcut="⇧⌘E">
              Export image…
            </MainMenu.Item>
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </div>
    </div>
  );
});

export function App() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveIdState] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const theme = useSystemTheme();

  // Refs hold the latest values for callbacks fired by Excalidraw, IPC and timers.
  const tabsRef = useRef<Tab[]>([]);
  const activeRef = useRef("");
  const settingsRef = useRef<Settings | null>(null);
  const apis = useRef(new Map<string, ExcalidrawImperativeAPI>());
  const baselines = useRef(new Map<string, string>());
  const timers = useRef(new Map<string, { autosave?: number; recovery?: number }>());
  const saveChains = useRef(new Map<string, Promise<boolean>>());
  const started = useRef(false);

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
      return true;
    },
    [patchTab, showToast],
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
    (id: string, elements: readonly ExcalidrawElement[], appState: AppState) => {
      if (appState.isLoading) return;
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

  // ---------- tabs ----------

  const addTab = useCallback(
    (tab: Tab) => {
      const active = getTab(activeRef.current);
      const activeApi = apis.current.get(activeRef.current);
      // Replace an untouched empty "Untitled" tab instead of piling up blank tabs.
      const replace =
        active && !active.filePath && !active.dirty && activeApi && activeApi.getSceneElements().length === 0;
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

  const newTab = useCallback(() => {
    const style = settingsRef.current?.drawingStyle ?? "clean";
    const tab: Tab = {
      id: newId(),
      title: nextUntitled(),
      filePath: null,
      dirty: false,
      conflict: null,
      initialData: initialDataFor(null, style),
    };
    commitTabs((ts) => [...ts, tab]);
    setActive(tab.id);
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
          return newTab();
        case "open":
          return openFiles(await bridge.openDialog());
        case "save":
          return void (await save(activeRef.current));
        case "saveAs":
          return void (await save(activeRef.current, true));
        case "export":
          if (apis.current.get(activeRef.current)) setExportOpen(true);
          return;
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
      }
    },
    [closeTab, newTab, openFiles, save, setActive],
  );

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
      bridge.onSettingsChanged((s) => {
        const prev = settingsRef.current;
        settingsRef.current = s;
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
  }, [beforeClose, onCommand, openFiles, patchTab, reloadFromContent, scheduleBackground]);

  const active = tabs.find((t) => t.id === activeId);
  useEffect(() => {
    if (active) bridge.setWindowState({ title: `${active.title} — mydraw`, edited: active.dirty });
  }, [active?.title, active?.dirty]); // eslint-disable-line react-hooks/exhaustive-deps

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
      openExportDialog: () => setExportOpen(true),
    };
  }, [newTab, patchTab, save]);

  const activeApi = apis.current.get(activeId);
  return (
    <div className={`md-app theme-${theme}`}>
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActive}
        onClose={(id) => void closeTab(id)}
        onNew={newTab}
      />
      <div className="md-content">
        {tabs.map((t) => (
          <DrawingView
            key={t.id}
            tab={t}
            hidden={t.id !== activeId}
            theme={theme}
            onApi={onApi}
            onChange={onChange}
            onCommand={onCommandSync}
            onResolveConflict={onResolveConflict}
          />
        ))}
      </div>
      {exportOpen && activeApi && active && (
        <ExportDialog
          api={activeApi}
          title={safeFileName(active.title)}
          onClose={() => setExportOpen(false)}
          onDone={(msg) => showToast(msg)}
        />
      )}
      {toast && <div className={`md-toast${toast.error ? " error" : ""}`}>{toast.text}</div>}
    </div>
  );
}
