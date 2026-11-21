// Persistent store for the user's style presets and themes (<userData>/styles.json). It is global to
// the app, so every drawing (and every tab) sees the same list, and it survives restarts.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { normalizeLibrary, type StyleLibrary } from "../../shared/styles";
import { writeFileAtomic } from "./fs-utils";

let current: StyleLibrary | null = null;
const listeners = new Set<(l: StyleLibrary) => void>();

function file(): string {
  return path.join(app.getPath("userData"), "styles.json");
}

export function getStyleLibrary(): StyleLibrary {
  if (current) return current;
  try {
    current = normalizeLibrary(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    current = normalizeLibrary(null);
  }
  return current;
}

export function saveStyleLibrary(raw: unknown): StyleLibrary {
  const next = normalizeLibrary(raw);
  current = next;
  writeFileAtomic(file(), JSON.stringify(next, null, 2));
  for (const l of listeners) l(next);
  return next;
}

export function onStyleLibraryChanged(cb: (l: StyleLibrary) => void): void {
  listeners.add(cb);
}
