// Tidy and Re-layout (menu Diagram, command palette). Both work on the selection, or on the whole
// drawing when nothing is selected, and are one undo step.
//  - Tidy keeps the arrangement: rows/columns lined up, gaps evened, overlaps pushed apart, zones grown
//    (`tidyDrawing`, the MCP `tidy` tool).
//  - Re-layout is the agent's auto_layout: a fresh ELK layout that follows the drawing's direction and
//    reading order, applied only when it measures clearly cleaner than what is there (onlyIfBetter).
// The judgment a layout engine lacks (roles, meaning) comes from Claude: the MCP `tidy_diagram` prompt.
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { autoLayout, tidyDrawing } from "./agent/diagram";
import { commitElements, selectedIds } from "./uiActions";

export interface TidyOutcome {
  scope: "selection" | "all";
  changed: boolean;
  message: string;
}

const scopeText = (s: TidyOutcome["scope"]) => (s === "all" ? "the drawing" : "the selection");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function commit(api: ExcalidrawImperativeAPI, r: { changed: unknown[]; added: unknown[] }): boolean {
  if (!r.changed.length && !r.added.length) return false;
  commitElements(api, r.changed as ExcalidrawElement[], r.added as ExcalidrawElement[]);
  return true;
}

export function tidyLayout(api: ExcalidrawImperativeAPI): TidyOutcome {
  const sel = selectedIds(api);
  const scope = sel.length ? "selection" : "all";
  const r = tidyDrawing(api.getSceneElements() as never, api.getAppState(), { ids: sel.length ? sel : undefined });
  const changed = commit(api, r);
  const s = r.result as { rows: number; columns: number; evened: number; overlaps: number };
  if (!changed) return { scope, changed, message: `${scopeText(scope)[0].toUpperCase()}${scopeText(scope).slice(1)} is already tidy. Try Re-layout for a fresh arrangement.` };
  const what = [s.rows && plural(s.rows, "row"), s.columns && plural(s.columns, "column")].filter(Boolean).join(" and ");
  const parts = [what && `lined up ${what}`, s.evened && `evened ${plural(s.evened, "spacing")}`, s.overlaps && `fixed ${plural(s.overlaps, "overlap")}`].filter(Boolean);
  return { scope, changed, message: `Tidied ${scopeText(scope)}: ${parts.join(", ") || "small moves"}. Undo to go back.` };
}

export async function relayout(api: ExcalidrawImperativeAPI): Promise<TidyOutcome> {
  const sel = selectedIds(api);
  const scope = sel.length ? "selection" : "all";
  const r = await autoLayout(api.getSceneElements() as never, api.getAppState(), { ids: sel.length ? sel : undefined, onlyIfBetter: true });
  const changed = commit(api, r);
  const res = r.result as { scoreBefore?: number; quality?: { score?: number }; direction?: string };
  if (!changed) return { scope, changed, message: `No cleaner layout found for ${scopeText(scope)}: left as it is.` };
  const gain = res.scoreBefore !== undefined && res.quality?.score !== undefined ? ` (score ${Math.round(res.scoreBefore)} → ${Math.round(res.quality.score)}, lower is cleaner)` : "";
  return { scope, changed, message: `Re-laid out ${scopeText(scope)}${res.direction ? `, flowing ${res.direction}` : ""}${gain}. Undo to go back.` };
}
