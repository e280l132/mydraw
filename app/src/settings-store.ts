import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, addRecent, mergeSettings } from "../../shared/settings";
import type { Settings } from "../../shared/types";
import { writeFileAtomic } from "./fs-utils";

const listeners = new Set<(s: Settings) => void>();
let current: Settings | null = null;

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function getSettings(): Settings {
  if (current) return current;
  try {
    current = mergeSettings(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(settingsPath(), "utf8")));
  } catch {
    current = mergeSettings(DEFAULT_SETTINGS, null);
  }
  return current;
}

export function updateSettings(patch: unknown): Settings {
  const next = mergeSettings(getSettings(), patch);
  current = next;
  writeFileAtomic(settingsPath(), JSON.stringify(next, null, 2));
  for (const l of listeners) l(next);
  return next;
}

export function rememberRecent(filePath: string): void {
  updateSettings({ recentFiles: addRecent(getSettings().recentFiles, filePath) });
  app.addRecentDocument(filePath);
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  listeners.add(cb);
}
