import type { DrawingStyle, Settings, ThemeSetting } from "./types";

export const MAX_RECENT = 10;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  drawingStyle: "clean",
  autosave: true,
  recentFiles: [],
  libraryPath: null,
};

const THEMES: ThemeSetting[] = ["system", "light", "dark"];
const STYLES: DrawingStyle[] = ["clean", "sketch"];

/** Merge untrusted JSON (settings file or a renderer patch) onto a base, keeping only valid values. */
export function mergeSettings(base: Settings, raw: unknown): Settings {
  const out: Settings = { ...base, recentFiles: [...base.recentFiles] };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (THEMES.includes(r.theme as ThemeSetting)) out.theme = r.theme as ThemeSetting;
  if (STYLES.includes(r.drawingStyle as DrawingStyle)) out.drawingStyle = r.drawingStyle as DrawingStyle;
  if (typeof r.autosave === "boolean") out.autosave = r.autosave;
  if (Array.isArray(r.recentFiles)) {
    out.recentFiles = r.recentFiles.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT);
  }
  if (r.libraryPath === null || (typeof r.libraryPath === "string" && r.libraryPath.startsWith("/"))) {
    out.libraryPath = r.libraryPath as string | null;
  }
  return out;
}

/** Move `path` to the front of the recent list, de-duplicated and capped. */
export function addRecent(list: readonly string[], path: string, max = MAX_RECENT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}
