// Stencil library model shared by the main process (scanning the folder) and the renderer (panel, search).

export type LibraryItemKind = "svg" | "png" | "stencil" | "xlib";

export interface LibraryItem {
  /** Path relative to the library root using "/" (plus "#n" for an item inside an .excalidrawlib). */
  id: string;
  /** Top-level folder name. */
  collection: string;
  /** Sub-folders between the collection and the file, e.g. ["Compute"]. */
  groups: string[];
  name: string;
  tags: string[];
  kind: LibraryItemKind;
  /** File path relative to the root (without "#n"). */
  file: string;
  /** Index inside an .excalidrawlib file. */
  index?: number;
  /** Last modified time of the file, used to refresh cached previews. */
  mtime: number;
}

export interface CollectionInfo {
  name: string;
  count: number;
  license?: string;
  source?: string;
  /** Installed by the icon-pack downloader (safe to replace on update). */
  managed?: boolean;
}

export interface LibraryIndex {
  root: string;
  collections: CollectionInfo[];
  items: LibraryItem[];
  favorites: string[];
  recent: string[];
}

/** Per-collection metadata stored as `<collection>/collection.json`. */
export interface CollectionMeta {
  managedBy?: "mydraw-packs";
  pack?: string;
  source?: string;
  license?: string;
  licenseUrl?: string;
  /** Keyed by path relative to the collection folder. */
  items?: Record<string, { name?: string; tags?: string[] }>;
}

/** Saved shape group: `<name>.stencil.json`. */
export interface StencilFile {
  type: "mydraw-stencil";
  version: 1;
  name: string;
  tags: string[];
  elements: unknown[];
  files: Record<string, unknown>;
}

export const MY_STENCILS = "My Stencils";
export const EXCALIDRAW_LIBRARY_COLLECTION = "Excalidraw Library";
export const EXCALIDRAW_LIBRARY_FILE = `${EXCALIDRAW_LIBRARY_COLLECTION}/library.excalidrawlib`;
export const MAX_RECENT_STENCILS = 30;

export function itemKindForFile(file: string): LibraryItemKind | null {
  const f = file.toLowerCase();
  if (f.endsWith(".stencil.json")) return "stencil";
  if (f.endsWith(".svg")) return "svg";
  if (f.endsWith(".png")) return "png";
  if (f.endsWith(".excalidrawlib")) return "xlib";
  return null;
}

/** "Amazon-EC2_64" / "cloud_run" / "load-balancer" -> readable words. */
export function humanize(base: string): string {
  return base
    .replace(/\.(stencil\.json|svg|png|excalidrawlib)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case words used for matching (name, tags, collection, groups). */
export function searchTokens(item: LibraryItem): string {
  return [item.name, ...item.tags, item.collection, ...item.groups].join(" ").toLowerCase();
}

/**
 * Score an item against a query. Every query word must match the start of some word in the
 * item's text (so "ec2" finds "Amazon EC2", "lb app" finds "Load Balancer (Application)").
 * Returns -1 for no match; higher is better.
 */
export function scoreItem(item: LibraryItem, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const name = item.name.toLowerCase();
  const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean);
  const hay = searchTokens(item);
  const hayWords = hay.split(/[^a-z0-9]+/).filter(Boolean);
  let score = 0;
  for (const w of words) {
    let best = -1;
    if (name === w) best = 100;
    else if (item.tags.some((t) => t.toLowerCase() === w)) best = 35; // curated keyword, e.g. "s3"
    else if (nameWords.includes(w)) best = 30;
    else if (name.startsWith(w)) best = 20;
    else if (nameWords.some((nw) => nw.startsWith(w))) best = 15;
    else if (hayWords.includes(w)) best = 10;
    else if (hayWords.some((hw) => hw.startsWith(w))) best = 8;
    else if (hay.includes(w)) best = 3;
    if (best < 0) return -1;
    score += best;
  }
  // Prefer shorter names (closer matches) and the user's own stencils.
  score -= Math.min(name.length, 60) / 10;
  if (item.collection === MY_STENCILS) score += 5;
  // Brand logos are a fallback; architecture icons with the same name should come first.
  if (item.tags.includes("logo")) score -= 8;
  return score;
}

export function searchItems(items: readonly LibraryItem[], query: string, limit = 200): LibraryItem[] {
  if (!query.trim()) return [];
  return items
    .map((item) => ({ item, s: scoreItem(item, query) }))
    .filter((r) => r.s >= 0)
    .sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((r) => r.item);
}

/** Add `id` to the front of the recent list. */
export function pushRecent(list: readonly string[], id: string, max = MAX_RECENT_STENCILS): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** URL the renderer uses to load a library file through the mdlib:// protocol. */
export function libraryFileUrl(file: string): string {
  return `mdlib://library/${file.split("/").map(encodeURIComponent).join("/")}`;
}

/** Safe single path segment for collection or file names. */
export function safeSegment(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^\.+/, "").trim();
  return s.slice(0, 120) || "untitled";
}
