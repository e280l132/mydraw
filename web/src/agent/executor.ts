// Runs agent (MCP) commands against the open drawings. Commands run one at a time, each against
// the latest scene, and each scene-changing command is applied as a single updateScene call, so it
// is one undo step and never overwrites edits the user made in the meantime (elements are merged
// by id).
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { AgentCommand } from "../../../shared/agent";
import { center, placeBeside, type Box, type Side } from "../../../shared/geometry";
import type { LibraryItem } from "../../../shared/library";
import type { OpenedFile } from "../../../shared/types";
import { DEFAULT_EXPORT_OPTIONS, exportElements, renderExport, type ExportFormat } from "../exportImage";
import { isRecolorableIcon, recoloredIcon } from "../library/iconColor";
import { colorOfElement } from "../library/pickColor";
import { cloneForInsert, loadStencil } from "../library/stencilContent";
import { trueColorFile } from "../library/trueColor";
import { serializeScene } from "../scene";
import {
  applyUpdates,
  boundsOf,
  boundTextOf,
  boxOf,
  buildElements,
  deleteElements,
  describe,
  listable,
  randomId,
  withGroupsAndLabels,
  type El,
  type ElMap,
} from "./sceneOps";

type Params = Record<string, unknown>;

export interface AgentTabInfo {
  id: string;
  title: string;
  filePath: string | null;
  dirty: boolean;
}

/** What the executor needs from the app (App.tsx). */
export interface AgentHost {
  tabs(): AgentTabInfo[];
  activeId(): string;
  api(tabId: string): ExcalidrawImperativeAPI | undefined;
  activate(tabId: string): void;
  newDrawing(title?: string): string;
  openFiles(files: OpenedFile[]): Promise<void>;
  /** Save a tab, to `path` if given (else its current file). Resolves to the saved path. */
  save(tabId: string, path?: string): Promise<string>;
  markStencilUsed(id: string): void;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const PLACE_GAP = 80;

function strArray(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`${name} must be an array of ids`);
  return v as string[];
}

function objArray(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${name} must be an array`);
  return v;
}

function liveMap(api: ExcalidrawImperativeAPI): ElMap {
  return new Map(api.getSceneElements().map((e) => [e.id, e]));
}

/** Apply changed + added elements as one undoable scene update. */
function commit(api: ExcalidrawImperativeAPI, changed: readonly El[], added: readonly El[] = []): void {
  if (!changed.length && !added.length) return;
  const byId = new Map(changed.map((e) => [e.id, e]));
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), ...added],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function createAgentExecutor(host: AgentHost, reply: (r: { id: number; ok: boolean; result?: unknown; error?: string }) => void) {
  let chain: Promise<void> = Promise.resolve();

  function resolveTab(d: unknown): string {
    if (d === undefined || d === null || d === "") {
      const id = host.activeId();
      if (!id) throw new Error("no drawing is open");
      return id;
    }
    const s = String(d);
    const tabs = host.tabs();
    const t =
      tabs.find((x) => x.id === s) ??
      tabs.find((x) => x.filePath === s) ??
      tabs.find((x) => x.title.toLowerCase() === s.toLowerCase());
    if (!t) throw new Error(`no open drawing "${s}" (see list_drawings)`);
    return t.id;
  }

  /** The tab's Excalidraw API once its scene has loaded. */
  async function apiFor(tabId: string): Promise<ExcalidrawImperativeAPI> {
    const start = Date.now();
    for (;;) {
      const api = host.api(tabId);
      if (api && !api.getAppState().isLoading) return api;
      if (Date.now() - start > 15000) throw new Error("drawing did not finish loading");
      await sleep(50);
    }
  }

  async function target(p: Params): Promise<{ tabId: string; api: ExcalidrawImperativeAPI }> {
    const tabId = resolveTab(p.drawing);
    return { tabId, api: await apiFor(tabId) };
  }

  function tabSummary(tabId: string) {
    const t = host.tabs().find((x) => x.id === tabId)!;
    const api = host.api(tabId);
    return {
      id: t.id,
      title: t.title,
      path: t.filePath,
      dirty: t.dirty,
      active: t.id === host.activeId(),
      elements: api ? listable(api.getSceneElements()).length : null,
    };
  }

  async function clickHistory(tabId: string, which: "undo" | "redo", steps: number): Promise<number> {
    let done = 0;
    for (let i = 0; i < steps; i++) {
      const btn = document.querySelector<HTMLButtonElement>(`[data-md-tab="${tabId}"] [data-testid="button-${which}"]`);
      if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") break;
      btn.click();
      done++;
      await sleep(0);
    }
    return done;
  }

  // ---------- stencils ----------

  async function placeStencil(api: ExcalidrawImperativeAPI, p: Params) {
    const item = p.item as LibraryItem;
    const st = api.getAppState();
    const opts = { fontFamily: st.currentItemFontFamily as number, strokeColor: st.currentItemStrokeColor };
    const content = await loadStencil(item, { ...opts, label: false });
    const scene = api.getSceneElements();
    let elements = cloneForInsert(content.elements);
    if (!elements.length) throw new Error(`stencil "${item.name}" is empty`);
    const files = new Map<string, BinaryFileData>(content.files.map((f) => [f.id, trueColorFile(f)]));
    const isIcon = item.kind === "svg" || item.kind === "png";
    let image = isIcon ? (elements.find((e) => e.type === "image") as ExcalidrawImageElement | undefined) : undefined;

    // Size (icons): longest side in px.
    if (image && typeof p.size === "number" && p.size > 0) {
      const k = p.size / Math.max(image.width, image.height);
      image = newElementWith(image, { width: image.width * k, height: image.height * k });
      elements = elements.map((e) => (e.id === image!.id ? image! : e));
    }
    // Color (SVG icons).
    if (typeof p.color === "string") {
      if (!HEX.test(p.color)) throw new Error("color must be a hex color like #ff9900");
      if (!image || !files.get(image.fileId!) || !isRecolorableIcon(image, Object.fromEntries(files))) {
        throw new Error("only SVG icons can be recolored");
      }
      const r = await recoloredIcon(image, files.get(image.fileId!)!, p.color);
      if (r.file) files.set(r.file.id, r.file);
      image = r.element as ExcalidrawImageElement;
      elements = elements.map((e) => (e.id === image!.id ? image! : e));
    }
    // Label under the icon.
    const labelText = p.label === false || p.label === "" ? null : typeof p.label === "string" ? p.label : isIcon ? item.name : null;
    let label: El | undefined;
    if (labelText && image) {
      const [text] = convertToExcalidrawElements([
        {
          type: "text",
          x: 0,
          y: 0,
          text: labelText,
          fontSize: typeof p.fontSize === "number" ? p.fontSize : 14,
          fontFamily: opts.fontFamily as never,
          strokeColor: opts.strokeColor,
          textAlign: "center",
        },
      ]);
      label = {
        ...text,
        x: image.x + (image.width - text.width) / 2,
        y: image.y + image.height + 6,
        groupIds: image.groupIds,
      } as El;
      elements.push(label);
    }
    if (isIcon && image && !image.groupIds.length) {
      const g = randomId();
      elements = elements.map((e) => ({ ...e, groupIds: [g] }) as El);
      image = elements.find((e) => e.id === image!.id) as ExcalidrawImageElement;
    }

    // Placement.
    const box = boundsOf(elements);
    const anchor: Box = image ? boxOf(image) : box;
    const map = liveMap(api);
    let dx: number;
    let dy: number;
    let frameId: string | null = null;
    const side = (["right_of", "left_of", "above", "below"] as Side[]).find((s) => typeof p[s] === "string");
    if (side) {
      const refId = p[side] as string;
      const ref = map.get(refId);
      if (!ref) throw new Error(`no element with id "${refId}"`);
      const refBox = boundsOf(withGroupsAndLabels([refId], scene));
      const gap = typeof p.gap === "number" ? p.gap : PLACE_GAP;
      ({ dx, dy } = placeBeside(box, anchor, refBox, boxOf(ref), side, gap));
      frameId = ref.frameId;
    } else if (typeof p.inside === "string") {
      const frame = map.get(p.inside);
      if (!frame || (frame.type !== "frame" && frame.type !== "magicframe")) throw new Error(`"${p.inside}" is not a frame`);
      const c = center(boxOf(frame));
      const a = center(anchor);
      dx = (typeof p.x === "number" ? p.x : c.x) - a.x;
      dy = (typeof p.y === "number" ? p.y : c.y) - a.y;
      frameId = frame.id;
    } else if (typeof p.x === "number" && typeof p.y === "number") {
      const a = center(anchor);
      dx = p.x - a.x;
      dy = p.y - a.y;
    } else if (scene.length) {
      // Default: to the right of everything, top-aligned.
      const all = boundsOf(scene);
      dx = all.x + all.width + PLACE_GAP - box.x;
      dy = all.y - box.y;
    } else {
      dx = -box.x;
      dy = -box.y;
    }
    const placed = elements.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy, frameId: frameId ?? e.frameId }) as El);
    commit(api, [], placed);
    if (files.size) api.addFiles([...files.values()]);
    host.markStencilUsed(item.id);
    const placedImage = image && placed.find((e) => e.id === image!.id);
    return {
      ids: placed.map((e) => e.id),
      icon: placedImage?.id ?? null,
      label: label?.id ?? null,
      groupId: placed[0].groupIds.at(-1) ?? null,
      bounds: boundsOf(placed),
      hint: placedImage ? `connect arrows to the icon id "${placedImage.id}"` : undefined,
    };
  }

  function stencilContent(api: ExcalidrawImperativeAPI, p: Params) {
    let elements: El[];
    if (Array.isArray(p.ids)) {
      elements = withGroupsAndLabels(strArray(p.ids, "ids"), api.getSceneElements());
    } else {
      const sel = api.getAppState().selectedElementIds;
      const map = liveMap(api);
      const ids = api.getSceneElements().filter((e) => sel[e.id]).map((e) => e.id);
      elements = ids.length ? withGroupsAndLabels(ids, [...map.values()]) : [];
    }
    const files = api.getFiles();
    const used: Record<string, unknown> = {};
    for (const el of elements) if (el.type === "image" && el.fileId && files[el.fileId]) used[el.fileId] = files[el.fileId];
    return { elements: JSON.parse(JSON.stringify(elements)), files: used };
  }

  async function recolor(api: ExcalidrawImperativeAPI, p: Params) {
    const ids = strArray(p.ids, "ids");
    const color = p.color === null ? null : String(p.color ?? "");
    if (color !== null && !HEX.test(color)) throw new Error("color must be a hex color like #ff9900, or null for the original icon colors");
    const map = liveMap(api);
    const files = api.getFiles();
    const changed: El[] = [];
    const newFiles: BinaryFileData[] = [];
    let icons = 0;
    let shapes = 0;
    for (const id of ids) {
      const el = map.get(id);
      if (!el) throw new Error(`no element with id "${id}"`);
      if (el.type === "image" && !isRecolorableIcon(el, files)) {
        throw new Error(`"${id}" is a raster image; only SVG icons can be recolored`);
      }
      if (isRecolorableIcon(el, files)) {
        const r = await recoloredIcon(el, files[el.fileId!], color);
        changed.push(r.element);
        if (r.file) newFiles.push(r.file);
        icons++;
      } else {
        if (color === null) throw new Error(`"${id}" is a ${el.type}; color null only restores icons`);
        const patch: Record<string, string> = { strokeColor: color };
        if (p.fill === true && el.type !== "text" && el.type !== "arrow" && el.type !== "line") patch.backgroundColor = color;
        changed.push(newElementWith(el, patch));
        const text = boundTextOf(el, map);
        if (text && p.text !== false && el.type !== "text") changed.push(newElementWith(text, { strokeColor: color }));
        shapes++;
      }
    }
    commit(api, changed);
    if (newFiles.length) api.addFiles(newFiles);
    return { icons, shapes };
  }

  // ---------- dispatch ----------

  async function exec(method: string, p: Params): Promise<unknown> {
    switch (method) {
      case "list_drawings":
        return host.tabs().map((t) => tabSummary(t.id));

      case "new_drawing": {
        const id = host.newDrawing(typeof p.title === "string" && p.title.trim() ? p.title.trim() : undefined);
        await apiFor(id);
        return tabSummary(id);
      }

      case "open_files": {
        const files = p.files as OpenedFile[];
        await host.openFiles(files);
        const t = host.tabs().find((x) => x.filePath === files[0]?.path);
        if (!t) throw new Error("could not open the drawing");
        await apiFor(t.id);
        return tabSummary(t.id);
      }

      case "activate_drawing": {
        const id = resolveTab(p.drawing);
        host.activate(id);
        return tabSummary(id);
      }

      case "save": {
        const { tabId } = await target(p);
        const path = await host.save(tabId, typeof p.path === "string" ? p.path : undefined);
        return { path };
      }

      case "render_export": {
        const { api } = await target(p);
        const format = String(p.format);
        if (format === "excalidraw") {
          if (p.ids !== undefined || p.scope === "selection") {
            throw new Error("excalidraw export always writes the whole drawing; use save_as_stencil for a part of it");
          }
          return { data: serializeScene(api) };
        }
        const ids = Array.isArray(p.ids)
          ? new Set(withGroupsAndLabels(strArray(p.ids, "ids"), api.getSceneElements()).map((e) => e.id))
          : undefined;
        const scope = p.scope === "selection" ? "selection" : "all";
        if (!exportElements(api, scope, ids).length) {
          throw new Error(scope === "selection" && !ids ? "nothing to export: nothing is selected" : "nothing to export: the drawing is empty");
        }
        const scale = Math.min(Math.max(Math.round(Number(p.scale) || (p.maxSize ? 2 : 2)), 1), 4) as 1 | 2 | 3 | 4;
        const out = await renderExport(
          api,
          {
            ...DEFAULT_EXPORT_OPTIONS,
            format: format as ExportFormat,
            scope,
            scale,
            padding: typeof p.padding === "number" ? p.padding : DEFAULT_EXPORT_OPTIONS.padding,
            background: p.background !== false,
            darkMode: p.darkMode === true,
            jpgQuality: typeof p.quality === "number" ? Math.min(Math.max(p.quality, 0.1), 1) : DEFAULT_EXPORT_OPTIONS.jpgQuality,
            embedScene: p.embedScene === true,
          },
          typeof p.maxSize === "number" ? p.maxSize : undefined,
          ids,
        );
        return { data: out.data };
      }

      case "get_scene": {
        const { tabId, api } = await target(p);
        const all = api.getSceneElements();
        const map = liveMap(api);
        const st = api.getAppState();
        let els = listable(all);
        if (Array.isArray(p.ids)) {
          const want = new Set(strArray(p.ids, "ids"));
          els = els.filter((e) => want.has(e.id));
        }
        if (typeof p.type === "string") els = els.filter((e) => e.type === p.type);
        return {
          drawing: tabSummary(tabId),
          background: st.viewBackgroundColor,
          selected: Object.keys(st.selectedElementIds).filter((id) => st.selectedElementIds[id] && map.has(id)),
          bounds: all.length ? boundsOf(all) : null,
          elements: p.full === true ? JSON.parse(JSON.stringify(els)) : els.map((e) => describe(e, map)),
        };
      }

      case "get_selection": {
        const { api } = await target(p);
        const sel = api.getAppState().selectedElementIds;
        const map = liveMap(api);
        return listable(api.getSceneElements())
          .filter((e) => sel[e.id])
          .map((e) => describe(e, map));
      }

      case "get_element": {
        const { api } = await target(p);
        const map = liveMap(api);
        const ids = Array.isArray(p.ids) ? strArray(p.ids, "ids") : [String(p.id ?? "")];
        return ids.map((id) => {
          const el = map.get(id);
          if (!el) throw new Error(`no element with id "${id}"`);
          const text = boundTextOf(el, map);
          return { element: JSON.parse(JSON.stringify(el)), label: text ? JSON.parse(JSON.stringify(text)) : undefined };
        });
      }

      case "add_elements": {
        const { api } = await target(p);
        const r = buildElements(objArray(p.elements, "elements"), api.getSceneElementsIncludingDeleted(), api.getAppState());
        commit(api, r.changed, r.added);
        return { ids: r.ids };
      }

      case "connect": {
        const { api } = await target(p);
        const style = (p.style && typeof p.style === "object" ? p.style : {}) as Params;
        const sk: Params = {
          type: p.type === "line" ? "line" : "arrow",
          from: p.from,
          to: p.to,
          ...style,
        };
        if (typeof p.id === "string") sk.id = p.id;
        if (typeof p.label === "string" && p.label) sk.label = p.label;
        if (sk.type === "arrow") {
          if (p.startArrowhead !== undefined) sk.startArrowhead = p.startArrowhead;
          if (p.endArrowhead !== undefined) sk.endArrowhead = p.endArrowhead;
        }
        const r = buildElements([sk], api.getSceneElementsIncludingDeleted(), api.getAppState());
        commit(api, r.changed, r.added);
        return { id: r.ids[0] };
      }

      case "update_elements": {
        const { api } = await target(p);
        const r = applyUpdates(objArray(p.updates, "updates"), api.getSceneElements(), api.getAppState());
        commit(api, r.changed, r.added);
        return { updated: r.ids };
      }

      case "move": {
        const { api } = await target(p);
        const els = withGroupsAndLabels(strArray(p.ids, "ids"), api.getSceneElements());
        let dx = Number(p.dx) || 0;
        let dy = Number(p.dy) || 0;
        if (typeof p.x === "number" || typeof p.y === "number") {
          const b = boundsOf(els);
          if (typeof p.x === "number") dx = p.x - b.x;
          if (typeof p.y === "number") dy = p.y - b.y;
        }
        const movable = els.filter((e) => !(e.type === "text" && (e as El & { containerId?: string }).containerId));
        const r = applyUpdates(
          movable.map((e) => ({ id: e.id, dx, dy })),
          api.getSceneElements(),
          api.getAppState(),
        );
        commit(api, r.changed, r.added);
        return { moved: movable.map((e) => e.id), dx, dy };
      }

      case "delete_elements": {
        const { api } = await target(p);
        const out = deleteElements(strArray(p.ids, "ids"), api.getSceneElements());
        commit(api, out);
        return { deleted: out.filter((e) => e.isDeleted).map((e) => e.id) };
      }

      case "group": {
        const { api } = await target(p);
        const els = withGroupsAndLabels(strArray(p.ids, "ids"), api.getSceneElements());
        if (els.length < 2) throw new Error("group needs at least two elements");
        const g = randomId();
        commit(api, els.map((e) => newElementWith(e, { groupIds: [...e.groupIds, g] })));
        return { groupId: g, ids: els.map((e) => e.id) };
      }

      case "ungroup": {
        const { api } = await target(p);
        const all = api.getSceneElements();
        let groupIds: Set<string>;
        if (typeof p.groupId === "string") groupIds = new Set([p.groupId]);
        else {
          const map = liveMap(api);
          groupIds = new Set(
            strArray(p.ids, "ids")
              .map((id) => map.get(id)?.groupIds.at(-1))
              .filter((g): g is string => !!g),
          );
        }
        const changed = all
          .filter((e) => e.groupIds.some((g) => groupIds.has(g)))
          .map((e) => newElementWith(e, { groupIds: e.groupIds.filter((g) => !groupIds.has(g)) }));
        commit(api, changed);
        return { ungrouped: changed.map((e) => e.id) };
      }

      case "select": {
        const { api } = await target(p);
        const map = liveMap(api);
        const ids = strArray(p.ids ?? [], "ids");
        for (const id of ids) if (!map.has(id)) throw new Error(`no element with id "${id}"`);
        api.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
            selectedGroupIds: {},
          } as Partial<AppState> as AppState,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        return { selected: ids };
      }

      case "zoom_to_fit": {
        const { api } = await target(p);
        const els = Array.isArray(p.ids)
          ? withGroupsAndLabels(strArray(p.ids, "ids"), api.getSceneElements())
          : api.getSceneElements();
        if (els.length) api.scrollToContent(els as ExcalidrawElement[], { fitToContent: true, animate: false });
        return { ok: true };
      }

      case "undo":
      case "redo": {
        const { tabId } = await target(p);
        const steps = Math.min(Math.max(Math.round(Number(p.steps) || 1), 1), 100);
        const done = await clickHistory(tabId, method, steps);
        return { [method === "undo" ? "undone" : "redone"]: done };
      }

      case "set_scene": {
        const { api } = await target(p);
        const current = new Map(api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
        // Elements that replace live ones need a higher version, or Excalidraw (and dirty
        // tracking) would treat them as unchanged.
        const restored = restoreElements(objArray(p.elements, "elements") as never, null, { repairBindings: true }).map((e) => {
          const live = current.get(e.id);
          return live
            ? ({ ...e, version: Math.max(e.version, live.version) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } as typeof e)
            : e;
        });
        const old = [...current.values()].filter((e) => !e.isDeleted);
        const ids = new Set(restored.map((e) => e.id));
        api.updateScene({
          elements: [...old.filter((e) => !ids.has(e.id)).map((e) => newElementWith(e, { isDeleted: true })), ...restored],
          ...(typeof p.background === "string"
            ? { appState: { viewBackgroundColor: p.background } as Partial<AppState> as AppState }
            : {}),
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        addRawFiles(api, p.files);
        return { elements: restored.length };
      }

      case "raw_update": {
        const { api } = await target(p);
        const map = new Map(api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
        const changed: El[] = [];
        const fresh: unknown[] = [];
        for (const raw of objArray(p.elements, "elements")) {
          const e = raw as Params;
          if (typeof e.id !== "string") throw new Error("each element needs an id");
          const cur = map.get(e.id);
          if (cur) {
            const { id: _id, type: _t, version: _v, versionNonce: _n, ...patch } = e;
            changed.push(newElementWith(cur, patch as never));
          } else fresh.push(e);
        }
        const added = fresh.length ? restoreElements(fresh as never, null, { repairBindings: true }) : [];
        commit(api, changed, added);
        addRawFiles(api, p.files);
        return { updated: changed.map((e) => e.id), added: added.map((e) => e.id) };
      }

      case "place_stencil": {
        const { api } = await target(p);
        return placeStencil(api, p);
      }

      case "stencil_content": {
        const { api } = await target(p);
        return stencilContent(api, p);
      }

      case "recolor": {
        const { api } = await target(p);
        return recolor(api, p);
      }

      case "get_color": {
        const { api } = await target(p);
        const el = liveMap(api).get(String(p.id ?? ""));
        if (!el) throw new Error(`no element with id "${p.id}"`);
        return { color: await colorOfElement(api, el) };
      }

      default:
        throw new Error(`unknown method "${method}"`);
    }
  }

  function addRawFiles(api: ExcalidrawImperativeAPI, files: unknown) {
    if (!files || typeof files !== "object") return;
    const now = Date.now();
    const list = Object.entries(files as Record<string, Params>).map(([id, f]) =>
      trueColorFile({
        id: (f.id ?? id) as BinaryFileData["id"],
        dataURL: String(f.dataURL) as BinaryFileData["dataURL"],
        mimeType: String(f.mimeType ?? "image/png") as BinaryFileData["mimeType"],
        created: now,
        lastRetrieved: now,
      }),
    );
    if (list.length) api.addFiles(list);
  }

  return (cmd: AgentCommand): void => {
    chain = chain.then(async () => {
      // The main process has already given up on expired commands: never run them late.
      if (Date.now() > cmd.deadline) {
        reply({ id: cmd.id, ok: false, error: `${cmd.method} expired before it could run` });
        return;
      }
      let timer: number | undefined;
      try {
        const expired = new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(`${cmd.method} timed out`)), cmd.deadline - Date.now());
        });
        reply({ id: cmd.id, ok: true, result: await Promise.race([exec(cmd.method, cmd.params ?? {}), expired]) });
      } catch (e) {
        reply({ id: cmd.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        window.clearTimeout(timer);
      }
    });
  };
}
