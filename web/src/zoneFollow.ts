// A zone's contents follow it when the zone is moved by hand (or by any edit that moves only the
// zone rectangle). Agent `move` already carries contents; those elements have moved too, so they
// are left alone here.
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { applyUpdates, isZone, withGroupsAndLabels } from "./agent/sceneOps";

export type Positions = Map<string, { x: number; y: number; w: number; h: number }>;

export function snapshot(elements: readonly ExcalidrawElement[]): Positions {
  const out: Positions = new Map();
  for (const e of elements) if (!e.isDeleted) out.set(e.id, { x: e.x, y: e.y, w: e.width, h: e.height });
  return out;
}

/**
 * Compare the scene with the previous snapshot; for each zone that moved without being resized,
 * translate the contents that did not move. Returns the new snapshot.
 */
export function followZones(
  api: ExcalidrawImperativeAPI,
  prev: Positions | undefined,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
): Positions {
  const now = snapshot(elements);
  if (!prev?.size) return now;
  const live = elements.filter((e) => !e.isDeleted);
  const moves: Array<{ id: string; dx: number; dy: number }> = [];
  const claimed = new Set<string>();
  // Outer zones first, so a nested zone's contents are moved once (by the outermost zone that moved).
  for (const z of live.filter(isZone)) {
    const p = prev.get(z.id);
    if (!p) continue;
    const dx = z.x - p.x;
    const dy = z.y - p.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
    if (Math.abs(z.width - p.w) > 0.01 || Math.abs(z.height - p.h) > 0.01) continue; // resized, not moved
    for (const m of withGroupsAndLabels([z.id], live)) {
      if (m.id === z.id || claimed.has(m.id)) continue;
      if (m.type === "text" && (m as ExcalidrawElement & { containerId?: string | null }).containerId) continue; // follows its container
      const q = prev.get(m.id);
      if (!q || Math.abs(m.x - q.x) > 0.01 || Math.abs(m.y - q.y) > 0.01) continue; // already moved with the zone
      claimed.add(m.id);
      moves.push({ id: m.id, dx, dy });
    }
  }
  if (!moves.length) return now;
  const r = applyUpdates(moves, live, appState);
  const byId = new Map(r.changed.map((e) => [e.id, e]));
  const all = api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e);
  // EVENTUALLY: not its own undo step; it is recorded together with the move that caused it.
  api.updateScene({ elements: [...all, ...r.added], captureUpdate: CaptureUpdateAction.EVENTUALLY });
  return now;
}
