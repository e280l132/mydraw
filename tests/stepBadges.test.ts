import { describe, expect, it } from "vitest";
import { badgeFixes, pointAlong } from "../shared/stepBadges";

const arrow = (x: number, y: number) => ({ id: "a", type: "arrow", x, y, width: 200, height: 0, points: [[0, 0], [200, 0]] as [number, number][] });
const badge = (cx: number, cy: number) => [
  { id: "c", type: "ellipse", x: cx - 11, y: cy - 11, width: 22, height: 22, customData: { mydrawStep: 1, mydrawStepOf: "a" } },
  { id: "t", type: "text", x: cx - 4, y: cy - 8, width: 8, height: 16, customData: { mydrawStep: 1, mydrawStepOf: "a" } },
];

describe("step badges", () => {
  it("finds points along a route", () => {
    expect(pointAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }], 28)).toEqual({ x: 10, y: 18 });
    expect(pointAlong([{ x: 0, y: 0 }, { x: 20, y: 0 }], 28)).toEqual({ x: 10, y: 0 });
  });
  it("leaves a badge that is on its arrow", () => {
    expect(badgeFixes([arrow(0, 0), ...badge(28, 0)]).size).toBe(0);
  });
  it("moves circle and number together back onto a moved arrow", () => {
    const f = badgeFixes([arrow(100, 50), ...badge(28, 0)]);
    expect(f.get("c")).toEqual({ x: 117, y: 39 });
    expect(f.get("t")).toEqual({ x: 124, y: 42 });
  });
  it("deletes badges of a deleted arrow and respects the arrow filter", () => {
    expect(badgeFixes([{ ...arrow(0, 0), isDeleted: true }, ...badge(28, 0)]).get("c")).toEqual({ isDeleted: true });
    expect(badgeFixes([arrow(100, 50), ...badge(28, 0)], new Set(["other"])).size).toBe(0);
  });
});
