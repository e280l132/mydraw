// Text outline: a colored stroke drawn around the letters of a text element (a halo), behind the
// fill. Excalidraw has no such property, so it lives in `customData.mydrawTextOutline` and is drawn
// by patched Excalidraw renderers (scripts/excalidrawPatch.mjs -> web/src/textOutline.ts).
// Pure: used by the renderer hooks, the style panel and the agent.

export interface TextOutline {
  /** CSS color (hex in practice). */
  color: string;
  /** Outline thickness in scene px, measured outward from the letter edge. */
  width: number;
}

export const OUTLINE_KEY = "mydrawTextOutline";
export const OUTLINE_MIN = 0.5;
export const OUTLINE_MAX = 16;
export const OUTLINE_DEFAULT_WIDTH = 2;

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,30}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\))$/i;

/** Validate an untrusted outline value (file, agent). Null = no outline. */
export function normalizeOutline(v: unknown): TextOutline | null {
  if (!v || typeof v !== "object") return null;
  const { color, width } = v as { color?: unknown; width?: unknown };
  if (typeof color !== "string") return null;
  const c = color.trim();
  if (!c || c.toLowerCase() === "transparent" || !SAFE_COLOR.test(c)) return null;
  const w = typeof width === "number" && Number.isFinite(width) ? width : OUTLINE_DEFAULT_WIDTH;
  return { color: c, width: Math.min(OUTLINE_MAX, Math.max(OUTLINE_MIN, w)) };
}

/** The outline of an element, if it has a valid one. */
export function outlineOf(el: { customData?: Record<string, unknown> | null } | null | undefined): TextOutline | null {
  return normalizeOutline(el?.customData?.[OUTLINE_KEY]);
}

/**
 * Width actually drawn. Excalidraw pads a text element's cached canvas by fontSize / 2, so anything
 * thicker than fontSize / 4 would be clipped there; cap it so screen and export agree.
 */
export function drawnOutlineWidth(o: TextOutline, fontSize: number): number {
  return Math.max(0, Math.min(o.width, fontSize / 4));
}

/**
 * customData with the outline set (or removed with null). Always an object: Excalidraw's
 * `newElementWith` ignores `undefined` values, so `customData: undefined` would keep the old outline.
 */
export function withOutline(customData: Record<string, unknown> | null | undefined, outline: TextOutline | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(customData ?? {}) };
  if (outline) next[OUTLINE_KEY] = { color: outline.color, width: outline.width };
  else delete next[OUTLINE_KEY];
  return next;
}

/** The one value shared by all `els` (for the panel's well / active chip), or null when mixed or none. */
export function commonOutline(els: readonly { customData?: Record<string, unknown> | null }[]): TextOutline | null | "mixed" {
  if (!els.length) return null;
  const first = outlineOf(els[0]);
  for (const e of els.slice(1)) {
    const o = outlineOf(e);
    if ((o?.color ?? null) !== (first?.color ?? null) || (o?.width ?? null) !== (first?.width ?? null)) return "mixed";
  }
  return first;
}
