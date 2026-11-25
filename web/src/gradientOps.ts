// Gradient fills (shared/gradient.ts) on the canvas: targets, one-undo-step changes, and clearing a
// gradient when one of Excalidraw's own Fill buttons is used.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canGradient, gradientOf, gradientPatch, sameGradient, storedGradient, type Gradient } from "../../shared/gradient";
import type { El } from "./agent/sceneOps";
import { commitElements } from "./uiActions";

type Data = Record<string, unknown> | undefined;

/** Selected, unlocked shapes that can take a gradient (icon-node containers stay borderless boxes). */
export function gradientTargets(api: ExcalidrawImperativeAPI): El[] {
  const sel = api.getAppState().selectedElementIds;
  return api
    .getSceneElements()
    .filter((e) => sel[e.id] && !e.locked && canGradient(e.type) && !(e.customData as Data)?.mydrawNode) as unknown as El[];
}

/** The selection's common gradient: null = none on any, "mixed" = differs. */
export function currentGradient(els: readonly El[]): Gradient | null | "mixed" {
  if (!els.length) return null;
  const first = gradientOf(els[0] as never);
  return els.every((e) => sameGradient(gradientOf(e as never), first)) ? first : "mixed";
}

export type GradientChange = (cur: Gradient | null, el: El) => Gradient | null;

/** Element with the change applied (or null when nothing changes). */
function changed(e: El, change: GradientChange): ExcalidrawElement | null {
  const cur = gradientOf(e as never);
  const next = change(cur, e);
  if (sameGradient(cur, next) && (next || !storedGradient(e as never))) return null;
  return newElementWith(e as unknown as ExcalidrawElement, gradientPatch(e.customData as Data, next) as never);
}

/** Apply to `els` as one undo step. */
export function applyGradient(api: ExcalidrawImperativeAPI, els: readonly El[], change: GradientChange): void {
  const out = els.map((e) => changed(e, change)).filter((e): e is ExcalidrawElement => !!e);
  if (out.length) commitElements(api, out);
}

/** Live preview while a color / angle is dragged: no undo entry; `restore` puts the start back. */
export class GradientSession {
  private base: El[];
  constructor(private api: ExcalidrawImperativeAPI, els: readonly El[]) {
    this.base = [...els];
  }
  preview(change: GradientChange) {
    const byId = new Map(this.base.map((e) => [e.id, changed(e, change) ?? (e as unknown as ExcalidrawElement)]));
    this.api.updateScene({ elements: this.api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
  }
  restore() {
    const byId = new Map(this.base.map((e) => [e.id, e as unknown as ExcalidrawElement]));
    this.api.updateScene({ elements: this.api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
  }
  commit(change: GradientChange) {
    this.restore();
    applyGradient(this.api, this.base, change);
  }
}

/**
 * One of Excalidraw's own Fill buttons was clicked: the selection becomes a plain fill (Solid would
 * otherwise leave the gradient on, since the fill is still `from`). Merged into Excalidraw's change.
 */
export function clearGradientAfterNative(api: ExcalidrawImperativeAPI): void {
  const els = gradientTargets(api).filter((e) => storedGradient(e as never));
  if (!els.length) return;
  const byId = new Map(els.map((e) => [e.id, newElementWith(e as unknown as ExcalidrawElement, gradientPatch(e.customData as Data, null) as never)]));
  api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.EVENTUALLY });
}
