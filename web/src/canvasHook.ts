// Hooks Excalidraw's static canvas (the one with the background and all shapes) for two jobs:
//  - the layout grid, painted between the background and the shapes; Excalidraw's own grid
//    (turned on only for its live snapping) is hidden;
//  - exact colours in dark mode: instead of Excalidraw's CSS filter on the whole canvas, the dark
//    theme is applied inside the canvas, per draw call, like Excalidraw's own dark exports do, so
//    images can be drawn unfiltered in their true colours (with darkImages.ts).
//
// !! Relies on Excalidraw internals (pinned 0.18.1). Re-check on every Excalidraw upgrade; see
// EXCALIDRAW-UPGRADE.md. What it assumes, all from the static scene renderer
// (`_renderStaticScene` / `bootstrapCanvas` / `strokeGrid` in renderer/staticScene.ts):
//  1. The static canvas is one long-lived <canvas class="excalidraw__canvas static">, and each
//     render begins with `fillRect(0, 0, width, height)` of the background colour in CSS pixels,
//     with the transform at scale(devicePixelRatio), inside a save()/restore() pair. Shapes are
//     drawn after that restore(), each inside its own save()/restore(), mostly as drawImage of
//     cached element canvases, and nothing resets `context.filter` on the live canvas.
//  2. Excalidraw's grid (drawn only while `gridModeEnabled`) is straight lines, each its own
//     beginPath/moveTo/lineTo/stroke, in exactly "#dddddd" (bold) or "#e5e5e5" (regular)
//     (`GridLineColor`).
//  3. The dark theme is `filter: invert(93%) hue-rotate(180deg)` on the canvas (THEME_FILTER,
//     CSS `.excalidraw.theme--dark canvas`); an inline `style.filter` overrides it.
//  4. Render throttling is off (window.EXCALIDRAW_THROTTLE_RENDER unset), so getAppState() at
//     render time is the state being rendered.
// If (1) breaks, the hook never fires: the CSS filter stays (Excalidraw's normal dark mode) and
// `status()` reports it, so useCanvasHook falls back (overlay grid, no live snapping). If the
// in-canvas theme gets lost mid-render, `themeLost` counts it and useCanvasHook switches the
// in-canvas theme off for good. If (2) breaks, Excalidraw's grid strokes are not seen while grid
// mode is on -> live snapping is turned off (so its grey grid never shows).
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { preDarkColor, type GridSettings } from "../../shared/grid";
import { installDarkImages, setInCanvasTheme, THEME_FILTER } from "./darkImages";
import { paintGrid } from "./gridPaint";

export const EXCALIDRAW_GRID_COLORS = new Set(["#dddddd", "#e5e5e5"]);
const HOOKED = Symbol("mydrawCanvasHook");

export interface CanvasHookStatus {
  /** A static canvas is wrapped. */
  attached: boolean;
  /** Renders seen (background fills recognised). */
  renders: number;
  /** Renders in which we painted the grid. */
  paints: number;
  /** Renders with Excalidraw grid mode on, and how many of those had Excalidraw grid strokes we hid. */
  gridModeRenders: number;
  gridModeRendersSuppressed: number;
  /** Renders done with the in-canvas dark theme, and how many of those lost it while drawing. */
  themedRenders: number;
  themeLost: number;
}

type Ctx = CanvasRenderingContext2D & { [HOOKED]?: CanvasHook };

export interface CanvasHookOptions {
  getApi(): ExcalidrawImperativeAPI | null;
  getGrid(): GridSettings;
  /** False when the in-canvas grid is not wanted (fallback overlay in use). */
  paintGrid(): boolean;
  /** False when the in-canvas dark theme must not be used (it failed its check). */
  themeInCanvas(): boolean;
}

export class CanvasHook {
  private canvas: HTMLCanvasElement | null = null;
  private restoreCtx: (() => void) | null = null;
  private stats: CanvasHookStatus = {
    attached: false,
    renders: 0,
    paints: 0,
    gridModeRenders: 0,
    gridModeRendersSuppressed: 0,
    themedRenders: 0,
    themeLost: 0,
  };
  private suppressedThisRender = 0;
  private gridModeThisRender = false;
  private themedThisRender = false;
  private lostThisRender = false;

  constructor(private readonly opts: CanvasHookOptions) {
    installDarkImages();
  }

  status(): CanvasHookStatus {
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

    const orig = {
      fillRect: ctx.fillRect,
      restore: ctx.restore,
      beginPath: ctx.beginPath,
      moveTo: ctx.moveTo,
      lineTo: ctx.lineTo,
      stroke: ctx.stroke,
    };
    let segs = 0; // path ops since beginPath (-1 = not a simple segment)
    /**
     * The filter to set after the restore() that closes the background fill (assumption 1):
     * THEME_FILTER for an in-canvas themed render, "none" otherwise. That restore() brings back
     * whatever the previous render left at the outer level, so it is always reset here.
     */
    let filterAfterRestore: string | null = null;
    const self = this;

    ctx.fillRect = function (x: number, y: number, w: number, h: number) {
      const dpr = window.devicePixelRatio || 1;
      // Only the background fill that starts each render (assumption 1).
      const isBackground = x === 0 && y === 0 && Math.abs(w - canvas.width / dpr) <= 1 && Math.abs(h - canvas.height / dpr) <= 1;
      if (!isBackground) return orig.fillRect.call(ctx, x, y, w, h);
      const themed = self.startRender(canvas, ctx);
      const filter = themed ? THEME_FILTER : "none";
      ctx.filter = filter; // the background goes through the theme like everything else
      orig.fillRect.call(ctx, x, y, w, h);
      self.paintGridLayer(ctx, w, h, dpr, themed);
      // Armed only now: the grid painter's own save()/restore() above must not consume it.
      filterAfterRestore = filter;
    };
    ctx.restore = function () {
      orig.restore.call(ctx);
      if (filterAfterRestore !== null) {
        ctx.filter = filterAfterRestore; // for every element drawn in this render
        filterAfterRestore = null;
      }
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
    this.restoreCtx = () => {
      setInCanvasTheme(ctx, false);
      ctx.filter = "none";
      canvas.style.filter = ""; // Excalidraw's CSS dark filter applies again
      // The wrappers were own properties; drop them so the prototype methods show through.
      for (const k of Object.keys(orig)) delete (ctx as unknown as Record<string, unknown>)[k];
      delete ctx[HOOKED];
    };
    return true;
  }

  detach(): void {
    this.closeRender();
    this.restoreCtx?.();
    this.restoreCtx = null;
    this.canvas = null;
  }

  private closeRender() {
    if (this.gridModeThisRender && this.suppressedThisRender > 0) this.stats.gridModeRendersSuppressed++;
    if (this.themedThisRender && this.lostThisRender) this.stats.themeLost++;
    this.suppressedThisRender = 0;
    this.gridModeThisRender = false;
    this.themedThisRender = false;
    this.lostThisRender = false;
  }

  /** A new render starts. Decides (and returns) whether it uses the in-canvas dark theme. */
  private startRender(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): boolean {
    this.closeRender();
    this.stats.renders++;
    const st = this.opts.getApi()?.getAppState();
    this.gridModeThisRender = !!st?.gridModeEnabled;
    if (this.gridModeThisRender) this.stats.gridModeRenders++;
    const themed = st?.theme === "dark" && this.opts.themeInCanvas();
    // The inline style and the pixels change in the same frame (assumption 3).
    const css = themed ? "none" : "";
    if (canvas.style.filter !== css) canvas.style.filter = css;
    setInCanvasTheme(ctx, themed, () => (this.lostThisRender = true));
    this.themedThisRender = themed;
    if (themed) this.stats.themedRenders++;
    return themed;
  }

  private paintGridLayer(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, themed: boolean) {
    const st = this.opts.getApi()?.getAppState();
    const grid = this.opts.getGrid();
    if (!st || !grid.enabled || !this.opts.paintGrid()) return;
    // In-canvas theme: paint unfiltered, exact colour. CSS dark filter: pre-compensate the colour.
    const color = !themed && st.theme === "dark" ? preDarkColor(grid.color) : grid.color;
    paintGrid(ctx, { scrollX: st.scrollX, scrollY: st.scrollY, zoom: st.zoom.value, width: w, height: h }, grid, color, dpr, themed);
    this.stats.paints++;
  }

  /** Close the counters of the last render (call before reading `status()` for a health check). */
  settle(): CanvasHookStatus {
    this.closeRender();
    return this.status();
  }
}
