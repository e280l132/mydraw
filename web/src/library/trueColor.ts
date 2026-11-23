// Keep SVG icons in their real colors in dark mode.
//
// Excalidraw's dark theme inverts the whole canvas with a CSS filter. For raster images it
// pre-inverts them (so photos look normal), but it skips that for files whose mimeType is exactly
// "image/svg+xml", treating SVGs as line drawings that should flip with the theme. Stencil icons
// have real brand/device colors, so we tag their files with a parameterised SVG MIME type. The file
// is still an SVG (the data URL says image/svg+xml), but Excalidraw now treats it as an image:
// dark exports draw it unfiltered (exact colours), and on screen web/src/darkImages.ts +
// canvasHook.ts draw it unfiltered too (Excalidraw's own on-screen correction is approximate).
import type { BinaryFileData, BinaryFiles, DataURL } from "@excalidraw/excalidraw/types";
import { ensureSvgSize, svgFromDataURL, svgToDataURL } from "../../../shared/recolor";

export const TRUE_COLOR_SVG_MIME = "image/svg+xml;mydraw=truecolor" as BinaryFileData["mimeType"];

export function isSvgDataURL(dataURL: string): boolean {
  return /^data:image\/svg\+xml[;,]/i.test(dataURL);
}

/**
 * Tag SVG files so Excalidraw keeps their colors in dark mode, and make sure they have an
 * intrinsic size (see ensureSvgSize). Returns new objects only when needed.
 */
export function trueColorFile<T extends BinaryFileData>(file: T): T {
  if (!isSvgDataURL(file.dataURL)) return file;
  let dataURL = file.dataURL;
  try {
    const svg = svgFromDataURL(dataURL);
    const sized = ensureSvgSize(svg);
    if (sized !== svg) dataURL = svgToDataURL(sized) as DataURL;
  } catch {
    // leave unreadable data as is
  }
  if (file.mimeType === TRUE_COLOR_SVG_MIME && dataURL === file.dataURL) return file;
  return { ...file, mimeType: TRUE_COLOR_SVG_MIME, dataURL };
}

export function trueColorFiles(files: BinaryFiles): BinaryFiles {
  return Object.fromEntries(Object.entries(files).map(([id, f]) => [id, trueColorFile(f)]));
}
