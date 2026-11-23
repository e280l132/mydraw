import { BrowserWindow, ClipboardItem, app, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { batchFileStems, ensureExtension, siblingPath } from "../../shared/names";
import { resolveLink } from "../../shared/links";
import { importFormatForPath } from "../../shared/importers";
import { addSnapshot, listSnapshots, readSnapshot } from "./snapshots";
import type { AutoExportRequest, ClipboardRequest, ExportExtension, ExportFileRequest, ExportFilesRequest, ImportSummary, LinkResult, OpenedFile, RecoveryEntry, Settings, UnsavedChoice } from "../../shared/types";
import {
  deleteRecovery,
  listRecovery,
  readDrawing,
  unwatchDrawing,
  watchDrawing,
  writeBinary,
  writeDrawing,
  writeRecovery,
} from "./files";
import { CONTROL_FILE } from "../../shared/agent";
import { APP_ORIGIN, registerSchemes, serveApp } from "./appProtocol";
import { registerPdfIpc } from "./pdf";
import { setupAgent } from "./agent";
import { removeControlFile, startControlServer, writeControlFile } from "./control";
import { LIBRARY_SCHEME, setupLibrary } from "./library-ipc";
import { buildMenu } from "./menu";
import { getSettings, onSettingsChanged, rememberRecent, updateSettings } from "./settings-store";
import { getStyleLibrary, saveStyleLibrary } from "./styles-store";

app.setName("mydraw");

const isTest = process.env.MYDRAW_TEST === "1";
const devUrl = process.env.MYDRAW_DEV_URL;
if (process.env.MYDRAW_USER_DATA) app.setPath("userData", process.env.MYDRAW_USER_DATA);

const webRoot = path.join(app.getAppPath(), "web", "dist");

registerSchemes([{ scheme: LIBRARY_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let win: BrowserWindow | null = null;
let allowClose = false;
let rendererReady = false;
const pendingPaths: string[] = [];
/** Paths the renderer may write to: ones the user opened or picked in a dialog. */
const allowedPaths = new Set<string>();

const DRAWING_FILTERS = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];

function isDrawingPath(p: string): boolean {
  return /\.(excalidraw(\.json)?|drawio)$/i.test(p);
}

/** draw.io files are converted into a new, unsaved drawing by the renderer: never a file to save back into. */
const isDrawio = (p: string) => /\.drawio$/i.test(p);

function open(filePath: string): OpenedFile {
  const abs = path.resolve(filePath);
  const file = readDrawing(abs);
  if (isDrawio(abs)) return file; // imported, not opened: not allowed for saving, not in the recent list
  allowedPaths.add(abs);
  rememberRecent(abs);
  return file;
}

function openPaths(paths: string[]): OpenedFile[] {
  const out: OpenedFile[] = [];
  for (const p of paths) {
    try {
      out.push(open(p));
    } catch (err) {
      dialog.showErrorBox("Could not open file", `${p}\n\n${(err as Error).message}`);
    }
  }
  return out;
}

function requestOpen(paths: string[]): void {
  const drawings = paths.filter(isDrawingPath);
  if (!drawings.length) return;
  if (win && rendererReady) {
    const files = openPaths(drawings);
    if (files.length) win.webContents.send("app:open-files", files);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingPaths.push(...drawings);
  }
}

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== "string" || !v) throw new Error(`${name} must be a non-empty string`);
}

/** Returns false (and drops it from the recent list) when the file no longer exists. */
function checkRecent(p: string): boolean {
  if (fs.existsSync(p)) return true;
  dialog.showErrorBox("File not found", `${p}\n\nIt has been removed from Open Recent.`);
  updateSettings({ recentFiles: getSettings().recentFiles.filter((r) => r !== p) });
  return false;
}

function clearRecent(): void {
  updateSettings({ recentFiles: [] });
  app.clearRecentDocuments();
}

function rebuildMenu(settings: Settings): void {
  buildMenu(settings, {
    send: (cmd) => win?.webContents.send("app:menu", cmd),
    openRecent: (p) => {
      if (checkRecent(p)) requestOpen([p]);
    },
    clearRecent,
    updateSettings: (patch) => updateSettings(patch),
  });
}

function applyNativeTheme(settings: Settings): void {
  nativeTheme.themeSource = settings.theme;
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_e, patch: unknown) => updateSettings(patch));
  ipcMain.handle("styles:get", () => getStyleLibrary());
  ipcMain.handle("styles:save", (_e, lib: unknown) => saveStyleLibrary(lib));

  ipcMain.handle("file:open-dialog", async () => {
    if (!win) return [];
    const res = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Drawings (Excalidraw, draw.io)", extensions: ["excalidraw", "drawio"] },
        { name: "Excalidraw drawing", extensions: ["excalidraw"] },
        { name: "draw.io diagram", extensions: ["drawio"] },
      ],
    });
    return res.canceled ? [] : openPaths(res.filePaths);
  });

  // Drill-down links (a shape's `link`): http(s) opens in the browser, a .excalidraw path in a tab.
  // The link text comes from the drawing, so it is validated here (shared/links.ts) and nothing
  // else is ever opened.
  ipcMain.handle("link:open", async (e, link: unknown, base: unknown): Promise<LinkResult> => {
    if (e.sender !== win?.webContents) throw new Error("invalid request");
    assertString(link, "link");
    const baseFile = typeof base === "string" && allowedPaths.has(base) ? base : null;
    const target = resolveLink(link, baseFile);
    if (target.kind === "error" && typeof base === "string" && base && !baseFile && !/^(https?:|file:|\/|~\/)/i.test(link.trim())) {
      return { type: "error", message: "mydraw doesn't know where this drawing is saved: save it again, then follow the link" };
    }
    if (target.kind === "error") return { type: "error", message: target.message };
    if (target.kind === "url") {
      if (!isTest) await shell.openExternal(target.url); // tests must not launch a browser
      return { type: "external" };
    }
    const abs = target.path.startsWith("~/") ? path.join(app.getPath("home"), target.path.slice(2)) : target.path;
    if (!fs.existsSync(abs)) return { type: "error", message: `Linked drawing not found: ${abs}` };
    try {
      return { type: "opened", files: [open(abs)] };
    } catch (err) {
      return { type: "error", message: `Could not open ${abs}: ${(err as Error).message}` };
    }
  });
  // Presentation mode asks for full screen (not in tests: it would resize the test window).
  // We only leave full screen if we were the ones who entered it, and if the user leaves it some
  // other way (green button, ⌃⌘F) the presentation overlay is told to end.
  let enteredFullScreen = false;
  const watched = new WeakSet<BrowserWindow>();
  ipcMain.on("ui:set-fullscreen", (e, on: unknown) => {
    if (e.sender !== win?.webContents || typeof on !== "boolean" || isTest) return;
    const w = win;
    if (!watched.has(w)) {
      watched.add(w);
      w.on("leave-full-screen", () => {
        if (!enteredFullScreen) return;
        enteredFullScreen = false;
        if (!w.isDestroyed()) w.webContents.send("ui:presentation-ended");
      });
    }
    if (on) {
      enteredFullScreen = !w.isFullScreen();
      if (enteredFullScreen) w.setFullScreen(true);
    } else if (enteredFullScreen) {
      enteredFullScreen = false;
      w.setFullScreen(false);
    }
  });
  // Pick a drawing to link to. Returns its absolute path (nothing is opened).
  ipcMain.handle("link:pick-drawing", async (e): Promise<string | null> => {
    if (e.sender !== win?.webContents || !win) throw new Error("invalid request");
    const res = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: DRAWING_FILTERS });
    return res.canceled || !res.filePaths[0] ? null : path.resolve(res.filePaths[0]);
  });

  ipcMain.handle("file:take-pending", () => {
    rendererReady = true;
    const paths = pendingPaths.splice(0);
    return openPaths(paths);
  });

  ipcMain.handle("file:open-recent", (_e, filePath: unknown) => {
    assertString(filePath, "path");
    // Only paths that are actually in the recent list may be opened this way.
    if (!getSettings().recentFiles.includes(filePath) || !checkRecent(filePath)) return [];
    return openPaths([filePath]);
  });
  // Version history: only for drawings the user opened or saved.
  const snapshotPath = (p: unknown): string => {
    assertString(p, "path");
    if (!allowedPaths.has(p)) throw new Error("path was not opened or chosen by the user");
    return p;
  };
  ipcMain.handle("snapshots:list", (_e, p: unknown) => listSnapshots(snapshotPath(p)));
  ipcMain.handle("snapshots:read", (_e, p: unknown, id: unknown) => {
    assertString(id, "id");
    return readSnapshot(snapshotPath(p), id);
  });
  ipcMain.handle("snapshots:add", (_e, p: unknown, content: unknown) => {
    if (typeof content !== "string") throw new Error("content must be a string");
    return addSnapshot(snapshotPath(p), content, { auto: false });
  });
  ipcMain.handle("file:clear-recent", () => clearRecent());

  ipcMain.handle("file:save",(_e, filePath: unknown, content: unknown, auto: unknown) => {
    assertString(filePath, "path");
    if (typeof content !== "string") throw new Error("content must be a string");
    if (!allowedPaths.has(filePath)) throw new Error("path was not opened or chosen by the user");
    writeDrawing(filePath, content);
    addSnapshot(filePath, content, { auto: auto === true });
    rememberRecent(filePath);
  });

  ipcMain.handle("file:save-as", async (_e, defaultName: unknown, content: unknown) => {
    assertString(defaultName, "defaultName");
    if (typeof content !== "string") throw new Error("content must be a string");
    if (!win) return null;
    const res = await dialog.showSaveDialog(win, {
      defaultPath: ensureExtension(defaultName, "excalidraw"),
      filters: DRAWING_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    const target = ensureExtension(res.filePath, "excalidraw");
    allowedPaths.add(target);
    writeDrawing(target, content);
    addSnapshot(target, content, { auto: false });
    rememberRecent(target);
    return target;
  });

  const EXPORT_TYPES: Record<ExportExtension, { name: string; extensions: string[] }> = {
    png: { name: "PNG image", extensions: ["png"] },
    jpg: { name: "JPEG image", extensions: ["jpg", "jpeg"] },
    webp: { name: "WebP image", extensions: ["webp"] },
    svg: { name: "SVG image", extensions: ["svg"] },
    html: { name: "HTML page", extensions: ["html"] },
    pdf: { name: "PDF document", extensions: ["pdf"] },
    pptx: { name: "PowerPoint presentation", extensions: ["pptx"] },
    drawio: { name: "draw.io diagram", extensions: ["drawio"] },
    mmd: { name: "Mermaid flowchart", extensions: ["mmd"] },
    csv: { name: "CSV inventory", extensions: ["csv"] },
    md: { name: "Markdown table", extensions: ["md"] },
    excalidrawlib: { name: "Excalidraw library", extensions: ["excalidrawlib"] },
  };
  const isExt = (v: unknown): v is ExportExtension => typeof v === "string" && Object.hasOwn(EXPORT_TYPES, v);
  const isData = (v: unknown): v is ArrayBuffer | string => typeof v === "string" || v instanceof ArrayBuffer || ArrayBuffer.isView(v);

  ipcMain.handle("file:export", async (_e, req: ExportFileRequest) => {
    if (!win || !req || !isExt(req.extension) || !isData(req.data)) return null;
    assertString(req.defaultName, "defaultName");
    const res = await dialog.showSaveDialog(win, {
      defaultPath: ensureExtension(req.defaultName, req.extension),
      filters: [EXPORT_TYPES[req.extension]],
    });
    if (res.canceled || !res.filePath) return null;
    writeBinary(res.filePath, req.data);
    return res.filePath;
  });

  ipcMain.handle("file:export-files", async (_e, req: ExportFilesRequest) => {
    if (!win || !req || !Array.isArray(req.files) || !req.files.length || !req.files.every((f) => f && isExt(f.extension) && isData(f.data))) {
      return null;
    }
    const res = await dialog.showOpenDialog(win, {
      title: "Export every frame to…",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Export here",
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const names = batchFileStems(req.files.map((f) => String(f.name)));
    return req.files.map((f, i) => {
      const target = path.join(res.filePaths[0], `${names[i]}.${f.extension}`);
      writeBinary(target, f.data);
      return target;
    });
  });

  ipcMain.handle("file:auto-export", (_e, req: AutoExportRequest) => {
    if (!req || (req.extension !== "png" && req.extension !== "svg") || !isData(req.data)) throw new Error("invalid auto-export request");
    assertString(req.path, "path");
    if (!allowedPaths.has(req.path)) throw new Error("path was not opened or chosen by the user");
    const target = siblingPath(req.path, req.extension);
    writeBinary(target, req.data);
    return target;
  });

  ipcMain.handle("clipboard:write", async (_e, req: ClipboardRequest) => {
    if (!req || typeof req !== "object") throw new Error("invalid clipboard request");
    if (req.png) {
      if (!isData(req.png)) throw new Error("invalid image");
      await clipboard.write([new ClipboardItem({ "image/png": new Blob([req.png], { type: "image/png" }) })]);
    } else if (typeof req.text === "string") {
      await clipboard.writeText(req.text);
    } else {
      throw new Error("nothing to copy");
    }
  });

  ipcMain.handle("test:write-file", (_e, filePath: unknown, data: ArrayBuffer | string) => {
    if (!isTest) throw new Error("test-only API");
    assertString(filePath, "path");
    const abs = path.resolve(filePath);
    allowedPaths.add(abs);
    writeBinary(abs, data);
  });

  ipcMain.handle("recovery:write", (_e, entry: RecoveryEntry) => writeRecovery(entry));
  ipcMain.handle("recovery:delete", (_e, tabId: unknown) => {
    assertString(tabId, "tabId");
    deleteRecovery(tabId);
  });
  ipcMain.handle("recovery:list", () => {
    const entries = listRecovery();
    for (const e of entries) if (e.filePath) allowedPaths.add(e.filePath);
    return entries;
  });

  ipcMain.handle("file:watch", (_e, filePath: unknown) => {
    assertString(filePath, "path");
    if (!allowedPaths.has(filePath)) return;
    watchDrawing(filePath, (file) => win?.webContents.send("file:changed-on-disk", file));
  });
  ipcMain.handle("file:unwatch", (_e, filePath: unknown) => {
    assertString(filePath, "path");
    unwatchDrawing(filePath);
  });

  ipcMain.handle("dialog:unsaved", async (_e, titles: unknown): Promise<UnsavedChoice> => {
    if (!win || !Array.isArray(titles)) return "cancel";
    const list = titles.map(String);
    const res = await dialog.showMessageBox(win, {
      type: "warning",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      message:
        list.length === 1
          ? `Save changes to "${list[0]}"?`
          : `You have ${list.length} drawings with unsaved changes. Save them?`,
      detail: list.length > 1 ? list.join("\n") : "Your changes will be lost if you don't save them.",
    });
    return (["save", "discard", "cancel"] as const)[res.response] ?? "cancel";
  });

  ipcMain.on("window:state", (_e, state: { title?: unknown; edited?: unknown }) => {
    if (!win) return;
    if (typeof state?.title === "string") win.setTitle(state.title);
    if (typeof state?.edited === "boolean") win.setDocumentEdited(state.edited);
  });

  ipcMain.on("app:ready-to-close", () => {
    allowClose = true;
    win?.close();
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: "mydraw",
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121212" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => {
    if (!isTest) win?.show();
  });

  // Never open other origins inside the app; send http(s) links to the default browser.
  const appOrigin = devUrl ? new URL(devUrl).origin : APP_ORIGIN;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== appOrigin) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  win.on("close", (e) => {
    if (allowClose || !win || win.webContents.isCrashed() || !rendererReady) return;
    e.preventDefault();
    win.webContents.send("app:before-close");
  });
  win.on("closed", () => {
    win = null;
  });

  void win.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
}

// ---------- agent control (MCP) ----------

async function startAgentControl(store: ReturnType<typeof setupLibrary>): Promise<void> {
  const handler = setupAgent({
    getWin: () => win,
    isRendererReady: () => rendererReady,
    store,
    openFile: (abs) => open(abs),
    allowPath: (abs) => allowedPaths.add(abs),
  });
  ipcMain.handle("ui:apply-template", async (e, name: unknown) => {
    if (e.sender !== win?.webContents || typeof name !== "string") throw new Error("invalid request");
    await handler("apply_template", { name, zoom: true });
  });
  // Text import (CSV / YAML / Mermaid): the dialog's paste box and file button.
  ipcMain.handle("ui:import-diagram", async (e, req: unknown): Promise<ImportSummary> => {
    if (e.sender !== win?.webContents) throw new Error("invalid request");
    if (!req || typeof req !== "object") throw new Error("invalid request");
    const { format, text } = req as { format?: unknown; text?: unknown };
    if ((format !== "csv" && format !== "yaml" && format !== "mermaid") || typeof text !== "string") throw new Error("invalid request");
    const r = (await handler("import_diagram", { format, text, zoom: true })) as { nodes?: unknown; edges?: unknown; warnings?: unknown };
    const count = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" ? v : undefined);
    return { nodes: count(r.nodes), edges: count(r.edges), warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [] };
  });
  ipcMain.handle("ui:pick-import-file", async (e) => {
    if (e.sender !== win?.webContents || !win) throw new Error("invalid request");
    const res = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [
        { name: "Diagram text", extensions: ["csv", "tsv", "yaml", "yml", "mmd", "mermaid"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const file = path.resolve(res.filePaths[0]);
    if (fs.statSync(file).size > 2_000_000) throw new Error("that file is larger than 2 MB");
    return { name: path.basename(file), format: importFormatForPath(file), text: fs.readFileSync(file, "utf8") };
  });
  try {
    const server = await startControlServer(handler);
    const file = path.join(app.getPath("userData"), CONTROL_FILE);
    writeControlFile(file, { port: server.port, key: server.key, pid: process.pid, version: app.getVersion() });
    app.on("will-quit", () => removeControlFile(file, server.key));
  } catch (err) {
    console.error("[mydraw] agent control server failed to start:", err);
  }
}

// ---------- app lifecycle ----------

if (!isTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => requestOpen(argv.slice(1)));
  app.on("open-file", (e, filePath) => {
    e.preventDefault();
    requestOpen([filePath]);
  });
  pendingPaths.push(...process.argv.slice(1).filter(isDrawingPath));

  app.whenReady().then(() => {
    const iconPng = path.join(app.getAppPath(), "assets", "icon.png");
    // The branded dev bundle already has the icon; this covers runs via the stock Electron binary.
    if (process.platform === "darwin" && !app.isPackaged && fs.existsSync(iconPng)) app.dock?.setIcon(iconPng);
    app.setAboutPanelOptions({
      applicationName: "mydraw",
      applicationVersion: app.getVersion(),
      copyright: "Built on Excalidraw (MIT)",
      ...(fs.existsSync(iconPng) ? { iconPath: iconPng } : {}),
    });

    serveApp(webRoot);

    const settings = getSettings();
    applyNativeTheme(settings);
    rebuildMenu(settings);
    onSettingsChanged((s) => {
      applyNativeTheme(s);
      rebuildMenu(s);
      win?.webContents.send("settings:changed", s);
    });

    registerIpc();
    registerPdfIpc();
    const store = setupLibrary(() => win, settings, (patch) => updateSettings(patch));
    createWindow();
    void startAgentControl(store);
  });

  app.on("window-all-closed", () => app.quit());
}
