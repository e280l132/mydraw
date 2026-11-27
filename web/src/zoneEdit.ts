// Zone editing by hand (rules in shared/zoneEdit.ts): a click on a locked zone's title unlocks that
// zone and selects its rectangle (inside its group, so the title is not resized with it); Excalidraw
// then moves / resizes it, the style panel recolours it, a double-click on the title renames it.
// Contents and title follow the rectangle (web/src/zoneFollow.ts). Once the zone is no longer
// selected it is locked again. Lock changes are not undo steps (NEVER).
import { CaptureUpdateAction, newElementWith, viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { UNLOCKED_KEY, zonesToRelock, zoneTitleAt, type ZoneEditEl } from "../../shared/zoneEdit";

type El = ExcalidrawElement;

function setLocked(el: El, locked: boolean): El {
  const data = { ...(el.customData ?? {}) } as Record<string, unknown>;
  if (locked) delete data[UNLOCKED_KEY];
  else data[UNLOCKED_KEY] = true;
  return newElementWith(el, { locked, customData: data } as never);
}

/** Is the pointer over a locked zone title (selection tool)? For the hover cursor. */
export function isOverZoneTitle(api: ExcalidrawImperativeAPI, e: PointerEvent): boolean {
  const st = api.getAppState();
  if (st.activeTool.type !== "selection" || st.viewModeEnabled) return false;
  const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
  return !!zoneTitleAt(api.getSceneElements() as unknown as ZoneEditEl[], x, y);
}

/**
 * Handle a pointerdown on the canvas: when it hits a locked zone title with the selection tool,
 * unlock and select that zone and return true (the caller swallows the event).
 */
export function zoneTitleClick(api: ExcalidrawImperativeAPI, e: PointerEvent): boolean {
  if (e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false;
  const st = api.getAppState();
  if (st.activeTool.type !== "selection" || st.viewModeEnabled || st.editingTextElement) return false;
  const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
  const elements = api.getSceneElements();
  const hit = zoneTitleAt(elements as unknown as ZoneEditEl[], x, y);
  if (!hit) return false;
  const ids = new Set([hit.zone.id, hit.title.id]);
  const next = api.getSceneElementsIncludingDeleted().map((el) => (ids.has(el.id) ? setLocked(el, false) : el));
  const zone = elements.find((el) => el.id === hit.zone.id)!;
  api.updateScene({
    elements: next,
    appState: {
      // Inside the zone's group: the rectangle alone is selected, so a resize doesn't scale the title.
      editingGroupId: zone.groupIds[0] ?? null,
      selectedElementIds: { [zone.id]: true },
      selectedGroupIds: {},
    } as Partial<AppState> as never,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return true;
}

/** On every change: lock again the zones unlocked by a title click that are no longer selected. */
export function relockZones(api: ExcalidrawImperativeAPI, elements: readonly El[], appState: AppState): void {
  if (!elements.some((e) => e.customData?.[UNLOCKED_KEY])) return;
  // Not mid-gesture: Excalidraw may pass through an empty selection while it handles a press.
  if (appState.cursorButton === "down") return;
  const selected = new Set(Object.keys(appState.selectedElementIds).filter((k) => appState.selectedElementIds[k]));
  const ids = new Set(zonesToRelock(elements as unknown as ZoneEditEl[], selected, appState.editingTextElement?.id ?? null));
  if (!ids.size) return;
  const next = api.getSceneElementsIncludingDeleted().map((el) => (ids.has(el.id) ? setLocked(el, true) : el));
  const leaveGroup = appState.editingGroupId && elements.some((e) => ids.has(e.id) && e.groupIds[0] === appState.editingGroupId);
  api.updateScene({
    elements: next,
    ...(leaveGroup ? { appState: { editingGroupId: null } as never } : {}),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}
