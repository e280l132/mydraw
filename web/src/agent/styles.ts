// Apply themes and style presets to elements. Builds on applyUpdates so text re-measures, labels
// re-center and arrows stay attached; the executor commits the result as one undo step.
import type { AppState } from "@excalidraw/excalidraw/types";
import { inkColors, stylePatch, themeStyle, type StyleSpec, type Theme } from "../../../shared/styles";
import { applyUpdates, boundTextOf, isIconNode, typedText, type El, type ElMap } from "./sceneOps";

type Loose = Record<string, unknown>;

export interface StyleResult {
  changed: El[];
  added: El[];
  /** Number of elements restyled. */
  count: number;
}

const SKIP = new Set(["image", "frame", "magicframe", "embeddable", "iframe", "selection"]);

function kindOf(el: El): "shape" | "text" | "line" | null {
  if (SKIP.has(el.type)) return null;
  if (el.type === "text") return "text";
  if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") return "line";
  return "shape";
}

/**
 * Apply `style` to the given elements. A shape's style also goes to its bound label (color, font);
 * an icon node's container is left alone (it is borderless by design) but its caption is styled.
 * `inkTo` (themes) re-inks strokes that currently use any theme ink color.
 */
export function styleElements(
  els: readonly El[],
  style: StyleSpec,
  scene: readonly El[],
  st: AppState,
  opts: { inkTo?: string; onlyInk?: boolean; inks?: readonly Theme[] } = {},
): StyleResult {
  const live = scene.filter((e) => !e.isDeleted);
  const map: ElMap = new Map(live.map((e) => [e.id, e]));
  const updates = new Map<string, Loose>();
  const labelFor = new Set<string>(); // containers whose bound text changed font metrics

  const put = (id: string, patch: Loose) => {
    if (!Object.keys(patch).length) return;
    updates.set(id, { ...(updates.get(id) ?? {}), id, ...patch });
  };
  const inks = inkColors(opts.inks ?? []);
  const isInk = (c: string) => inks.includes(c.toLowerCase());

  for (const el of els) {
    const kind = kindOf(el);
    if (!kind) continue;
    const container = (el as El & Loose).containerId ? map.get((el as El & Loose).containerId as string) : undefined;
    // Bound text is styled through its container (below), so skip it as a root.
    if (container) continue;

    const node = isIconNode(el);
    const patch = node ? {} : stylePatch(style, kind);
    if (opts.inkTo && !node) {
      if (el.strokeColor && isInk(el.strokeColor)) patch.strokeColor = opts.inkTo;
      else if (opts.onlyInk) delete patch.strokeColor;
    }
    put(el.id, patch);

    // The label: color + font follow the container's style.
    const text = boundTextOf(el, map);
    if (text && kind !== "text") {
      const tp = stylePatch(style, "text");
      const t: Loose = {};
      if (tp.fontFamily !== undefined) t.fontFamily = tp.fontFamily;
      if (tp.fontSize !== undefined) t.fontSize = tp.fontSize;
      if (opts.inkTo) {
        if (isInk(text.strokeColor)) t.strokeColor = opts.inkTo;
      } else if (tp.strokeColor !== undefined) t.strokeColor = tp.strokeColor; // an icon node: stroke colors its caption
      if (tp.opacity !== undefined) t.opacity = tp.opacity;
      if (Object.keys(t).length) {
        put(text.id, t);
        if (t.fontFamily !== undefined || t.fontSize !== undefined) labelFor.add(el.id);
      }
    }
  }
  if (!updates.size) return { changed: [], added: [], count: 0 };

  // Pass 1: properties (bound text just takes the new font; its container re-fits in pass 2).
  const r1 = applyUpdates([...updates.values()], scene, st);
  const merged = new Map(live.map((e) => [e.id, e] as const));
  for (const c of r1.changed) merged.set(c.id, c);
  const changed = new Map(r1.changed.map((e) => [e.id, e] as const));
  const added = [...r1.added];

  // Pass 2: re-fit labels whose font changed.
  if (labelFor.size) {
    const relabels = [...labelFor].map((id) => {
      return { id, label: typedText(boundTextOf(merged.get(id)!, merged) as El | undefined) };
    }).filter((u) => u.label);
    if (relabels.length) {
      const r2 = applyUpdates(relabels, [...merged.values()], st);
      for (const c of r2.changed) changed.set(c.id, c);
      added.push(...r2.added);
    }
  }
  return { changed: [...changed.values()], added, count: updates.size };
}

/** Apply a theme to the whole drawing (or `only`). Canvas background is returned for the caller. */
export function applyThemeToScene(theme: Theme, scene: readonly El[], st: AppState, only?: readonly El[], allThemes: readonly Theme[] = []): StyleResult {
  const els = (only ?? scene).filter((e) => !e.isDeleted);
  return styleElements(els, themeStyle(theme), scene, st, { inkTo: theme.ink, onlyInk: true, inks: allThemes });
}
