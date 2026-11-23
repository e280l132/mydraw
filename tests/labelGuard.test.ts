import { describe, expect, it } from "vitest";
import { detachedLabels, DETACHED_PX, distToPolyline, labelPoint, type GuardEl } from "../shared/labelGuard";

// An elbow arrow from (100,100) right to (300,100), down to (300,300).
const arrow = (o: Partial<GuardEl> = {}): GuardEl => ({
  id: "a",
  type: "arrow",
  x: 100,
  y: 100,
  width: 200,
  height: 200,
  points: [
    [0, 0],
    [200, 0],
    [200, 200],
  ],
  boundElements: [{ id: "t", type: "text" }],
  ...o,
});
const label = (cx: number, cy: number, o: Partial<GuardEl> = {}): GuardEl => ({ id: "t", type: "text", x: cx - 30, y: cy - 10, width: 60, height: 20, containerId: "a", ...o });

describe("label point", () => {
  it("is the middle point of an odd number of points, else the middle of the middle segment", () => {
    expect(labelPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 0 });
    expect(labelPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
    expect(labelPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 30, y: 10 }])).toEqual({ x: 10, y: 5 });
  });
  it("distance to a polyline", () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    expect(distToPolyline({ x: 50, y: 30 }, pts)).toBe(30);
    expect(distToPolyline({ x: 130, y: 0 }, pts)).toBe(30);
  });
});

describe("detached arrow labels", () => {
  it("leaves a label on its arrow, or near it, alone", () => {
    expect(detachedLabels([arrow(), label(300, 100)]).size).toBe(0);
    expect(detachedLabels([arrow(), label(300, 100 + DETACHED_PX - 5)]).size).toBe(0);
  });

  it("accepts a wide label placed beside a vertical arrow, but not one that floats away", () => {
    const vertical = arrow({ points: [[0, 0], [0, 300]], width: 0, height: 300, x: 100, y: 100 });
    // 200 px wide label, centre 108 px (half the width + 8) left of the arrow: beside it, fine
    expect(detachedLabels([vertical, label(100 - 108, 250, { width: 200, x: 100 - 108 - 100 })]).size).toBe(0);
    expect(detachedLabels([vertical, label(100 - 300, 250, { width: 200, x: 100 - 300 - 100 })]).size).toBe(1);
  });

  it("puts a label that floats far away back at the arrow's label point", () => {
    // the point list's middle point is (300, 100)
    const fixes = detachedLabels([arrow(), label(-14, 590)]);
    expect(fixes.get("t")).toEqual({ x: 270, y: 90 });
  });

  it("only looks at the arrows asked for", () => {
    const els = [arrow(), label(-14, 590)];
    expect(detachedLabels(els, new Set(["other"])).size).toBe(0);
    expect(detachedLabels(els, new Set(["a"])).size).toBe(1);
  });

  it("ignores deleted labels, text bound to something else, and arrows without a label", () => {
    expect(detachedLabels([arrow(), label(-14, 590, { isDeleted: true })]).size).toBe(0);
    expect(detachedLabels([arrow(), label(-14, 590, { containerId: "box" })]).size).toBe(0);
    expect(detachedLabels([arrow({ boundElements: null })]).size).toBe(0);
  });
});
