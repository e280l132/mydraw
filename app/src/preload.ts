import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
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
  openDialog: () => ipcRenderer.invoke("file:open-dialog"),
  takePendingFiles: () => ipcRenderer.invoke("file:take-pending"),
  saveFile: (path, content) => ipcRenderer.invoke("file:save", path, content),
  saveFileAs: (defaultName, content) => ipcRenderer.invoke("file:save-as", defaultName, content),
  exportFile: (req) => ipcRenderer.invoke("file:export", req),
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
};

contextBridge.exposeInMainWorld("mydraw", bridge);
