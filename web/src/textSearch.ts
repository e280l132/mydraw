// Find & replace over the text of a drawing: standalone text and the labels of shapes, arrows and
// icon nodes. Replace-all is one undoable scene update.
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { countMatches, replaceInText, replaceNth, type FindOptions } from "../../shared/findReplace";
import { relabel, remeasureText, withGroupsAndLabels, type El, type ElMap } from "./agent/sceneOps";
import { commitElements, selectedIds } from "./uiActions";

export type FindScope = "all" | "selection";

type TextEl = El & { type: "text"; text: string; originalText: string; containerId: string | null };

const isText = (e: El): e is TextEl => e.type === "text" && !e.isDeleted;

/** The text elements a search covers: the whole drawing, or the selection (with the labels of selected shapes). */
export function textElements(api: ExcalidrawImperativeAPI, scope: FindScope, ids?: readonly string[]): TextEl[] {
  const scene = api.getSceneElements() as El[];
  if (scope === "all") return scene.filter(isText);
  return withGroupsAndLabels(ids ?? selectedIds(api), scene, { contents: false }).filter(isText);
}

/** What's visible to the user for one text element (the unwrapped text). */
const textOf = (e: TextEl) => e.originalText ?? e.text;

export interface MatchSummary {
  matches: number;
  /** Text elements containing at least one match. */
  elements: TextEl[];
}

export function findMatches(api: ExcalidrawImperativeAPI, find: string, opts: FindOptions, scope: FindScope, ids?: readonly string[]): MatchSummary {
  let matches = 0;
  const elements: TextEl[] = [];
  for (const t of textElements(api, scope, ids)) {
    const n = countMatches(textOf(t), find, opts);
    if (n) {
      matches += n;
      elements.push(t);
    }
  }
  return { matches, elements };
}

/** One match: the text element and which occurrence inside it (0-based). */
export interface MatchRef {
  el: TextEl;
  nth: number;
}

/** Every match in reading order (scene order, then position inside the text). `ids` fixes a selection scope. */
export function listMatches(api: ExcalidrawImperativeAPI, find: string, opts: FindOptions, scope: FindScope, ids?: readonly string[]): MatchRef[] {
  const out: MatchRef[] = [];
  for (const el of textElements(api, scope, ids)) {
    const n = countMatches(textOf(el), find, opts);
    for (let nth = 0; nth < n; nth++) out.push({ el, nth });
  }
  return out;
}

/** Select the shape (or standalone text) that holds a match and bring it into view. */
export function goToMatch(api: ExcalidrawImperativeAPI, ref: MatchRef): void {
  const map: ElMap = new Map((api.getSceneElements() as El[]).map((e) => [e.id, e]));
  const owner = ownerOf(ref.el, map);
  api.updateScene({
    appState: { selectedElementIds: { [owner.id]: true } } as never,
    captureUpdate: "NEVER" as never,
  });
  api.scrollToContent(owner as ExcalidrawElement, { fitToContent: true, animate: true, viewportZoomFactor: 0.6 });
}

/** Replace just this one match (one undo step). False if it is no longer there. */
export function replaceOne(api: ExcalidrawImperativeAPI, ref: MatchRef, find: string, replacement: string, opts: FindOptions): boolean {
  const scene = api.getSceneElements() as El[];
  const map: ElMap = new Map(scene.map((e) => [e.id, e]));
  const t = map.get(ref.el.id) as TextEl | undefined;
  if (!t || !isText(t)) return false;
  const r = replaceNth(textOf(t), find, replacement, opts, ref.nth);
  if (!r.replaced) return false;
  const container = t.containerId ? map.get(t.containerId) : undefined;
  if (container) {
    const out = relabel(container, r.text, map, api.getAppState());
    commitElements(api, out.changed, out.added);
  } else {
    commitElements(api, [remeasureText(t, { text: r.text })], []);
  }
  return true;
}

/** The shape a text belongs to, or the text itself when it stands alone. */
export function ownerOf(t: TextEl, map: ElMap): El {
  return (t.containerId && map.get(t.containerId)) || t;
}

/** Select the elements that contain matches and bring them into view. */
export function selectMatches(api: ExcalidrawImperativeAPI, find: string, opts: FindOptions, scope: FindScope, ids?: readonly string[]): number {
  const { elements } = findMatches(api, find, opts, scope, ids);
  if (!elements.length) return 0;
  const map: ElMap = new Map((api.getSceneElements() as El[]).map((e) => [e.id, e]));
  const owners = [...new Map(elements.map((t) => [ownerOf(t, map).id, ownerOf(t, map)])).values()];
  api.updateScene({
    appState: { selectedElementIds: Object.fromEntries(owners.map((o) => [o.id, true])) } as never,
    captureUpdate: "NEVER" as never,
  });
  api.scrollToContent(owners as ExcalidrawElement[], { fitToContent: true, animate: true });
  return owners.length;
}

export interface ReplaceResult {
  replacements: number;
  elements: number;
}

/** Replace every match. Labels go through `relabel` (so containers can grow), standalone text is re-measured. */
export function replaceAll(api: ExcalidrawImperativeAPI, find: string, replacement: string, opts: FindOptions, scope: FindScope, ids?: readonly string[]): ReplaceResult {
  const scene = api.getSceneElements() as El[];
  const map: ElMap = new Map(scene.map((e) => [e.id, e]));
  const st = api.getAppState();
  const changed: El[] = [];
  const added: El[] = [];
  let replacements = 0;
  let elements = 0;
  for (const t of textElements(api, scope, ids)) {
    const r = replaceInText(textOf(t), find, replacement, opts);
    if (!r.count) continue;
    replacements += r.count;
    elements += 1;
    const container = t.containerId ? map.get(t.containerId) : undefined;
    if (container) {
      const out = relabel(container, r.text, map, st);
      changed.push(...out.changed);
      added.push(...out.added);
    } else {
      changed.push(remeasureText(t, { text: r.text }));
    }
  }
  if (replacements) commitElements(api, changed, added);
  return { replacements, elements };
}
