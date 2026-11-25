import { describe, expect, it } from "vitest";
import { alignMoves, distributeMoves, isAlignEdge, unionOf } from "../shared/arrange";

const u = (key: string, x: number, y: number, width = 10, height = 10) => ({ key, box: { x, y, width, height } });
const byKey = (moves: { key: string; dx: number; dy: number }[]) => Object.fromEntries(moves.map((m) => [m.key, [m.dx, m.dy]]));

describe("alignMoves", () => {
  const units = [u("a", 0, 0, 10, 10), u("b", 50, 20, 30, 20), u("c", 20, 100, 20, 40)];
  it("aligns left / right / center on the common box", () => {
    expect(byKey(alignMoves(units, "left"))).toEqual({ a: [0, 0], b: [-50, 0], c: [-20, 0] });
    expect(byKey(alignMoves(units, "right"))).toEqual({ a: [70, 0], b: [0, 0], c: [40, 0] });
    expect(byKey(alignMoves(units, "center"))).toEqual({ a: [35, 0], b: [-25, 0], c: [10, 0] });
  });
  it("aligns top / bottom / middle", () => {
    expect(byKey(alignMoves(units, "top"))).toEqual({ a: [0, 0], b: [0, -20], c: [0, -100] });
    expect(byKey(alignMoves(units, "bottom"))).toEqual({ a: [0, 130], b: [0, 100], c: [0, 0] });
    expect(byKey(alignMoves(units, "middle"))).toEqual({ a: [0, 65], b: [0, 40], c: [0, -50] });
  });
  it("aligns to a reference box", () => {
    expect(byKey(alignMoves([u("a", 0, 0)], "left", { x: 200, y: 0, width: 5, height: 5 }))).toEqual({ a: [200, 0] });
  });
  it("validates edges and builds unions", () => {
    expect(isAlignEdge("middle")).toBe(true);
    expect(isAlignEdge("centre")).toBe(false);
    expect(unionOf([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 5, height: 5 }])).toEqual({ x: 0, y: -5, width: 25, height: 15 });
  });
});

describe("distributeMoves", () => {
  it("evens the gaps, keeping the ends", () => {
    const m = byKey(distributeMoves([u("a", 0, 0), u("c", 100, 0), u("b", 20, 0)], "horizontal"));
    expect(m).toEqual({ a: [0, 0], b: [30, 0], c: [0, 0] });
  });
  it("leaves fewer than 3 alone without a gap", () => {
    expect(byKey(distributeMoves([u("a", 0, 0), u("b", 50, 0)], "vertical"))).toEqual({ a: [0, 0], b: [0, 0] });
  });
  it("uses a fixed gap from the first unit", () => {
    const m = byKey(distributeMoves([u("a", 0, 0, 10, 10), u("b", 0, 300, 10, 30), u("c", 0, 100, 10, 20)], "vertical", 5));
    expect(m).toEqual({ a: [0, 0], c: [0, -85], b: [0, -260] });
  });
});
