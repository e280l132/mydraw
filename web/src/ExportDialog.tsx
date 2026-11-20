import { useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportElements,
  hasSelection,
  renderExport,
  type ExportFormat,
  type ExportOptions,
} from "./exportImage";

const STORAGE_KEY = "mydraw.exportOptions";

function loadOptions(): ExportOptions {
  try {
    return { ...DEFAULT_EXPORT_OPTIONS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"), scope: "all" };
  } catch {
    return DEFAULT_EXPORT_OPTIONS;
  }
}

interface Props {
  api: ExcalidrawImperativeAPI;
  title: string;
  onClose(): void;
  onDone(message: string): void;
}

export function ExportDialog({ api, title, onClose, onDone }: Props) {
  const [opts, setOpts] = useState<ExportOptions>(() => {
    const o = loadOptions();
    return hasSelection(api) ? { ...o, scope: "selection" } : o;
  });
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewUrl = useRef<string | null>(null);

  const selectionAvailable = hasSelection(api);
  const count = exportElements(api, opts.scope).length;
  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...opts, scope: "all" }));
  }, [opts]);

  useEffect(() => {
    let cancelled = false;
    if (!count) {
      setPreview(null);
      return;
    }
    renderExport(api, opts, 480)
      .then(({ data }) => {
        if (cancelled) return;
        const mime = opts.format === "jpg" ? "image/jpeg" : "image/png";
        const url = URL.createObjectURL(new Blob([data], { type: mime }));
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setPreview(url);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [api, opts, count]);

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
      const out = await renderExport(api, opts);
      const saved = await window.mydraw.exportFile({ defaultName: title, extension: out.extension, data: out.data });
      if (saved) {
        onDone(`Exported ${saved}`);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const raster = opts.format !== "svg";
  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-modal" role="dialog" aria-label="Export image">
        <h2>Export image</h2>
        <div className="md-export">
          <div className="md-export-preview">
            {preview ? <img src={preview} alt="Export preview" /> : <span>{count ? "Rendering…" : "Nothing to export"}</span>}
          </div>
          <div className="md-export-options">
            <label>Format</label>
            <div className="md-seg">
              {(["png", "jpg", "svg"] as ExportFormat[]).map((f) => (
                <button key={f} className={opts.format === f ? "on" : ""} onClick={() => set("format", f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>

            <label>Content</label>
            <div className="md-seg">
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
            </div>

            {raster && (
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

            {opts.format === "jpg" && (
              <>
                <label>Quality {Math.round(opts.jpgQuality * 100)}%</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={Math.round(opts.jpgQuality * 100)}
                  onChange={(e) => set("jpgQuality", Number(e.target.value) / 100)}
                />
              </>
            )}

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
              Background {opts.format === "jpg" && <small>(always on for JPG)</small>}
            </label>
            <label className="md-check">
              <input type="checkbox" checked={opts.darkMode} onChange={(e) => set("darkMode", e.target.checked)} />
              Dark mode
            </label>
            {opts.format !== "jpg" && (
              <label className="md-check">
                <input type="checkbox" checked={opts.embedScene} onChange={(e) => set("embedScene", e.target.checked)} />
                Embed drawing (re-openable in mydraw/Excalidraw)
              </label>
            )}
          </div>
        </div>
        {error && <div className="md-error">{error}</div>}
        <div className="md-modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!count || busy} onClick={doExport}>
            {busy ? "Exporting…" : `Export ${opts.format.toUpperCase()}…`}
          </button>
        </div>
      </div>
    </div>
  );
}
