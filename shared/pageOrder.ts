// Order of a drawing's frames ("pages") is their position on the canvas: rows top to bottom, left to
// right. Reordering two neighbours swaps their places (the frames carry their contents). Position
// is plain geometry, so Excalidraw's undo covers it and exports follow it. Pure.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Reading order by position: rows (40px tolerance) top to bottom, then left to right. */
export const byPosition = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x;

const sameRow = (a: Rect, b: Rect) => Math.round(a.y / 40) === Math.round(b.y / 40);

/**
 * Move offsets that make `second` (the later page) come before `first`, using the space both
 * occupy now and keeping the gap between them. Side by side: they trade places left to right;
 * stacked: top to bottom.
 */
export function swapOffsets(first: Rect, second: Rect): { first: { dx: number; dy: number }; second: { dx: number; dy: number } } {
  if (sameRow(first, second)) {
    const gap = Math.max(0, second.x - (first.x + first.width));
    return {
      second: { dx: first.x - second.x, dy: 0 },
      first: { dx: first.x + second.width + gap - first.x, dy: 0 },
    };
  }
  const gap = Math.max(0, second.y - (first.y + first.height));
  return {
    second: { dx: 0, dy: first.y - second.y },
    first: { dx: 0, dy: first.y + second.height + gap - first.y },
  };
}
