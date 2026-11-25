// Shadow panel logic (web/src/ShadowSection.tsx): which elements a shadow change reaches, the
// one-undo-step change, slider previews, the default shadow for new shapes. Drawn by shadowRender.ts.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canShadow, normalizeShadow, sameShadow, shadowOf, withShadow, type Shadow } from "../../shared/shadow";
import { boundTextOf, iconImageOf, iconNodeOf, isIconNode, type El } from "./agent/sceneOps";
import { commitElements, replaceQuietly } from "./uiActions";
import { DASH_KEY, DASH_STYLES } from "../../shared/dash";
import { dashable, newShapeDash } from "./dashOps";

type Loose = Record<string, unknown>;
/** Maps an element's current shadow to its next one (null = remove). */
export type ShadowChange = (current: Shadow | null, el: El) => Shadow | null;

export interface ShadowTargets {
  /** Elements the change reaches. */
  els: El[];
  /** The selection has labels / icon captions that "Labels too" would add. */
  hasLabels: boolean;
}

/**
 * Elements a shadow change reaches: each selected shape/text/line/arrow/image (locked ones skipped),
 * the image of an icon node (its container is an invisible box), and the text being edited. Labels of
 * shapes and arrows, icon captions and a stencil's free caption only with `labels`.
 */
export function shadowTargets(api: ExcalidrawImperativeAPI, labels: boolean): ShadowTargets {
  const st = api.getAppState();
  const sel = st.selectedElementIds;
  const all = api.getSceneElements() as unknown as El[];
  const byId = new Map(all.map((e) => [e.id, e]));
  const out = new Map<string, El>();
  const captions = new Map<string, El>();
  const imageGroups = new Set(all.filter((e) => sel[e.id] && e.type === "image").map((e) => e.groupIds[0]).filter(Boolean));
  const add = (e: El | undefined) => {
    if (e && !e.locked && !e.isDeleted && canShadow(e.type)) out.set(e.id, e);
  };
  for (const e of all) {
    if (!sel[e.id] || e.locked) continue;
    if (isIconNode(e)) {
      add(iconImageOf(e, byId));
      const cap = boundTextOf(e, byId);
      if (cap) captions.set(cap.id, cap);
      continue;
    }
    if (e.type === "text") {
      const containerId = (e as El & Loose).containerId as string | null | undefined;
      if (containerId || (e.groupIds[0] && imageGroups.has(e.groupIds[0])) || iconNodeOf(e, byId)) captions.set(e.id, e);
      else add(e);
      continue;
    }
    add(e);
    const label = boundTextOf(e, byId);
    if (label) captions.set(label.id, label);
  }
  const editing = st.editingTextElement;
  if (editing) {
    const live = byId.get(editing.id);
    if (live && live.type === "text" && !(live as El & Loose).containerId) add(live);
  }
  if (labels) for (const c of captions.values()) add(c);
  for (const id of out.keys()) captions.delete(id);
  return { els: [...out.values()], hasLabels: captions.size > 0 || (labels && [...out.values()].some((e) => e.type === "text" && !!(e as El & Loose).containerId)) };
}

/** The changed copies of `els` (only those whose shadow actually changes). */
function changes(els: readonly El[], change: ShadowChange): ExcalidrawElement[] {
  const out: ExcalidrawElement[] = [];
  for (const e of els) {
    const cur = shadowOf(e);
    const raw = change(cur, e);
    const next = raw ? normalizeShadow(raw) : null;
    if (sameShadow(cur, next)) continue;
    out.push(newElementWith(e as unknown as ExcalidrawElement, { customData: withShadow(e.customData, next) } as never));
  }
  return out;
}

/** Apply `change` to `els` as ONE undo step. Returns how many changed. */
export function applyShadow(api: ExcalidrawImperativeAPI, els: readonly El[], change: ShadowChange): number {
  const live = new Map(api.getSceneElements().map((e) => [e.id, e as unknown as El]));
  const changed = changes(els.map((e) => live.get(e.id) ?? e), change);
  if (changed.length) commitElements(api, changed);
  return changed.length;
}

/**
 * A slider drag: previews without undo entries from the elements as they were when the drag began
 * (so previews never compound), then restores them quietly and commits once (one undo step).
 */
export class ShadowSession {
  private readonly originals: El[];
  constructor(private readonly api: ExcalidrawImperativeAPI, els: readonly El[]) {
    this.originals = [...els];
  }
  preview(change: ShadowChange) {
    replaceQuietly(this.api, changes(this.originals, change));
  }
  commit(change: ShadowChange): number {
    const live = new Set(this.api.getSceneElements().map((e) => e.id));
    const originals = this.originals.filter((e) => live.has(e.id));
    replaceQuietly(this.api, originals as unknown as ExcalidrawElement[]);
    const changed = changes(originals, change);
    if (changed.length) commitElements(this.api, changed);
    return changed.length;
  }
}

// ---------- default shadow for new shapes ----------

const NEW_KEY = "mydraw.newShadow";

export function newShapeShadow(): Shadow | null {
  try {
    const raw = localStorage.getItem(NEW_KEY);
    return raw ? normalizeShadow(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function setNewShapeShadow(s: Shadow | null) {
  if (s) localStorage.setItem(NEW_KEY, JSON.stringify(s));
  else localStorage.removeItem(NEW_KEY);
  window.dispatchEvent(new Event("mydraw-new-shadow"));
}

/** Per-tab tracker state for `stampNewShadows`. */
export interface NewShadowTracker {
  known: Set<string> | null;
  /** Elements the user is creating right now (new ids being drawn or typed). */
  pending: Set<string>;
}

export const newTracker = (): NewShadowTracker => ({ known: null, pending: new Set() });

/**
 * Called from App's onChange: elements the user draws with a tool (or types as new free text) get the
 * default shadow when they are finished. Uses EVENTUALLY, so it merges into the creation's undo step.
 * Loaded, pasted, agent-made and duplicated elements never pass through `newElement` / editing, so
 * they are left alone.
 */
export function stampNewShadows(api: ExcalidrawImperativeAPI, t: NewShadowTracker, elements: readonly ExcalidrawElement[], st: AppState): void {
  const ids = new Set<string>();
  for (const e of elements) if (!e.isDeleted) ids.add(e.id);
  const prev = t.known;
  t.known = ids;
  if (!prev) return;
  const active = new Set<string>();
  for (const e of [st.newElement, st.editingTextElement, (st as AppState & { multiElement?: ExcalidrawElement | null }).multiElement]) {
    if (e) active.add(e.id);
  }
  for (const id of active) if (!prev.has(id) || t.pending.has(id)) t.pending.add(id);
  const done = [...t.pending].filter((id) => !active.has(id));
  if (!done.length) return;
  for (const id of done) t.pending.delete(id);
  const shadow = newShapeShadow();
  // The default extra dash style (web/src/dashOps.ts) also goes on what the user just drew, while the
  // tool's own stroke style is still that dash's fallback (picking Solid switches it off).
  const dash = newShapeDash();
  if (!shadow && !dash) return;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const changed: ExcalidrawElement[] = [];
  for (const id of done) {
    const e = byId.get(id);
    if (!e || e.isDeleted) continue;
    let data = e.customData as Loose | undefined;
    const isLabel = e.type === "text" && !!(e as unknown as Loose).containerId; // a label: its shape has the shadow
    if (shadow && canShadow(e.type) && !shadowOf(e as unknown as El) && !isLabel) data = withShadow(data, shadow);
    if (dash && dashable(e.type) && e.strokeStyle === DASH_STYLES[dash].base && !data?.[DASH_KEY]) data = { ...(data ?? {}), [DASH_KEY]: dash };
    if (data !== e.customData) changed.push(newElementWith(e, { customData: data } as never));
  }
  if (!changed.length) return;
  const m = new Map(changed.map((e) => [e.id, e]));
  // Deferred: Excalidraw is still inside its own update when onChange runs.
  queueMicrotask(() =>
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((e) => {
        const c = m.get(e.id);
        return c && e.version <= c.version - 1 ? c : e;
      }),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    }),
  );
}
