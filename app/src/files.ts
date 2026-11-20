import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { OpenedFile, RecoveryEntry } from "../../shared/types";
import { hashContent, writeFileAtomic } from "./fs-utils";

/** Hash of the last content this app wrote to each path, so the watcher ignores our own saves. */
const lastWritten = new Map<string, string>();
const watched = new Map<string, (curr: fs.Stats, prev: fs.Stats) => void>();

export function readDrawing(filePath: string): OpenedFile {
  const content = fs.readFileSync(filePath, "utf8");
  lastWritten.set(filePath, hashContent(content));
  return { path: filePath, content };
}

export function writeDrawing(filePath: string, content: string): void {
  lastWritten.set(filePath, hashContent(content));
  writeFileAtomic(filePath, content);
}

export function writeBinary(filePath: string, data: ArrayBuffer | string): void {
  writeFileAtomic(filePath, typeof data === "string" ? data : new Uint8Array(data));
}

/** Poll-based watcher: survives editors that save via rename, which fs.watch does not. */
export function watchDrawing(filePath: string, onExternalChange: (file: OpenedFile) => void): void {
  if (watched.has(filePath)) return;
  const listener = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.mtimeMs === prev.mtimeMs || curr.nlink === 0) return;
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return;
    }
    const hash = hashContent(content);
    if (hash === lastWritten.get(filePath)) return;
    lastWritten.set(filePath, hash);
    onExternalChange({ path: filePath, content });
  };
  watched.set(filePath, listener);
  fs.watchFile(filePath, { interval: 1000 }, listener);
}

export function unwatchDrawing(filePath: string): void {
  const listener = watched.get(filePath);
  if (!listener) return;
  fs.unwatchFile(filePath, listener);
  watched.delete(filePath);
}

// ---------- crash recovery ----------

function recoveryDir(): string {
  return path.join(app.getPath("userData"), "recovery");
}

function recoveryFile(tabId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(tabId)) throw new Error("invalid tab id");
  return path.join(recoveryDir(), `${tabId}.json`);
}

export function writeRecovery(entry: RecoveryEntry): void {
  writeFileAtomic(recoveryFile(entry.tabId), JSON.stringify(entry));
}

export function deleteRecovery(tabId: string): void {
  fs.rmSync(recoveryFile(tabId), { force: true });
}

export function listRecovery(): RecoveryEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(recoveryDir());
  } catch {
    return [];
  }
  const out: RecoveryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const e = JSON.parse(fs.readFileSync(path.join(recoveryDir(), name), "utf8")) as RecoveryEntry;
      if (typeof e.tabId === "string" && typeof e.content === "string") out.push(e);
    } catch {
      // ignore corrupt entries
    }
  }
  return out.sort((a, b) => a.savedAt - b.savedAt);
}
