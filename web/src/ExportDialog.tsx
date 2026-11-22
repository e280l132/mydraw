import { useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { isPagedFormat } from "../../shared/agent";
import { siblingPath } from "../../shared/names";
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FORMATS,
  TEXT_FORMATS,
  exportElements,
  hasSelection,
  listFrames,
  renderExport,
  renderFrameExports,
  type ExportFormat,
  type ExportOptions,
} from "./exportImage";

const STORAGE_KEY = "mydraw.exportOptions";

export const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: "PNG",
  jpg: "JPG",
  webp: "WebP",
  svg: "SVG",
  html: "HTML",
  pdf: "PDF",
  pptx: "PowerPoint",
  drawio: "draw.io",
  mermaid: "Mermaid",
  csv: "CSV",
  markdown: "Markdown",
};

/** Options as last used (scope is never remembered). */
export function loadExportOptions(): ExportOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ExportOptions> & { jpgQuality?: number };
    const { jpgQuality, ...rest } = saved;
    return { ...DEFAULT_EXPORT_OPTIONS, ...(jpgQuality !== undefined ? { quality: jpgQuality } : {}), ...rest, scope: "all", frameId: undefined };
  } catch {
    return DEFAULT_EXPORT_OPTIONS;
  }
}

interface Props {
  api: ExcalidrawImperativeAPI;
  title: string;
  /** The saved .excalidraw file, or null for an unsaved drawing (no auto-export then). */
  filePath: string | null;
  autoExport: "png" | "svg" | null;
  /** Start on this format instead of the last used one (command palette entries). */
  initialFormat?: ExportFormat;
  onAutoExport(format: "png" | "svg" | null): void;
  onClose(): void;
  onDone(message: string): void;
}

export function ExportDialog({ api, title, filePath, autoExport, initialFormat, onAutoExport, onClose, onDone }: Props) {
  const frames = listFrames(api);
  const [opts, setOpts] = useState<ExportOptions>(() => {
    const o = { ...loadExportOptions(), ...(initialFormat ? { format: initialFormat } : {}) };
    return hasSelection(api) ? { ...o, scope: "selection" } : o;
  });
  const [preview, setPreview] = useState<{ url?: string; text?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);

  const selectionAvailable = hasSelection(api);
  const frameId = opts.frameId ?? frames[0]?.id;
  const isText = TEXT_FORMATS.includes(opts.format);
  const paged = isPagedFormat(opts.format);
  // draw.io is a diagram file, not a picture: no padding/background/dark mode.
  const isPicture = !isText && opts.format !== "drawio";
  const canScale = opts.format === "png" || opts.format === "jpg" || opts.format === "webp" || opts.format === "pptx";
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  let count = 0;
  try {
    count = opts.scope === "frames" ? frames.length : exportElements(api, opts.scope, undefined, frameId).length;
  } catch {
    count = 0;
  }

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...opts, scope: "all", frameId: undefined }));
  }, [opts]);

  useEffect(() => {
    let cancelled = false;
    if (!count) {
      setPreview(null);
      return;
    }
    // A batch previews its first frame.
    const previewOpts: ExportOptions =
      opts.scope === "frames" ? { ...opts, scope: "frame", frameId: frames[0]?.id } : { ...opts, frameId };
    renderExport(api, previewOpts, 480)
      .then(({ data, mime }) => {
        if (cancelled) return;
        if (typeof data === "string") {
          setPreview({ text: data.length > 4000 ? `${data.slice(0, 4000)}\n…` : data });
          return;
        }
        const url = URL.createObjectURL(new Blob([data], { type: mime }));
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setPreview({ url });
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setPreview(null);
        setError(e.message);
      });
    setError(null);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, opts, count, frameId]);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function doExport() {
    setBusy(true);
    setError(null);
    try {
      const run = { ...opts, frameId };
      if (opts.scope === "frames" && !paged) {
        const files = await renderFrameExports(api, run);
        const saved = await window.mydraw.exportFiles({ files });
        if (saved) {
          onDone(`Exported ${saved.length} file${saved.length === 1 ? "" : "s"} to ${saved[0].replace(/[\\/][^\\/]*$/, "")}`);
          onClose();
        }
        return;
      }
      const out = await renderExport(api, run);
      const name = opts.scope === "frame" ? `${title} - ${frames.find((f) => f.id === frameId)?.name ?? "frame"}` : title;
      const saved = await window.mydraw.exportFile({ defaultName: name, extension: out.extension, data: out.data });
      if (saved) {
        onDone(`Exported ${saved}${out.warnings?.length ? ` (${out.warnings.join("; ")})` : ""}`);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lossy = opts.format === "jpg" || opts.format === "webp";
  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-modal" role="dialog" aria-label="Export">
        <h2>Export</h2>
        <div className="md-export">
          <div className="md-export-preview">
            {preview?.url ? (
              <img src={preview.url} alt="Export preview" />
            ) : preview?.text !== undefined ? (
              <pre className="md-export-text">{preview.text}</pre>
            ) : (
              <span>{count ? (error ? "No preview" : "Rendering…") : "Nothing to export"}</span>
            )}
          </div>
          <div className="md-export-options">
            <label>Format</label>
            <div className="md-seg md-seg-wrap">
              {EXPORT_FORMATS.map((f) => (
                <button key={f} className={opts.format === f ? "on" : ""} onClick={() => set("format", f)}>
                  {FORMAT_LABEL[f]}
                </button>
              ))}
            </div>

            <label>Content</label>
            <div className="md-seg md-seg-wrap">
              <button className={opts.scope === "all" ? "on" : ""} onClick={() => set("scope", "all")}>
                Whole drawing
              </button>
              <button
                className={opts.scope === "selection" ? "on" : ""}
                disabled={!selectionAvailable}
                onClick={() => set("scope", "selection")}
              >
                Selection
              </button>
              <button className={opts.scope === "frame" ? "on" : ""} disabled={!frames.length} onClick={() => set("scope", "frame")}>
                One frame
              </button>
              <button className={opts.scope === "frames" ? "on" : ""} disabled={!frames.length} onClick={() => set("scope", "frames")}>
                Every frame
              </button>
            </div>
            {opts.scope === "frame" && (
              <select value={frameId} onChange={(e) => set("frameId", e.target.value)} aria-label="Frame">
                {frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            {opts.scope === "frames" && (
              <small>
                {opts.format === "pdf"
                  ? "One PDF, one page per frame."
                  : opts.format === "pptx"
                    ? "One presentation, one slide per frame."
                    : opts.format === "drawio"
                      ? "One draw.io file, one page per frame."
                      : "One file per frame, written to a folder you choose."}
              </small>
            )}

            {opts.format === "pdf" && (
              <>
                <label>Page size</label>
                <div className="md-seg">
                  {(
                    [
                      ["fit", "Fit to content"],
                      ["a4", "A4"],
                      ["letter", "Letter"],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} className={opts.pageSize === v ? "on" : ""} onClick={() => set("pageSize", v)}>
                      {l}
                    </button>
                  ))}
                </div>
                <label className="md-check">
                  <input
                    type="checkbox"
                    checked={opts.actualSize && opts.pageSize !== "fit"}
                    disabled={opts.pageSize === "fit"}
                    onChange={(e) => set("actualSize", e.target.checked)}
                  />
                  Actual size <small>{opts.pageSize === "fit" ? "(the page is the drawing's size)" : "(100%, may span several sheets; off = fit to the sheet)"}</small>
                </label>
              </>
            )}

            {opts.format === "pptx" && (
              <>
                <label>Slide size</label>
                <div className="md-seg">
                  {(["16:9", "4:3"] as const).map((v) => (
                    <button key={v} className={opts.slideSize === v ? "on" : ""} onClick={() => set("slideSize", v)}>
                      {v}
                    </button>
                  ))}
                </div>
                <small>Each slide is a picture of {opts.scope === "frames" ? "one frame" : "the drawing"}.</small>
              </>
            )}

            {opts.format === "drawio" && <small>Shapes, text, arrows, zones (as containers) and icons (as images) become editable draw.io cells. Approximate: hand-drawn styles map to draw.io's sketch style.</small>}

            {canScale && (
              <>
                <label>Scale</label>
                <div className="md-seg">
                  {([1, 2, 3, 4] as const).map((s) => (
                    <button key={s} className={opts.scale === s ? "on" : ""} onClick={() => set("scale", s)}>
                      {s}×
                    </button>
                  ))}
                </div>
              </>
            )}

            {lossy && (
              <>
                <label>Quality {Math.round(opts.quality * 100)}%</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(opts.quality * 100)}
                  onChange={(e) => set("quality", Number(e.target.value) / 100)}
                />
              </>
            )}

            {isPicture && (
              <>
                <label>Padding (px)</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={opts.padding}
                  onChange={(e) => set("padding", Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                />

                <label className="md-check">
                  <input
                    type="checkbox"
                    checked={opts.background || opts.format === "jpg"}
                    disabled={opts.format === "jpg"}
                    onChange={(e) => set("background", e.target.checked)}
                  />
                  Background {opts.format === "jpg" ? <small>(always on for JPG)</small> : <small>(off = transparent)</small>}
                </label>
                <label className="md-check">
                  <input type="checkbox" checked={opts.darkMode} onChange={(e) => set("darkMode", e.target.checked)} />
                  Dark mode
                </label>
                {(opts.format === "png" || opts.format === "svg") && (
                  <label className="md-check">
                    <input type="checkbox" checked={opts.embedScene} onChange={(e) => set("embedScene", e.target.checked)} />
                    Embed drawing (re-openable in mydraw/Excalidraw)
                  </label>
                )}
              </>
            )}

            <label>Keep an image up to date</label>
            <div className="md-seg">
              {([null, "png", "svg"] as const).map((f) => (
                <button key={f ?? "off"} className={autoExport === f ? "on" : ""} disabled={!filePath} onClick={() => onAutoExport(f)}>
                  {f ? f.toUpperCase() : "Off"}
                </button>
              ))}
            </div>
            <small>
              {!filePath
                ? "Save the drawing to a file first, then you can have an image written automatically."
                : autoExport
                  ? `On: every time you save, ${siblingPath(filePath, autoExport).split(/[\\/]/).pop()} is rewritten next to this file (replacing the old one). No need to export again.`
                  : `Off. Choose PNG or SVG and every save also writes an image (e.g. ${siblingPath(filePath, "png").split(/[\\/]/).pop()}) next to this file, replacing the old one. Handy for README/docs. Applies to this drawing only; uses the settings above; whole drawing.`}
            </small>
          </div>
        </div>
        {error && <div className="md-error">{error}</div>}
        <div className="md-modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!count || busy} onClick={doExport}>
            {busy ? "Exporting…" : opts.scope === "frames" && !paged ? `Export ${frames.length} frames…` : `Export ${FORMAT_LABEL[opts.format]}…`}
          </button>
        </div>
      </div>
    </div>
  );
}
