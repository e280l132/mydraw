import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { MydrawBridge } from "../../shared/types";

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: MydrawBridge = {
  platform: process.platform,
  isTest: process.env.MYDRAW_TEST === "1",
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  getStyleLibrary: () => ipcRenderer.invoke("styles:get"),
  saveStyleLibrary: (lib) => ipcRenderer.invoke("styles:save", lib),
  openDialog: () => ipcRenderer.invoke("file:open-dialog"),
  takePendingFiles: () => ipcRenderer.invoke("file:take-pending"),
  openRecent: (path) => ipcRenderer.invoke("file:open-recent", path),
  clearRecent: () => ipcRenderer.invoke("file:clear-recent"),
  saveFile: (path, content) => ipcRenderer.invoke("file:save", path, content),
  saveFileAs: (defaultName, content) => ipcRenderer.invoke("file:save-as", defaultName, content),
  exportFile: (req) => ipcRenderer.invoke("file:export", req),
  exportFiles: (req) => ipcRenderer.invoke("file:export-files", req),
  autoExportFile: (req) => ipcRenderer.invoke("file:auto-export", req),
  copyToClipboard: (req) => ipcRenderer.invoke("clipboard:write", req),
  printPdf: (html) => ipcRenderer.invoke("pdf:print", html),
  writeFileForTest: (path, data) => ipcRenderer.invoke("test:write-file", path, data),
  writeRecovery: (entry) => ipcRenderer.invoke("recovery:write", entry),
  deleteRecovery: (tabId) => ipcRenderer.invoke("recovery:delete", tabId),
  listRecovery: () => ipcRenderer.invoke("recovery:list"),
  watchFile: (path) => ipcRenderer.invoke("file:watch", path),
  unwatchFile: (path) => ipcRenderer.invoke("file:unwatch", path),
  askUnsaved: (titles) => ipcRenderer.invoke("dialog:unsaved", titles),
  setWindowState: (state) => ipcRenderer.send("window:state", state),
  readyToClose: () => ipcRenderer.send("app:ready-to-close"),
  onMenu: (cb) => subscribe("app:menu", cb),
  onOpenFiles: (cb) => subscribe("app:open-files", cb),
  onFileChangedOnDisk: (cb) => subscribe("file:changed-on-disk", cb),
  onSettingsChanged: (cb) => subscribe("settings:changed", cb),
  onBeforeClose: (cb) => subscribe("app:before-close", () => cb()),

  libraryIndex: () => ipcRenderer.invoke("library:index"),
  librarySetFavorite: (id, favorite) => ipcRenderer.invoke("library:set-favorite", id, favorite),
  libraryMarkUsed: (id) => ipcRenderer.invoke("library:mark-used", id),
  librarySaveStencil: (payload) => ipcRenderer.invoke("library:save-stencil", payload),
  libraryImport: (paths, collection) => ipcRenderer.invoke("library:import", paths, collection),
  libraryImportDialog: () => ipcRenderer.invoke("library:import-dialog"),
  libraryRename: (id, name) => ipcRenderer.invoke("library:rename", id, name),
  libraryRemove: (id) => ipcRenderer.invoke("library:remove", id),
  libraryReveal: (id) => ipcRenderer.invoke("library:reveal", id),
  libraryOpenFolder: () => ipcRenderer.invoke("library:open-folder"),
  libraryChooseFolder: () => ipcRenderer.invoke("library:choose-folder"),
  libraryPacks: () => ipcRenderer.invoke("library:packs"),
  libraryInstallPacks: (ids) => ipcRenderer.invoke("library:install-packs", ids),
  excalidrawLibraryGet: () => ipcRenderer.invoke("xlib:get"),
  excalidrawLibrarySave: (content) => ipcRenderer.invoke("xlib:save", content),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onLibraryChanged: (cb) => subscribe("library:changed", cb),
  onExcalidrawLibraryChanged: (cb) => subscribe("xlib:changed", cb),
  onPackProgress: (cb) => subscribe("library:pack-progress", cb),
  onAgentCommand: (cb) => subscribe("agent:command", cb),
  agentReply: (reply) => ipcRenderer.send("agent:reply", reply),
};

contextBridge.exposeInMainWorld("mydraw", bridge);
