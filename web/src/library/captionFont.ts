// The font of the name under an icon ("caption"): a hand font (Excalifont by default) under
// hand-drawn icons, the drawing's font under original ones, or always one of them
// (Settings.captionFont / captionHandFont, shared/iconSketch.ts captionFontName). Used when stencils
// are inserted (Stencils panel, agent, quick connect) and when an icon's style changes.
import { CaptureUpdateAction, FONT_FAMILY } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { captionFontName, DEFAULT_HAND_FONT, storedIconSketch, type CaptionFontMode } from "../../../shared/iconSketch";
import { customFonts, fontIdByName, fontNameById } from "../fontRegistry";
import { styleElements } from "../agent/styles";
import { boundTextOf, iconNodeOf, type El } from "../agent/sceneOps";

export interface CaptionPrefs {
  captionFont?: CaptionFontMode;
  captionHandFont?: string;
}

/** Font id of a font name, falling back to Excalifont for an unknown hand font. */
function idOf(name: string): number | undefined {
  return fontIdByName(name) ?? fontIdByName(DEFAULT_HAND_FONT) ?? (FONT_FAMILY.Excalifont as number);
}

/** Font id for the caption of an icon (`sketched` = drawn by hand); `current` = the drawing's font. */
export function captionFontId(prefs: CaptionPrefs | null | undefined, sketched: boolean, current: number): number {
  const name = captionFontName(prefs?.captionFont, sketched, prefs?.captionHandFont);
  return name ? (idOf(name) ?? current) : current;
}

/** CSS font-family that shows `name` in menus (Excalidraw's own fonts via their preview faces in styles.css). */
export function fontCss(name: string): string {
  const own = name === "Excalifont" || name === "Virgil" ? `, "md-preview-${name}"` : "";
  return `"${name}"${own}, sans-serif`;
}

/** Handwriting fonts to offer: Excalidraw's own, then mydraw's fun fonts (regular weight). */
export function handFonts(): string[] {
  const out = ["Excalifont", "Virgil"].filter((n) => fontIdByName(n) !== undefined);
  for (const f of customFonts()) {
    if (f.category !== "fun" || f.style !== "normal" || f.family !== f.typeface) continue;
    if (!out.includes(f.family)) out.push(f.family);
  }
  return out.length ? out : [DEFAULT_HAND_FONT];
}

const isHandFontId = (id: number) => {
  const name = fontNameById(id);
  return !!name && handFonts().includes(name);
};

/** The caption of each image: an icon node's bound text, or the one free text grouped with a stencil image. */
export function captionsOf(imageIds: Iterable<string>, scene: readonly El[]): Map<string, { owner: El; text: El }> {
  const map = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const out = new Map<string, { owner: El; text: El }>();
  for (const id of imageIds) {
    const img = map.get(id);
    if (!img || img.type !== "image") continue;
    const node = iconNodeOf(img, map);
    if (node && node.id !== img.id) {
      const text = boundTextOf(node, map);
      if (text) out.set(id, { owner: node, text });
      continue;
    }
    // A stencil from the panel: image + caption text in one group of exactly those two.
    const g = img.groupIds.at(-1);
    if (!g) continue;
    const members = [...map.values()].filter((e) => e.groupIds.includes(g));
    const texts = members.filter((e) => e.type === "text" && !(e as El & { containerId?: string }).containerId);
    if (members.length === 2 && texts.length === 1) out.set(id, { owner: texts[0], text: texts[0] });
  }
  return out;
}

/**
 * How the captions of `imageIds` are set: "match" when each one is what matching its icon gives,
 * else "hand" / "plain" when all use a hand font / not, "mixed", or null when there are none.
 */
export function captionStateOf(imageIds: Iterable<string>, scene: readonly El[], prefs: CaptionPrefs, current: number): "match" | "hand" | "plain" | "mixed" | null {
  const map = new Map(scene.map((e) => [e.id, e]));
  const caps = [...captionsOf(imageIds, scene)];
  if (!caps.length) return null;
  const fontOf = (t: El) => (t as El & { fontFamily: number }).fontFamily;
  const kinds = new Set(caps.map(([, { text }]) => (isHandFontId(fontOf(text)) ? "hand" : "plain")));
  const matching = caps.every(([id, { text }]) => fontOf(text) === captionFontId({ ...prefs, captionFont: "match" }, !!storedIconSketch(map.get(id)?.customData?.mydrawIconSketch), current));
  const sketchedKinds = new Set(caps.map(([id]) => !!storedIconSketch(map.get(id)?.customData?.mydrawIconSketch)));
  // Only call it "match" when that differs from plainly hand / plain (icons of both kinds), or the setting says so.
  if (matching && (sketchedKinds.size > 1 || prefs.captionFont === "match")) return "match";
  return kinds.size === 1 ? ([...kinds][0] as "hand" | "plain") : "mixed";
}

/**
 * Set the captions of `imageIds` to the font `mode` asks for (each icon's own sketch decides under
 * "match"). Labels re-fit. EVENTUALLY merges into the change just made (an icon restyle), so both are
 * one undo step; IMMEDIATELY makes it its own step. Returns how many captions changed.
 */
export function restyleCaptions(
  api: ExcalidrawImperativeAPI,
  imageIds: Iterable<string>,
  prefs: CaptionPrefs,
  capture: (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction] = CaptureUpdateAction.EVENTUALLY,
): number {
  const scene = api.getSceneElements() as readonly El[];
  const st = api.getAppState();
  const map = new Map(scene.map((e) => [e.id, e]));
  const byFont = new Map<string, El[]>();
  for (const [imageId, { owner, text }] of captionsOf(imageIds, scene)) {
    const img = map.get(imageId)!;
    const id = captionFontId(prefs, !!storedIconSketch(img.customData?.mydrawIconSketch), st.currentItemFontFamily as number);
    if ((text as El & { fontFamily: number }).fontFamily === id) continue;
    const name = fontNameById(id);
    if (!name) continue;
    byFont.set(name, [...(byFont.get(name) ?? []), owner]);
  }
  if (!byFont.size) return 0;
  const changed = new Map<string, El>();
  let n = 0;
  for (const [name, owners] of byFont) {
    const r = styleElements(owners, { fontFamily: name }, scene.map((e) => changed.get(e.id) ?? e), st);
    for (const c of r.changed) {
      // A free caption keeps its centre under the icon (its x is its left edge).
      const before = map.get(c.id);
      const fix = before && c.type === "text" && !(c as El & { containerId?: string }).containerId && c.width !== before.width;
      changed.set(c.id, fix ? ({ ...c, x: before.x + (before.width - c.width) / 2 } as El) : c);
    }
    n += owners.length;
  }
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((e) => changed.get(e.id) ?? e),
    captureUpdate: capture,
  });
  return n;
}
