// Labels for quick-connect copies: "web-1" -> "web-2", "db01" -> "db02", "Server" -> "Server 2".
// Pure, unit-tested in tests/labelNumber.test.ts.

/** The first line of a label (the name; further lines are details such as an IP address). */
const firstLine = (s: string) => s.split("\n")[0];

/**
 * The label for a copy of `label`: its first line with the trailing number counted up (keeping zero
 * padding), or " 2" added when it has none, skipping names `existing` already uses (first lines
 * compared, case-insensitively). Later lines are kept. Null for an empty label.
 */
export function nextLabel(label: string, existing: Iterable<string>): string | null {
  const name = firstLine(label);
  if (!name.trim()) return null;
  const rest = label.slice(name.length);
  const taken = new Set([...existing].map((e) => firstLine(e).trim().toLowerCase()));
  const m = /^(.*?)(\d+)(\s*)$/.exec(name);
  const prefix = m ? m[1] : `${name.replace(/\s+$/, "")} `;
  const tail = m ? m[3] : "";
  const width = m && m[2].startsWith("0") ? m[2].length : 0;
  let n = m ? Number(m[2]) + 1 : 2;
  const make = (k: number) => `${prefix}${String(k).padStart(width, "0")}${tail}`;
  for (let i = 0; i < 10_000 && taken.has(make(n).trim().toLowerCase()); i++) n++;
  return make(n) + rest;
}
