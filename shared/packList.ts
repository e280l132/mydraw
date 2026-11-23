// Keyword search and sort for the "Download icon packs" dialog (pure, unit-tested).
export type PackSort = "name" | "size-asc" | "size-desc" | "installed";

export interface PackLike {
  id: string;
  title: string;
  description: string;
  approxMB: number;
  license: string;
  installed: boolean;
}

/** Every word of `query` must appear in the title, description, id or license (case-insensitive). */
export function matchesPack(p: PackLike, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${p.title} ${p.description} ${p.id} ${p.license}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterAndSortPacks<T extends PackLike>(packs: readonly T[], query: string, sort: PackSort): T[] {
  const byName = (a: T, b: T) => a.title.localeCompare(b.title);
  const out = packs.filter((p) => matchesPack(p, query));
  switch (sort) {
    case "size-asc":
      return out.sort((a, b) => a.approxMB - b.approxMB || byName(a, b));
    case "size-desc":
      return out.sort((a, b) => b.approxMB - a.approxMB || byName(a, b));
    case "installed":
      return out.sort((a, b) => Number(b.installed) - Number(a.installed) || byName(a, b));
    default:
      return out.sort(byName);
  }
}
