// Headless export runner for the `mydraw` CLI. app/src/cli.ts loads index.html#headless in a hidden
// window and calls window.__mydrawHeadless.run(job). One off-screen <Excalidraw> holds the input
// drawing, and the app's own export code renders it (same output as the export dialog and MCP).
import { Excalidraw } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useState } from "react";
import { isPagedFormat } from "../../shared/agent";
import type { PdfPageSize, SlideSize } from "../../shared/pdfLayout";
import { drawingStyleAppState } from "./drawingStyle";
import { drawioToScene } from "./drawioImport";
import { DEFAULT_EXPORT_OPTIONS, EXPORT_FORMATS, findFrame, renderExport, renderFrameExports, type ExportFormat, type ExportOptions } from "./exportImage";
import { parseDrawing, serializeScene } from "./scene";

export interface HeadlessJob {
  inputKind: "excalidraw" | "drawio";
  content: string;
  format: string;
  scope: "all" | "frame" | "frames";
  frame?: string;
  padding?: number;
  scale?: 1 | 2 | 3 | 4;
  darkMode: boolean;
  background: boolean;
  backgroundColor?: string;
  quality?: number;
  embedScene: boolean;
  pageSize?: PdfPageSize;
  actualSize: boolean;
  slideSize?: SlideSize;
}

export interface HeadlessFile {
  /** Frame name for one-file-per-frame output, else null. */
  name: string | null;
  extension: string;
  base64?: string;
  text?: string;
}

export interface HeadlessResult {
  files: HeadlessFile[];
  warnings: string[];
  pages?: number;
}

declare global {
  interface Window {
    __mydrawHeadless?: { ready: true; run(job: HeadlessJob): Promise<HeadlessResult> };
  }
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const out = (name: string | null, extension: string, data: ArrayBuffer | string): HeadlessFile =>
  typeof data === "string" ? { name, extension, text: data } : { name, extension, base64: toBase64(data) };

/** Resolves once `ok()` is true (checked every frame-ish), or after `ms` (then the caller goes on). */
async function settled(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 16));
}

async function run(api: ExcalidrawImperativeAPI, job: HeadlessJob): Promise<HeadlessResult> {
  const warnings: string[] = [];
  // Clean style (the app's default) for imported shapes. Pass it explicitly: getAppState() does not
  // see an updateScene from the same tick.
  const style = drawingStyleAppState("clean");
  api.updateScene({ appState: style as AppState });
  let inputBg: string | undefined;
  if (job.inputKind === "drawio") {
    const scene = await drawioToScene(job.content, { ...api.getAppState(), ...style });
    warnings.push(...scene.warnings);
    api.updateScene({ elements: scene.elements });
    api.addFiles(scene.files);
  } else {
    const scene = await parseDrawing(job.content);
    api.updateScene({ elements: scene.elements, appState: scene.appState as AppState });
    api.addFiles(Object.values(scene.files));
    inputBg = scene.appState?.viewBackgroundColor;
  }
  if (job.backgroundColor) api.updateScene({ appState: { viewBackgroundColor: job.backgroundColor } });
  // The export code reads api.getAppState() (canvas color etc.), which only reflects the updates
  // above after React has rendered them. Wait until the last update is visible.
  const wantBg = job.backgroundColor ?? (inputBg ?? api.getAppState().viewBackgroundColor);
  await settled(() => api.getAppState().viewBackgroundColor === wantBg && api.getSceneElements().length > 0);
  if (!api.getSceneElements().length) throw new Error("the drawing is empty");

  if (job.format === "excalidraw") return { files: [out(null, "excalidraw", serializeScene(api))], warnings };
  if (!EXPORT_FORMATS.includes(job.format as ExportFormat)) throw new Error(`unknown format "${job.format}"`);
  const opts: ExportOptions = {
    ...DEFAULT_EXPORT_OPTIONS,
    format: job.format as ExportFormat,
    scope: job.scope,
    frameId: job.scope === "frame" ? findFrame(api, job.frame ?? "").id : undefined,
    scale: job.scale ?? DEFAULT_EXPORT_OPTIONS.scale,
    padding: job.padding ?? DEFAULT_EXPORT_OPTIONS.padding,
    background: job.background,
    darkMode: job.darkMode,
    quality: job.quality ?? DEFAULT_EXPORT_OPTIONS.quality,
    embedScene: job.embedScene,
    pageSize: job.pageSize ?? "fit",
    actualSize: job.actualSize,
    slideSize: job.slideSize ?? "16:9",
  };
  if (job.scope === "frames" && !isPagedFormat(opts.format)) {
    const files = await renderFrameExports(api, opts);
    return { files: files.map((f) => out(f.name, f.extension, f.data)), warnings };
  }
  const r = await renderExport(api, opts);
  return { files: [out(null, r.extension, r.data)], warnings: [...warnings, ...(r.warnings ?? [])], pages: r.pages };
}

export function Headless() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    if (!api) return;
    window.__mydrawHeadless = {
      ready: true,
      run: (job) =>
        run(api, job).catch((e: Error) => {
          console.error(e?.stack ?? e); // shown with MYDRAW_CLI_DEBUG=1
          throw e;
        }),
    };
  }, [api]);
  return (
    <div style={{ position: "fixed", left: 0, top: 0, width: 1200, height: 800 }}>
      <Excalidraw excalidrawAPI={setApi} />
    </div>
  );
}
