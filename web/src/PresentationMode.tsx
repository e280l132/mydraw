// Presentation mode (⌥⌘Return): the drawing's frames as full-screen slides, in page order. Arrow
// keys / space / click move between slides, Esc leaves. Slides are rendered with the same PNG export
// as everything else, so what you see is what exports. A drawing without frames is one slide.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { DEFAULT_EXPORT_OPTIONS, listFrames, renderExport } from "./exportImage";

interface Slide {
  /** Frame id, or null for the whole drawing. */
  id: string | null;
  name: string;
}

interface Props {
  api: ExcalidrawImperativeAPI;
  darkMode: boolean;
  onClose(): void;
}

type Rendered = { url: string } | { error: string };

export function slidesOf(api: ExcalidrawImperativeAPI): Slide[] {
  const frames = listFrames(api);
  return frames.length ? frames.map((f) => ({ id: f.id, name: f.name })) : [{ id: null, name: "Drawing" }];
}

export function PresentationMode({ api, darkMode, onClose }: Props) {
  const [slides] = useState<Slide[]>(() => slidesOf(api));
  const [index, setIndex] = useState(() => {
    // Start on the selected frame, if there is one.
    const sel = api.getAppState().selectedElementIds;
    const i = slides.findIndex((s) => s.id && sel[s.id]);
    return i >= 0 ? i : 0;
  });
  const [, bump] = useState(0);
  const cache = useRef(new Map<number, Rendered>());
  const pending = useRef(new Set<number>());
  const [hud, setHud] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const background = api.getAppState().viewBackgroundColor;

  const render = useCallback(
    async (i: number) => {
      if (i < 0 || i >= slides.length || cache.current.has(i) || pending.current.has(i)) return;
      pending.current.add(i);
      const s = slides[i];
      try {
        const out = await renderExport(api, {
          ...DEFAULT_EXPORT_OPTIONS,
          format: "png",
          scope: s.id ? "frame" : "all",
          frameId: s.id ?? undefined,
          scale: 2,
          padding: s.id ? 0 : 40,
          background: true,
          darkMode,
        });
        cache.current.set(i, { url: URL.createObjectURL(new Blob([out.data], { type: out.mime })) });
      } catch (e) {
        cache.current.set(i, { error: (e as Error).message });
      }
      pending.current.delete(i);
      bump((n) => n + 1);
    },
    [api, darkMode, slides],
  );

  useEffect(() => {
    void render(index);
    void render(index + 1); // the next slide is ready before it's needed
  }, [index, render]);
  useEffect(() => {
    const urls = cache.current;
    return () => {
      for (const r of urls.values()) if ("url" in r) URL.revokeObjectURL(r.url);
    };
  }, []);

  const go = useCallback((to: number) => setIndex((i) => Math.min(slides.length - 1, Math.max(0, typeof to === "number" ? to : i))), [slides.length]);

  // Keys: capture phase on window, so Excalidraw never sees them while presenting.
  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const next = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"];
      const prev = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"];
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") onClose();
      else if (next.includes(e.key)) setIndex((i) => Math.min(slides.length - 1, i + 1));
      else if (prev.includes(e.key)) setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "Home") setIndex(0);
      else if (e.key === "End") setIndex(slides.length - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, slides.length]);

  // The counter and the cursor fade out after the mouse rests.
  useEffect(() => {
    let timer: number | undefined;
    const show = () => {
      setHud(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHud(false), 2200);
    };
    show();
    window.addEventListener("mousemove", show);
    return () => {
      window.removeEventListener("mousemove", show);
      window.clearTimeout(timer);
    };
  }, []);

  const current = cache.current.get(index);
  const slide = slides[index];
  return (
    <div
      ref={root}
      className={`md-present${hud ? "" : " idle"}`}
      tabIndex={-1}
      role="dialog"
      aria-label="Presentation"
      data-index={index}
      data-count={slides.length}
      style={{ background }}
      onClick={(e) => {
        // Right two thirds go forward, the left third back.
        const third = (e.currentTarget as HTMLElement).clientWidth / 3;
        go(e.clientX < third ? index - 1 : index + 1);
      }}
    >
      {current && "url" in current && <img className="md-present-slide" src={current.url} alt={slide.name} draggable={false} />}
      {current && "error" in current && <div className="md-present-msg">{slide.name}: {current.error}</div>}
      {!current && <div className="md-present-msg">Rendering…</div>}
      <div className="md-present-hud">
        <span className="md-present-count">
          {index + 1} / {slides.length}
        </span>
        <span>{slide.name}</span>
        <button
          aria-label="End presentation"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
