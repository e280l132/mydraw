// Page navigator (⌥⌘P): the drawing's frames as pages. Click to zoom, double-click to rename,
// arrows to reorder (exports and slides follow this order), + to add a page.
import { useEffect, useReducer, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { listFrames } from "./exportImage";
import { addPage, movePage, renamePage, zoomToPage } from "./pages";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  onClose(): void;
}

export function PagesPanel({ api, onClose }: Props) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    refresh();
    if (!api) return;
    let timer: number | undefined;
    // Frames change rarely; redraw at most every 150 ms while the scene changes.
    const off = api.onChange(() => {
      if (timer === undefined) timer = window.setTimeout(() => ((timer = undefined), refresh()), 150);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [api]);
  useEffect(() => input.current?.select(), [editing]);

  const frames = api ? listFrames(api) : [];
  const selected = api?.getAppState().selectedElementIds ?? {};

  const commit = () => {
    // Escape unmounts the focused input, which fires onBlur: don't save then.
    if (api && editing && !cancelled.current) renamePage(api, editing, draft);
    cancelled.current = false;
    setEditing(null);
  };

  return (
    <aside className="md-pages" aria-label="Pages">
      <div className="md-panel-head">
        <span className="md-panel-title">Pages</span>
        <div className="md-panel-actions">
          <button className="md-icon-btn" title="Add page" aria-label="Add page" disabled={!api} onClick={() => api && addPage(api)}>
            +
          </button>
          <button className="md-icon-btn" title="Close" aria-label="Close pages" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="md-pages-list">
        {frames.map((f, i) => (
          <div key={f.id} className={`md-page${selected[f.id] ? " on" : ""}`} onClick={() => api && zoomToPage(api, f.id)}>
            <span className="md-page-num">{i + 1}</span>
            {editing === f.id ? (
              <input
                ref={input}
                className="md-page-edit"
                value={draft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") {
                    cancelled.current = true;
                    setEditing(null);
                  }
                  e.stopPropagation();
                }}
              />
            ) : (
              <span
                className="md-page-name"
                title="Click to go to this page, double-click to rename"
                onDoubleClick={() => {
                  setEditing(f.id);
                  setDraft(f.name);
                }}
              >
                {f.name}
              </span>
            )}
            <span className="md-page-actions">
              <button
                aria-label={`Move ${f.name} up`}
                title="Move up"
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  api && movePage(api, f.id, -1);
                }}
              >
                ↑
              </button>
              <button
                aria-label={`Move ${f.name} down`}
                title="Move down"
                disabled={i === frames.length - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  api && movePage(api, f.id, 1);
                }}
              >
                ↓
              </button>
            </span>
          </div>
        ))}
        {!frames.length && (
          <div className="md-pages-empty">
            No pages yet. A page is a frame; press <b>+</b> to add one, or use the frame tool (F).
          </div>
        )}
      </div>
    </aside>
  );
}
