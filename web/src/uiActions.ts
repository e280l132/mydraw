// Actions the UI runs directly on a drawing (command palette, panels). They mirror what the MCP
// tools do, with the same one-undo-step rule.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { fontIdOf, type StylePreset, type Theme } from "../../shared/styles";
import { applyThemeToScene, styleElements, type StyleResult } from "./agent/styles";
import { isIconNode, withGroupsAndLabels, type El } from "./agent/sceneOps";
import { allThemes } from "./styleStore";

/** Apply changed + added elements as ONE undoable scene update (merged by id, so concurrent edits survive). */
export function commitElements(
  api: ExcalidrawImperativeAPI,
  changed: readonly ExcalidrawElement[],
  added: readonly ExcalidrawElement[] = [],
  appState?: Partial<AppState>,
) {
  const byId = new Map(changed.map((e) => [e.id, e]));
  const current = api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e);
  api.updateScene({
    elements: [...current, ...added],
    ...(appState ? { appState: appState as AppState } : {}),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

const commitStyle = (api: ExcalidrawImperativeAPI, r: StyleResult, appState?: Partial<AppState>) =>
  commitElements(api, r.changed, r.added, appState);

/** Selected element ids (live elements only). */
export function selectedIds(api: ExcalidrawImperativeAPI): string[] {
  const sel = api.getAppState().selectedElementIds;
  return api
    .getSceneElements()
    .filter((e) => sel[e.id])
    .map((e) => e.id);
}

/** Apply a theme to the selection, or to the whole drawing (and its background) when nothing is selected. */
export function applyThemeTo(api: ExcalidrawImperativeAPI, theme: Theme): number {
  const scene = api.getSceneElements();
  const ids = selectedIds(api);
  const only = ids.length ? withGroupsAndLabels(ids, scene, { contents: false }) : undefined;
  const r = applyThemeToScene(theme, scene, api.getAppState(), only, allThemes());
  commitStyle(api, r, {
    ...(only ? {} : { viewBackgroundColor: theme.background }),
    currentItemRoughness: theme.roughness,
    currentItemRoundness: theme.roundness,
    currentItemFontFamily: fontIdOf(theme.fontFamily),
    currentItemStrokeWidth: theme.strokeWidth,
  } as Partial<AppState>);
  return r.count;
}

/** Apply a style preset to the selection. Returns how many elements changed (0 when nothing is selected). */
export function applyPresetTo(api: ExcalidrawImperativeAPI, preset: StylePreset): number {
  const ids = selectedIds(api);
  if (!ids.length) return 0;
  const scene = api.getSceneElements();
  const r = styleElements(withGroupsAndLabels(ids, scene, { contents: false }), preset.style, scene, api.getAppState(), { inks: allThemes() });
  commitStyle(api, r);
  return r.count;
}

/**
 * The elements that should carry a link for the selection: labels give way to their shape, and an
 * icon's image to its node (the borderless container), so each thing has exactly one link badge.
 */
export function linkOwners(api: ExcalidrawImperativeAPI): El[] {
  const scene = api.getSceneElements() as El[];
  const byId = new Map(scene.map((e) => [e.id, e]));
  const owners = new Map<string, El>();
  for (const id of selectedIds(api)) {
    let el = byId.get(id);
    if (!el) continue;
    if (el.type === "text" && (el as El & { containerId?: string | null }).containerId) el = byId.get((el as El & { containerId: string }).containerId) ?? el;
    if (el.type === "image") {
      const node = scene.find((n) => isIconNode(n) && n.groupIds.some((g) => el!.groupIds.includes(g)));
      if (node) el = node;
    }
    owners.set(el.id, el);
  }
  return [...owners.values()];
}

/** Set (or with null, remove) the link of the selection. Returns how many elements changed. One undo step. */
export function setSelectionLink(api: ExcalidrawImperativeAPI, link: string | null): number {
  const owners = linkOwners(api).filter((e) => (e.link ?? null) !== link);
  if (owners.length) commitElements(api, owners.map((e) => newElementWith(e, { link } as never)));
  return owners.length;
}
