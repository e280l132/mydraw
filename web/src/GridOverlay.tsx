// FALLBACK layout grid: a canvas above the drawing (pointer-events: none), used only when the
// in-canvas hook (canvasHook.ts) does not work, e.g. after an Excalidraw upgrade changed its renderer.
// It draws over the shapes. The canvas sits outside Excalidraw's dark-mode CSS filter, so the
// chosen colour is shown as is.
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { GridSettings } from "../../shared/grid";
import { paintGrid } from "./gridPaint";

export interface GridViewRef {
  current: { scrollX: number; scrollY: number; zoom: number };
}

interface Props {
  grid: GridSettings;
  /** Latest scroll/zoom of this tab, written by DrawingView's onChange. */
  viewRef: GridViewRef;
  /** DrawingView calls this after each change of scroll/zoom. */
  registerRedraw(fn: () => void): void;
}

export function GridOverlay({ grid, viewRef, registerRedraw }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const c = canvas.current;
    const host = c?.parentElement;
    if (!c || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!grid.enabled || w === 0 || h === 0) return;
    paintGrid(ctx, { ...viewRef.current, width: w, height: h }, grid, grid.color, dpr);
  }, [grid, viewRef]);

  useLayoutEffect(() => {
    registerRedraw(draw);
    draw();
  }, [draw, registerRedraw]);

  useEffect(() => {
    const host = canvas.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver(draw);
    ro.observe(host);
    return () => ro.disconnect();
  }, [draw]);

  return <canvas ref={canvas} className="md-grid-canvas" aria-hidden="true" />;
}
