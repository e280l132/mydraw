// Per-drawing data that travels inside the .excalidraw file, under a top-level "mydraw" key
// (Excalidraw and other readers ignore unknown top-level keys):
//   id       names the drawing's version history, so renaming or moving the file keeps it
//   palette  the custom colors picked in this drawing, so another person sees the same swatches
// Pure helpers (no Electron, no DOM) used by the renderer, main and tests.

export const META_KEY = "mydraw";
export const PALETTE_MAX = 12;
/** What a history id may look like (it becomes a folder name, so keep it strict). */
export const HISTORY_ID = /^[0-9a-f-]{8,64}$/;

export interface DrawingMeta {
  id: string;
  palette: string[];
}

const HEX = /^#[0-9a-f]{6}$/;

export function newHistoryId(): string {
  return globalThis.crypto.randomUUID();
}

export function emptyMeta(): DrawingMeta {
  return { id: newHistoryId(), palette: [] };
}

/** Colors as lower-case #rrggbb, valid ones only, no duplicates, at most PALETTE_MAX. */
export function normalizePalette(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) {
    if (typeof c !== "string") continue;
    const hex = c.trim().toLowerCase();
    if (HEX.test(hex) && !out.includes(hex)) out.push(hex);
    if (out.length >= PALETTE_MAX) break;
  }
  return out;
}

/** Put `hex` first (most recent), dropping an older copy and anything past the limit. */
export function addToPalette(palette: readonly string[], hex: string): string[] {
  const h = hex.trim().toLowerCase();
  if (!HEX.test(h)) return [...palette];
  return [h, ...palette.filter((c) => c !== h)].slice(0, PALETTE_MAX);
}

/** Untrusted `mydraw` value from a parsed file -> meta (a fresh id when the file has none). */
export function normalizeMeta(raw: unknown): DrawingMeta {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = typeof r.id === "string" && HISTORY_ID.test(r.id) ? r.id : newHistoryId();
  return { id, palette: normalizePalette(r.palette) };
}

/** Read the meta of a file's text. Missing or unreadable -> a fresh one. */
export function readMeta(content: string): DrawingMeta {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    return normalizeMeta(data?.[META_KEY]);
  } catch {
    return emptyMeta();
  }
}

/**
 * The history id from the END of a file's text, without parsing it (files can be megabytes and
 * main calls this on every save). `withMeta` writes the block last, so it is found in the tail.
 */
export function historyIdFromContent(content: string): string | null {
  const tail = content.length > 4096 ? content.slice(-4096) : content;
  const m = /"mydraw"\s*:\s*\{[^}]*?"id"\s*:\s*"([^"]+)"/.exec(tail);
  return m && HISTORY_ID.test(m[1]) ? m[1] : null;
}

/** `content` (Excalidraw's JSON) with the meta block as its last key. Replaces an existing block. */
export function withMeta(content: string, meta: DrawingMeta): string {
  const block = JSON.stringify({ version: 1, id: meta.id, palette: meta.palette });
  const end = content.lastIndexOf("}");
  if (end < 0) return content;
  const head = content.slice(0, end).replace(/\s+$/, "");
  const existing = /,\s*"mydraw"\s*:\s*\{[^}]*\}$/.exec(head);
  const base = existing ? head.slice(0, existing.index) : head;
  return `${base},\n  "${META_KEY}": ${block}\n}\n`;
}
