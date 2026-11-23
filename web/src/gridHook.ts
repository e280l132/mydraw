// Draws the layout grid INSIDE Excalidraw's static canvas, between the background and the shapes,
// and hides Excalidraw's own grid (which is turned on only for its live snapping).
//
// !! Relies on Excalidraw internals (pinned 0.18.1). Re-check on every Excalidraw upgrade; see
// EXCALIDRAW-UPGRADE.md. What it assumes, all from the static scene renderer
// (`_renderStaticScene` / `bootstrapCanvas` / `strokeGrid` in renderer/staticScene.ts):
//  1. The static canvas is one long-lived <canvas class="excalidraw__canvas static">, and each
//     render begins with `fillRect(0, 0, width, height)` of the background colour in CSS pixels,
//     with the transform at scale(devicePixelRatio). Shapes are drawn after that.
//  2. Excalidraw's grid (drawn only while `gridModeEnabled`) is straight lines, each its own
//     beginPath/moveTo/lineTo/stroke, in exactly "#dddddd" (bold) or "#e5e5e5" (regular)
//     (`GridLineColor`).
//  3. The dark theme is `filter: invert(93%) hue-rotate(180deg)` on the canvas (shared/grid.ts
//     `preDarkColor`).
//  4. Render throttling is off (window.EXCALIDRAW_THROTTLE_RENDER unset), so getAppState() at
//     render time is the state being rendered.
// If (1) breaks the hook never fires -> `status()` reports it and DrawingView falls back to the
// overlay canvas + no live snapping. If (2) breaks, Excalidraw's grid strokes are not seen while
// grid mode is on -> `snapBroken` and live snapping is turned off (so its grey grid never shows).
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { preDarkColor, type GridSettings } from "../../shared/grid";
import { paintGrid } from "./gridPaint";

export const EXCALIDRAW_GRID_COLORS = new Set(["#dddddd", "#e5e5e5"]);
const HOOKED = Symbol("mydrawGridHook");

export interface GridHookStatus {
  /** A static canvas is wrapped. */
  attached: boolean;
  /** Renders seen (background fills recognised). */
  renders: number;
  /** Renders in which we painted the grid. */
  paints: number;
  /** Renders with Excalidraw grid mode on, and how many of those had Excalidraw grid strokes we hid. */
  gridModeRenders: number;
  gridModeRendersSuppressed: number;
}

type Ctx = CanvasRenderingContext2D & { [HOOKED]?: GridHook };

export class GridHook {
  private canvas: HTMLCanvasElement | null = null;
  private restore: (() => void) | null = null;
  private stats: GridHookStatus = { attached: false, renders: 0, paints: 0, gridModeRenders: 0, gridModeRendersSuppressed: 0 };
  private suppressedThisRender = 0;
  private gridModeThisRender = false;

  constructor(
    private readonly getApi: () => ExcalidrawImperativeAPI | null,
    private readonly getGrid: () => GridSettings,
    /** False when the in-canvas grid is not wanted (fallback overlay in use). */
    private readonly paintEnabled: () => boolean,
  ) {}

  status(): GridHookStatus {
    return { ...this.stats, attached: !!this.canvas };
  }

  /** Wrap the static canvas under `root` (again if Excalidraw replaced it). Cheap when already done. */
  attach(root: HTMLElement | null): boolean {
    // Test-only switch: behave as if Excalidraw's renderer changed, to exercise the fallback.
    if ((window as { __mydrawNoGridHook?: boolean }).__mydrawNoGridHook) {
      this.detach();
      return false;
    }
    const canvas = root?.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas.static") ?? null;
    if (canvas === this.canvas) return !!canvas;
    this.detach();
    if (!canvas) return false;
    const ctx = canvas.getContext("2d") as Ctx | null;
    if (!ctx || ctx[HOOKED]) return false;
    this.canvas = canvas;
    ctx[HOOKED] = this;

    const orig = { fillRect: ctx.fillRect, beginPath: ctx.beginPath, moveTo: ctx.moveTo, lineTo: ctx.lineTo, stroke: ctx.stroke };
    let segs = 0; // path ops since beginPath (-1 = not a simple segment)
    const self = this;

    ctx.fillRect = function (x: number, y: number, w: number, h: number) {
      orig.fillRect.call(ctx, x, y, w, h);
      const dpr = window.devicePixelRatio || 1;
      // Only the background fill that starts each render (assumption 1).
      if (x !== 0 || y !== 0 || Math.abs(w - canvas.width / dpr) > 1 || Math.abs(h - canvas.height / dpr) > 1) return;
      self.onRenderStart(ctx, w, h, dpr);
    };
    ctx.beginPath = function () {
      segs = 0;
      return orig.beginPath.call(ctx);
    };
    ctx.moveTo = function (x: number, y: number) {
      segs = segs === 0 ? 1 : -1;
      return orig.moveTo.call(ctx, x, y);
    };
    ctx.lineTo = function (x: number, y: number) {
      segs = segs === 1 ? 2 : -1;
      return orig.lineTo.call(ctx, x, y);
    };
    ctx.stroke = function (this: CanvasRenderingContext2D, ...args: [] | [Path2D]) {
      // Excalidraw's own grid line (assumption 2): skip it, we paint ours under the shapes.
      if (self.gridModeThisRender && args.length === 0 && segs === 2 && EXCALIDRAW_GRID_COLORS.has(String(ctx.strokeStyle).toLowerCase())) {
        self.suppressedThisRender++;
        return;
      }
      return (orig.stroke as (...a: unknown[]) => void).apply(ctx, args);
    };
    this.restore = () => {
      Object.assign(ctx, orig);
      // The wrappers were own properties; drop them so the prototype methods show through.
      for (const k of Object.keys(orig)) delete (ctx as unknown as Record<string, unknown>)[k];
      delete ctx[HOOKED];
    };
    return true;
  }

  detach(): void {
    this.closeRender();
    this.restore?.();
    this.restore = null;
    this.canvas = null;
  }

  private closeRender() {
    if (this.gridModeThisRender && this.suppressedThisRender > 0) this.stats.gridModeRendersSuppressed++;
    this.suppressedThisRender = 0;
    this.gridModeThisRender = false;
  }

  private onRenderStart(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
    // A new render: settle the previous one's counters first.
    this.closeRender();
    this.stats.renders++;
    const api = this.getApi();
    if (!api) return;
    const st = api.getAppState();
    this.gridModeThisRender = !!st.gridModeEnabled;
    if (this.gridModeThisRender) this.stats.gridModeRenders++;
    const grid = this.getGrid();
    if (!grid.enabled || !this.paintEnabled()) return;
    const color = st.theme === "dark" ? preDarkColor(grid.color) : grid.color;
    paintGrid(ctx, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, width: w, height: h }, grid, color, dpr);
    this.stats.paints++;
  }

  /** Close the counters of the last render (call before reading `status()` for a health check). */
  settle(): GridHookStatus {
    this.closeRender();
    return this.status();
  }
}
