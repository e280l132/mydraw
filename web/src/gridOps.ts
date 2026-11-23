// Grid actions on a drawing: snap the selection onto the layout grid.
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { snapOffset } from "../../shared/grid";
import { applyUpdates, boundsOf, withGroupsAndLabels, type El } from "./agent/sceneOps";
import { commitElements, selectedIds } from "./uiActions";

/**
 * Move every selected unit (a shape, or a whole group) so its top-left corner lies on a grid
 * crossing. Sizes are left alone. Labels and bound arrows follow (via `applyUpdates`); one undo step.
 * Returns how many units moved.
 */
export function snapSelectionToGrid(api: ExcalidrawImperativeAPI, size: number): number {
  const ids = selectedIds(api);
  if (!ids.length) return 0;
  const scene = api.getSceneElements() as El[];
  const members = withGroupsAndLabels(ids, scene).filter((e) => !(e.type === "text" && (e as El & { containerId?: string | null }).containerId));
  // One unit per outermost group, or per element when ungrouped.
  const units = new Map<string, El[]>();
  for (const e of members) {
    const key = e.groupIds.length ? `g:${e.groupIds[e.groupIds.length - 1]}` : `e:${e.id}`;
    units.set(key, [...(units.get(key) ?? []), e]);
  }
  const updates: Array<{ id: string; dx: number; dy: number }> = [];
  let moved = 0;
  for (const els of units.values()) {
    const b = boundsOf(els);
    const { dx, dy } = snapOffset(b, size);
    if (dx === 0 && dy === 0) continue;
    moved++;
    for (const e of els) updates.push({ id: e.id, dx, dy });
  }
  if (!updates.length) return 0;
  const r = applyUpdates(updates, scene, api.getAppState());
  commitElements(api, r.changed, r.added);
  return moved;
}
