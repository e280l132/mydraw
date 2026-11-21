import { MIME_TYPES, exportToBlob, exportToCanvas, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawFrameLikeElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { buildHtml } from "../../shared/htmlExport";
import { inventoryRows, toCsv, toMarkdownTable } from "../../shared/inventory";
import { toMermaid } from "../../shared/mermaidWriter";
import { extractGraph, type SceneEl } from "../../shared/sceneGraph";
import type { ExportExtension } from "../../shared/types";

export type ExportFormat = "png" | "jpg" | "webp" | "svg" | "html" | "mermaid" | "csv" | "markdown";
export const EXPORT_FORMATS: readonly ExportFormat[] = ["png", "jpg", "webp", "svg", "html", "mermaid", "csv", "markdown"];
/** Formats that are text built from the diagram's structure, not a picture. */
export const TEXT_FORMATS: readonly ExportFormat[] = ["mermaid", "csv", "markdown"];

export const FORMAT_EXTENSION: Record<ExportFormat, ExportExtension> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
  svg: "svg",
  html: "html",
  mermaid: "mmd",
  csv: "csv",
  markdown: "md",
};

export type ExportScope = "all" | "selection" | "frame" | "frames";

export interface ExportOptions {
  format: ExportFormat;
  /** whole drawing / selection / one frame (`frameId`) / every frame (one file each, see renderFrameExports). */
  scope: ExportScope;
  /** Frame id (or name) for scope "frame". */
  frameId?: string;
  scale: 1 | 2 | 3 | 4;
  padding: number;
  background: boolean;
  darkMode: boolean;
  /** 0.1 - 1, JPG and WebP. */
  quality: number;
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
  quality: 0.92,
  embedScene: false,
};

type Live = NonDeleted<ExcalidrawElement>;

export interface FrameInfo {
  id: string;
  name: string;
}

/** Frames in reading order, named like Excalidraw shows them ("Frame 1" when unnamed). */
export function listFrames(api: ExcalidrawImperativeAPI): FrameInfo[] {
  const frames = (api.getSceneElements() as Live[]).filter((e) => e.type === "frame" || e.type === "magicframe");
  frames.sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x);
  return frames.map((f, i) => ({ id: f.id, name: (f as { name?: string | null }).name?.trim() || `Frame ${i + 1}` }));
}

/** Find a frame by id, exact name or case-insensitive name. */
export function findFrame(api: ExcalidrawImperativeAPI, ref: string): FrameInfo {
  const frames = listFrames(api);
  const hit =
    frames.find((f) => f.id === ref) ?? frames.find((f) => f.name === ref) ?? frames.find((f) => f.name.toLowerCase() === ref.toLowerCase());
  if (!hit) {
    throw new Error(frames.length ? `no frame "${ref}" (frames: ${frames.map((f) => f.name).join(", ")})` : "the drawing has no frames");
  }
  return hit;
}

function frameElements(all: readonly Live[], frameId: string): { frame: ExcalidrawFrameLikeElement; elements: Live[] } {
  const frame = all.find((e) => e.id === frameId) as ExcalidrawFrameLikeElement | undefined;
  if (!frame) throw new Error(`no frame with id "${frameId}"`);
  const inside = new Set(all.filter((e) => e.frameId === frameId).map((e) => e.id));
  const elements = all.filter(
    (e) => e.id === frameId || inside.has(e.id) || ("containerId" in e && e.containerId != null && inside.has(e.containerId)),
  );
  return { frame, elements };
}

/**
 * Elements to export: everything, the selection (or the elements in `ids`) plus text bound to
 * those shapes, or one frame with what is in it.
 */
export function exportElements(
  api: ExcalidrawImperativeAPI,
  scope: ExportOptions["scope"],
  ids?: ReadonlySet<string>,
  frameId?: string,
): Live[] {
  const all = api.getSceneElements() as Live[];
  if (scope === "frame") return frameElements(all, findFrame(api, frameId ?? "").id).elements;
  if ((scope === "all" || scope === "frames") && !ids) return all;
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
  extension: ExportExtension;
  mime: string;
}

const MIME: Record<ExportExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  html: "text/html",
  mmd: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
};

function sceneBounds(els: readonly Live[]): { width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of els) {
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.width);
    maxY = Math.max(maxY, e.y + e.height);
  }
  return els.length ? { width: maxX - minX, height: maxY - minY } : { width: 0, height: 0 };
}

/** Text exports (Mermaid, CSV, Markdown table) of the given elements. */
export function renderTextExport(format: ExportFormat, elements: readonly Live[]): string {
  const graph = extractGraph(elements as unknown as SceneEl[]);
  if (format === "mermaid") {
    if (!graph.nodes.length) throw new Error("no nodes to export: Mermaid needs labelled shapes or icon nodes");
    const nodeEls = elements.filter((e) => graph.nodes.some((n) => n.id === e.id));
    return toMermaid(graph, { bounds: sceneBounds(nodeEls) });
  }
  const rows = inventoryRows(graph);
  if (!rows.length) throw new Error("no nodes to export: the inventory needs labelled shapes or icon nodes");
  return format === "csv" ? toCsv(rows) : toMarkdownTable(rows);
}

export async function renderExport(
  api: ExcalidrawImperativeAPI,
  opts: ExportOptions,
  previewMaxSize?: number,
  ids?: ReadonlySet<string>,
): Promise<RenderedExport> {
  const all = api.getSceneElements() as Live[];
  const framed = opts.scope === "frame" ? frameElements(all, findFrame(api, opts.frameId ?? "").id) : null;
  const elements = framed ? framed.elements : exportElements(api, opts.scope, ids);
  return renderElements(api, opts, elements, framed?.frame ?? null, previewMaxSize);
}

async function renderElements(
  api: ExcalidrawImperativeAPI,
  opts: ExportOptions,
  elements: Live[],
  exportingFrame: ExcalidrawFrameLikeElement | null,
  previewMaxSize?: number,
): Promise<RenderedExport> {
  const extension = FORMAT_EXTENSION[opts.format];
  const preview = previewMaxSize != null;
  if (TEXT_FORMATS.includes(opts.format)) {
    return { data: renderTextExport(opts.format, elements), extension, mime: MIME[extension] };
  }
  const isJpg = opts.format === "jpg";
  const appState = {
    ...api.getAppState(),
    // JPG has no transparency, so it always gets a background.
    exportBackground: opts.background || isJpg,
    exportWithDarkMode: opts.darkMode,
    exportEmbedScene: opts.embedScene && (opts.format === "png" || opts.format === "svg") && !preview,
    exportScale: opts.scale,
  };
  const files = api.getFiles();
  const common = { elements, appState, files, exportPadding: opts.padding, exportingFrame };

  if ((opts.format === "svg" || opts.format === "html") && !preview) {
    const svg = await exportToSvg(common);
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${svg.outerHTML}`;
    if (opts.format === "svg") return { data: text, extension, mime: MIME.svg };
    const html = buildHtml({
      title: (exportingFrame as { name?: string } | null)?.name || "mydraw diagram",
      svg: text,
      dark: opts.darkMode,
      background: opts.background && !opts.darkMode ? api.getAppState().viewBackgroundColor : undefined,
    });
    return { data: html, extension, mime: MIME.html };
  }

  const dims = preview
    ? { maxWidthOrHeight: previewMaxSize }
    : { getDimensions: (w: number, h: number) => ({ width: w * opts.scale, height: h * opts.scale, scale: opts.scale }) };

  if (opts.format === "webp" && !preview) {
    const canvas = await exportToCanvas({ ...common, ...dims });
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/webp", opts.quality));
    if (!blob || blob.type !== "image/webp") throw new Error("this build cannot encode WebP");
    return { data: await blob.arrayBuffer(), extension, mime: MIME.webp };
  }

  const blob = await exportToBlob({
    ...common,
    ...dims,
    mimeType: isJpg && !preview ? MIME_TYPES.jpg : MIME_TYPES.png,
    quality: opts.quality,
  });
  // Previews are always PNG, whatever the chosen format.
  const out = preview ? FORMAT_EXTENSION.png : extension;
  return { data: await blob.arrayBuffer(), extension: out, mime: MIME[out] };
}

/** One export per frame, named by the frame. Frames without content are skipped. */
export async function renderFrameExports(
  api: ExcalidrawImperativeAPI,
  opts: ExportOptions,
): Promise<{ name: string; extension: ExportExtension; data: ArrayBuffer | string }[]> {
  const all = api.getSceneElements() as Live[];
  const out: { name: string; extension: ExportExtension; data: ArrayBuffer | string }[] = [];
  for (const f of listFrames(api)) {
    const { frame, elements } = frameElements(all, f.id);
    if (elements.length < 2 && !TEXT_FORMATS.includes(opts.format)) continue; // an empty frame is not worth a file
    try {
      const r = await renderElements(api, opts, elements, frame, undefined);
      out.push({ name: f.name, extension: r.extension, data: r.data });
    } catch (e) {
      // Text exports of a frame with no nodes: skip, the other frames still export.
      if (!TEXT_FORMATS.includes(opts.format)) throw e;
    }
  }
  if (!out.length) throw new Error(listFrames(api).length ? "nothing to export: the frames are empty" : "the drawing has no frames");
  return out;
}

export type ClipboardKind = "png" | "svg" | "mermaid";

/** Content for the clipboard: the selection if there is one, else the whole drawing. */
export async function renderClipboard(
  api: ExcalidrawImperativeAPI,
  kind: ClipboardKind,
  base: ExportOptions = DEFAULT_EXPORT_OPTIONS,
): Promise<{ text?: string; png?: ArrayBuffer }> {
  const opts: ExportOptions = {
    ...base,
    scope: hasSelection(api) ? "selection" : "all",
    format: kind === "mermaid" ? "mermaid" : kind,
    embedScene: false,
  };
  if (!exportElements(api, opts.scope).length) throw new Error("nothing to copy: the drawing is empty");
  const out = await renderExport(api, opts);
  return kind === "png" ? { png: out.data as ArrayBuffer } : { text: out.data as string };
}
