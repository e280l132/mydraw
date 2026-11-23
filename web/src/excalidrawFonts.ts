// Access to Excalidraw 0.18's font registry, which is not public API (see EXCALIDRAW-UPGRADE.md).
//
// `Fonts` lives in a bundled chunk that Vite exposes under the alias "mydraw-excalidraw-chunk"
// (vite.config.ts). Its export names are minified in the production build, so the class is found by
// shape: a function with a static `registered` Map and `register` / `loadElementsFonts`. The chunk
// must be the same module instance Excalidraw uses; that is checked by finding the public
// FONT_FAMILY object among the chunk's exports.
//
// What registering a family gives us (all inside Excalidraw):
//   - its font picker lists it (FontPickerList reads Fonts.registered on each open);
//   - line height and baseline use the font's own metrics (getLineHeight / getVerticalOffset);
//   - the font loads on canvas (Fonts.loadFontFaces adds every registered FontFace to document.fonts);
//   - SVG export (and PDF/HTML, built from SVG) inlines a subset of it.
import { FONT_FAMILY } from "@excalidraw/excalidraw";
import * as chunk from "mydraw-excalidraw-chunk";
import type { ReactNode } from "react";

export interface ExcalidrawFontMetadata {
  metrics: { unitsPerEm: number; ascender: number; descender: number; lineHeight: number };
  icon?: ReactNode;
}

interface FontsClass {
  registered: Map<number, { metadata: ExcalidrawFontMetadata; fontFaces: { fontFace: FontFace }[] }>;
  register(family: string, metadata: ExcalidrawFontMetadata, ...faces: { uri: string; descriptors?: FontFaceDescriptors }[]): unknown;
}

let cached: FontsClass | null | undefined;

function findFonts(): FontsClass | null {
  if ((window as { __mydrawNoFontHook?: boolean }).__mydrawNoFontHook) return null;
  const exports = Object.values(chunk as Record<string, unknown>);
  // Same module instance as Excalidraw's index.js: its FONT_FAMILY object is exported from here.
  if (!exports.includes(FONT_FAMILY)) return null;
  for (const v of exports) {
    if (typeof v !== "function") continue;
    const c = v as unknown as Partial<FontsClass> & { loadElementsFonts?: unknown };
    try {
      if (typeof c.register === "function" && typeof c.loadElementsFonts === "function" && c.registered instanceof Map) {
        // Sanity: Excalidraw's own fonts are in it.
        if (c.registered.has(FONT_FAMILY.Excalifont)) return c as FontsClass;
      }
    } catch {
      // a getter that throws is not the one
    }
  }
  return null;
}

/** Excalidraw's `Fonts` class, or null when this Excalidraw build can't be hooked. */
export function excalidrawFonts(): FontsClass | null {
  if (cached === undefined) cached = findFonts();
  return cached;
}

/**
 * Chromium serializes multi-word FontFace families with quotes ("\"Inter Bold\""), and Excalidraw's
 * picker shows and sorts by that text. Give each registered FontFace object an own `family`
 * getter without the quotes (the browser itself uses its internal slot, not this property; the
 * unquoted name is also valid in the @font-face rules Excalidraw writes for SVG export).
 */
export function unquotePickerNames(): void {
  const Fonts = excalidrawFonts();
  if (!Fonts) return;
  for (const { fontFaces } of Fonts.registered.values()) {
    for (const { fontFace } of fontFaces) {
      if (Object.prototype.hasOwnProperty.call(fontFace, "family")) continue;
      const name = fontFace.family.replace(/^["']|["']$/g, "");
      if (name === fontFace.family) continue;
      Object.defineProperty(fontFace, "family", { get: () => name, configurable: true });
    }
  }
}

/** Family name -> id table Excalidraw builds font strings from (public, mutable). */
export const fontFamilyTable = FONT_FAMILY as unknown as Record<string, number>;

/**
 * Make `family` known to Excalidraw under `id`. Returns false when the registry can't be reached
 * (custom fonts are off then) or the id is already used by another family.
 */
export function registerExcalidrawFont(
  id: number,
  family: string,
  metadata: ExcalidrawFontMetadata,
  faces: { uri: string; descriptors?: FontFaceDescriptors }[],
): boolean {
  const Fonts = excalidrawFonts();
  if (!Fonts) return false;
  const existing = fontFamilyTable[family];
  if (existing !== undefined) return existing === id;
  if (Fonts.registered.has(id)) return false;
  fontFamilyTable[family] = id;
  Fonts.register(family, metadata, ...faces);
  unquotePickerNames();
  // Known to the page right away (loads lazily, when something is drawn in it), so previews and a
  // font registered after Excalidraw loaded its scene fonts work too.
  for (const { fontFace } of Fonts.registered.get(id)?.fontFaces ?? []) {
    if (!document.fonts.has(fontFace)) document.fonts.add(fontFace);
  }
  return Fonts.registered.has(id);
}
