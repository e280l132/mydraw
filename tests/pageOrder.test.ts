import { describe, expect, it } from "vitest";
import { byPosition, swapOffsets, type Rect } from "../shared/pageOrder";

const place = (r: Rect, o: { dx: number; dy: number }): Rect => ({ ...r, x: r.x + o.dx, y: r.y + o.dy });

describe("byPosition", () => {
  const sort = (xs: Array<{ n: string; x: number; y: number }>) => [...xs].sort(byPosition).map((p) => p.n);

  it("orders rows top to bottom, then left to right", () => {
    expect(
      sort([
        { n: "c", x: 0, y: 800 },
        { n: "b", x: 500, y: 10 },
        { n: "a", x: 0, y: 0 },
      ]),
    ).toEqual(["a", "b", "c"]);
  });

  it("treats frames within 40px of height as one row", () => {
    expect(
      sort([
        { n: "right", x: 500, y: 0 },
        { n: "left", x: 0, y: 15 },
      ]),
    ).toEqual(["left", "right"]);
  });
});

describe("swapOffsets", () => {
  it("trades places of equal pages side by side", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 200, y: 0, width: 100, height: 50 };
    const o = swapOffsets(a, b);
    expect(place(b, o.second)).toMatchObject({ x: 0, y: 0 });
    expect(place(a, o.first)).toMatchObject({ x: 200, y: 0 });
  });

  it("keeps the gap and doesn't overlap pages of different widths", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 130, y: 0, width: 300, height: 50 };
    const o = swapOffsets(a, b);
    const nb = place(b, o.second);
    const na = place(a, o.first);
    expect(nb.x).toBe(0);
    expect(na.x).toBe(300 + 30); // second's width + the original 30px gap
    expect(na.x).toBeGreaterThanOrEqual(nb.x + nb.width);
    expect(byPosition(nb, na)).toBeLessThan(0);
  });

  it("trades places top to bottom for stacked pages", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 0, y: 100, width: 100, height: 80 };
    const o = swapOffsets(a, b);
    const nb = place(b, o.second);
    const na = place(a, o.first);
    expect(nb).toMatchObject({ x: 0, y: 0 });
    expect(na).toMatchObject({ x: 0, y: 80 + 50 });
    expect(na.y).toBeGreaterThanOrEqual(nb.y + nb.height);
  });

  it("never uses a negative gap when pages overlap", () => {
    const a = { x: 0, y: 0, width: 100, height: 50 };
    const b = { x: 50, y: 0, width: 100, height: 50 };
    const o = swapOffsets(a, b);
    expect(place(a, o.first).x).toBe(100);
  });
});
