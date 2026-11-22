// Pages = frames. Operations behind the page navigator: zoom, rename, reorder, add.
import { convertToExcalidrawElements, getCommonBounds, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { swapOffsets } from "../../shared/pageOrder";
import { applyUpdates, withGroupsAndLabels } from "./agent/sceneOps";
import { listFrames } from "./exportImage";
import { commitElements } from "./uiActions";

const PAGE_WIDTH = 1280;
const PAGE_HEIGHT = 720;
const PAGE_GAP = 80;

type El = ExcalidrawElement;

const frameById = (api: ExcalidrawImperativeAPI, id: string) =>
  api.getSceneElements().find((e) => e.id === id && (e.type === "frame" || e.type === "magicframe")) as El | undefined;

/** Bring a page into view and select it. */
export function zoomToPage(api: ExcalidrawImperativeAPI, id: string): void {
  const frame = frameById(api, id);
  if (!frame) return;
  api.updateScene({ appState: { selectedElementIds: { [id]: true } } as never, captureUpdate: "NEVER" as never });
  api.scrollToContent(frame, { fitToContent: true, animate: true });
}

/** Give a page a name (empty clears it, so it shows as "Frame N" again). One undo step. */
export function renamePage(api: ExcalidrawImperativeAPI, id: string, name: string): void {
  const frame = frameById(api, id);
  if (!frame) return;
  const next = name.trim();
  if (next === ((frame as { name?: string | null }).name ?? "")) return;
  commitElements(api, [newElementWith(frame, { name: next || null } as never)]);
}

/**
 * Move a page one place earlier/later by trading places with its neighbour; each page carries its
 * contents (and connected arrows follow). One undo step, and exports follow the new order because
 * page order is canvas position.
 */
export function movePage(api: ExcalidrawImperativeAPI, id: string, dir: -1 | 1): void {
  const ids = listFrames(api).map((f) => f.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  const [first, second] = dir === 1 ? [frameById(api, id), frameById(api, ids[j])] : [frameById(api, ids[j]), frameById(api, id)];
  if (!first || !second) return;
  const off = swapOffsets(first, second);
  const scene = api.getSceneElements() as El[];
  const movable = (frame: El) => withGroupsAndLabels([frame.id], scene).filter((e) => !(e.type === "text" && (e as El & { containerId?: string }).containerId));
  const moves = [
    ...movable(first).map((e) => ({ id: e.id, ...off.first })),
    ...movable(second).map((e) => ({ id: e.id, ...off.second })),
  ];
  const r = applyUpdates(moves, scene, api.getAppState());
  commitElements(api, r.changed, r.added);
}

/** Add an empty 16:9 page to the right of the existing ones (or in the middle of the view). */
export function addPage(api: ExcalidrawImperativeAPI): string {
  const frames = api.getSceneElements().filter((e) => e.type === "frame" || e.type === "magicframe");
  let x: number;
  let y: number;
  if (frames.length) {
    const [, minY, maxX] = getCommonBounds(frames);
    x = maxX + PAGE_GAP;
    y = minY;
  } else {
    const st = api.getAppState();
    x = -st.scrollX + st.width / st.zoom.value / 2 - PAGE_WIDTH / 2;
    y = -st.scrollY + st.height / st.zoom.value / 2 - PAGE_HEIGHT / 2;
  }
  const n = frames.length + 1;
  const [frame] = convertToExcalidrawElements([{ type: "frame", x, y, width: PAGE_WIDTH, height: PAGE_HEIGHT, name: `Page ${n}`, children: [] }]);
  const made = frame as El;
  commitElements(api, [], [made]);
  zoomToPage(api, made.id);
  return made.id;
}
