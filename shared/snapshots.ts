// Version snapshots: a timestamped copy of a drawing's file content on save. Pure helpers; the
// storage is app/src/snapshots.ts.

/** Autosaves are snapshotted at most this often per file (manual saves always, if the content changed). */
export const AUTO_SNAPSHOT_GAP_MS = 2 * 60_000;
/** Snapshots kept per file (the oldest are deleted). */
export const MAX_SNAPSHOTS = 60;

/** Snapshot ids are the creation time in milliseconds. */
export const SNAPSHOT_ID = /^\d{10,16}$/;

export interface SnapshotInfo {
  id: string;
  /** Creation time (ms since epoch). */
  time: number;
  /** Size of the saved drawing in bytes. */
  size: number;
}

/** Whether a save should create a snapshot. `last` is the newest existing snapshot, if any. */
export function shouldSnapshot(opts: { last: { time: number; hash: string } | null; hash: string; now: number; auto: boolean }): boolean {
  const { last, hash, now, auto } = opts;
  if (!last) return true;
  if (last.hash === hash) return false;
  return !auto || now - last.time >= AUTO_SNAPSHOT_GAP_MS;
}

/** Ids to delete so that only the newest `max` remain. */
export function snapshotsToPrune(ids: readonly string[], max = MAX_SNAPSHOTS): string[] {
  return [...ids]
    .filter((i) => SNAPSHOT_ID.test(i))
    .sort((a, b) => Number(b) - Number(a))
    .slice(max);
}

/** "just now", "5 min ago", "3 h ago", "yesterday 14:32", or a date. */
export function describeSnapshotTime(time: number, now: number): string {
  const diff = Math.max(0, now - time);
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  const d = new Date(time);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (time >= startOfToday) return `today ${hhmm}`;
  if (time >= startOfToday - 86_400_000) return `yesterday ${hhmm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hhmm}`;
}
