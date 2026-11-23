// Layout grid: the settings (global, persisted in settings.json), the pure geometry that turns a
// view (scroll + zoom) into the lines/dots to draw, and the colour maths for Excalidraw's dark-mode
// canvas filter. The renderer paints the grid INTO Excalidraw's static canvas, behind the shapes
// (web/src/gridHook.ts), and falls back to an overlay canvas (web/src/GridOverlay.tsx) when that
// hook stops working after an Excalidraw upgrade. Unit-tested in tests/grid.test.ts.
// See EXCALIDRAW-UPGRADE.md before changing anything that touches Excalidraw internals.
import { normalizeHex } from "./colorMath";

export type GridStyle = "lines" | "dots";

export interface GridSettings {
  enabled: boolean;
  /** Scene units between minor lines. */
  size: number;
  /** Every Nth line is a stronger "major" line; 0 = no major lines. */
  majorEvery: number;
  style: GridStyle;
  /** `#rrggbb`. */
  color: string;
  /** Strength of the minor lines, 0.02..1. Major lines are drawn about twice as strong. */
  opacity: number;
  /** Snap shapes to the grid while dragging, drawing and resizing (only while the grid is shown). */
  snap: boolean;
}

export const GRID_LIMITS = { size: [4, 100], majorEvery: [0, 20], opacity: [0.02, 1] } as const;
export const GRID_SIZE_PRESETS = [5, 8, 10, 16, 20, 25, 40, 50, 100] as const;
export const GRID_COLORS = ["#7a8ba3", "#4f8cff", "#2fa84f", "#e08a1e", "#d64545", "#9b59d0", "#111111", "#ffffff"] as const;

export const DEFAULT_GRID: GridSettings = {
  enabled: false,
  size: 20,
  majorEvery: 5,
  style: "lines",
  color: "#7a8ba3",
  opacity: 0.3,
  snap: true,
};

const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));

/** Merge untrusted input (settings file, renderer patch) onto a base, keeping only valid values. */
export function normalizeGrid(raw: unknown, base: GridSettings = DEFAULT_GRID): GridSettings {
  const out = { ...base };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.size === "number" && Number.isFinite(r.size)) out.size = Math.round(clamp(r.size, GRID_LIMITS.size));
  if (typeof r.majorEvery === "number" && Number.isFinite(r.majorEvery)) out.majorEvery = Math.round(clamp(r.majorEvery, GRID_LIMITS.majorEvery));
  if (r.style === "lines" || r.style === "dots") out.style = r.style;
  if (typeof r.color === "string") out.color = normalizeHex(r.color) ?? out.color;
  if (typeof r.snap === "boolean") out.snap = r.snap;
  if (typeof r.opacity === "number" && Number.isFinite(r.opacity)) out.opacity = Math.round(clamp(r.opacity, GRID_LIMITS.opacity) * 100) / 100;
  return out;
}

export interface GridView {
  /** Excalidraw scroll offsets (scene = screen / zoom - scroll). */
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** Visible size in CSS pixels. */
  width: number;
  height: number;
}

export interface GridLine {
  /** Screen position (CSS px) along its axis. */
  at: number;
  major: boolean;
}

export interface GridPlan {
  vertical: GridLine[];
  horizontal: GridLine[];
  /** Minor lines are drawn every `skip` grid units (>1 when zoomed far out). */
  skip: number;
}

/** Below this many screen pixels between lines the grid turns to mush, so lines are thinned out. */
export const MIN_SCREEN_STEP = 8;
/** Safety cap per axis. */
const MAX_LINES = 600;

function axis(scroll: number, extent: number, zoom: number, g: GridSettings, skip: number): GridLine[] {
  const unit = g.size;
  const first = Math.floor(-scroll / unit);
  const last = Math.ceil((extent / zoom - scroll) / unit);
  const out: GridLine[] = [];
  for (let i = first; i <= last && out.length < MAX_LINES; i++) {
    const major = g.majorEvery > 0 && i % g.majorEvery === 0;
    if (i % skip !== 0 && !major) continue;
    out.push({ at: (i * unit + scroll) * zoom, major });
  }
  return out;
}

/** Which lines to draw for this view. Lines are thinned (never moved) when zoomed out; majors always stay. */
export function planGrid(view: GridView, g: GridSettings): GridPlan {
  const zoom = view.zoom > 0 ? view.zoom : 1;
  let skip = 1;
  // Prefer thinning to the major interval, then keep doubling it.
  const step = g.size * zoom;
  if (step < MIN_SCREEN_STEP) {
    skip = g.majorEvery > 1 ? g.majorEvery : 2;
    while (g.size * skip * zoom < MIN_SCREEN_STEP && skip < 1 << 20) skip *= 2;
  }
  // If even the major lines are too dense, drop them to the thinned interval.
  const majors = g.majorEvery > 0 && g.size * g.majorEvery * zoom >= MIN_SCREEN_STEP;
  const eff = majors ? g : { ...g, majorEvery: 0 };
  return {
    vertical: axis(view.scrollX, view.width, zoom, eff, skip),
    horizontal: axis(view.scrollY, view.height, zoom, eff, skip),
    skip,
  };
}

/** Round to the nearest grid line (the one a shape's edge would snap to). */
export const snapValue = (v: number, size: number): number => Math.round(v / size) * size;

/** Offset that moves a box's top-left corner onto the grid. -0 is normalised to 0. */
export function snapOffset(box: { x: number; y: number }, size: number): { dx: number; dy: number } {
  return { dx: snapValue(box.x, size) - box.x + 0, dy: snapValue(box.y, size) - box.y + 0 };
}

/**
 * The Excalidraw app state that gives live snapping: Excalidraw snaps to `gridSize` whenever
 * `gridModeEnabled` is on (and draws its own grid, which web/src/gridHook.ts hides).
 * Excalidraw clamps gridSize/gridStep to 1..100 when it restores a scene.
 */
export function excalidrawGridState(g: GridSettings, snapUsable: boolean): { gridModeEnabled: boolean; gridSize: number } {
  return { gridModeEnabled: g.enabled && g.snap && snapUsable, gridSize: g.size };
}

/** What a saved .excalidraw file gets instead of the live grid state (Excalidraw's defaults), so files stay clean. */
export const FILE_GRID_STATE = { gridModeEnabled: false, gridSize: 20, gridStep: 5 } as const;

// ----- dark mode -----
// Excalidraw dark mode puts `filter: invert(93%) hue-rotate(180deg)` (THEME_FILTER, CSS var
// --theme-filter) on its canvases. Anything we paint into its static canvas goes through that
// filter, so the grid colour is pre-compensated: we paint c such that filter(c) = the chosen colour.
// The filter is applied in sRGB; each function's result is clamped to 0..1.

export const EXCALIDRAW_DARK_INVERT = 0.93;

/** hue-rotate(180deg) matrix from the Filter Effects spec (cos = -1, sin = 0). */
const HUE_180: readonly (readonly number[])[] = [
  [0.213 - 0.787, 0.715 + 0.715, 0.072 + 0.072],
  [0.213 + 0.213, 0.715 - 0.285, 0.072 + 0.072],
  [0.213 + 0.213, 0.715 + 0.715, 0.072 - 0.928],
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const mul = (m: readonly (readonly number[])[], v: readonly number[]) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

function inverse3(m: readonly (readonly number[])[]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const HUE_180_INV = inverse3(HUE_180);

const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toHex = (rgb: readonly number[]) => "#" + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

/** What Excalidraw's dark filter turns `hex` into (model of the CSS filter; used by tests). */
export function applyDarkFilter(hex: string, amount = EXCALIDRAW_DARK_INVERT): string {
  const inv = toRgb(hex).map((c) => clamp01(c * (1 - amount) + (1 - c) * amount));
  return toHex(mul(HUE_180, inv).map(clamp01));
}

/** The colour to paint so that, after the dark filter, it shows as `hex` (as close as the filter allows). */
export function preDarkColor(hex: string, amount = EXCALIDRAW_DARK_INVERT): string {
  const u = mul(HUE_180_INV, toRgb(hex)).map((v) => Math.min(amount, Math.max(1 - amount, v)));
  // invert: u = c(1-a) + (1-c)a = a + c(1-2a)  ->  c = (u - a) / (1 - 2a)
  return toHex(u.map((v) => (v - amount) / (1 - 2 * amount)));
}
