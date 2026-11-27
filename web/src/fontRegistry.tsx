// mydraw's extra fonts in the renderer: built-in set (web/public/fonts/extra/manifest.json, made by
// scripts/build-app.mjs), fonts carried inside opened drawings, and (later) catalog downloads.
// Each one is registered with Excalidraw (web/src/excalidrawFonts.ts), so its own font picker,
// canvas, text editor and SVG/PDF exports use it. Pure rules are in shared/fonts.ts.
//
// Saving: `prepareFonts(elements)` (async) makes sure the bytes of every used font file are in
// memory; `embeddedFontsFor(elements)` (sync, called by serializeScene) then lists them.
import type { ReactNode } from "react";
import {
  charsPerCustomFont,
  filesToEmbed,
  normalizeEmbeddedFonts,
  planFontImport,
  type EmbeddedFonts,
  type FontCategory,
  type FontEntry,
} from "../../shared/fonts";
import { excalidrawFonts, fontFamilyTable, registerExcalidrawFont, unquotePickerNames } from "./excalidrawFonts";

export interface FontStatus {
  /** Excalidraw's registry was found and fonts can be used. */
  ok: boolean;
  /** The manifest of built-in fonts loaded. */
  builtin: number;
  /** Families registered with Excalidraw by mydraw. */
  registered: number;
  error?: string;
}

/** `removed`: deleted from the font store this session (still registered with Excalidraw). */
const entries = new Map<number, FontEntry & { removed?: boolean }>();
/** url -> base64 of the file, while loading and once loaded (data: URLs are read directly). */
const bytes = new Map<string, Promise<string | null>>();
const settled = new Map<string, string>();
const status: FontStatus = { ok: false, builtin: 0, registered: 0 };
const listeners = new Set<() => void>();

const svg = (children: ReactNode) => (
  <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

/** Picker icons by category, so fun and professional fonts are told apart at a glance. */
const CATEGORY_ICON: Record<FontCategory, ReactNode> = {
  // pen
  fun: svg(
    <>
      <path d="M13.5 3.5l3 3L7 16H4v-3z" />
      <path d="M11.5 5.5l3 3" />
    </>,
  ),
  // "Aa"
  professional: svg(
    <>
      <path d="M2.5 15.5L6.5 4.5l4 11M4 11.5h5" />
      <path d="M17.5 15.5v-5a2.2 2.2 0 0 0-4.2-.8M17.5 12.5c-2.5-.3-4.5.3-4.5 1.8 0 1.6 2.6 1.9 4.5.2" />
    </>,
  ),
  // </>
  mono: svg(
    <>
      <path d="M7 6l-4 4 4 4M13 6l4 4-4 4M11 4.5l-2 11" />
    </>,
  ),
};

function absolute(url: string): string {
  if (/^(data|blob|https?|app|mdfont):/i.test(url)) return url;
  return new URL(url.replace(/^\/+/, ""), `${window.location.origin}/`).href;
}

function register(entry: FontEntry): boolean {
  entries.set(entry.id, entry);
  if (!status.ok) return false;
  const ok = registerExcalidrawFont(
    entry.id,
    entry.family,
    { metrics: entry.metrics, icon: CATEGORY_ICON[entry.category] },
    entry.files.map((f) => ({ uri: f.url, descriptors: f.unicodeRange ? { unicodeRange: f.unicodeRange } : undefined })),
  );
  if (ok) status.registered++;
  return ok;
}

async function init(): Promise<void> {
  status.ok = !!excalidrawFonts();
  unquotePickerNames(); // Excalidraw's own "Lilita One", "Comic Shanns", ...
  if (!status.ok) {
    status.error = "Excalidraw's font registry was not found";
    console.warn("[mydraw] Extra fonts are off: Excalidraw's font registry was not found. See EXCALIDRAW-UPGRADE.md.");
  }
  try {
    const res = await fetch(absolute("fonts/extra/manifest.json"));
    if (!res.ok) throw new Error(`manifest: ${res.status}`);
    const manifest = (await res.json()) as { faces: FontEntry[] };
    for (const face of manifest.faces) {
      register({ ...face, source: "builtin", files: face.files.map((f) => ({ ...f, url: absolute(f.url) })) });
      status.builtin++;
    }
  } catch (e) {
    status.error = `Built-in fonts could not be loaded: ${(e as Error).message}`;
    console.warn(`[mydraw] ${status.error}`);
  }
  // Downloaded fonts (not in the headless CLI, which has no font store: drawings carry their fonts).
  try {
    for (const face of (await window.mydraw?.fontsInstalled?.()) ?? []) registerInstalled(face);
  } catch {
    // no font store in this process
  }
  notify();
}

function notify(): void {
  for (const l of listeners) l();
}

function registerInstalled(face: FontEntry): void {
  if (entries.has(face.id) && entries.get(face.id)!.family !== face.family) return; // id taken (very unlikely)
  register({ ...face, source: "catalog" });
}

/** Download weights of a catalog font and register them now. Returns the new family names. */
export async function installCatalogFont(id: string, weights: number[]): Promise<string[]> {
  const added = await window.mydraw.fontInstall(id, weights);
  for (const face of added) registerInstalled(face);
  notify();
  return added.map((f) => f.family);
}

/** Keep fonts that came with a drawing, so every drawing can use them. */
export async function installEmbeddedFonts(families: string[]): Promise<string[]> {
  const faces = families
    .map((f) => [...entries.values()].find((e) => e.family === f && e.source === "embedded"))
    .filter((e): e is FontEntry => !!e);
  const fonts = embeddedFontsForEntries(faces);
  if (!fonts.faces.length) return [];
  const added = await window.mydraw.fontInstallEmbedded(fonts);
  for (const face of added) {
    // The registered entry keeps its id for this session (the store's id may differ after a remap):
    // point it at the installed files.
    const e = [...entries.values()].find((x) => x.family === face.family);
    if (e) entries.set(e.id, { ...e, source: "catalog", files: face.files, license: face.license });
  }
  notify();
  return added.map((f) => f.family);
}

/**
 * Remove a downloaded typeface (all its weights). Excalidraw can't forget a registered font, so it
 * stays usable until the app restarts; drawings that use it keep their own copy.
 */
export async function removeInstalledFont(typeface: string): Promise<string[]> {
  const removed = await window.mydraw.fontRemove(typeface);
  for (const e of entries.values()) if (removed.includes(e.family)) e.removed = true;
  notify();
  return removed;
}

/** Resolves once the built-in fonts are registered (or failed). Await before loading a drawing. */
export const fontsReady: Promise<void> = init();

export function fontStatus(): FontStatus {
  return { ...status };
}

/** All fonts mydraw added, by category then name. */
export function customFonts(): FontEntry[] {
  return [...entries.values()].sort((a, b) => a.category.localeCompare(b.category) || a.family.localeCompare(b.family));
}

export function fontById(id: number): FontEntry | undefined {
  return entries.get(id);
}

/**
 * Font id for a family name Excalidraw can draw: its own ("Excalifont") and mydraw's registered
 * ones ("Inter Bold"). Case-insensitive. Undefined when unknown or the extra fonts are off.
 */
export function fontIdByName(name: string): number | undefined {
  const key = name.trim().toLowerCase();
  for (const [family, id] of Object.entries(fontFamilyTable)) if (family.toLowerCase() === key) return id;
  return undefined;
}

/** Family name for an id (Excalidraw's own or mydraw's). */
export function fontNameById(id: number): string | undefined {
  for (const [family, fid] of Object.entries(fontFamilyTable)) if (fid === id) return family;
  return entries.get(id)?.family;
}

/**
 * Load the font files of these font ids (Excalidraw's own and mydraw's) before text in them is
 * measured. Registered fonts load lazily, when something is first drawn in them; until then the
 * browser measures with a fallback font, so text built by code (diagram titles, zone titles) got a
 * box too narrow for the real font and the canvas clipped its end. Never rejects.
 */
export async function ensureFontsLoaded(ids: Iterable<number>): Promise<void> {
  const Fonts = excalidrawFonts();
  if (!Fonts) return;
  const loads: Promise<unknown>[] = [];
  for (const id of new Set(ids)) {
    for (const { fontFace } of Fonts.registered.get(id)?.fontFaces ?? []) {
      if (!document.fonts.has(fontFace)) document.fonts.add(fontFace);
      if (fontFace.status !== "loaded") loads.push(fontFace.load().catch(() => undefined));
    }
  }
  if (loads.length) await Promise.all(loads);
}

/** `ensureFontsLoaded` by family names ("Montserrat Bold", "Excalifont"); unknown names are skipped. */
export function ensureFontNamesLoaded(names: Iterable<string>): Promise<void> {
  const ids: number[] = [];
  for (const n of names) {
    const id = fontIdByName(n);
    if (id !== undefined) ids.push(id);
  }
  return ensureFontsLoaded(ids);
}

/** Family names of the custom fonts the elements' text uses. */
export function usedFontFamilies(elements: readonly TextLike[]): string[] {
  return [...charsPerCustomFont(elements).keys()].map((id) => entries.get(id)?.family).filter((f): f is string => !!f);
}

export function onFontsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Bring the fonts a drawing carries into the app. Returns the id remapping to apply to its text
 * elements (`remapFontFamilies`). Fonts already known here are used as they are.
 */
export function importEmbeddedFonts(raw: unknown): Map<number, number> {
  const embedded = normalizeEmbeddedFonts(raw);
  if (!embedded.faces.length) return new Map();
  const known = new Map<string, number>();
  for (const [family, id] of Object.entries(fontFamilyTable)) known.set(family.toLowerCase(), id);
  for (const e of entries.values()) known.set(e.family.toLowerCase(), e.id);
  const plan = planFontImport(embedded.faces, known);
  for (const face of plan.register) {
    const files = face.files.map((f) => {
      const url = `data:font/woff2;base64,${f.data}`;
      return { url, unicodeRange: f.unicodeRange };
    });
    const entry: FontEntry = {
      id: face.id,
      family: face.family,
      typeface: face.typeface,
      weight: face.weight,
      style: face.style,
      category: face.category,
      source: "embedded",
      metrics: face.metrics,
      files,
    };
    // Without files the font can't be drawn, but its name and metrics still travel with the drawing.
    if (files.length) register(entry);
    else entries.set(entry.id, entry);
  }
  if (plan.register.length) notify();
  return plan.remap;
}

function toBase64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function loadBytes(url: string): Promise<string | null> {
  let p = bytes.get(url);
  if (!p) {
    p = (async () => {
      if (url.startsWith("data:")) return url.slice(url.indexOf(",") + 1);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const b64 = toBase64(await res.arrayBuffer());
        settled.set(url, b64);
        return b64;
      } catch (e) {
        console.warn(`[mydraw] Could not read font file ${url}: ${(e as Error).message}`);
        bytes.delete(url); // try again next save
        return null;
      }
    })();
    bytes.set(url, p);
  }
  return p;
}

type TextLike = Parameters<typeof charsPerCustomFont>[0][number];

/** Load the bytes of every font file the drawing's text needs (call before serializeScene). */
export async function prepareFonts(elements: readonly TextLike[]): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [id, chars] of charsPerCustomFont(elements)) {
    const entry = entries.get(id);
    if (!entry) continue;
    for (const f of filesToEmbed(entry, chars)) jobs.push(loadBytes(f.url));
  }
  await Promise.all(jobs);
}

/** Synchronous view of loaded bytes. */
function bytesNow(url: string): string | null {
  if (url.startsWith("data:")) return url.slice(url.indexOf(",") + 1);
  return settled.get(url) ?? null;
}

/** Fonts block for whole entries (every file, bytes from their data: URLs or loaded files). */
function embeddedFontsForEntries(list: FontEntry[]): EmbeddedFonts {
  return {
    version: 1,
    faces: list.map((entry) => ({
      id: entry.id,
      family: entry.family,
      typeface: entry.typeface,
      weight: entry.weight,
      style: entry.style,
      category: entry.category,
      metrics: entry.metrics,
      files: entry.files
        .map((f) => ({ unicodeRange: f.unicodeRange, data: bytesNow(f.url) }))
        .filter((f): f is { unicodeRange: string; data: string } => !!f.data),
    })),
  };
}

/**
 * The fonts block for a drawing: every custom font its text uses, with the files covering its
 * characters (those whose bytes are loaded; see prepareFonts). Null when it uses none.
 */
export function embeddedFontsFor(elements: readonly TextLike[]): EmbeddedFonts | null {
  const faces: EmbeddedFonts["faces"] = [];
  for (const [id, chars] of charsPerCustomFont(elements)) {
    const entry = entries.get(id);
    if (!entry) continue;
    const files = filesToEmbed(entry, chars)
      .map((f) => ({ unicodeRange: f.unicodeRange, data: bytesNow(f.url) }))
      .filter((f): f is { unicodeRange: string; data: string } => !!f.data);
    faces.push({
      id: entry.id,
      family: entry.family,
      typeface: entry.typeface,
      weight: entry.weight,
      style: entry.style,
      category: entry.category,
      metrics: entry.metrics,
      files,
    });
  }
  return faces.length ? { version: 1, faces } : null;
}
