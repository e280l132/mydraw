// Font size slider (web/src/FineTune.tsx): which text a size change reaches and what it changes.
//
// Excalidraw's own S/M/L/XL buttons change the selected text and the bound text (label) of selected
// shapes and arrows, then grow the container to fit. This does the same through `styleElements`
// (web/src/agent/styles.ts: the path presets and themes use), so a label's shape grows to fit and
// arrows follow, then anchors free text like Excalidraw does (`anchorAfterResize`).
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { anchorAfterResize, type TunableElement } from "../../shared/fineTune";
import { applyUpdates, boundTextOf, type El } from "./agent/sceneOps";
import { styleElements } from "./agent/styles";

type Loose = Record<string, unknown>;

/** Text a font size change reaches: selected text, plus the label of each selected shape or arrow. Locked text is skipped. */
export function fontSizeTargets(api: ExcalidrawImperativeAPI): El[] {
  const sel = api.getAppState().selectedElementIds;
  const all = api.getSceneElements() as unknown as El[];
  const byId = new Map(all.map((e) => [e.id, e]));
  const out = new Map<string, El>();
  for (const e of all) {
    if (!sel[e.id] || e.locked) continue;
    if (e.type === "text") {
      out.set(e.id, e);
      continue;
    }
    const label = boundTextOf(e, byId);
    if (label && !label.locked) out.set(label.id, label);
  }
  return [...out.values()];
}

/**
 * The elements that change when `texts` get `fontSize`, computed against `scene` (the state before
 * any preview, so successive previews never compound). Labels re-fit their shapes, arrows follow, free
 * text keeps its anchor.
 */
export function fontSizeChanges(scene: readonly El[], texts: readonly El[], fontSize: number, st: AppState): { changed: El[]; added: El[] } {
  const live = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  // A label is styled through its container; free text is its own root.
  const roots = new Map<string, El>();
  for (const t of texts) {
    const containerId = (t as El & Loose).containerId as string | null | undefined;
    const root = (containerId ? live.get(containerId) : undefined) ?? live.get(t.id) ?? t;
    roots.set(root.id, root);
  }
  if (!roots.size) return { changed: [], added: [] };

  const r1 = styleElements([...roots.values()], { fontSize }, scene, st);
  const changed = new Map(r1.changed.map((e) => [e.id, e]));
  const added = [...r1.added];

  // Free text: grow from the same point as Excalidraw's own size buttons. Going through applyUpdates
  // also re-routes arrows bound to the text.
  const moves: Loose[] = [];
  for (const next of r1.changed) {
    const prev = live.get(next.id);
    if (!prev || next.type !== "text" || (next as El & Loose).containerId) continue;
    const at = anchorAfterResize(prev as unknown as TunableElement, next as unknown as TunableElement);
    moves.push({ id: next.id, x: at.x, y: at.y });
  }
  if (moves.length) {
    const merged = scene.map((e) => changed.get(e.id) ?? e);
    const r2 = applyUpdates(moves, merged, st);
    for (const c of r2.changed) changed.set(c.id, c);
    added.push(...r2.added);
  }
  return { changed: [...changed.values()], added };
}
