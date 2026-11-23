// Version snapshots on disk: <userData>/snapshots/<hash of the drawing's path>/<ms>.excalidraw.
// Created on save (see main.ts), listed and read for the version history dialog.
import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { historyIdFromContent } from "../../shared/drawingMeta";
import { shouldSnapshot, SNAPSHOT_ID, snapshotsToPrune, type SnapshotInfo } from "../../shared/snapshots";

const sha1 = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

const root = () => path.join(app.getPath("userData"), "snapshots");
const pathDir = (filePath: string) => path.join(root(), sha1(path.resolve(filePath)).slice(0, 20));

/** The history id of the drawing saved at `filePath`, read from the END of the file. */
function idOnDisk(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 4096);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return historyIdFromContent(buf.toString("utf8"));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Where a drawing's snapshots live. Drawings carry a history id inside the file (shared/drawingMeta.ts),
 * so a renamed or moved file keeps its history. Older files, which have no id yet, are keyed by path;
 * the first save that writes an id adopts that folder.
 */
function dirFor(filePath: string, id: string | null): string {
  const byPath = pathDir(filePath);
  if (!id) return byPath;
  const byId = path.join(root(), `id-${id}`);
  if (!fs.existsSync(byId) && fs.existsSync(byPath)) {
    try {
      fs.renameSync(byPath, byId);
    } catch {
      // could not adopt the old folder: the id folder simply starts empty
    }
  }
  return byId;
}

function ids(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".excalidraw") && SNAPSHOT_ID.test(n.slice(0, -".excalidraw".length))).map((n) => n.slice(0, -".excalidraw".length));
  } catch {
    return [];
  }
}

const newest = (all: string[]) => all.reduce<string | null>((best, id) => (best === null || Number(id) > Number(best) ? id : best), null);

/** Save a snapshot of `content` for `filePath` unless it is unchanged (or an autosave came too soon). Never throws. */
export function addSnapshot(filePath: string, content: string, opts: { auto: boolean; now?: number }): boolean {
  try {
    const dir = dirFor(filePath, historyIdFromContent(content));
    const now = opts.now ?? Date.now();
    const all = ids(dir);
    const lastId = newest(all);
    const last = lastId ? { time: Number(lastId), hash: sha1(fs.readFileSync(path.join(dir, `${lastId}.excalidraw`), "utf8")) } : null;
    if (!shouldSnapshot({ last, hash: sha1(content), now, auto: opts.auto })) return false;
    fs.mkdirSync(dir, { recursive: true });
    // Ids are millisecond times; never reuse one.
    let id = now;
    while (all.includes(String(id))) id++;
    fs.writeFileSync(path.join(dir, `${id}.excalidraw`), content);
    fs.writeFileSync(path.join(dir, "path.txt"), path.resolve(filePath)); // which drawing this folder belongs to
    for (const old of snapshotsToPrune([...all, String(id)])) fs.rmSync(path.join(dir, `${old}.excalidraw`), { force: true });
    return true;
  } catch (err) {
    console.error("[mydraw] snapshot failed:", err);
    return false;
  }
}

/** Snapshots of a drawing, newest first. */
export function listSnapshots(filePath: string): SnapshotInfo[] {
  const dir = dirFor(filePath, idOnDisk(filePath));
  return ids(dir)
    .map((id) => ({ id, time: Number(id), size: fs.statSync(path.join(dir, `${id}.excalidraw`)).size }))
    .sort((a, b) => b.time - a.time);
}

export function readSnapshot(filePath: string, id: string): string {
  if (!SNAPSHOT_ID.test(id)) throw new Error("invalid snapshot id");
  return fs.readFileSync(path.join(dirFor(filePath, idOnDisk(filePath)), `${id}.excalidraw`), "utf8");
}
