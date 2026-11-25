// Previews of an icon in each hand-drawn style, for the Icon style window, the style panel row and the
// Stencils panel's style menu. A preview is a data URL of the real sketched picture (the same code that
// makes the icon's file), computed lazily and cached.
import { useEffect, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { sketchKey, type IconSketch } from "../../../shared/iconSketch";
import { ensureSvgSize, recolorSvg, svgFromDataURL, svgToDataURL } from "../../../shared/recolor";
import { sketchRasterDataURL, sketchSvgCached } from "./sketchIcon";
import { isSvgDataURL } from "./trueColor";

/** What a preview is drawn from: an SVG document or a raster data URL. */
export type IconSource = { kind: "svg"; svg: string } | { kind: "raster"; dataURL: string };

/** A small multi-colour server icon: what new icons will look like, when nothing is selected. */
export const SAMPLE_ICON: IconSource = {
  kind: "svg",
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">' +
    '<rect x="4" y="6" width="40" height="36" rx="6" fill="#4dabf7"/>' +
    '<rect x="10" y="12" width="28" height="9" rx="2" fill="#ffffff"/>' +
    '<rect x="10" y="27" width="28" height="9" rx="2" fill="#ffffff"/>' +
    '<circle cx="32" cy="16.5" r="2.4" fill="#2f9e44"/>' +
    '<circle cx="32" cy="31.5" r="2.4" fill="#f08c00"/>' +
    "</svg>",
};

/** The original picture of an image element, with its recolor applied (what a sketch is drawn from). */
export function iconSource(el: ExcalidrawElement, files: BinaryFiles): IconSource | null {
  if (el.type !== "image" || !el.fileId) return null;
  const file = files[el.fileId];
  const custom = el.customData ?? {};
  const raster = custom.mydrawOriginalImage as string | undefined;
  if (raster) return { kind: "raster", dataURL: raster };
  if (!file) return null;
  if (!isSvgDataURL(file.dataURL)) return { kind: "raster", dataURL: file.dataURL };
  const stored = custom.mydrawOriginalSvg as string | undefined;
  // Without a stored original and without a sketch, the file is the original (maybe recolored).
  if (!stored && custom.mydrawIconSketch) return null;
  let svg = ensureSvgSize(stored ?? svgFromDataURL(file.dataURL));
  const color = custom.mydrawIconColor as string | undefined;
  if (stored && color) svg = recolorSvg(svg, color);
  return { kind: "svg", svg };
}

const cache = new Map<string, Promise<string>>();
const CACHE_MAX = 400;

function sourceKey(s: IconSource): string {
  return s.kind === "svg" ? s.svg : s.dataURL;
}

/** Data URL of `source` drawn with `sketch` (null = as it is). */
export function previewURL(source: IconSource, sketch: IconSketch | null): Promise<string> {
  const key = `${sketchKey(sketch)}|${sourceKey(source)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      if (!sketch) return source.kind === "svg" ? svgToDataURL(source.svg) : source.dataURL;
      if (source.kind === "raster") return svgToDataURL(await sketchRasterDataURL(source.dataURL, sketch));
      return svgToDataURL(sketchSvgCached(source.svg, sketch));
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/**
 * Previews of one source in several styles: `{name: sketch|null}` → `{name: dataURL}`. Fills in as
 * they are made (one at a time, so the UI stays responsive).
 */
export function useIconPreviews(source: IconSource | null, styles: Record<string, IconSketch | null>): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = source ? `${sourceKey(source).length}:${sourceKey(source).slice(0, 200)}|${Object.entries(styles).map(([k, s]) => `${k}=${sketchKey(s)}`).join(",")}` : "";
  useEffect(() => {
    if (!source) {
      setUrls({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const out: Record<string, string> = {};
      for (const [name, s] of Object.entries(styles)) {
        try {
          out[name] = await previewURL(source, s);
        } catch {
          continue;
        }
        if (cancelled) return;
        setUrls({ ...out });
        // Let the browser paint between sketches.
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}
