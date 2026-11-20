import { MIME_TYPES, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type ExportFormat = "png" | "jpg" | "svg";

export interface ExportOptions {
  format: ExportFormat;
  scope: "all" | "selection";
  scale: 1 | 2 | 3 | 4;
  padding: number;
  background: boolean;
  darkMode: boolean;
  /** 0.1 - 1, JPG only. */
  jpgQuality: number;
  /** Embed the editable scene in PNG/SVG metadata so the image can be reopened. */
  embedScene: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "png",
  scope: "all",
  scale: 2,
  padding: 20,
  background: true,
  darkMode: false,
  jpgQuality: 0.92,
  embedScene: false,
};

/**
 * Elements to export: everything, or the selection (or the elements in `ids`) plus text bound to
 * those shapes.
 */
export function exportElements(
  api: ExcalidrawImperativeAPI,
  scope: ExportOptions["scope"],
  ids?: ReadonlySet<string>,
): NonDeleted<ExcalidrawElement>[] {
  const all = api.getSceneElements() as NonDeleted<ExcalidrawElement>[];
  if (scope === "all" && !ids) return all;
  const selected: Record<string, boolean> = ids
    ? Object.fromEntries([...ids].map((id) => [id, true]))
    : api.getAppState().selectedElementIds;
  return all.filter(
    (el) => selected[el.id] || ("containerId" in el && el.containerId != null && selected[el.containerId]),
  );
}

export function hasSelection(api: ExcalidrawImperativeAPI): boolean {
  return Object.values(api.getAppState().selectedElementIds).some(Boolean);
}

export interface RenderedExport {
  data: ArrayBuffer | string;
  extension: ExportFormat;
}

export async function renderExport(
  api: ExcalidrawImperativeAPI,
  opts: ExportOptions,
  previewMaxSize?: number,
  ids?: ReadonlySet<string>,
): Promise<RenderedExport> {
  const elements = exportElements(api, opts.scope, ids);
  const isJpg = opts.format === "jpg";
  const appState = {
    ...api.getAppState(),
    // JPG has no transparency, so it always gets a background.
    exportBackground: opts.background || isJpg,
    exportWithDarkMode: opts.darkMode,
    exportEmbedScene: opts.embedScene && !isJpg && previewMaxSize == null,
    exportScale: opts.scale,
  };
  const files = api.getFiles();

  if (opts.format === "svg" && previewMaxSize == null) {
    const svg = await exportToSvg({ elements, appState, files, exportPadding: opts.padding });
    return { data: `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}`, extension: "svg" };
  }

  const blob = await exportToBlob({
    elements,
    appState,
    files,
    exportPadding: opts.padding,
    mimeType: isJpg ? MIME_TYPES.jpg : MIME_TYPES.png,
    quality: opts.jpgQuality,
    ...(previewMaxSize != null
      ? { maxWidthOrHeight: previewMaxSize }
      : { getDimensions: (w: number, h: number) => ({ width: w * opts.scale, height: h * opts.scale, scale: opts.scale }) }),
  });
  return { data: await blob.arrayBuffer(), extension: opts.format };
}
