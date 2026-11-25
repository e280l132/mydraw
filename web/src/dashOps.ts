// Extra stroke styles (shared/dash.ts) on the canvas: which selected elements take one, applying a
// pick as one undo step, and the default for the next shape drawn (nothing selected).
// The default is stamped onto new shapes by `stampNewShadows` (web/src/shadowOps.ts), the same
// onChange pass that gives new shapes the default shadow.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, StrokeStyle } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { dashOf, dashPatch, DASH_STYLES, isDashId, type DashId } from "../../shared/dash";
import type { El } from "./agent/sceneOps";
import { commitElements } from "./uiActions";

const NEW_KEY = "mydraw.newDash";
const DASHABLE = new Set(["rectangle", "diamond", "ellipse", "arrow", "line"]);

/** Element types whose outline takes a dash pattern (freehand is a filled path; text has no stroke). */
export const dashable = (type: string) => DASHABLE.has(type);

/** The extra dash style for shapes drawn next, if any. */
export function newShapeDash(): DashId | null {
  try {
    const v = localStorage.getItem(NEW_KEY);
    return isDashId(v) ? v : null;
  } catch {
    return null;
  }
}

function setNewShapeDash(id: DashId | null) {
  try {
    if (id) localStorage.setItem(NEW_KEY, id);
    else localStorage.removeItem(NEW_KEY);
  } catch {
    /* private mode: the default just isn't kept */
  }
}

/** Selected, unlocked elements with an outline (icon-node containers stay borderless). */
export function dashTargets(api: ExcalidrawImperativeAPI): El[] {
  const sel = api.getAppState().selectedElementIds;
  return api
    .getSceneElements()
    .filter((e) => sel[e.id] && !e.locked && dashable(e.type) && !(e.customData as Record<string, unknown> | undefined)?.mydrawNode) as unknown as El[];
}

/**
 * The selection's common extra dash style ("" = none of ours, null = mixed); nothing selected = the
 * default for new shapes (only while the tool's stroke style still matches it).
 */
export function currentDash(api: ExcalidrawImperativeAPI, els: El[]): DashId | "" | null {
  if (!els.length) {
    const d = newShapeDash();
    return d && api.getAppState().currentItemStrokeStyle === DASH_STYLES[d].base ? d : "";
  }
  const first = dashOf(els[0]) ?? "";
  return els.every((e) => (dashOf(e) ?? "") === first) ? first : null;
}

/** Give the selection (or the next shapes) dash style `id`. One undo step. */
export function applyDash(api: ExcalidrawImperativeAPI, id: DashId): void {
  const els = dashTargets(api);
  const appState = { currentItemStrokeStyle: DASH_STYLES[id].base as StrokeStyle } as Partial<AppState>;
  if (!els.length) {
    setNewShapeDash(id);
    api.updateScene({ appState: appState as AppState, captureUpdate: CaptureUpdateAction.NEVER });
    return;
  }
  const changed = els
    .filter((e) => dashOf(e) !== id)
    .map((e) => newElementWith(e as unknown as ExcalidrawElement, dashPatch(e.customData as Record<string, unknown> | undefined, id) as never));
  commitElements(api, changed, [], appState);
}

/**
 * Excalidraw's own Stroke style buttons were used: drop our dash style from the selection (otherwise
 * clicking "Dashed" on a dash-dot line, already strokeStyle "dashed", would change nothing) and from
 * the default. Merged into Excalidraw's own change (EVENTUALLY), so still one undo step.
 */
export function clearDashAfterNative(api: ExcalidrawImperativeAPI, style: "solid" | "dashed" | "dotted"): void {
  setNewShapeDash(null);
  const els = dashTargets(api).filter((e) => (e.customData as Record<string, unknown> | undefined)?.mydrawDash);
  if (!els.length) return;
  const byId = new Map(
    els.map((e) => [e.id, newElementWith(e as unknown as ExcalidrawElement, dashPatch(e.customData as Record<string, unknown> | undefined, null, style) as never)]),
  );
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e),
    captureUpdate: CaptureUpdateAction.EVENTUALLY,
  });
}
