// Recoloring icons (stencils) on the canvas and drawing them by hand (shared/sketchSvg.ts).
// Excalidraw can't style image elements, so we rewrite the SVG, store it as a new file and point the
// element at it. The original is kept in the element's customData so "Original" restores it and
// styles never compound.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from "@excalidraw/excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { ensureSvgSize, recolorSvg, svgFromDataURL, svgToDataURL } from "../../../shared/recolor";
import { type IconSketch, storedIconSketch } from "../../../shared/sketchSvg";
import { sketchRasterDataURL, sketchSvgCached } from "./sketchIcon";
import { TRUE_COLOR_SVG_MIME, isSvgDataURL } from "./trueColor";

const ORIGINAL_KEY = "mydrawOriginalSvg";
const COLOR_KEY = "mydrawIconColor";
/** Hand-drawn settings (shared/sketchSvg.ts IconSketch). */
export const SKETCH_KEY = "mydrawIconSketch";
/** The original data URL of a raster icon drawn by hand (its file is then a wobble SVG). */
const ORIGINAL_IMAGE_KEY = "mydrawOriginalImage";
/** Larger originals are not stored (recoloring then works from the current version). */
const MAX_STORED_ORIGINAL = 256 * 1024;
/** Larger raster originals are not drawn by hand (they could not be restored). */
const MAX_STORED_ORIGINAL_IMAGE = 512 * 1024;

export interface IconSelection {
  /** Selected SVG images that can be recolored. */
  count: number;
  /** Raster images in the selection (PNG/JPG) that can't be recolored. */
  raster: number;
  /** The shared color of the selected icons, "original" if none recolored, or null if mixed. */
  color: string | "original" | null;
}

export const NO_ICONS: IconSelection = { count: 0, raster: 0, color: null };

function isSvgFile(files: BinaryFiles, el: ExcalidrawImageElement): boolean {
  const file = el.fileId ? files[el.fileId] : undefined;
  return !!file && isSvgDataURL(file.dataURL);
}

/** Summarise the selected images, for the color bar. */
export function iconSelection(
  elements: readonly ExcalidrawElement[],
  appState: Pick<AppState, "selectedElementIds">,
  files: BinaryFiles,
): IconSelection {
  let count = 0;
  let raster = 0;
  const colors = new Set<string>();
  for (const el of elements) {
    if (el.type !== "image" || el.isDeleted || !appState.selectedElementIds[el.id]) continue;
    if (isSvgFile(files, el)) {
      count++;
      colors.add((el.customData?.[COLOR_KEY] as string | undefined) ?? "original");
    } else if (el.fileId) {
      raster++;
    }
  }
  return { count, raster, color: colors.size === 1 ? [...colors][0] : null };
}

async function sha1Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-1", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function dataURLBytes(dataURL: string): Uint8Array {
  const comma = dataURL.indexOf(",");
  const meta = dataURL.slice(0, comma);
  const body = dataURL.slice(comma + 1);
  if (/;base64$/i.test(meta)) return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(body));
}

/** What to change: undefined keeps the current value, null removes it. */
export interface IconStylePatch {
  color?: string | null;
  sketch?: IconSketch | null;
}

/** The hand-drawn settings of an image element, or null. */
export function iconSketchOf(el: ExcalidrawElement): IconSketch | null {
  return storedIconSketch(el.customData?.[SKETCH_KEY]);
}

/**
 * An icon element restyled: recolored and/or hand-drawn, always rendered from the original SVG (or
 * PNG) kept in customData, so styles never compound. Returns a new element pointing at a new file
 * (null file = the file already exists), or null when the icon can't take the change (a raster
 * icon's color, an original too big to keep).
 */
export async function restyledIcon(
  el: ExcalidrawImageElement,
  file: BinaryFileData,
  patch: IconStylePatch,
): Promise<{ element: ExcalidrawElement; file: BinaryFileData | null } | null> {
  const custom = { ...(el.customData ?? {}) };
  const rasterOriginal = custom[ORIGINAL_IMAGE_KEY] as string | undefined;
  const raster = !!rasterOriginal || !isSvgDataURL(file.dataURL);
  const sketch = patch.sketch !== undefined ? patch.sketch : storedIconSketch(custom[SKETCH_KEY]);
  const now = Date.now();
  let dataURL: string;
  let mimeType: BinaryFileData["mimeType"];
  let id: FileId;

  if (raster) {
    if (patch.color) return null;
    const original = rasterOriginal ?? file.dataURL;
    if (sketch) {
      if (original.length > MAX_STORED_ORIGINAL_IMAGE) return null;
      const svg = await sketchRasterDataURL(original, sketch);
      dataURL = svgToDataURL(svg);
      mimeType = TRUE_COLOR_SVG_MIME;
      id = (await sha1Hex(svg)) as FileId;
      custom[ORIGINAL_IMAGE_KEY] = original;
      custom[SKETCH_KEY] = sketch;
    } else {
      dataURL = original;
      mimeType = (original.match(/^data:([^;,]+)/)?.[1] ?? "image/png") as BinaryFileData["mimeType"];
      id = (await sha1Hex(dataURLBytes(original))) as FileId;
      delete custom[ORIGINAL_IMAGE_KEY];
      delete custom[SKETCH_KEY];
    }
  } else {
    const stored = custom[ORIGINAL_KEY] as string | undefined;
    // Without a stored original the current file IS the original (nothing applied yet).
    if (!stored && custom[SKETCH_KEY]) return null;
    const original = ensureSvgSize(stored ?? svgFromDataURL(file.dataURL));
    const color = patch.color !== undefined ? patch.color : ((custom[COLOR_KEY] as string | undefined) ?? null);
    if (sketch && original.length > MAX_STORED_ORIGINAL) return null;
    let svg = color ? recolorSvg(original, color) : original;
    if (sketch) svg = sketchSvgCached(svg, sketch);
    dataURL = svgToDataURL(svg);
    mimeType = TRUE_COLOR_SVG_MIME;
    id = (await sha1Hex(svg)) as FileId;
    if ((color || sketch) && original.length <= MAX_STORED_ORIGINAL) custom[ORIGINAL_KEY] = original;
    else delete custom[ORIGINAL_KEY];
    if (color) custom[COLOR_KEY] = color;
    else delete custom[COLOR_KEY];
    if (sketch) custom[SKETCH_KEY] = sketch;
    else delete custom[SKETCH_KEY];
  }
  const newFile = id !== el.fileId ? { id, dataURL: dataURL as DataURL, mimeType, created: now, lastRetrieved: now } : null;
  return { element: newElementWith(el, { fileId: id, status: "saved", customData: custom }), file: newFile };
}

/**
 * The recolored version of one SVG icon element: a new element pointing at a new file (or the
 * original file when `color` is null). Keeps a hand-drawn style. Throws for icons that can't be
 * recolored.
 */
export async function recoloredIcon(
  el: ExcalidrawImageElement,
  file: BinaryFileData,
  color: string | null,
): Promise<{ element: ExcalidrawElement; file: BinaryFileData | null }> {
  const r = await restyledIcon(el, file, { color });
  if (!r) throw new Error("this icon can't be recolored (raster image, or its original SVG is too big to keep)");
  return r;
}

/** Whether an element is an SVG icon that can be recolored (a wobbled PNG is still a raster). */
export function isRecolorableIcon(el: ExcalidrawElement, files: BinaryFiles): el is ExcalidrawImageElement {
  return el.type === "image" && !el.isDeleted && isSvgFile(files, el) && !el.customData?.[ORIGINAL_IMAGE_KEY];
}

/** Whether an element is an icon (SVG or raster image) that can be drawn by hand. */
export function isSketchableIcon(el: ExcalidrawElement, files: BinaryFiles): el is ExcalidrawImageElement {
  return el.type === "image" && !el.isDeleted && !!el.fileId && !!files[el.fileId];
}

export type IconPatchFor = IconStylePatch | ((el: ExcalidrawImageElement) => IconStylePatch | null);

/**
 * Restyle the selected icons (or the icons in `ids`): recolor and/or draw by hand. `patch` may be a
 * function, for changes that depend on each icon (keep its seed, a new seed each). With `preview`,
 * the change is shown but not recorded in undo history (see IconRecolorSession for how a drag
 * becomes one undo step). Returns how many icons changed.
 */
export async function restyleIcons(
  api: ExcalidrawImperativeAPI,
  patch: IconPatchFor,
  preview = false,
  ids?: ReadonlySet<string>,
): Promise<number> {
  const appState = api.getAppState();
  const files = api.getFiles();
  const all = api.getSceneElementsIncludingDeleted();
  const updates = new Map<string, ExcalidrawElement>();
  const newFiles = new Map<string, BinaryFileData>();
  const colorOnly = typeof patch !== "function" && patch.color !== undefined && patch.sketch === undefined;

  for (const el of all) {
    if (!(ids ? ids.has(el.id) : appState.selectedElementIds[el.id])) continue;
    if (el.type !== "image" || !(colorOnly ? isRecolorableIcon(el, files) : isSketchableIcon(el, files))) continue;
    const p = typeof patch === "function" ? patch(el) : patch;
    if (!p) continue;
    const r = await restyledIcon(el, files[el.fileId!], p);
    if (!r) continue;
    if (r.file) newFiles.set(r.file.id, r.file);
    updates.set(el.id, r.element);
  }
  if (!updates.size) return 0;

  // Decode first so Excalidraw's own image load (below) is served from the browser's cache.
  await Promise.all(
    [...newFiles.values()].map((f) => {
      const img = new Image();
      img.src = f.dataURL;
      return img.decode().catch(() => undefined);
    }),
  );
  api.updateScene({
    elements: all.map((el) => updates.get(el.id) ?? el),
    captureUpdate: preview ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY,
  });
  // Add the files after the elements point at them: Excalidraw loads images for files added to
  // elements already in the scene, so the new icon appears right away instead of a placeholder.
  api.addFiles([...newFiles.values()]);
  return updates.size;
}

/**
 * Recolor the selected SVG icons (or the icons in `ids`) to `color` (hex), or restore their
 * original colors when `color` is null. Returns how many icons changed.
 */
export function recolorSelectedIcons(
  api: ExcalidrawImperativeAPI,
  color: string | null,
  preview = false,
  ids?: ReadonlySet<string>,
): Promise<number> {
  return restyleIcons(api, { color }, preview, ids);
}

/**
 * Serialises recolors (they are async) and turns a live-preview drag into exactly one undo step:
 * previews are applied without history; on commit the icons are first put back to how they were
 * before the drag (also without history) and the final color is then applied as one change.
 */
export class IconRecolorSession {
  private queue: { patch: IconPatchFor; preview: boolean; after?: (api: ExcalidrawImperativeAPI) => void } | null = null;
  private busy = false;
  /** Selected image elements as they were before the current drag started. */
  private base: Map<string, ExcalidrawElement> | null = null;

  constructor(
    private getApi: () => ExcalidrawImperativeAPI | undefined,
    private onError: (e: Error) => void,
  ) {}

  apply(color: string | null, preview = false): void {
    this.applyPatch({ color }, preview);
  }

  /** Any icon change (hand-drawn style too), with the same preview / one-undo-step handling. */
  applyPatch(patch: IconPatchFor, preview = false, after?: (api: ExcalidrawImperativeAPI) => void): void {
    // Keep only the newest preview; never let a preview replace a pending commit.
    if (!this.queue || this.queue.preview) this.queue = { patch, preview, after };
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue) {
        const job = this.queue;
        this.queue = null;
        const api = this.getApi();
        if (!api) continue;
        if (job.preview) {
          if (!this.base) this.base = this.snapshotSelectedImages(api);
          await restyleIcons(api, job.patch, true);
        } else {
          if (this.base) {
            const base = this.base;
            this.base = null;
            api.updateScene({
              elements: api.getSceneElementsIncludingDeleted().map((el) => base.get(el.id) ?? el),
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
          await restyleIcons(api, job.patch, false);
          // e.g. captions following the icon's style, merged into the same undo step.
          job.after?.(api);
        }
      }
    } catch (e) {
      this.onError(e as Error);
    } finally {
      this.busy = false;
    }
  }

  private snapshotSelectedImages(api: ExcalidrawImperativeAPI): Map<string, ExcalidrawElement> {
    const sel = api.getAppState().selectedElementIds;
    return new Map(
      api
        .getSceneElementsIncludingDeleted()
        .filter((el) => el.type === "image" && sel[el.id])
        .map((el) => [el.id, el]),
    );
  }
}
