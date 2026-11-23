// Agent command dispatcher (main process). Library and file-system methods run here; everything
// that touches a drawing is forwarded to the renderer, which owns the scene and runs commands one
// at a time (see web/src/agent/executor.ts).
import { app, clipboard, ClipboardItem, ipcMain, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AGENT_EXPORT_FORMATS, exportFormatForPath, isPagedFormat, type AgentCommand, type AgentReply } from "../../shared/agent";
import { normalizeSpec, type DiagramSpec } from "../../shared/diagram";
import { findStencil as lookupStencil, searchItems, type LibraryItem } from "../../shared/library";
import { findTemplate, TEMPLATES } from "../../shared/templates";
import { csvToSpec, importFormatForPath, yamlToSpec } from "../../shared/importers";
import { batchFileStems, ensureExtension } from "../../shared/names";
import type { OpenedFile } from "../../shared/types";
import { writeBinary } from "./files";
import type { LibraryStore } from "./library";

const MAX_IMPORT_BYTES = 2_000_000;
const RENDERER_TIMEOUT = 120_000;
const READY_TIMEOUT = 30_000;

export interface AgentDeps {
  getWin(): BrowserWindow | null;
  isRendererReady(): boolean;
  store: LibraryStore;
  /** Read a drawing and allow the renderer to save to it. */
  openFile(abs: string): OpenedFile;
  allowPath(abs: string): void;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} must be a non-empty string`);
  return v;
}

function absPath(v: unknown, name: string): string {
  const p = str(v, name).replace(/^~(?=$|\/)/, app.getPath("home"));
  if (!path.isAbsolute(p)) throw new Error(`${name} must be an absolute path`);
  return path.normalize(p);
}

function stencilSummary(i: LibraryItem) {
  return { id: i.id, name: i.name, collection: i.collection, groups: i.groups, tags: i.tags, kind: i.kind };
}

export function setupAgent(deps: AgentDeps): (method: string, params: Record<string, unknown>) => Promise<unknown> {
  let nextId = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>();

  ipcMain.on("agent:reply", (e, reply: AgentReply) => {
    if (e.sender !== deps.getWin()?.webContents || !reply || typeof reply.id !== "number") return;
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    clearTimeout(p.timer);
    if (reply.ok) p.resolve(reply.result);
    else p.reject(new Error(reply.error));
  });

  async function waitForRenderer(): Promise<BrowserWindow> {
    const start = Date.now();
    for (;;) {
      const win = deps.getWin();
      if (win && !win.isDestroyed() && deps.isRendererReady()) return win;
      if (Date.now() - start > READY_TIMEOUT) throw new Error("the mydraw window is not ready");
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async function renderer(method: string, params: Record<string, unknown>): Promise<unknown> {
    const win = await waitForRenderer();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, RENDERER_TIMEOUT);
      pending.set(id, { resolve, reject, timer });
      win.webContents.send("agent:command", { id, method, params, deadline: Date.now() + RENDERER_TIMEOUT - 1000 } satisfies AgentCommand);
    });
  }

  function findStencil(id: string): LibraryItem {
    let item = deps.store.getIndex().items.find((i) => i.id === id);
    if (!item) {
      deps.store.rescan(); // a file added a moment ago may not be indexed yet
      item = deps.store.getIndex().items.find((i) => i.id === id);
    }
    if (!item) throw new Error(`no stencil with id "${id}" (use search_stencils)`);
    return item;
  }

  /** Validate a diagram and look up its icons in the library; then build it in the renderer. */
  function buildDiagram(spec: DiagramSpec, params: Record<string, unknown>, renameOnClash = false) {
    const items: Record<string, LibraryItem | null> = {};
    const all = deps.store.getIndex().items;
    for (const n of spec.nodes) if (n.icon && !(n.icon in items)) items[n.icon] = lookupStencil(all, n.icon, true);
    return renderer("build_diagram", { drawing: params.drawing, zoom: params.zoom, spec, items, renameOnClash });
  }

  return async (method, params) => {
    switch (method) {
      // ----- diagrams -----
      case "build_diagram":
        return buildDiagram(normalizeSpec(params.diagram ?? params), params);
      case "import_diagram": {
        // CSV / YAML / Mermaid text (inline or from a file) -> a laid-out diagram in the drawing.
        let text = typeof params.text === "string" ? params.text : null;
        const file = params.path !== undefined ? absPath(params.path, "path") : null;
        if (text === null && file) {
          if (fs.statSync(file).size > MAX_IMPORT_BYTES) throw new Error(`${file} is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB`);
          text = fs.readFileSync(file, "utf8");
        }
        if (!text || !text.trim()) throw new Error("give `text` or a `path` to a CSV, YAML or Mermaid file");
        if (text.length > MAX_IMPORT_BYTES) throw new Error(`the text is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB`);
        const format = typeof params.format === "string" ? params.format : file ? importFormatForPath(file) : null;
        if (format !== "csv" && format !== "yaml" && format !== "mermaid") throw new Error("format must be csv, yaml or mermaid (or give a path ending in .csv, .yaml or .mmd)");
        if (format === "mermaid") return renderer("mermaid_to_scene", { ...params, mermaid: text });
        const { spec, warnings } = format === "csv" ? csvToSpec(text) : yamlToSpec(text);
        for (const k of ["direction", "algorithm", "routing", "spacing", "x", "y", "title", "legend", "iconSize"]) if (params[k] !== undefined) spec[k] = params[k];
        const result = (await buildDiagram(normalizeSpec(spec), params, true)) as Record<string, unknown>;
        const built = Array.isArray(result.warnings) ? (result.warnings as string[]) : [];
        return { ...result, format, warnings: [...warnings, ...built] };
      }
      case "list_templates":
        return TEMPLATES.map((t) => ({ name: t.name, title: t.title, description: t.description }));
      case "apply_template": {
        const t = findTemplate(str(params.name, "name"));
        if (!t) throw new Error(`no template "${params.name}" (templates: ${TEMPLATES.map((x) => x.name).join(", ")})`);
        const spec: Record<string, unknown> = structuredClone(t.spec) as unknown as Record<string, unknown>;
        for (const k of ["x", "y", "direction", "algorithm", "routing", "spacing", "legend", "title", "iconSize"]) {
          if (params[k] !== undefined) spec[k] = params[k];
        }
        return buildDiagram(normalizeSpec(spec), params, true);
      }

      case "ping":
        return { app: "mydraw", version: app.getVersion(), pid: process.pid, ready: deps.isRendererReady() };

      // ----- stencil library -----
      case "search_stencils": {
        const index = deps.store.getIndex();
        const query = typeof params.query === "string" ? params.query : "";
        const collection = typeof params.collection === "string" ? params.collection : null;
        const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 200);
        const pool = collection ? index.items.filter((i) => i.collection === collection) : index.items;
        const items = query.trim() ? searchItems(pool, query, limit) : pool.slice(0, limit);
        return { total: query.trim() ? undefined : pool.length, items: items.map(stencilSummary) };
      }
      case "list_collections":
        return deps.store.getIndex().collections;
      case "add_stencil_file": {
        const file = absPath(params.path, "path");
        const collection = typeof params.collection === "string" && params.collection ? params.collection : undefined;
        const count = deps.store.importPaths([file], collection);
        deps.store.rescan();
        return { imported: count };
      }
      case "delete_stencil":
        findStencil(str(params.id, "id"));
        await deps.store.remove(str(params.id, "id"));
        return { deleted: params.id };
      case "save_as_stencil": {
        const content = (await renderer("stencil_content", params)) as { elements: unknown[]; files: Record<string, unknown> };
        if (!content.elements.length) throw new Error("nothing to save: select elements or pass ids");
        const id = deps.store.saveStencil({
          collection: typeof params.collection === "string" ? params.collection : "",
          name: str(params.name, "name"),
          tags: Array.isArray(params.tags) ? params.tags.filter((t): t is string => typeof t === "string") : [],
          elements: content.elements,
          files: content.files,
        });
        deps.store.rescan();
        return { id };
      }
      case "place_stencil":
        return renderer("place_stencil", { ...params, item: findStencil(str(params.id, "id")) });

      // ----- files -----
      case "open_drawing": {
        const file = deps.openFile(absPath(params.path, "path"));
        return renderer("open_files", { files: [file] });
      }
      case "save": {
        if (params.path === undefined) return renderer("save", params);
        const target = ensureExtension(absPath(params.path, "path"), "excalidraw");
        deps.allowPath(target);
        return renderer("save", { ...params, path: target });
      }
      case "export": {
        const target = absPath(params.path, "path");
        const scope = params.scope === undefined ? "all" : params.scope;
        const fromPath = exportFormatForPath(target);
        // scope "frames": `path` is a folder (one file per frame) unless the format has pages
        // (pdf/pptx/drawio write one file with a page per frame).
        const format =
          (typeof params.format === "string" ? params.format : null) ??
          (scope !== "frames" || (fromPath && isPagedFormat(fromPath)) ? fromPath : null);
        const batch = scope === "frames" && !!format && !isPagedFormat(format);
        if (!format || !(AGENT_EXPORT_FORMATS as readonly string[]).includes(format)) {
          throw new Error(
            `format must be one of ${AGENT_EXPORT_FORMATS.join(", ")}${scope === "frames" ? " (required with scope frames unless the path ends in .pdf, .pptx or .drawio)" : " (or use a path with that extension)"}`,
          );
        }
        const out = (await renderer("render_export", { ...params, format })) as {
          data?: ArrayBuffer | string;
          files?: { name: string; extension: string; data: ArrayBuffer | string }[];
          pages?: number;
          warnings?: string[];
        };
        if (out.files && batch) {
          // scope "frames": `path` is a folder, one file per frame.
          const stems = batchFileStems(out.files.map((f) => f.name));
          const written = out.files.map((f, i) => {
            const file = path.join(target, `${stems[i]}.${f.extension}`);
            writeBinary(file, f.data);
            return { frame: f.name, path: file };
          });
          return { format, files: written };
        }
        if (out.data === undefined) throw new Error("export produced no data");
        writeBinary(target, out.data);
        return {
          path: target,
          format,
          bytes: typeof out.data === "string" ? Buffer.byteLength(out.data) : out.data.byteLength,
          ...(out.pages !== undefined ? { pages: out.pages } : {}),
          ...(out.warnings?.length ? { warnings: out.warnings } : {}),
        };
      }
      case "copy_to_clipboard": {
        // The same as the app's Copy As: a PNG picture, or SVG / Mermaid text, on the system clipboard.
        const format = params.format;
        if (format !== "png" && format !== "svg" && format !== "mermaid") throw new Error("format must be png, svg or mermaid");
        const scope = params.scope === undefined ? "all" : params.scope;
        if (scope !== "all" && scope !== "selection") throw new Error("scope must be all or selection");
        const out = (await renderer("render_export", { ...params, format, scope })) as { data?: ArrayBuffer | string };
        if (out.data === undefined) throw new Error("nothing to copy");
        if (format === "png") {
          const bytes = out.data as ArrayBuffer;
          await clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
          return { copied: "png", bytes: bytes.byteLength };
        }
        clipboard.writeText(out.data as string);
        return { copied: format, chars: (out.data as string).length };
      }
      case "screenshot": {
        const out = (await renderer("render_export", {
          ...params,
          format: "png",
          maxSize: Math.min(Math.max(Number(params.maxSize) || 1600, 200), 4000),
        })) as { data: ArrayBuffer; width?: number; height?: number };
        return { png: Buffer.from(out.data).toString("base64") };
      }

      default:
        return renderer(method, params);
    }
  };
}
