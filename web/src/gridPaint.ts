// Paints the layout grid onto a 2D context whose transform is CSS pixels (scale = devicePixelRatio).
// Shared by the in-canvas hook (web/src/canvasHook.ts) and the fallback overlay (GridOverlay.tsx).
import { planGrid, type GridSettings } from "../../shared/grid";

export interface PaintView {
  scrollX: number;
  scrollY: number;
  zoom: number;
  /** CSS pixels. */
  width: number;
  height: number;
}

/** `unfiltered`: switch the context filter off while painting (the canvas is themed in-canvas). */
export function paintGrid(ctx: CanvasRenderingContext2D, view: PaintView, grid: GridSettings, color: string, dpr: number, unfiltered = false): void {
  const { width: w, height: h } = view;
  if (w <= 0 || h <= 0) return;
  const plan = planGrid(view, grid);
  const minor = grid.opacity;
  const major = Math.min(1, grid.opacity * 2.2);
  ctx.save();
  if (unfiltered) ctx.filter = "none";
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  // 1 CSS px lines on whole device pixels: centred on a pixel boundary when that is an even number
  // of device pixels (dpr 2), on a pixel centre when odd (dpr 1), so they stay crisp.
  const lw = Math.max(1, Math.round(dpr));
  const px = (v: number) => (Math.round(v * dpr) + (lw % 2 ? 0.5 : 0)) / dpr;
  if (grid.style === "lines") {
    ctx.lineWidth = lw / dpr;
    for (const pass of [false, true]) {
      ctx.globalAlpha = pass ? major : minor;
      ctx.beginPath();
      for (const l of plan.vertical) if (l.major === pass) (ctx.moveTo(px(l.at), 0), ctx.lineTo(px(l.at), h));
      for (const l of plan.horizontal) if (l.major === pass) (ctx.moveTo(0, px(l.at)), ctx.lineTo(w, px(l.at)));
      ctx.stroke();
    }
  } else if (plan.vertical.length * plan.horizontal.length <= 60000) {
    // Dots at every crossing; crossings of two major lines are bigger.
    for (const v of plan.vertical) {
      for (const hz of plan.horizontal) {
        const big = v.major && hz.major;
        ctx.globalAlpha = big ? major : v.major || hz.major ? (minor + major) / 2 : minor;
        ctx.beginPath();
        ctx.arc(v.at, hz.at, big ? 1.8 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}
