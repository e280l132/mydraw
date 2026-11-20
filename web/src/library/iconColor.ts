// Recoloring SVG icons (stencils) on the canvas. Excalidraw can't color image elements, so we
// rewrite the SVG, store it as a new file and point the element at it. The original SVG is kept in
// the element's customData so "Original" can restore it and recoloring never compounds.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { recolorSvg, svgFromDataURL, svgToDataURL } from "../../../shared/recolor";

const ORIGINAL_KEY = "mydrawOriginalSvg";
const COLOR_KEY = "mydrawIconColor";
/** Larger originals are not stored (recoloring then works from the current version). */
const MAX_STORED_ORIGINAL = 256 * 1024;

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
  return !!el.fileId && files[el.fileId]?.mimeType === "image/svg+xml";
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

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Recolor the selected SVG icons to `color` (hex), or restore their original colors when `color`
 * is null. With `preview`, the change is shown but not recorded in undo history (see
 * IconRecolorSession for how a drag becomes one undo step). Returns how many icons changed.
 */
export async function recolorSelectedIcons(
  api: ExcalidrawImperativeAPI,
  color: string | null,
  preview = false,
): Promise<number> {
  const appState = api.getAppState();
  const files = api.getFiles();
  const all = api.getSceneElementsIncludingDeleted();
  const updates = new Map<string, ExcalidrawElement>();
  const newFiles = new Map<string, { id: FileId; dataURL: DataURL }>();

  for (const el of all) {
    if (el.type !== "image" || el.isDeleted || !appState.selectedElementIds[el.id] || !isSvgFile(files, el)) continue;
    const custom = { ...(el.customData ?? {}) };
    const original = (custom[ORIGINAL_KEY] as string | undefined) ?? svgFromDataURL(files[el.fileId!].dataURL);
    const svg = color ? recolorSvg(original, color) : original;
    const id = (await sha1Hex(svg)) as FileId;
    if (id !== el.fileId) newFiles.set(id, { id, dataURL: svgToDataURL(svg) as DataURL });

    if (color) {
      if (original.length <= MAX_STORED_ORIGINAL) custom[ORIGINAL_KEY] = original;
      custom[COLOR_KEY] = color;
    } else {
      delete custom[ORIGINAL_KEY];
      delete custom[COLOR_KEY];
    }
    updates.set(el.id, newElementWith(el, { fileId: id, status: "saved", customData: custom }));
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
  const now = Date.now();
  api.addFiles(
    [...newFiles.values()].map((f) => ({ ...f, mimeType: "image/svg+xml" as const, created: now, lastRetrieved: now })),
  );
  return updates.size;
}

/**
 * Serialises recolors (they are async) and turns a live-preview drag into exactly one undo step:
 * previews are applied without history; on commit the icons are first put back to how they were
 * before the drag (also without history) and the final color is then applied as one change.
 */
export class IconRecolorSession {
  private queue: { color: string | null; preview: boolean } | null = null;
  private busy = false;
  /** Selected image elements as they were before the current drag started. */
  private base: Map<string, ExcalidrawElement> | null = null;

  constructor(
    private getApi: () => ExcalidrawImperativeAPI | undefined,
    private onError: (e: Error) => void,
  ) {}

  apply(color: string | null, preview = false): void {
    // Keep only the newest preview; never let a preview replace a pending commit.
    if (!this.queue || this.queue.preview) this.queue = { color, preview };
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
          await recolorSelectedIcons(api, job.color, true);
        } else {
          if (this.base) {
            const base = this.base;
            this.base = null;
            api.updateScene({
              elements: api.getSceneElementsIncludingDeleted().map((el) => base.get(el.id) ?? el),
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
          await recolorSelectedIcons(api, job.color, false);
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
