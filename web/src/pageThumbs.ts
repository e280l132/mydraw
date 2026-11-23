// Small previews of the pages (frames) for the page navigator. A preview is rendered again only when
// its frame's content (or the theme) changed, one at a time, a moment after the editing stops.
import { exportToBlob, hashElementsVersion } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { frameElements } from "./exportImage";

export const THUMB_SIZE = 240;
const SETTLE_MS = 400;

type Live = Parameters<typeof frameElements>[0][number];

/** Changes whenever the frame's picture would: its elements (and their versions), canvas color, theme. */
export function thumbKey(api: ExcalidrawImperativeAPI, frameId: string): string {
  const { elements } = frameElements(api.getSceneElements() as Live[], frameId);
  const st = api.getAppState();
  return `${hashElementsVersion(elements as readonly ExcalidrawElement[])}:${elements.length}:${st.viewBackgroundColor}:${st.theme}`;
}

async function renderThumb(api: ExcalidrawImperativeAPI, frameId: string): Promise<Blob> {
  const { frame, elements } = frameElements(api.getSceneElements() as Live[], frameId);
  const st = api.getAppState();
  return exportToBlob({
    elements,
    appState: { ...st, exportBackground: true, exportWithDarkMode: st.theme === "dark", exportScale: 1, exportEmbedScene: false },
    files: api.getFiles(),
    exportPadding: 0,
    exportingFrame: frame,
    maxWidthOrHeight: THUMB_SIZE,
    mimeType: "image/png",
  });
}

/**
 * Object URLs of the pages' previews, by frame id (missing until the first one is ready). `tick`
 * changes when the scene does (the panel's refresh counter).
 */
export function usePageThumbs(api: ExcalidrawImperativeAPI | undefined, frameIds: readonly string[], tick: number): Record<string, string> {
  const cache = useRef(new Map<string, { key: string; url: string }>());
  const [, bump] = useState(0);
  const idsKey = frameIds.join(",");

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      // Drop previews of frames that are gone.
      for (const [id, v] of [...cache.current]) {
        if (!frameIds.includes(id)) {
          URL.revokeObjectURL(v.url);
          cache.current.delete(id);
        }
      }
      for (const id of frameIds) {
        if (cancelled) return;
        let key: string;
        try {
          key = thumbKey(api, id);
        } catch {
          continue;
        }
        if (cache.current.get(id)?.key === key) continue;
        try {
          const blob = await renderThumb(api, id);
          if (cancelled) return;
          const old = cache.current.get(id);
          if (old) URL.revokeObjectURL(old.url);
          cache.current.set(id, { key, url: URL.createObjectURL(blob) });
          bump((n) => n + 1);
        } catch {
          // a preview that cannot be drawn is simply left out
        }
      }
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, idsKey, tick]);

  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const v of c.values()) URL.revokeObjectURL(v.url);
      c.clear();
    };
  }, []);

  return Object.fromEntries([...cache.current].map(([id, v]) => [id, v.url]));
}
