import { DEFAULT_GRID, normalizeGrid } from "./grid";
import { normalizePanelOrder } from "./panelOrder";
import { cloneQuickConnect, defaultQuickConnect, normalizeQuickConnect } from "./quickBindings";
import { CAPTION_FONT_MODES, DEFAULT_HAND_FONT, DEFAULT_ICON_SKETCH, ICON_STYLE_SETTINGS, type CaptionFontMode, type IconStyleSetting, lookOfSetting, normalizeHandFont, normalizeIconSketch } from "./iconSketch";
import type { DrawingStyle, Settings, ThemeSetting } from "./types";
import { tagVersion } from "./version";
import { DEFAULT_ASK_MODEL, normalizeAskSettings } from "./askClaude";

export const MAX_RECENT = 10;

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  drawingStyle: "clean",
  autosave: true,
  recentFiles: [],
  libraryPath: null,
  autoExport: {},
  quickConnect: defaultQuickConnect(),
  grid: { ...DEFAULT_GRID },
  panelOrder: [],
  iconStyle: "auto",
  iconSketch: lookOfSetting(null),
  captionFont: "match",
  captionHandFont: DEFAULT_HAND_FONT,
  updates: { check: true, lastCheck: 0, skipped: null },
  setupShown: false,
  askClaude: { model: DEFAULT_ASK_MODEL },
};

const THEMES: ThemeSetting[] = ["system", "light", "dark"];
const STYLES: DrawingStyle[] = ["clean", "sketch"];

/** Merge untrusted JSON (settings file or a renderer patch) onto a base, keeping only valid values. */
export function mergeSettings(base: Settings, raw: unknown): Settings {
  const out: Settings = { ...base, recentFiles: [...base.recentFiles], autoExport: { ...base.autoExport }, quickConnect: cloneQuickConnect(base.quickConnect), grid: { ...base.grid }, panelOrder: [...base.panelOrder], iconSketch: { ...base.iconSketch }, updates: { ...base.updates }, askClaude: { ...base.askClaude } };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (THEMES.includes(r.theme as ThemeSetting)) out.theme = r.theme as ThemeSetting;
  if (STYLES.includes(r.drawingStyle as DrawingStyle)) out.drawingStyle = r.drawingStyle as DrawingStyle;
  if (typeof r.autosave === "boolean") out.autosave = r.autosave;
  if (typeof r.setupShown === "boolean") out.setupShown = r.setupShown;
  if (Array.isArray(r.recentFiles)) {
    out.recentFiles = r.recentFiles.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT);
  }
  if (r.libraryPath === null || (typeof r.libraryPath === "string" && r.libraryPath.startsWith("/"))) {
    out.libraryPath = r.libraryPath as string | null;
  }
  if (r.autoExport && typeof r.autoExport === "object" && !Array.isArray(r.autoExport)) {
    out.autoExport = {};
    for (const [p, v] of Object.entries(r.autoExport as Record<string, unknown>)) {
      if (p.startsWith("/") && (v === "png" || v === "svg")) out.autoExport[p] = v;
    }
  }
  if (r.askClaude !== undefined) out.askClaude = normalizeAskSettings(r.askClaude, base.askClaude);
  if (r.quickConnect !== undefined) out.quickConnect = normalizeQuickConnect(r.quickConnect);
  if (r.grid !== undefined) out.grid = normalizeGrid(r.grid, base.grid);
  if (r.panelOrder !== undefined) out.panelOrder = normalizePanelOrder(r.panelOrder);
  if (ICON_STYLE_SETTINGS.includes(r.iconStyle as IconStyleSetting)) out.iconStyle = r.iconStyle as IconStyleSetting;
  if (CAPTION_FONT_MODES.includes(r.captionFont as CaptionFontMode)) out.captionFont = r.captionFont as CaptionFontMode;
  if (r.updates && typeof r.updates === "object") {
    const u = r.updates as Record<string, unknown>;
    if (typeof u.check === "boolean") out.updates.check = u.check;
    if (typeof u.lastCheck === "number" && Number.isFinite(u.lastCheck) && u.lastCheck >= 0) out.updates.lastCheck = u.lastCheck;
    if (u.skipped === null || (typeof u.skipped === "string" && tagVersion(u.skipped))) out.updates.skipped = u.skipped === null ? null : tagVersion(u.skipped as string);
  }
  const hand = normalizeHandFont(r.captionHandFont);
  if (hand) out.captionHandFont = hand;
  if (r.iconSketch && typeof r.iconSketch === "object") {
    try {
      const s = normalizeIconSketch({ ...(r.iconSketch as object), seed: 1 }, { ...DEFAULT_ICON_SKETCH, ...base.iconSketch, seed: 1 });
      if (s) {
        const { seed: _seed, ...look } = s;
        void _seed;
        out.iconSketch = look;
      }
    } catch {
      // keep the current look
    }
  }
  return out;
}

/** Move `path` to the front of the recent list, de-duplicated and capped. */
export function addRecent(list: readonly string[], path: string, max = MAX_RECENT): string[] {
  return [path, ...list.filter((p) => p !== path)].slice(0, max);
}
