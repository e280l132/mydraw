import { BrowserWindow, app, dialog, ipcMain, nativeTheme, net, protocol, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureExtension } from "../../shared/names";
import type { ExportFileRequest, OpenedFile, RecoveryEntry, Settings, UnsavedChoice } from "../../shared/types";
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
import { buildMenu } from "./menu";
import { getSettings, onSettingsChanged, rememberRecent, updateSettings } from "./settings-store";

app.setName("mydraw");

const isTest = process.env.MYDRAW_TEST === "1";
const devUrl = process.env.MYDRAW_DEV_URL;
if (process.env.MYDRAW_USER_DATA) app.setPath("userData", process.env.MYDRAW_USER_DATA);

const APP_ORIGIN = "app://mydraw";
const webRoot = path.join(app.getAppPath(), "web", "dist");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

let win: BrowserWindow | null = null;
let allowClose = false;
let rendererReady = false;
const pendingPaths: string[] = [];
/** Paths the renderer may write to: ones the user opened or picked in a dialog. */
const allowedPaths = new Set<string>();

const DRAWING_FILTERS = [{ name: "Excalidraw drawing", extensions: ["excalidraw"] }];

function isDrawingPath(p: string): boolean {
  return /\.excalidraw(\.json)?$/i.test(p);
}

function open(filePath: string): OpenedFile {
  const abs = path.resolve(filePath);
  const file = readDrawing(abs);
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

  ipcMain.handle("file:open-dialog", async () => {
    if (!win) return [];
    const res = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: DRAWING_FILTERS,
    });
    return res.canceled ? [] : openPaths(res.filePaths);
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
  ipcMain.handle("file:clear-recent", () => clearRecent());

  ipcMain.handle("file:save",(_e, filePath: unknown, content: unknown) => {
    assertString(filePath, "path");
    if (typeof content !== "string") throw new Error("content must be a string");
    if (!allowedPaths.has(filePath)) throw new Error("path was not opened or chosen by the user");
    writeDrawing(filePath, content);
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
    rememberRecent(target);
    return target;
  });

  ipcMain.handle("file:export", async (_e, req: ExportFileRequest) => {
    if (!win || !req || !["png", "jpg", "svg"].includes(req.extension)) return null;
    assertString(req.defaultName, "defaultName");
    const names: Record<string, string> = { png: "PNG image", jpg: "JPEG image", svg: "SVG image" };
    const res = await dialog.showSaveDialog(win, {
      defaultPath: ensureExtension(req.defaultName, req.extension),
      filters: [{ name: names[req.extension], extensions: req.extension === "jpg" ? ["jpg", "jpeg"] : [req.extension] }],
    });
    if (res.canceled || !res.filePath) return null;
    writeBinary(res.filePath, req.data);
    return res.filePath;
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

    protocol.handle("app", (req) => {
      const { pathname } = new URL(req.url);
      const file = path.normalize(path.join(webRoot, decodeURIComponent(pathname)));
      if (!file.startsWith(webRoot + path.sep)) return new Response("forbidden", { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });

    const settings = getSettings();
    applyNativeTheme(settings);
    rebuildMenu(settings);
    onSettingsChanged((s) => {
      applyNativeTheme(s);
      rebuildMenu(s);
      win?.webContents.send("settings:changed", s);
    });

    registerIpc();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
