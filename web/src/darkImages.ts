// Exact image colours in dark mode.
//
// Excalidraw's live dark theme is a CSS filter on the canvas (THEME_FILTER). To keep photos and
// icons looking normal under it, it pre-corrects each image with IMAGE_INVERT_FILTER while drawing
// the image into a detached per-element canvas. That correction is only approximate: saturated
// colours shift (Broadcom's #cc092f shows as #993f69). Excalidraw's own dark EXPORTS do it
// properly instead: the theme filter is applied in the canvas per draw call and switched off for
// images, which keeps them exact.
//
// canvasHook.ts makes the live static canvas render like an export (CSS filter off, THEME_FILTER
// set on the context). This module provides the image half, with two global canvas patches:
//  1. When Excalidraw sets IMAGE_INVERT_FILTER on a detached canvas (an image's element canvas),
//     we set "none" instead and remember that canvas: it now holds the image's true colours.
//  2. When such a canvas is drawn somewhere, it is drawn with no filter onto a context that is
//     rendering with the in-canvas theme (exact colours), and with IMAGE_INVERT_FILTER anywhere
//     else, which is exactly what Excalidraw would have produced (so nothing else changes).
//
// !! Relies on Excalidraw internals (pinned 0.18.1); see EXCALIDRAW-UPGRADE.md. If Excalidraw
// changes the filter string, patch 1 never fires and images look as they did before (approximate).

/** Excalidraw's `IMAGE_INVERT_FILTER` (renderer/renderElement.ts). */
export const IMAGE_INVERT_FILTER = "invert(100%) hue-rotate(180deg) saturate(1.25)";
/** Excalidraw's `THEME_FILTER` (constants.ts; CSS var --theme-filter on dark canvases). */
export const THEME_FILTER = "invert(93%) hue-rotate(180deg)";

/** Element canvases holding an image's true colours (we skipped Excalidraw's pre-correction). */
const trueColorCanvases = new WeakSet<object>();
/** Contexts currently rendering with the in-canvas dark theme (set by canvasHook.ts per render). */
const inCanvasThemed = new WeakSet<CanvasRenderingContext2D>();
/** Called when an in-canvas render draws an element while the context lost THEME_FILTER. */
const themeLostListeners = new WeakMap<CanvasRenderingContext2D, () => void>();

let installed = false;
const stats = { swapped: 0, exactDraws: 0, correctedDraws: 0 };

export function darkImageStats() {
  return { ...stats };
}

export function setInCanvasTheme(ctx: CanvasRenderingContext2D, on: boolean, onThemeLost?: () => void): void {
  if (on) {
    inCanvasThemed.add(ctx);
    if (onThemeLost) themeLostListeners.set(ctx, onThemeLost);
  } else {
    inCanvasThemed.delete(ctx);
  }
}

/** Install the two prototype patches once (idempotent). */
export function installDarkImages(): void {
  if (installed || typeof CanvasRenderingContext2D === "undefined") return;
  installed = true;
  const proto = CanvasRenderingContext2D.prototype;
  const filterDesc = Object.getOwnPropertyDescriptor(proto, "filter");
  if (!filterDesc?.get || !filterDesc.set) return; // no canvas filters: nothing to do
  const getFilter = filterDesc.get;
  const setFilter = filterDesc.set;

  Object.defineProperty(proto, "filter", {
    configurable: true,
    enumerable: filterDesc.enumerable,
    get(this: CanvasRenderingContext2D) {
      return getFilter.call(this);
    },
    set(this: CanvasRenderingContext2D, value: string) {
      // Patch 1: only for detached canvases (element canvases), never for a canvas on the page.
      const c = this.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
      if (value === IMAGE_INVERT_FILTER && c && !(c instanceof HTMLCanvasElement && c.isConnected)) {
        trueColorCanvases.add(c);
        stats.swapped++;
        return setFilter.call(this, "none");
      }
      return setFilter.call(this, value);
    },
  });

  const drawImage = proto.drawImage as (this: CanvasRenderingContext2D, ...a: unknown[]) => void;
  proto.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    const src = args[0] as object;
    const themed = inCanvasThemed.has(this);
    if (themed && !trueColorCanvases.has(src) && getFilter.call(this) !== THEME_FILTER) {
      // An element drawn without the theme on an in-canvas themed render: the renderer changed.
      themeLostListeners.get(this)?.();
    }
    if (!trueColorCanvases.has(src)) return drawImage.apply(this, args);
    // Patch 2: true-colour image canvas.
    const prev = getFilter.call(this);
    if (themed) stats.exactDraws++;
    else stats.correctedDraws++;
    setFilter.call(this, themed ? "none" : IMAGE_INVERT_FILTER);
    try {
      return drawImage.apply(this, args);
    } finally {
      setFilter.call(this, prev);
    }
  } as typeof proto.drawImage;
}
