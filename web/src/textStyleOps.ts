// Bold / italic for selected text and labels (web/src/TextStyle.tsx, ⌘B / ⌘I, palette).
//
// Excalidraw keeps one font per text, so a style change = another face of the same typeface
// ("Inter" <-> "Inter Bold" <-> "Inter Bold Italic", registered by web/src/fontRegistry.tsx). The
// choice of face is pure (`faceFor` in shared/fonts.ts); this file finds the text, reads the state
// and applies the new font through `styleElements`, the path presets and the font size slider use:
// a label re-fits its shape, arrows follow, and one call is one undo step.
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canStyle, faceFor, isBoldFace, isItalicFace, type FontEntry } from "../../shared/fonts";
import type { El } from "./agent/sceneOps";
import { styleElements } from "./agent/styles";
import { commitElements } from "./uiActions";
import { customFonts, fontById, fontIdByName, fontNameById } from "./fontRegistry";
import { fontSizeTargets } from "./fontSizeOps";

type Loose = Record<string, unknown>;

export interface TextStyleState {
  /** Text the buttons act on (selected text + labels of selected shapes/arrows, locked skipped). */
  count: number;
  /** All of it is bold / italic. */
  bold: boolean;
  italic: boolean;
  /** Every text's typeface has a bold / italic face (the buttons are disabled otherwise). */
  canBold: boolean;
  canItalic: boolean;
}

export const NO_TEXT_STYLE: TextStyleState = { count: 0, bold: false, italic: false, canBold: false, canItalic: false };

const fontOf = (t: El): FontEntry | undefined => fontById((t as El & Loose).fontFamily as number);

/**
 * The text being edited, if any (Excalidraw's own font picker targets it too: while typing, the
 * selection can be empty), else the selected text and labels. A change applies to the whole text
 * element, not to the highlighted words: Excalidraw holds one font per text.
 * Texts in Excalidraw's own fonts (Excalifont, Nunito, ...) have no bold or italic face; the
 * buttons are disabled for them.
 */
export function textStyleTargets(api: ExcalidrawImperativeAPI): El[] {
  const editing = api.getAppState().editingTextElement;
  if (editing?.type === "text") {
    const live = (api.getSceneElements() as unknown as El[]).find((e) => e.id === editing.id);
    if (live && !live.locked) return [live];
  }
  return fontSizeTargets(api);
}

export function textStyleState(texts: readonly El[]): TextStyleState {
  if (!texts.length) return NO_TEXT_STYLE;
  const all = customFonts();
  let bold = true;
  let italic = true;
  let canBold = true;
  let canItalic = true;
  for (const t of texts) {
    const f = fontOf(t);
    if (!f) {
      bold = italic = canBold = canItalic = false;
      continue;
    }
    const can = canStyle(f, all);
    canBold &&= can.bold;
    canItalic &&= can.italic;
    bold &&= isBoldFace(f);
    italic &&= isItalicFace(f);
  }
  return { count: texts.length, bold, italic, canBold, canItalic };
}

/** The font id each text moves to (only texts that change), or null when a typeface lacks the face. */
export function planTextStyle(texts: readonly El[], want: { bold?: boolean; italic?: boolean }): Map<string, number> | null {
  const all = customFonts();
  const out = new Map<string, number>();
  for (const t of texts) {
    const f = fontOf(t);
    if (!f) return null;
    const next = faceFor(f, all, want);
    if (!next) return null;
    if (next.id !== f.id) out.set(t.id, next.id);
  }
  return out;
}

/**
 * Toggle bold or italic on the selection: all of it bold -> regular, otherwise all bold. Returns the
 * number of texts changed, or a reason string when nothing can be done.
 */
export function toggleTextStyle(api: ExcalidrawImperativeAPI, kind: "bold" | "italic"): number | string {
  const texts = textStyleTargets(api);
  if (!texts.length) return "Select some text, or a shape with a label, first.";
  const state = textStyleState(texts);
  if (kind === "bold" ? !state.canBold : !state.canItalic) {
    return kind === "bold" ? "This font has no bold face. Pick another font (Inter, Roboto, Caveat Bold, ...)." : "This font has no italic face. Italics exist for the Professional and Mono fonts.";
  }
  const turnOn = kind === "bold" ? !state.bold : !state.italic;
  return setTextStyle(api, texts, kind === "bold" ? { bold: turnOn } : { italic: turnOn });
}

/** Switch `texts` to the wanted face and commit one undo step. */
export function setTextStyle(api: ExcalidrawImperativeAPI, texts: readonly El[], want: { bold?: boolean; italic?: boolean }): number | string {
  const plan = planTextStyle(texts, want);
  if (!plan) return "That font has no such face.";
  if (!plan.size) return 0;
  const st = api.getAppState();
  const scene = api.getSceneElementsIncludingDeleted() as unknown as El[];
  const live = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const changed = new Map<string, El>();
  const added: El[] = [];
  // Group by target font id: one styleElements call per face, so each label re-fits once.
  const byFont = new Map<number, El[]>();
  for (const t of texts) {
    const id = plan.get(t.id);
    if (id === undefined) continue;
    // A label is styled through its container; free text is its own root.
    const containerId = (t as El & Loose).containerId as string | null | undefined;
    const root = (containerId ? live.get(containerId) : undefined) ?? t;
    byFont.set(id, [...(byFont.get(id) ?? []), root]);
  }
  let cursor = scene;
  for (const [id, roots] of byFont) {
    const name = fontNameById(id);
    if (!name || fontIdByName(name) === undefined) return "That font is not available.";
    const r = styleElements(roots, { fontFamily: name }, cursor, st as AppState);
    for (const e of r.changed) changed.set(e.id, e);
    added.push(...r.added);
    cursor = cursor.map((e) => changed.get(e.id) ?? e);
  }
  commitElements(api, [...changed.values()] as never, added as never);
  return plan.size;
}
