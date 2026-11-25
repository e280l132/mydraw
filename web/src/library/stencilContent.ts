// Turning library items into Excalidraw elements and inserting them into a drawing.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  getCommonBounds,
  loadLibraryFromBlob,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
  LibraryItems,
} from "@excalidraw/excalidraw/types";
import { libraryFileUrl, type LibraryItem, type StencilFile } from "../../../shared/library";
import { ensureSvgSize } from "../../../shared/recolor";
import { sketchKey, type IconSketch } from "../../../shared/iconSketch";
import { restyledIcon } from "./iconColor";
import { TRUE_COLOR_SVG_MIME, trueColorFile } from "./trueColor";

export interface StencilContent {
  elements: ExcalidrawElement[];
  files: BinaryFileData[];
}

export interface LabelOptions {
  label: boolean;
  fontFamily: number;
  strokeColor: string;
  /** Draw the stencil by hand (shared/sketchSvg.ts); null/absent = as saved. */
  sketch?: IconSketch | null;
}

/** Icons are inserted at this size (longest side), keeping their aspect ratio. */
export const ICON_SIZE = 64;

const contentCache = new Map<string, Promise<StencilContent>>();
const xlibCache = new Map<string, Promise<LibraryItems>>();

async function fetchLibraryFile(file: string, mtime: number): Promise<Blob> {
  const res = await fetch(`${libraryFileUrl(file)}?v=${mtime}`);
  if (!res.ok) throw new Error(`could not read ${file} (${res.status})`);
  return res.blob();
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function sha1Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function imageSize(dataURL: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  return { w: img.naturalWidth || ICON_SIZE, h: img.naturalHeight || ICON_SIZE };
}

/** Fit an icon so its height is ICON_SIZE; wide logos may grow up to 2.5x wider. */
export function iconDimensions(w: number, h: number): { width: number; height: number } {
  const aspect = w / h || 1;
  if (aspect <= 1) return { width: Math.round(ICON_SIZE * aspect), height: ICON_SIZE };
  const width = Math.min(ICON_SIZE * aspect, ICON_SIZE * 2.5);
  return { width: Math.round(width), height: Math.round(width / aspect) };
}

const randomId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const randomInt = () => Math.floor(Math.random() * 2 ** 31);

async function loadIcon(item: LibraryItem, opts: LabelOptions): Promise<StencilContent> {
  const raw = await fetchLibraryFile(item.file, item.mtime);
  let bytes = await raw.arrayBuffer();
  if (item.kind === "svg") {
    // Icons need an intrinsic size or image export crops them (see ensureSvgSize).
    bytes = new TextEncoder().encode(ensureSvgSize(new TextDecoder().decode(bytes))).buffer as ArrayBuffer;
  }
  const mimeType = item.kind === "png" ? "image/png" : "image/svg+xml";
  const dataURL = await blobToDataURL(new Blob([bytes], { type: mimeType }));
  const fileId = (await sha1Hex(bytes)) as FileId;
  const { w, h } = await imageSize(dataURL);
  const { width, height } = iconDimensions(w, h);

  const groupId = randomId();
  const [image] = convertToExcalidrawElements([{ type: "image", fileId, x: 0, y: 0, width, height }]);
  const elements: ExcalidrawElement[] = [{ ...image, status: "saved", groupIds: [groupId] } as ExcalidrawElement];
  if (opts.label) {
    const [text] = convertToExcalidrawElements([
      {
        type: "text",
        x: 0,
        y: height + 6,
        text: item.name,
        fontSize: 14,
        fontFamily: opts.fontFamily as never,
        strokeColor: opts.strokeColor,
        textAlign: "center",
      },
    ]);
    elements.push({ ...text, x: (width - text.width) / 2, groupIds: [groupId] } as ExcalidrawElement);
  }
  const now = Date.now();
  return {
    elements,
    files: [
      {
        id: fileId,
        dataURL: dataURL as DataURL,
        mimeType: item.kind === "png" ? "image/png" : TRUE_COLOR_SVG_MIME,
        created: now,
        lastRetrieved: now,
      },
    ],
  };
}

async function loadXlibItems(item: LibraryItem): Promise<LibraryItems> {
  const key = `${item.file}@${item.mtime}`;
  let p = xlibCache.get(key);
  if (!p) {
    p = fetchLibraryFile(item.file, item.mtime).then((blob) => loadLibraryFromBlob(blob, "unpublished"));
    xlibCache.set(key, p);
  }
  return p;
}

async function loadUncached(item: LibraryItem, opts: LabelOptions): Promise<StencilContent> {
  switch (item.kind) {
    case "svg":
    case "png":
      return loadIcon(item, opts);
    case "stencil": {
      const data = JSON.parse(await (await fetchLibraryFile(item.file, item.mtime)).text()) as StencilFile;
      return {
        elements: data.elements as ExcalidrawElement[],
        files: (Object.values(data.files ?? {}) as BinaryFileData[]).map(trueColorFile),
      };
    }
    case "xlib": {
      const items = await loadXlibItems(item);
      const li = items[item.index ?? 0];
      if (!li) throw new Error("library item not found");
      return { elements: li.elements as ExcalidrawElement[], files: [] };
    }
  }
}

/** Shapes drawn by Excalidraw itself: hand-drawn = roughness 1, like Sketch style. */
const ROUGH_TYPES = new Set(["rectangle", "ellipse", "diamond", "line", "arrow"]);

/**
 * Stencil content drawn by hand: images (icons) are redrawn (restyledIcon keeps the original in
 * customData, so the style panel can switch back), Excalidraw shapes get roughness 1.
 */
export async function sketchContent(content: StencilContent, sketch: IconSketch): Promise<StencilContent> {
  const files = new Map(content.files.map((f) => [f.id as string, f]));
  const elements: ExcalidrawElement[] = [];
  for (const el of content.elements) {
    if (el.type === "image" && el.fileId && files.has(el.fileId)) {
      const r = await restyledIcon(el, files.get(el.fileId)!, { sketch });
      if (r) {
        if (r.file) files.set(r.file.id, r.file);
        elements.push(r.element);
        continue;
      }
    }
    elements.push(ROUGH_TYPES.has(el.type) && el.roughness === 0 ? ({ ...el, roughness: 1 } as ExcalidrawElement) : el);
  }
  const used = new Set(elements.map((e) => (e.type === "image" ? e.fileId : null)).filter(Boolean));
  return { elements, files: [...files.values()].filter((f) => used.has(f.id)) };
}


/** Load (and cache) the elements and image files for a library item. */
export function loadStencil(item: LibraryItem, opts: LabelOptions): Promise<StencilContent> {
  const key = `${item.id}@${item.mtime}:${opts.label ? 1 : 0}:${opts.fontFamily}:${opts.strokeColor}:${sketchKey(opts.sketch)}`;
  let p = contentCache.get(key);
  if (!p) {
    const sketch = opts.sketch;
    p = sketch ? loadUncached(item, opts).then((c) => sketchContent(c, sketch)) : loadUncached(item, opts);
    contentCache.set(key, p);
    p.catch(() => contentCache.delete(key));
  }
  return p;
}

/**
 * Copy elements with fresh ids (and fresh group ids), keeping links between them
 * (bound text, arrow bindings, frames) and dropping links to elements outside the set.
 */
export function cloneForInsert(elements: readonly ExcalidrawElement[]): ExcalidrawElement[] {
  const live = elements.filter((e) => !e.isDeleted);
  const ids = new Map(live.map((e) => [e.id, randomId()]));
  const groups = new Map<string, string>();
  const group = (g: string) => {
    if (!groups.has(g)) groups.set(g, randomId());
    return groups.get(g)!;
  };
  const now = Date.now();
  return live.map((el) => {
    const e = el as ExcalidrawElement & Record<string, unknown>;
    const copy: Record<string, unknown> = {
      ...e,
      id: ids.get(el.id)!,
      groupIds: el.groupIds.map(group),
      seed: randomInt(),
      versionNonce: randomInt(),
      version: 1,
      updated: now,
      index: null,
      frameId: el.frameId && ids.has(el.frameId) ? ids.get(el.frameId) : null,
      boundElements:
        el.boundElements?.filter((b) => ids.has(b.id)).map((b) => ({ ...b, id: ids.get(b.id)! })) ?? null,
    };
    if ("containerId" in e) copy.containerId = e.containerId && ids.has(e.containerId as string) ? ids.get(e.containerId as string) : null;
    for (const key of ["startBinding", "endBinding"] as const) {
      const b = e[key] as { elementId: string } | null | undefined;
      if (b) copy[key] = ids.has(b.elementId) ? { ...b, elementId: ids.get(b.elementId) } : null;
    }
    return copy as unknown as ExcalidrawElement;
  });
}

/** Scene coordinates of the middle of the visible canvas. */
export function viewportCenter(appState: AppState): { x: number; y: number } {
  return {
    x: appState.width / 2 / appState.zoom.value - appState.scrollX,
    y: appState.height / 2 / appState.zoom.value - appState.scrollY,
  };
}

/** Insert stencil content centred on `at` (scene coords; default: middle of the view) and select it. */
export function insertStencil(
  api: ExcalidrawImperativeAPI,
  content: StencilContent,
  at?: { x: number; y: number },
): ExcalidrawElement[] {
  if (content.files.length) api.addFiles(content.files);
  const cloned = cloneForInsert(content.elements);
  if (!cloned.length) return [];
  const [minX, minY, maxX, maxY] = getCommonBounds(cloned);
  const target = at ?? viewportCenter(api.getAppState());
  const dx = target.x - (minX + maxX) / 2;
  const dy = target.y - (minY + maxY) / 2;
  const placed = cloned.map((el) => ({ ...el, x: el.x + dx, y: el.y + dy }) as ExcalidrawElement);

  const selectedGroupIds: Record<string, boolean> = {};
  for (const el of placed) if (el.groupIds.length) selectedGroupIds[el.groupIds[el.groupIds.length - 1]] = true;
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...placed],
    appState: {
      selectedElementIds: Object.fromEntries(placed.map((e) => [e.id, true])),
      selectedGroupIds,
    } as Partial<AppState> as AppState,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return placed;
}

/** The current selection (plus text bound inside selected shapes) and the image files it uses. */
export function selectionForStencil(api: ExcalidrawImperativeAPI): StencilContent & { suggestedName: string } {
  const selected = api.getAppState().selectedElementIds;
  const all = api.getSceneElements();
  const elements = all.filter(
    (el) => selected[el.id] || ("containerId" in el && el.containerId != null && selected[el.containerId]),
  );
  const files = api.getFiles();
  const used: BinaryFileData[] = [];
  for (const el of elements) {
    if (el.type === "image" && el.fileId && files[el.fileId]) used.push(files[el.fileId]);
  }
  const text = elements.find((e) => e.type === "text") as { text?: string } | undefined;
  const suggestedName = (text?.text ?? "").split("\n")[0].trim().slice(0, 40) || "Stencil";
  return { elements: JSON.parse(JSON.stringify(elements)), files: used, suggestedName };
}
