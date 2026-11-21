// Renderer side of the style library: built-in presets/themes plus the user's own, which are kept
// by the main process (<userData>/styles.json) so they are the same in every drawing and survive
// restarts. A saved entry with a built-in's id overrides it; deleting it brings the built-in back.
import {
  BUILTIN_PRESETS,
  BUILTIN_THEMES,
  EMPTY_LIBRARY,
  normalizeLibrary,
  normalizePreset,
  normalizeTheme,
  slugId,
  type StyleLibrary,
  type StylePreset,
  type Theme,
} from "../../shared/styles";

const OLD_KEY = "mydraw.stylePresets"; // Phase 4 first cut kept presets in localStorage

let lib: StyleLibrary = EMPTY_LIBRARY;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

export const stylesReady: Promise<void> = (async () => {
  try {
    lib = normalizeLibrary(await window.mydraw.getStyleLibrary());
  } catch {
    lib = EMPTY_LIBRARY;
  }
  // One-time move of presets saved by the first version. A broken old entry must never cost the
  // library loaded above: it is dropped on its own.
  const old = localStorage.getItem(OLD_KEY);
  if (old !== null) {
    try {
      const migrated = normalizeLibrary({ presets: JSON.parse(old) });
      const have = new Set(lib.presets.map((p) => p.id));
      const fresh = migrated.presets.filter((p) => !have.has(p.id));
      if (fresh.length) {
        lib = { ...lib, presets: [...lib.presets, ...fresh] };
        await persist();
      }
    } catch {
      /* unreadable old entry: ignore */
    }
    localStorage.removeItem(OLD_KEY);
  }
  notify();
})();

async function persist(): Promise<void> {
  lib = normalizeLibrary(await window.mydraw.saveStyleLibrary(lib));
  notify();
}

export function subscribeStyles(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

function merge<T extends { id: string }>(builtin: readonly T[], user: readonly T[]): Array<T & { builtin?: boolean; overridden?: boolean }> {
  const out: Array<T & { builtin?: boolean; overridden?: boolean }> = builtin.map((b) => ({ ...b }));
  for (const u of user) {
    const i = out.findIndex((o) => o.id === u.id);
    if (i >= 0) out[i] = { ...u, builtin: false, overridden: true };
    else out.push({ ...u, builtin: false });
  }
  return out;
}

export const allPresets = () => merge(BUILTIN_PRESETS, lib.presets);
export const allThemes = () => merge(BUILTIN_THEMES, lib.themes);

const find = <T extends { id: string; title: string }>(list: T[], name: string): T | undefined => {
  const k = name.trim().toLowerCase();
  return list.find((p) => p.id === k || p.title.toLowerCase() === k);
};
export const findPreset = (name: string) => find(allPresets(), name);
export const findTheme = (name: string) => find(allThemes(), name);

export const presetCategories = () => [...new Set(allPresets().map((p) => p.category))];
export const themeCategories = () => [...new Set(allThemes().map((t) => t.category))];

/** Create or replace (same id) a user preset. Returns it. */
export async function savePreset(input: unknown): Promise<StylePreset> {
  await stylesReady;
  const p = normalizePreset(input);
  lib = { ...lib, presets: [...lib.presets.filter((x) => x.id !== p.id), p] };
  await persist();
  return p;
}

export async function deletePreset(id: string): Promise<boolean> {
  await stylesReady;
  const had = lib.presets.some((p) => p.id === id);
  lib = { ...lib, presets: lib.presets.filter((p) => p.id !== id) };
  if (had) await persist();
  return had;
}

/** Create or replace (same id) a user theme. */
export async function saveTheme(input: unknown): Promise<Theme> {
  await stylesReady;
  const t = normalizeTheme(input);
  lib = { ...lib, themes: [...lib.themes.filter((x) => x.id !== t.id), t] };
  await persist();
  return t;
}

export async function deleteTheme(id: string): Promise<boolean> {
  await stylesReady;
  const had = lib.themes.some((t) => t.id === id);
  lib = { ...lib, themes: lib.themes.filter((t) => t.id !== id) };
  if (had) await persist();
  return had;
}

export const uniqueId = (title: string) => slugId(title) || "item";
