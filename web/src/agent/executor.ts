// Runs agent (MCP) commands against the open drawings. Commands run one at a time, each against
// the latest scene, and each scene-changing command is applied as a single updateScene call, so it
// is one undo step and never overwrites edits the user made in the meantime (elements are merged
// by id).
import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import { normalizeSpec, tint, uniquifySpec, type DiagramSpec } from "../../../shared/diagram";
import { isFlowchart, parseMermaidFlowchart } from "../../../shared/mermaid";
import { PALETTES, requireColor, resolveColor } from "../../../shared/palettes";
import { FONTS, normalizeStyle, type StyleSpec } from "../../../shared/styles";
import { allPresets, allThemes, deletePreset, deleteTheme, findPreset, findTheme, savePreset, saveTheme, stylesReady } from "../styleStore";
import { applyThemeToScene, styleElements } from "./styles";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { isPagedFormat, type AgentCommand } from "../../../shared/agent";
import { PDF_PAGE_SIZES } from "../../../shared/pdfLayout";
import { center, placeBeside, type Box, type Side } from "../../../shared/geometry";
import type { LibraryItem } from "../../../shared/library";
import type { OpenedFile } from "../../../shared/types";
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_FORMATS,
  exportElements,
  findFrame,
  renderExport,
  renderFrameExports,
  type ExportFormat,
  type ExportOptions,
} from "../exportImage";
import { isRecolorableIcon, recoloredIcon } from "../library/iconColor";
import { colorOfElement } from "../library/pickColor";
import { cloneForInsert, loadStencil } from "../library/stencilContent";
import { autoLayout, buildDiagram, buildLegend, loadIconImage, makeIconNode, makeZone, zoneTitleSize } from "./diagram";
import { trueColorFile } from "../library/trueColor";
import { serializeScene } from "../scene";
import {
  applyUpdates,
  bindTarget,
  boundsOf,
  boundTextOf,
  boxOf,
  iconImageOf,
  isIconNode,
  isZone,
  zoneOf,
  buildElements,
  deleteElements,
  describe,
  listable,
  parseRouting,
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

function fail(message: string): never {
  throw new Error(message);
}

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

/**
 * Apply changed + added elements as one undoable scene update. Added elements go on top, or just
 * below `beforeId` (zones go behind their contents).
 */
function commit(api: ExcalidrawImperativeAPI, changed: readonly El[], added: readonly El[] = [], beforeId?: string): void {
  if (!changed.length && !added.length) return;
  const byId = new Map(changed.map((e) => [e.id, e]));
  const current = api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e);
  const at = beforeId ? current.findIndex((e) => e.id === beforeId) : -1;
  // Excalidraw orders by fractional index; dropping the index of moved/new elements makes it
  // re-derive them from the array order.
  const elements = at >= 0 ? [...current.slice(0, at), ...added.map((e) => ({ ...e, index: null }) as El), ...current.slice(at)] : [...current, ...added];
  api.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

/** Elements whose box crosses the border of a zone or frame (rather than sitting inside or outside it). */
function crossesBorder(box: Box, scene: readonly El[]): boolean {
  return scene.some((z) => {
    if (z.isDeleted || !(isZone(z) || z.type === "frame" || z.type === "magicframe")) return false;
    const inX = box.x < z.x + z.width && box.x + box.width > z.x;
    const inY = box.y < z.y + z.height && box.y + box.height > z.y;
    if (!inX || !inY) return false;
    const inside = box.x >= z.x && box.y >= z.y && box.x + box.width <= z.x + z.width && box.y + box.height <= z.y + z.height;
    return !inside;
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

  /** Where to put content (`box`, anchored on `anchor`) for place_stencil's position options. */
  function placement(api: ExcalidrawImperativeAPI, p: Params, box: Box, anchor: Box): { dx: number; dy: number; frameId: string | null; zone: string | null } {
    const scene = api.getSceneElements();
    const map = liveMap(api);
    const side = (["right_of", "left_of", "above", "below"] as Side[]).find((s) => typeof p[s] === "string");
    if (side) {
      const refId = p[side] as string;
      const ref = map.get(refId);
      if (!ref) throw new Error(`no element with id "${refId}"`);
      const node = bindTarget(ref, map);
      const refBox = boundsOf(withGroupsAndLabels([refId], scene).filter((e) => !isZone(e) || e.id === refId));
      const refAnchor = isIconNode(node) ? boxOf(iconImageOf(node, map) ?? node) : boxOf(ref);
      const gap = typeof p.gap === "number" ? p.gap : PLACE_GAP;
      return { ...placeBeside(box, anchor, refBox, refAnchor, side, gap), frameId: ref.frameId, zone: zoneOf(node) };
    }
    if (typeof p.inside === "string") {
      const z = map.get(p.inside);
      if (!z || !(z.type === "frame" || z.type === "magicframe" || isZone(z))) throw new Error(`"${p.inside}" is not a frame or zone`);
      const c = center(boxOf(z));
      const a = center(anchor);
      return {
        dx: (typeof p.x === "number" ? p.x : c.x) - a.x,
        dy: (typeof p.y === "number" ? p.y : c.y) - a.y,
        frameId: isZone(z) ? z.frameId : z.id,
        zone: isZone(z) ? z.id : null,
      };
    }
    if (typeof p.x === "number" && typeof p.y === "number") {
      const a = center(anchor);
      return { dx: p.x - a.x, dy: p.y - a.y, frameId: null, zone: null };
    }
    if (scene.length) {
      // Default: to the right of everything, top-aligned.
      const all = boundsOf(scene);
      return { dx: all.x + all.width + PLACE_GAP - box.x, dy: all.y - box.y, frameId: null, zone: null };
    }
    return { dx: -box.x, dy: -box.y, frameId: null, zone: null };
  }

  async function placeStencil(api: ExcalidrawImperativeAPI, p: Params) {
    const item = p.item as LibraryItem;
    const st = api.getAppState();
    const opts = { fontFamily: st.currentItemFontFamily as number, strokeColor: st.currentItemStrokeColor };
    const isIcon = item.kind === "svg" || item.kind === "png";

    if (isIcon) {
      // Icon + caption as one icon node (arrows bind to the node, clear of the caption).
      const { image, files } = await loadIconImage(item, {
        ...opts,
        size: typeof p.size === "number" && p.size > 0 ? p.size : undefined,
        color: typeof p.color === "string" ? p.color : undefined,
      });
      const caption = p.label === false || p.label === "" ? null : typeof p.label === "string" ? p.label : item.name;
      const build = (x: number, y: number, mask: string | null, zone: string | null) =>
        makeIconNode({
          image,
          caption,
          fontSize: typeof p.fontSize === "number" ? p.fontSize : undefined,
          ...opts,
          x,
          y,
          mask,
          customData: zone ? { mydrawZoneId: zone } : undefined,
          stencil: { id: item.id, name: item.name },
        });
      let els = build(0, 0, null, null);
      const at = placement(api, p, boundsOf(els), boxOf(els[1]));
      const box = { ...boundsOf(els), x: els[0].x + at.dx, y: els[0].y + at.dy };
      // On a zone border, a fill in the canvas color keeps the border line out of icon and caption.
      const mask = p.mask === false ? null : p.mask === true || crossesBorder(box, api.getSceneElements()) ? st.viewBackgroundColor : null;
      els = build(box.x, box.y, mask, at.zone).map((e) => ({ ...e, frameId: at.frameId }) as El);
      commit(api, [], els);
      api.addFiles(files);
      host.markStencilUsed(item.id);
      return {
        node: els[0].id,
        icon: els[1].id,
        label: els[2]?.id ?? null,
        ids: els.map((e) => e.id),
        groupId: els[0].groupIds[0],
        bounds: boundsOf(els),
        masked: !!mask,
        hint: `connect arrows to the node id "${els[0].id}"`,
      };
    }

    // Saved shape groups and Excalidraw library items: their elements, as saved.
    const content = await loadStencil(item, { ...opts, label: false });
    const elements = cloneForInsert(content.elements);
    if (!elements.length) throw new Error(`stencil "${item.name}" is empty`);
    if (typeof p.color === "string" || typeof p.size === "number") throw new Error("color and size apply to icons (SVG/PNG stencils) only");
    const files = new Map<string, BinaryFileData>(content.files.map((f) => [f.id, trueColorFile(f)]));
    const box = boundsOf(elements);
    const at = placement(api, p, box, box);
    const placed = elements.map((e) => ({ ...e, x: e.x + at.dx, y: e.y + at.dy, frameId: at.frameId ?? e.frameId }) as El);
    commit(api, [], placed);
    if (files.size) api.addFiles([...files.values()]);
    host.markStencilUsed(item.id);
    return {
      ids: placed.map((e) => e.id),
      node: null,
      icon: null,
      label: null,
      groupId: placed[0].groupIds.at(-1) ?? null,
      bounds: boundsOf(placed),
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
    const color = p.color === null ? null : resolveColor(String(p.color ?? "")) ?? "";
    if (color !== null && !HEX.test(color)) {
      throw new Error("color must be a hex color like #ff9900 or a palette name (blue-600, aws.orange), or null for the original icon colors");
    }
    const map = liveMap(api);
    const files = api.getFiles();
    const changed: El[] = [];
    const newFiles: BinaryFileData[] = [];
    let icons = 0;
    let shapes = 0;
    for (const id of ids) {
      let el = map.get(id);
      if (!el) throw new Error(`no element with id "${id}"`);
      // An icon node is recolored through its image.
      if (isIconNode(el)) el = iconImageOf(el, map) ?? el;
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
          if (p.ids !== undefined || (p.scope !== undefined && p.scope !== "all")) {
            throw new Error("excalidraw export always writes the whole drawing; use save_as_stencil for a part of it");
          }
          return { data: serializeScene(api) };
        }
        if (!EXPORT_FORMATS.includes(format as ExportFormat)) throw new Error(`unknown export format "${format}"`);
        const ids = Array.isArray(p.ids)
          ? new Set(withGroupsAndLabels(strArray(p.ids, "ids"), api.getSceneElements()).map((e) => e.id))
          : undefined;
        const scope = (["all", "selection", "frame", "frames"] as const).find((s) => s === p.scope) ?? "all";
        if (p.scope !== undefined && scope !== p.scope) throw new Error("scope must be all, selection, frame or frames");
        if (ids && (scope === "frame" || scope === "frames")) throw new Error("ids cannot be combined with scope frame/frames");
        let frameId: string | undefined;
        if (scope === "frame") {
          if (typeof p.frame !== "string" || !p.frame.trim()) throw new Error('scope "frame" needs `frame` (a frame name or id)');
          frameId = findFrame(api, p.frame).id;
        }
        const opts: ExportOptions = {
          ...DEFAULT_EXPORT_OPTIONS,
          format: format as ExportFormat,
          scope,
          frameId,
          scale: Math.min(Math.max(Math.round(Number(p.scale) || 2), 1), 4) as 1 | 2 | 3 | 4,
          padding: typeof p.padding === "number" ? Math.min(Math.max(p.padding, 0), 500) : DEFAULT_EXPORT_OPTIONS.padding,
          background: p.background !== false,
          darkMode: p.darkMode === true,
          quality: typeof p.quality === "number" ? Math.min(Math.max(p.quality, 0.1), 1) : DEFAULT_EXPORT_OPTIONS.quality,
          embedScene: p.embedScene === true,
          pageSize: p.pageSize === undefined ? "fit" : (PDF_PAGE_SIZES.find((x) => x === p.pageSize) ?? fail("pageSize must be fit, a4 or letter")),
          actualSize: p.actualSize === true,
          slideSize: p.slideSize === undefined ? "16:9" : p.slideSize === "4:3" || p.slideSize === "16:9" ? p.slideSize : fail('slideSize must be "16:9" or "4:3"'),
        };
        if (format === "pdf" && opts.actualSize && opts.pageSize === "fit") throw new Error("actualSize needs pageSize a4 or letter");
        if (scope === "frames" && !isPagedFormat(format)) {
          const files = await renderFrameExports(api, opts);
          return { files };
        }
        if (!exportElements(api, scope, ids, frameId).length) {
          throw new Error(scope === "selection" && !ids ? "nothing to export: nothing is selected" : "nothing to export: the drawing is empty");
        }
        const out = await renderExport(api, opts, typeof p.maxSize === "number" ? p.maxSize : undefined, ids);
        return { data: out.data, pages: out.pages, warnings: out.warnings };
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
        if (p.routing !== undefined) sk.routing = p.routing;
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

      case "list_palettes": {
        const only = typeof p.palette === "string" ? p.palette.toLowerCase() : null;
        const list = PALETTES.filter((x) => !only || x.id === only);
        if (only && !list.length) throw new Error(`no palette "${only}"; have ${PALETTES.map((x) => x.id).join(", ")}`);
        return list.map((x) => ({
          id: x.id,
          title: x.title,
          description: x.description,
          // The ramp is large: only list its names when asked for it.
          colors: x.id === "ramp" && !only ? "(pass palette:\"ramp\" for all names)" : x.colors,
        }));
      }

      case "list_themes":
        await stylesReady;
        return {
          themes: allThemes().map((t) => ({
            id: t.id,
            title: t.title,
            category: t.category,
            description: t.description,
            background: t.background,
            ink: t.ink,
            font: t.fontFamily,
            roughness: t.roughness,
            roundness: t.roundness,
            strokeWidth: t.strokeWidth,
            builtin: !!t.builtin,
          })),
          presets: allPresets().map((x) => ({ id: x.id, title: x.title, category: x.category, description: x.description, style: x.style, builtin: !!x.builtin })),
        };

      case "apply_theme": {
        const { api } = await target(p);
        await stylesReady;
        const theme = findTheme(String(p.theme ?? ""));
        if (!theme) throw new Error(`unknown theme "${p.theme}"; have ${allThemes().map((t) => t.id).join(", ")}`);
        const ids = p.ids === undefined ? null : strArray(p.ids, "ids");
        const scene = api.getSceneElements();
        const only = ids ? withGroupsAndLabels(ids, scene, { contents: false }) : undefined;
        const r = applyThemeToScene(theme, scene, api.getAppState(), only, allThemes());
        const whole = !ids && p.background !== false;
        const byId = new Map(r.changed.map((e) => [e.id, e]));
        const current = api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e);
        api.updateScene({
          elements: [...current, ...r.added],
          appState: {
            ...(whole ? { viewBackgroundColor: theme.background } : {}),
            currentItemRoughness: theme.roughness,
            currentItemRoundness: theme.roundness === "round" ? "round" : "sharp",
            currentItemFontFamily: FONTS[theme.fontFamily],
            currentItemStrokeWidth: theme.strokeWidth,
          } as Partial<AppState> as AppState,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        return { theme: theme.id, restyled: r.count, background: whole ? theme.background : undefined };
      }

      case "apply_style_preset": {
        const { api } = await target(p);
        let style: StyleSpec;
        let name: string;
        if (typeof p.preset === "string") {
          await stylesReady;
          const preset = findPreset(p.preset);
          if (!preset) throw new Error(`no style preset "${p.preset}"; list_themes shows them`);
          style = preset.style;
          name = preset.title;
        } else {
          style = normalizeStyle(p.style);
          name = "custom style";
        }
        const scene = api.getSceneElements();
        const ids = strArray(p.ids, "ids");
        const r = styleElements(withGroupsAndLabels(ids, scene, { contents: false }), style, scene, api.getAppState());
        commit(api, r.changed, r.added);
        return { preset: name, restyled: r.count };
      }

      case "save_style_preset": {
        const { api } = await target(p);
        let style: StyleSpec;
        if (typeof p.id === "string") {
          const el = liveMap(api).get(p.id) as (El & Record<string, unknown>) | undefined;
          if (!el) throw new Error(`no element with id "${p.id}"`);
          style = {
            strokeColor: el.strokeColor,
            ...(el.type !== "text" && el.type !== "arrow" && el.type !== "line"
              ? { backgroundColor: el.backgroundColor, fillStyle: el.fillStyle as StyleSpec["fillStyle"] }
              : {}),
            strokeWidth: el.strokeWidth,
            strokeStyle: el.strokeStyle as StyleSpec["strokeStyle"],
            opacity: el.opacity,
          };
        } else style = normalizeStyle(p.style);
        const preset = await savePreset({ title: p.name, category: p.category, description: p.description, style });
        return { saved: preset.id, category: preset.category, style: preset.style };
      }

      case "delete_style_preset": {
        await stylesReady;
        const preset = findPreset(String(p.name ?? ""));
        if (!preset) throw new Error(`no style preset "${p.name}"`);
        if (preset.builtin) throw new Error(`"${preset.title}" is built in and can't be deleted (save one with the same name to override it)`);
        await deletePreset(preset.id);
        return { deleted: preset.id };
      }

      case "save_theme": {
        const t = await saveTheme({
          title: p.name,
          category: p.category,
          description: p.description,
          background: p.background,
          ink: p.ink,
          fontFamily: p.fontFamily,
          roughness: p.roughness,
          roundness: p.roundness,
          strokeWidth: p.strokeWidth,
        });
        return { saved: t.id, category: t.category };
      }

      case "delete_theme": {
        await stylesReady;
        const t = findTheme(String(p.name ?? ""));
        if (!t) throw new Error(`no theme "${p.name}"`);
        if (t.builtin) throw new Error(`"${t.title}" is built in and can't be deleted`);
        await deleteTheme(t.id);
        return { deleted: t.id };
      }

      case "recolor": {
        const { api } = await target(p);
        return recolor(api, p);
      }

      case "get_color": {
        const { api } = await target(p);
        const map = liveMap(api);
        let el = map.get(String(p.id ?? ""));
        if (!el) throw new Error(`no element with id "${p.id}"`);
        if (isIconNode(el)) el = iconImageOf(el, map) ?? el;
        return { color: await colorOfElement(api, el) };
      }

      case "build_diagram": {
        const { api } = await target(p);
        // Main has already validated the spec and resolved icons; normalize again so the renderer
        // never trusts its input blindly.
        let spec = normalizeSpec(p.spec);
        if (p.renameOnClash) spec = uniquifySpec(spec, new Set(api.getSceneElementsIncludingDeleted().map((e) => e.id)));
        return buildAndCommit(api, spec, (p.items ?? {}) as Record<string, LibraryItem | null>, p.zoom !== false);
      }

      case "mermaid_to_scene": {
        const { api } = await target(p);
        const src = String(p.mermaid ?? "");
        if (!src.trim()) throw new Error("mermaid text is empty");
        if (isFlowchart(src)) {
          const spec = parseMermaidFlowchart(src);
          for (const k of ["direction", "algorithm", "routing", "spacing", "x", "y", "title", "legend"] as const) {
            if (p[k] !== undefined) (spec as unknown as Params)[k] = p[k];
          }
          const unique = uniquifySpec(normalizeSpec(spec), new Set(api.getSceneElementsIncludingDeleted().map((e) => e.id)));
          return { ...(await buildAndCommit(api, unique, {}, p.zoom !== false)), parsedAs: "flowchart" };
        }
        // Other diagram types: Mermaid's own renderer via Excalidraw's converter.
        const { parseMermaidToExcalidraw } = await import("@excalidraw/mermaid-to-excalidraw");
        let parsed;
        try {
          parsed = await parseMermaidToExcalidraw(src);
        } catch (e) {
          throw new Error(`Mermaid could not parse this: ${e instanceof Error ? e.message : String(e)}`);
        }
        let els = convertToExcalidrawElements(parsed.elements as never, { regenerateIds: true }) as El[];
        if (!els.length) throw new Error("the Mermaid diagram produced no elements");
        const b = boundsOf(els);
        const scene = api.getSceneElements();
        const o =
          typeof p.x === "number" || typeof p.y === "number"
            ? { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0 }
            : scene.length
              ? { x: boundsOf(scene).x + boundsOf(scene).width + PLACE_GAP, y: boundsOf(scene).y }
              : { x: 0, y: 0 };
        els = els.map((e) => ({ ...e, x: e.x + o.x - b.x, y: e.y + o.y - b.y }) as El);
        commit(api, [], els);
        const files = Object.values(parsed.files ?? {}) as BinaryFileData[];
        if (files.length) api.addFiles(files);
        if (p.zoom !== false) api.scrollToContent(els as ExcalidrawElement[], { fitToContent: true, animate: false });
        return { parsedAs: "mermaid", ids: listable(els).map((e) => e.id), bounds: boundsOf(els) };
      }

      case "create_zone": {
        const { api } = await target(p);
        return createZone(api, p);
      }

      case "add_legend": {
        const { api } = await target(p);
        const scene = api.getSceneElements();
        const st = api.getAppState();
        const scope = Array.isArray(p.ids) ? withGroupsAndLabels(strArray(p.ids, "ids"), scene) : scene;
        const old = scene.filter((e) => e.customData?.mydrawLegend);
        const legend = buildLegend(scope, {
          title: typeof p.title === "string" && p.title ? p.title : "Legend",
          fontFamily: st.currentItemFontFamily as number,
          roughness: st.currentItemRoughness,
          ink: st.currentItemStrokeColor,
          x: typeof p.x === "number" ? p.x : undefined,
          y: typeof p.y === "number" ? p.y : undefined,
        });
        commit(api, p.replace === false ? [] : old.map((e) => newElementWith(e, { isDeleted: true })), legend);
        return { legend: legend[0].id, ids: legend.map((e) => e.id), replaced: p.replace === false ? 0 : old.length, bounds: boundsOf(legend) };
      }

      case "auto_layout": {
        const { api } = await target(p);
        const r = await autoLayout(api.getSceneElements(), api.getAppState(), {
          ids: Array.isArray(p.ids) ? strArray(p.ids, "ids") : undefined,
          direction: p.direction as never,
          algorithm: p.algorithm as never,
          spacing: typeof p.spacing === "number" ? p.spacing : undefined,
          routing: p.routing === undefined ? undefined : parseRouting(p.routing, "elbow"),
        });
        commit(api, r.changed, r.added);
        return r.result;
      }

      default:
        throw new Error(`unknown method "${method}"`);
    }
  }

  async function buildAndCommit(api: ExcalidrawImperativeAPI, spec: DiagramSpec, items: Record<string, LibraryItem | null>, zoom: boolean) {
    const b = await buildDiagram(api.getSceneElementsIncludingDeleted(), api.getAppState(), spec, items);
    commit(api, [], b.added);
    // Files after the scene update, so Excalidraw starts loading them (see CLAUDE.md).
    if (b.files.length) api.addFiles(b.files);
    if (zoom) api.scrollToContent(b.added as ExcalidrawElement[], { fitToContent: true, animate: false });
    return b.result;
  }

  function createZone(api: ExcalidrawImperativeAPI, p: Params) {
    const scene = api.getSceneElements();
    const st = api.getAppState();
    const map = liveMap(api);
    const font = st.currentItemFontFamily as number;
    const label = typeof p.label === "string" && p.label ? p.label : null;
    const id = typeof p.id === "string" && p.id ? p.id : randomId();
    if (api.getSceneElementsIncludingDeleted().some((e) => e.id === id || e.id === `${id}.title`)) throw new Error(`id "${id}" is already used in this drawing`);
    const pad = typeof p.padding === "number" ? p.padding : 24;
    const { titleHeight, minWidth } = zoneTitleSize(label ?? undefined, font);
    const memberIds = Array.isArray(p.ids) ? strArray(p.ids, "ids") : [];
    const members = memberIds.map((m) => {
      const el = map.get(m);
      if (!el) throw new Error(`no element with id "${m}"`);
      return bindTarget(el, map);
    });
    let box: Box;
    if (members.length) {
      const b = boundsOf(withGroupsAndLabels(members.map((m) => m.id), scene));
      box = { x: b.x - pad, y: b.y - pad - titleHeight, width: Math.max(b.width + pad * 2, minWidth), height: b.height + pad * 2 + titleHeight };
    } else if ([p.x, p.y, p.width, p.height].every((v) => typeof v === "number")) {
      box = { x: p.x as number, y: p.y as number, width: p.width as number, height: p.height as number };
    } else throw new Error("give ids of the elements inside the zone, or x, y, width and height");
    let parent: string | null = typeof p.parent === "string" ? p.parent : null;
    if (parent && !isZone(map.get(parent))) throw new Error(`"${parent}" is not a zone`);
    if (!parent && members.length) {
      const zs = new Set(members.map((m) => zoneOf(m)));
      if (zs.size === 1) parent = [...zs][0];
    }
    const stroke = typeof p.color === "string" ? requireColor(p.color, "color") : "#1971c2";
    const fillColor = typeof p.fill === "string" ? requireColor(p.fill, "fill") : tint(stroke);
    const zone = makeZone({
      id,
      label,
      box,
      stroke,
      fill: fillColor,
      style: p.style === "dashed" || p.style === "dotted" ? p.style : "solid",
      strokeWidth: parent ? 1 : 2,
      roughness: st.currentItemRoughness,
      fontFamily: font,
      locked: p.locked !== false,
      parent,
    });
    const changed = members.map((m) => newElementWith(m, { customData: { ...(m.customData ?? {}), mydrawZoneId: id } }));
    // Behind its contents: just below the lowest member (or on top when it has none).
    const order = api.getSceneElementsIncludingDeleted();
    const memberSet = new Set(withGroupsAndLabels(members.map((m) => m.id), scene).map((e) => e.id));
    const first = order.find((e) => memberSet.has(e.id));
    commit(api, changed, zone, first?.id);
    return { zone: id, title: zone[1]?.id ?? null, members: members.map((m) => m.id), parent, bounds: box };
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
