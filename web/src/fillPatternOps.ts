// Hatch pattern (line width + spacing, shared/fillPattern.ts) on the canvas:
// - `pinPatterns`: App's onChange pass. When an element's stroke width changes (Excalidraw's own
//   S/M/L buttons, the agent, styles) and it stores no pattern yet, the pattern of its old width is
//   stored, so the stroke width changes only the outline. EVENTUALLY: merged into that change's undo step.
// - targets / current value / apply / drag session for the Pattern sliders in the Fill popover.
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { patternOf, patternPins, storedPattern, takesPattern, withPattern, type FillPattern } from "../../shared/fillPattern";
import type { El } from "./agent/sceneOps";
import { commitElements } from "./uiActions";

type Loose = Record<string, unknown>;

/** Per-tab state for `pinPatterns`: id -> the stroke width its pattern follows. */
export interface PatternTracker {
  basis: Map<string, number> | null;
}
export const newPatternTracker = (): PatternTracker => ({ basis: null });

export function pinPatterns(api: ExcalidrawImperativeAPI, t: PatternTracker, elements: readonly ExcalidrawElement[]): void {
  const r = patternPins(t.basis, elements as never);
  t.basis = r.basis;
  if (!r.pins.length) return;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const changed = new Map<string, ExcalidrawElement>();
  for (const p of r.pins) {
    const e = byId.get(p.id);
    if (e) changed.set(e.id, newElementWith(e, { customData: withPattern(e.customData as Loose | undefined, p.pattern) } as never));
  }
  // Deferred: Excalidraw is still inside its own update when onChange runs.
  queueMicrotask(() =>
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((e) => {
        const c = changed.get(e.id);
        return c && e.version <= c.version - 1 && !storedPattern(e as never) ? c : e;
      }),
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    }),
  );
}

/** Selected, unlocked elements with a fill pattern (icon-node containers stay borderless). */
export function patternTargets(api: ExcalidrawImperativeAPI): El[] {
  const sel = api.getAppState().selectedElementIds;
  return api
    .getSceneElements()
    .filter((e) => sel[e.id] && !e.locked && takesPattern(e.type) && !(e.customData as Loose | undefined)?.mydrawNode) as unknown as El[];
}

/** The pattern shown for a selection (the first element's), whether others differ, and whether it is stored. */
export function currentPattern(els: readonly El[]): { pattern: FillPattern; mixed: boolean; stored: boolean } | null {
  if (!els.length) return null;
  const pattern = patternOf(els[0] as never);
  const mixed = els.some((e) => {
    const p = patternOf(e as never);
    return p.weight !== pattern.weight || p.gap !== pattern.gap;
  });
  return { pattern, mixed, stored: els.some((e) => !!storedPattern(e as never)) };
}

export type PatternChange = Partial<FillPattern> | null;

function changedEl(e: El, change: PatternChange): ExcalidrawElement {
  const next = change ? { ...patternOf(e as never), ...change } : null;
  return newElementWith(e as unknown as ExcalidrawElement, { customData: withPattern(e.customData as Loose | undefined, next) } as never);
}

/** Set (or with null: drop, back to following the stroke width) the pattern of `els`. One undo step. */
export function applyPattern(api: ExcalidrawImperativeAPI, els: readonly El[], change: PatternChange): void {
  commitElements(api, els.map((e) => changedEl(e, change)));
}

/** A slider drag: quiet previews from the elements at the start, one undo step at the end. */
export class PatternSession {
  private base: El[];
  constructor(private api: ExcalidrawImperativeAPI, els: readonly El[]) {
    this.base = [...els];
  }
  preview(change: PatternChange) {
    const byId = new Map(this.base.map((e) => [e.id, changedEl(e, change)]));
    this.api.updateScene({ elements: this.api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
  }
  restore() {
    const byId = new Map(this.base.map((e) => [e.id, e as unknown as ExcalidrawElement]));
    this.api.updateScene({ elements: this.api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), captureUpdate: CaptureUpdateAction.NEVER });
  }
  commit(change: PatternChange) {
    this.restore();
    applyPattern(this.api, this.base, change);
  }
}
