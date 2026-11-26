// Style Brush on the canvas (pure rules in shared/styleCopy.ts): which element a point or id paints,
// the combined change for a set of targets (one undo step), live previews without undo entries, and
// the loaded look + part chips that the overlay, "Paste look" and the palette share.
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import { captureLook, lookUpdates, normalizeLookParts, type Look, type LookEl, type LookPart, type LookTarget } from "../../shared/styleCopy";
import { applyUpdates, boundTextOf, iconImageOf, iconNodeOf, isIconNode, typedText, type El, type ElMap } from "./agent/sceneOps";
import { isRecolorableIcon, restyledIcon } from "./library/iconColor";
import { commitElements, replaceQuietly } from "./uiActions";

const PARTS_KEY = "mydraw.brushParts";

// ---------- loaded look (shared by the overlay, Paste look and the agent-free UI paths) ----------

export interface LoadedLook {
  look: Look;
  /** Id of the element it was picked up from (not painted onto itself). */
  sourceId: string;
}

let loaded: LoadedLook | null = null;
const listeners = new Set<() => void>();
export const loadedLook = () => loaded;
export function setLoadedLook(l: LoadedLook | null) {
  loaded = l;
  listeners.forEach((f) => f());
}
export function onLoadedLook(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function brushParts(): LookPart[] {
  try {
    return normalizeLookParts(JSON.parse(localStorage.getItem(PARTS_KEY) ?? "null"));
  } catch {
    return normalizeLookParts(null);
  }
}
export function setBrushParts(parts: readonly LookPart[]) {
  try {
    localStorage.setItem(PARTS_KEY, JSON.stringify(parts));
  } catch {
    /* private mode: chips just aren't remembered */
  }
}

// ---------- targets ----------

const sceneMap = (api: ExcalidrawImperativeAPI): ElMap =>
  new Map((api.getSceneElements() as unknown as El[]).map((e) => [e.id, e]));

/** The element a hit or id stands for: an icon's image/caption -> the icon node, a label -> its container. */
export function unitOf(el: El, map: ElMap): El {
  const node = iconNodeOf(el, map);
  if (node) return node;
  const cid = (el as El & { containerId?: string | null }).containerId;
  return (cid && map.get(cid)) || el;
}

/** What shared/styleCopy needs to know about `el`. A bare SVG image (a stencil) acts like an icon node. */
export function lookTargetOf(el: El, map: ElMap): LookTarget {
  if (isIconNode(el)) return { el: el as unknown as LookEl, label: boundTextOf(el, map) as unknown as LookEl, iconImage: iconImageOf(el, map) as unknown as LookEl };
  if (el.type === "image") {
    const asNode = { ...(el as unknown as LookEl), customData: { ...(el.customData ?? {}), mydrawNode: "icon" } };
    return { el: asNode, iconImage: el as unknown as LookEl };
  }
  return { el: el as unknown as LookEl, label: boundTextOf(el, map) as unknown as LookEl | undefined };
}

/** Pick up the look of element `id` (any member of a unit works). */
export function pickUpLook(api: ExcalidrawImperativeAPI, id: string): LoadedLook | null {
  const map = sceneMap(api);
  const el = map.get(id);
  if (!el) return null;
  const unit = unitOf(el, map);
  return { look: captureLook(lookTargetOf(unit, map)), sourceId: unit.id };
}

/** Pick up from the current selection (its first unit). */
export function pickUpSelection(api: ExcalidrawImperativeAPI): LoadedLook | null {
  const sel = api.getAppState().selectedElementIds;
  const first = api.getSceneElements().find((e) => sel[e.id]);
  return first ? pickUpLook(api, first.id) : null;
}

// ---------- painting ----------

export interface PaintResult {
  elements: ExcalidrawElement[];
  files: BinaryFileData[];
  /** Units that changed. */
  painted: string[];
}

/** Units in `ids` (deduplicated) that `look` with `parts` would change. */
export function paintableUnits(api: ExcalidrawImperativeAPI, look: Look, ids: readonly string[], parts: readonly LookPart[], skip?: string): string[] {
  const map = sceneMap(api);
  const out: string[] = [];
  for (const id of ids) {
    const el = map.get(id);
    if (!el) continue;
    const u = unitOf(el, map);
    if (u.id === skip || out.includes(u.id)) continue;
    if (lookUpdates(look, lookTargetOf(u, map), parts)) out.push(u.id);
  }
  return out;
}

/** The elements (and recoloured icon files) that painting `ids` gives. Throws nothing: bad targets are skipped. */
export async function paintChanges(api: ExcalidrawImperativeAPI, look: Look, ids: readonly string[], parts: readonly LookPart[], skip?: string): Promise<PaintResult | null> {
  const st = api.getAppState();
  const scene = api.getSceneElements() as unknown as El[];
  const map: ElMap = new Map(scene.map((e) => [e.id, e]));
  const updates: Record<string, unknown>[] = [];
  const refits: string[] = [];
  const icons: { imageId: string; color: string }[] = [];
  const painted: string[] = [];
  for (const id of paintableUnits(api, look, ids, parts, skip)) {
    const ch = lookUpdates(look, lookTargetOf(map.get(id)!, map), parts);
    if (!ch) continue;
    painted.push(id);
    updates.push(...ch.updates);
    if (ch.refit) refits.push(ch.refit);
    if (ch.iconColor) icons.push(ch.iconColor);
  }
  if (!painted.length) return null;

  // Pass 1: properties. Pass 2: labels whose font changed re-fit their container (as styleElements does).
  const changed = new Map<string, ExcalidrawElement>();
  let merged = scene;
  if (updates.length) {
    const r1 = applyUpdates(updates, scene, st);
    for (const c of r1.changed) changed.set(c.id, c as unknown as ExcalidrawElement);
    const m = new Map(scene.map((e) => [e.id, e] as const));
    for (const c of r1.changed) m.set(c.id, c);
    merged = [...m.values()];
    if (refits.length) {
      const relabels = refits
        .map((id) => ({ id, label: typedText(boundTextOf(m.get(id)!, m) as El | undefined) }))
        .filter((u) => u.label);
      if (relabels.length) for (const c of applyUpdates(relabels, merged, st).changed) changed.set(c.id, c as unknown as ExcalidrawElement);
    }
  }

  // Icons: recolour the image (a new SVG file), like the Icon colour target does.
  const files: BinaryFileData[] = [];
  const allFiles = api.getFiles();
  for (const { imageId, color } of icons) {
    const img = (changed.get(imageId) ?? map.get(imageId)) as unknown as ExcalidrawElement | undefined;
    if (!img || !isRecolorableIcon(img, allFiles)) continue;
    const r = await restyledIcon(img as ExcalidrawImageElement, allFiles[(img as ExcalidrawImageElement).fileId!], { color });
    if (!r) continue;
    changed.set(imageId, r.element);
    if (r.file) files.push(r.file);
  }
  return changed.size ? { elements: [...changed.values()], files, painted } : null;
}

/** Paint `ids` as one undo step. Returns the units painted. */
export async function paintLook(api: ExcalidrawImperativeAPI, look: Look, ids: readonly string[], parts: readonly LookPart[], skip?: string): Promise<string[]> {
  const r = await paintChanges(api, look, ids, parts, skip);
  if (!r) return [];
  commitElements(api, r.elements);
  if (r.files.length) api.addFiles(r.files); // after the elements point at them (see CLAUDE.md)
  return r.painted;
}

/**
 * Hover preview: shows a paint without an undo entry and puts the originals back on `clear`.
 * Calls are serialised; a preview that resolves after `clear` is dropped.
 */
export class BrushPreview {
  private originals: ExcalidrawElement[] = [];
  private gen = 0;
  constructor(private api: ExcalidrawImperativeAPI) {}

  async show(look: Look, ids: readonly string[], parts: readonly LookPart[], skip?: string): Promise<void> {
    this.clear();
    const gen = ++this.gen;
    const r = await paintChanges(this.api, look, ids, parts, skip);
    if (gen !== this.gen || !r) return;
    const live = new Map<string, ExcalidrawElement>(this.api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
    this.originals = r.elements.map((e) => live.get(e.id)).filter((e): e is ExcalidrawElement => !!e);
    replaceQuietly(this.api, r.elements);
    if (r.files.length) this.api.addFiles(r.files);
  }

  /** Put the previewed elements back as they were. */
  clear(): void {
    this.gen++;
    if (!this.originals.length) return;
    replaceQuietly(this.api, this.originals);
    this.originals = [];
  }

  get active(): boolean {
    return this.originals.length > 0;
  }
}
