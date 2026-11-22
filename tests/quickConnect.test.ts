import { describe, expect, it } from "vitest";
import { boxesOverlap, growToContain, quickConnectBox, QUICK_GAP } from "../shared/quickConnect";

const src = { x: 100, y: 100, width: 160, height: 80 };
const size = { width: 160, height: 80 };

describe("quickConnectBox", () => {
  it("puts the node beside the source on each side, centred and a gap away", () => {
    expect(quickConnectBox({ source: src, side: "right", size, obstacles: [] })).toEqual({ x: 260 + QUICK_GAP, y: 100, width: 160, height: 80 });
    expect(quickConnectBox({ source: src, side: "left", size, obstacles: [] })).toEqual({ x: 100 - QUICK_GAP - 160, y: 100, width: 160, height: 80 });
    expect(quickConnectBox({ source: src, side: "bottom", size, obstacles: [] })).toEqual({ x: 100, y: 180 + QUICK_GAP, width: 160, height: 80 });
    expect(quickConnectBox({ source: src, side: "top", size, obstacles: [] })).toEqual({ x: 100, y: 100 - QUICK_GAP - 80, width: 160, height: 80 });
  });

  it("centres a node of another size on the source", () => {
    const b = quickConnectBox({ source: src, side: "right", size: { width: 72, height: 100 }, obstacles: [], gap: 50 });
    expect(b.x).toBe(310);
    expect(b.y + b.height / 2).toBe(140);
  });

  it("ignores elements that are out of the way", () => {
    const far = { x: 2000, y: 2000, width: 50, height: 50 };
    expect(quickConnectBox({ source: src, side: "right", size, obstacles: [far, src] })).toEqual({ x: 340, y: 100, width: 160, height: 80 });
  });

  it("slides along the side when the spot is taken, nearest free spot first (down before up)", () => {
    const blocker = { x: 340, y: 100, width: 160, height: 80 };
    const b = quickConnectBox({ source: src, side: "right", size, obstacles: [src, blocker] });
    expect(b.x).toBe(340);
    expect(b.y).toBeGreaterThan(100);
    expect(boxesOverlap(b, blocker, 20)).toBe(false);
    // Blocked below too: goes up.
    const below = { x: 340, y: 180, width: 160, height: 400 };
    const up = quickConnectBox({ source: src, side: "right", size, obstacles: [src, blocker, below] });
    expect(up.x).toBe(340);
    expect(up.y).toBeLessThan(100);
    expect([blocker, below].some((o) => boxesOverlap(up, o, 20))).toBe(false);
  });

  it("pushes further out when the whole side is blocked nearby", () => {
    // A wall right of the source, much taller than the search slides.
    const wall = { x: 330, y: -5000, width: 40, height: 10000 };
    const b = quickConnectBox({ source: src, side: "right", size, obstacles: [src, wall] });
    expect(b.x).toBeGreaterThanOrEqual(370 + 20);
    expect(boxesOverlap(b, wall, 20)).toBe(false);
  });

  it("works vertically too", () => {
    const blocker = { x: 100, y: 260, width: 160, height: 80 };
    const b = quickConnectBox({ source: src, side: "bottom", size, obstacles: [src, blocker] });
    expect(b.y).toBe(260);
    expect(b.x).toBeGreaterThan(100);
    expect(boxesOverlap(b, blocker, 20)).toBe(false);
  });

  it("falls back to the centred spot when nothing nearby is free", () => {
    const everything = { x: -1e5, y: -1e5, width: 2e5, height: 2e5 };
    expect(quickConnectBox({ source: src, side: "left", size, obstacles: [everything] })).toEqual({ x: -140, y: 100, width: 160, height: 80 });
  });
});

describe("boxesOverlap", () => {
  it("respects the margin", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(boxesOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(boxesOverlap(a, { x: 15, y: 0, width: 10, height: 10 }, 10)).toBe(true);
    expect(boxesOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });
});

describe("growToContain", () => {
  const zone = { x: 0, y: 0, width: 300, height: 200 };
  const pad = { top: 40, right: 20, bottom: 20, left: 20 };
  it("returns null when the box already fits", () => {
    expect(growToContain(zone, { x: 50, y: 50, width: 100, height: 50 }, pad)).toBeNull();
  });
  it("grows to the right and bottom", () => {
    expect(growToContain(zone, { x: 250, y: 150, width: 100, height: 100 }, pad)).toEqual({ x: 0, y: 0, width: 370, height: 270 });
  });
  it("grows to the left and top, keeping the far edges", () => {
    expect(growToContain(zone, { x: -50, y: 10, width: 60, height: 60 }, pad)).toEqual({ x: -70, y: -30, width: 370, height: 230 });
  });
});
