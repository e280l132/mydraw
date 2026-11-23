// Wires the stencil library (LibraryStore + icon packs) to IPC and the mdlib:// protocol.
import { app, dialog, ipcMain, net, protocol, shell, type BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { PackStatus, SaveStencilPayload, Settings } from "../../shared/types";
import { LibraryStore } from "./library";
import { PACKS, installPacks, installedPacks, uninstallPack } from "./packs";

export const LIBRARY_SCHEME = "mdlib";

export function defaultLibraryPath(): string {
  return process.env.MYDRAW_LIBRARY || path.join(app.getPath("documents"), "mydraw", "Library");
}

export function libraryPathFor(settings: Settings): string {
  return process.env.MYDRAW_LIBRARY || settings.libraryPath || defaultLibraryPath();
}

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== "string" || !v) throw new Error(`${name} must be a non-empty string`);
}

export function setupLibrary(
  getWin: () => BrowserWindow | null,
  settings: Settings,
  updateSettings: (patch: Partial<Settings>) => void,
): LibraryStore {
  const send = (channel: string, payload: unknown) => getWin()?.webContents.send(channel, payload);
  const store = new LibraryStore(
    libraryPathFor(settings),
    (index) => send("library:changed", index),
  );
  store.start();

  // Serve library files (previews, stencil contents) to the renderer, confined to the library root.
  protocol.handle(LIBRARY_SCHEME, (req) => {
    try {
      const { pathname } = new URL(req.url);
      const rel = decodeURIComponent(pathname.replace(/^\/+/, ""));
      const abs = store.resolve(rel);
      return net.fetch(pathToFileURL(abs).toString()).then((res) => {
        const headers = new Headers(res.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "no-cache");
        return new Response(res.body, { status: res.status, headers });
      });
    } catch {
      return new Response("forbidden", { status: 403 });
    }
  });

  ipcMain.handle("library:index", () => store.getIndex());
  ipcMain.handle("library:set-favorite", (_e, id: unknown, fav: unknown) => {
    assertString(id, "id");
    store.setFavorite(id, fav === true);
  });
  ipcMain.handle("library:mark-used", (_e, id: unknown) => {
    assertString(id, "id");
    store.markUsed(id);
  });
  ipcMain.handle("library:save-stencil", (_e, p: SaveStencilPayload) => {
    if (!p || !Array.isArray(p.elements) || !p.elements.length) throw new Error("nothing to save");
    return store.saveStencil({
      collection: typeof p.collection === "string" ? p.collection : "",
      name: typeof p.name === "string" ? p.name : "",
      tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === "string") : [],
      elements: p.elements,
      files: p.files && typeof p.files === "object" ? p.files : {},
    });
  });
  ipcMain.handle("library:import", (_e, paths: unknown, collection: unknown) => {
    if (!Array.isArray(paths)) return 0;
    return store.importPaths(
      paths.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)),
      typeof collection === "string" && collection ? collection : undefined,
    );
  });
  ipcMain.handle("library:import-dialog", async () => {
    const win = getWin();
    if (!win) return 0;
    const res = await dialog.showOpenDialog(win, {
      title: "Import stencils",
      buttonLabel: "Import",
      properties: ["openFile", "openDirectory", "multiSelections"],
      filters: [{ name: "Stencils", extensions: ["svg", "png", "excalidrawlib"] }],
    });
    return res.canceled ? 0 : store.importPaths(res.filePaths);
  });
  ipcMain.handle("library:rename", (_e, id: unknown, name: unknown) => {
    assertString(id, "id");
    assertString(name, "name");
    store.rename(id, name);
  });
  ipcMain.handle("library:remove", async (_e, id: unknown) => {
    assertString(id, "id");
    await store.remove(id);
  });
  ipcMain.handle("library:reveal", (_e, id: unknown) => {
    assertString(id, "id");
    store.reveal(id);
  });
  ipcMain.handle("library:open-folder", () => shell.openPath(store.rootPath));
  ipcMain.handle("library:choose-folder", async () => {
    const win = getWin();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, {
      title: "Choose stencil library folder",
      defaultPath: store.rootPath,
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const chosen = res.filePaths[0];
    updateSettings({ libraryPath: chosen === defaultLibraryPath() ? null : chosen });
    store.setRoot(chosen);
    return chosen;
  });

  ipcMain.handle("library:uninstall-pack", (_e, id: unknown) => {
    assertString(id, "id");
    uninstallPack(store.rootPath, id);
    store.rescan();
  });

  ipcMain.handle("library:packs", (): PackStatus[] => {
    const installed = new Set(installedPacks(store.rootPath));
    return PACKS.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      approxMB: p.approxMB,
      license: p.license,
      installed: installed.has(p.id),
    }));
  });
  let installing = false;
  ipcMain.handle("library:install-packs", async (_e, ids: unknown) => {
    if (installing) throw new Error("an install is already running");
    if (!Array.isArray(ids)) return [];
    installing = true;
    try {
      const results = await installPacks(
        store.rootPath,
        ids.filter((x): x is string => typeof x === "string"),
        (m) => send("library:pack-progress", m),
      );
      store.rescan();
      return results;
    } finally {
      installing = false;
    }
  });

  return store;
}
