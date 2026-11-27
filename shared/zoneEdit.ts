// Editing a zone by hand. Zones (and their titles) are locked so clicks inside them reach the icons
// and arrows; a click on a zone's TITLE unlocks that one zone and selects it (move, resize, recolour,
// double-click the title to rename). When the selection moves on, it is locked again. Pure rules;
// the DOM side is web/src/zoneEdit.ts. Tested in tests/zoneEdit.test.ts.

export interface ZoneEditEl {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked?: boolean;
  isDeleted?: boolean;
  customData?: Record<string, unknown> | null;
}

/** Marks a zone (and its title) unlocked by a title click, so it is locked again afterwards. */
export const UNLOCKED_KEY = "mydrawZoneUnlocked";
/** Extra room around a title for the click, in scene px. */
const TITLE_SLACK = 4;

/**
 * The zone whose title is under (x, y), topmost first: an inner zone's title wins over the zone
 * around it. Only locked titles count (an unlocked one is Excalidraw's to click).
 */
export function zoneTitleAt(elements: readonly ZoneEditEl[], x: number, y: number): { zone: ZoneEditEl; title: ZoneEditEl } | null {
  const zones = new Map(elements.filter((e) => !e.isDeleted && e.customData?.mydrawZone).map((e) => [e.id, e]));
  for (let i = elements.length - 1; i >= 0; i--) {
    const t = elements[i];
    const of = t.customData?.mydrawZoneTitle;
    if (t.isDeleted || t.type !== "text" || typeof of !== "string" || !t.locked) continue;
    if (x < t.x - TITLE_SLACK || x > t.x + t.width + TITLE_SLACK || y < t.y - TITLE_SLACK || y > t.y + t.height + TITLE_SLACK) continue;
    const zone = zones.get(of);
    if (zone) return { zone, title: t };
  }
  return null;
}

/**
 * Elements to lock again: zones unlocked by a title click (and their titles) that are no longer
 * selected or being edited.
 */
export function zonesToRelock(elements: readonly ZoneEditEl[], selected: ReadonlySet<string>, editingId: string | null): string[] {
  const out: string[] = [];
  const titleOf = new Map<string, string>();
  for (const e of elements) if (typeof e.customData?.mydrawZoneTitle === "string") titleOf.set(e.customData.mydrawZoneTitle as string, e.id);
  for (const z of elements) {
    if (z.isDeleted || !z.customData?.mydrawZone || !z.customData?.[UNLOCKED_KEY]) continue;
    const title = titleOf.get(z.id);
    const busy = selected.has(z.id) || (title !== undefined && (selected.has(title) || editingId === title));
    if (busy) continue;
    out.push(z.id);
    if (title) out.push(title);
  }
  return out;
}
