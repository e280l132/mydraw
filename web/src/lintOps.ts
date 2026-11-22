// Diagram lint on a live drawing: runs the pure rules (shared/lint.ts) on the scene, applies the
// safe fixes as ONE undo step, and reveals an issue's element. Used by LintPanel.tsx and the MCP
// tool lint_diagram (web/src/agent/executor.ts). (Not "lint.ts" next to "LintPanel.tsx": keep logic
// and component names apart on a case-insensitive disk.)
import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { lintScene, type LintEl, type LintIssue, type LintOptions, type LintResult } from "../../shared/lint";
import { resolveColor } from "../../shared/palettes";
import { BIND_GAP, reroute, type El, type ElMap } from "./agent/sceneOps";
import { allPresets, allThemes } from "./styleStore";
import { commitElements } from "./uiActions";

/** Colors that are fine besides the built-in palettes: user themes and presets, the canvas color. */
function extraColors(api: ExcalidrawImperativeAPI): string[] {
  const out = [api.getAppState().viewBackgroundColor];
  for (const t of allThemes()) out.push(t.ink, t.background);
  for (const p of allPresets()) {
    for (const c of [p.style.strokeColor, p.style.backgroundColor]) {
      const r = c ? resolveColor(c) : null;
      if (r) out.push(r);
    }
  }
  return out;
}

/** Lint the drawing. */
export function lintDrawing(api: ExcalidrawImperativeAPI, opts: Pick<LintOptions, "rules"> = {}): LintResult {
  return lintScene(api.getSceneElements() as unknown as LintEl[], { rules: opts.rules, allowedColors: extraColors(api) });
}

/** Cheap key that changes whenever any element changes (to skip re-linting on selection/scroll). */
export function sceneKey(api: ExcalidrawImperativeAPI): string {
  let v = 0;
  const all = api.getSceneElementsIncludingDeleted();
  for (const e of all) v += e.version;
  return `${all.length}:${v}:${api.getAppState().viewBackgroundColor}`;
}

const addBound = (el: El, id: string): El => {
  const list = el.boundElements ?? [];
  return list.some((b) => b.id === id) ? el : newElementWith(el, { boundElements: [...list, { id, type: "arrow" }] });
};

/**
 * The element changes for the fixes of `issues` (issues without a fix are skipped). Fixes run in
 * order against a working copy of the scene, so several fixes on one element combine.
 */
export function fixChanges(api: ExcalidrawImperativeAPI, issues: readonly LintIssue[]): { changed: El[]; fixed: number } {
  const map: ElMap = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const changed = new Map<string, El>();
  const put = (el: El) => {
    map.set(el.id, el);
    changed.set(el.id, el);
  };
  let fixed = 0;
  for (const issue of issues) {
    const fix = issue.fix;
    const el = map.get(issue.id);
    if (!fix || !el) continue;
    if (fix.kind === "color") {
      if ((el as unknown as Record<string, unknown>)[fix.property] === fix.color) continue;
      put(newElementWith(el, { [fix.property]: fix.color } as never));
      fixed++;
    } else if (fix.kind === "bind" && el.type === "arrow") {
      let arrow = el;
      let any = false;
      for (const end of ["start", "end"] as const) {
        const targetId = fix[end];
        const target = targetId ? map.get(targetId) : undefined;
        const key = end === "start" ? "startBinding" : "endBinding";
        const current = (arrow as unknown as Record<string, { elementId: string } | null>)[key];
        if (!target || (current && map.has(current.elementId))) continue;
        // reroute() turns this into a fixed-point binding for elbow arrows.
        arrow = newElementWith(arrow, { [key]: { elementId: target.id, focus: 0, gap: BIND_GAP } } as never);
        put(addBound(target, arrow.id));
        any = true;
      }
      if (!any) continue;
      map.set(arrow.id, arrow);
      const routed = reroute(arrow, map);
      put(arrow);
      for (const r of routed) put(r);
      fixed++;
    }
  }
  return { changed: [...changed.values()], fixed };
}

/** Apply the fixes of `issues` as ONE undo step. Returns how many issues were fixed. */
export function applyLintFixes(api: ExcalidrawImperativeAPI, issues: readonly LintIssue[]): number {
  const { changed, fixed } = fixChanges(api, issues);
  if (changed.length) commitElements(api, changed);
  return fixed;
}

/** Select an issue's element (and the other node of an overlap) and scroll it into view. Not an undo step. */
export function revealIssue(api: ExcalidrawImperativeAPI, issue: LintIssue): void {
  const scene = api.getSceneElements();
  const byId = new Map(scene.map((e) => [e.id, e]));
  let el = byId.get(issue.id);
  if (!el) return;
  // A label's row selects its shape or arrow.
  const containerId = (el as El & { containerId?: string | null }).containerId;
  if (el.type === "text" && containerId && byId.get(containerId)) el = byId.get(containerId)!;
  const ids = [el.id, ...(issue.other && byId.has(issue.other) ? [issue.other] : [])];
  api.updateScene({
    appState: { selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])), selectedGroupIds: {} } as never,
    captureUpdate: "NEVER" as never,
  });
  api.scrollToContent(
    ids.map((id) => byId.get(id)!),
    { animate: true },
  );
}
