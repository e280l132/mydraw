// Sorting and filtering for the inventory table. Pure.
import type { InventoryEntry } from "./inventory";

export type SortKey = keyof Pick<InventoryEntry, "name" | "kind" | "type" | "zone" | "ip" | "hostname" | "vlan" | "role" | "owner" | "url" | "notes">;
export type SortDir = "asc" | "desc";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/\d+)?$/;

/** Compare two cell values: IPv4 addresses by octet, numbers by value, otherwise text "naturally" (web-2 < web-10). */
export function compareCells(a: string, b: string): number {
  const ia = IPV4.exec(a.trim());
  const ib = IPV4.exec(b.trim());
  if (ia && ib) {
    for (let i = 1; i <= 4; i++) if (+ia[i] !== +ib[i]) return +ia[i] - +ib[i];
    return 0;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Sorted copy. Empty cells always go last, whichever the direction. Stable. */
export function sortRows<T extends InventoryEntry>(rows: readonly T[], key: SortKey, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((x, y) => {
      const a = x.r[key];
      const b = y.r[key];
      if (!a && b) return 1;
      if (a && !b) return -1;
      return sign * compareCells(a, b) || x.i - y.i;
    })
    .map((x) => x.r);
}

/** Rows where every word of `query` appears (case-insensitive) in some cell. */
export function filterRows<T extends InventoryEntry>(rows: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((r) => {
    const hay = [r.name, r.kind, r.type, r.zone, r.ip, r.hostname, r.vlan, r.role, r.owner, r.url, r.notes, ...Object.values(r.extra)].join("\n").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
