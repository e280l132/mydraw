// Version history (⌥⌘V): the snapshots made when the drawing was saved. Pick one to preview it,
// Restore puts it into the open drawing as one undo step (the current state is snapshotted first,
// so a restore can itself be taken back).
import { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction, exportToBlob } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { describeSnapshotTime, type SnapshotInfo } from "../../shared/snapshots";
import { parseDrawing, prepareSerialize, serializeScene } from "./scene";

interface Props {
  api: ExcalidrawImperativeAPI;
  filePath: string;
  title: string;
  onClose(): void;
  onDone(message: string, error?: boolean): void;
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);

export function VersionHistoryDialog({ api, filePath, title, onClose, onDone }: Props) {
  const [list, setList] = useState<SnapshotInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url?: string; empty?: boolean; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useRef<string | null>(null);
  const now = Date.now();

  useEffect(() => {
    let live = true;
    window.mydraw.listSnapshots(filePath).then(
      (l) => {
        if (!live) return;
        setList(l);
        if (l[0]) setSelected(l[0].id);
      },
      () => live && setList([]),
    );
    return () => {
      live = false;
    };
  }, [filePath]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    setPreview(null);
    (async () => {
      try {
        const loaded = await parseDrawing(await window.mydraw.readSnapshot(filePath, selected));
        const elements = loaded.elements.filter((e) => !e.isDeleted);
        if (!live) return;
        if (!elements.length) return setPreview({ empty: true });
        const blob = await exportToBlob({
          elements,
          appState: { exportBackground: true, viewBackgroundColor: loaded.appState.viewBackgroundColor ?? "#ffffff" },
          files: loaded.files,
          mimeType: "image/png",
          maxWidthOrHeight: 1000,
        });
        if (!live) return;
        if (url.current) URL.revokeObjectURL(url.current);
        url.current = URL.createObjectURL(blob);
        setPreview({ url: url.current });
      } catch (e) {
        if (live) setPreview({ error: (e as Error).message });
      }
    })();
    return () => {
      live = false;
    };
  }, [filePath, selected]);
  useEffect(() => () => void (url.current && URL.revokeObjectURL(url.current)), []);

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const loaded = await parseDrawing(await window.mydraw.readSnapshot(filePath, selected));
      await prepareSerialize(api);
      await window.mydraw.addSnapshot(filePath, serializeScene(api)); // keep what is open now
      api.updateScene({
        elements: loaded.elements,
        appState: loaded.appState as never,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      // Files after the scene update, so Excalidraw starts loading them (see CLAUDE.md).
      const files = Object.values(loaded.files);
      if (files.length) api.addFiles(files);
      api.scrollToContent(loaded.elements.filter((e) => !e.isDeleted), { fitToContent: true, animate: false });
      const info = list?.find((s) => s.id === selected);
      onDone(`Restored the version from ${info ? describeSnapshotTime(info.time, Date.now()) : "the history"}. Undo (⌘Z) brings back the previous state.`);
      onClose();
    } catch (e) {
      onDone(`Could not restore: ${(e as Error).message}`, true);
      setBusy(false);
    }
  };

  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-modal md-hist" role="dialog" aria-label="Version history" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2>Version history: {title}</h2>
        <div className="md-hist-body">
          <div className="md-hist-list" role="listbox">
            {list === null && <div className="md-hist-empty">Loading…</div>}
            {list?.length === 0 && <div className="md-hist-empty">No versions yet. A version is kept each time you save (autosaves at most every 2 minutes).</div>}
            {list?.map((s) => (
              <div
                key={s.id}
                role="option"
                aria-selected={s.id === selected}
                className={`md-hist-item${s.id === selected ? " on" : ""}`}
                title={new Date(s.time).toLocaleString()}
                onClick={() => setSelected(s.id)}
              >
                <span>{describeSnapshotTime(s.time, now)}</span>
                <span className="md-hist-size">{kb(s.size)}</span>
              </div>
            ))}
          </div>
          <div className="md-hist-preview">
            {preview?.url && <img src={preview.url} alt="Preview of the selected version" />}
            {preview?.empty && <span>This version is empty.</span>}
            {preview?.error && <span>Could not read this version: {preview.error}</span>}
            {!preview && selected && <span>Rendering…</span>}
          </div>
        </div>
        <div className="md-modal-actions">
          <button onClick={onClose}>Close</button>
          <button className="primary" disabled={!selected || busy || !preview?.url} onClick={() => void restore()}>
            {busy ? "Restoring…" : "Restore this version"}
          </button>
        </div>
      </div>
    </div>
  );
}
