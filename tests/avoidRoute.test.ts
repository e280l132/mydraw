import { describe, expect, it } from "vitest";
import { crossesBox, fixedSegmentsFor, nearestSide, portPoint, routeAround, routeLength, snapRatio } from "../shared/avoidRoute";
import { isOrthogonal } from "../shared/routing";

const A = { x: 0, y: 0, width: 100, height: 60 };
const B = { x: 500, y: 0, width: 100, height: 60 };
const wall = { x: 250, y: -100, width: 60, height: 260 }; // between A and B, taller than both

const route = (extra: Partial<Parameters<typeof routeAround>[0]> = {}) =>
  routeAround({
    start: portPoint(A, "right", 0.5, 5),
    startSide: "right",
    end: portPoint(B, "left", 0.5, 5),
    endSide: "left",
    startBox: A,
    endBox: B,
    obstacles: [],
    ...extra,
  });

describe("routeAround", () => {
  it("goes straight when nothing is in the way", () => {
    const r = route();
    expect(r.ok).toBe(true);
    expect(r.points).toEqual([
      { x: 105, y: 30 },
      { x: 495, y: 30 },
    ]);
  });

  it("goes around an obstacle in between, keeping clear of it", () => {
    const r = route({ obstacles: [wall] });
    expect(r.ok).toBe(true);
    expect(isOrthogonal(r.points)).toBe(true);
    expect(crossesBox(r.points, wall)).toBe(false);
    // ...at the clearance (16px), not hugging it
    const inflated = { x: wall.x - 15, y: wall.y - 15, width: wall.width + 30, height: wall.height + 30 };
    expect(crossesBox(r.points, inflated)).toBe(false);
    expect(r.points[0]).toEqual({ x: 105, y: 30 });
    expect(r.points.at(-1)).toEqual({ x: 495, y: 30 });
  });

  it("leaves and enters straight through the given sides", () => {
    const r = route({ obstacles: [wall] });
    const [p0, p1] = r.points;
    expect(p1.y).toBe(p0.y); // horizontal out of the right side
    expect(p1.x).toBeGreaterThan(p0.x);
    const [q1, q0] = r.points.slice(-2);
    expect(q1.y).toBe(q0.y); // horizontal into the left side
    expect(q1.x).toBeLessThan(q0.x);
  });

  it("enters a side that faces away, going around the target", () => {
    const r = routeAround({
      start: portPoint(A, "right", 0.5, 5),
      startSide: "right",
      end: portPoint(B, "right", 0.5, 5),
      endSide: "right",
      startBox: A,
      endBox: B,
      obstacles: [],
    });
    expect(r.ok).toBe(true);
    expect(crossesBox(r.points, B)).toBe(false);
    const [q1, q0] = r.points.slice(-2);
    expect(q1.x).toBeGreaterThan(q0.x); // arrives moving left, into the right side
  });

  it("never crosses the source or the target", () => {
    const r = routeAround({
      start: portPoint(A, "left", 0.5, 5),
      startSide: "left",
      end: portPoint(B, "right", 0.5, 5),
      endSide: "right",
      startBox: A,
      endBox: B,
      obstacles: [],
    });
    expect(crossesBox(r.points, A)).toBe(false);
    expect(crossesBox(r.points, B)).toBe(false);
  });

  it("passes through waypoints in order", () => {
    const wp = [{ x: 300, y: 300 }];
    const r = route({ waypoints: wp });
    expect(r.points.some((p) => p.x === 300 && p.y === 300)).toBe(true);
    expect(isOrthogonal(r.points)).toBe(true);
  });

  it("goes around obstacles between waypoints too", () => {
    const blocker = { x: 200, y: 250, width: 200, height: 100 };
    const r = route({ waypoints: [{ x: 150, y: 300 }, { x: 450, y: 300 }], obstacles: [blocker] });
    expect(r.ok).toBe(true);
    expect(crossesBox(r.points, blocker)).toBe(false);
  });

  it("supports a free end (no target side)", () => {
    const r = routeAround({ start: portPoint(A, "right", 0.5, 5), startSide: "right", end: { x: 400, y: 300 }, startBox: A, obstacles: [wall] });
    expect(r.ok).toBe(true);
    expect(r.points.at(-1)).toEqual({ x: 400, y: 300 });
    expect(crossesBox(r.points, wall)).toBe(false);
  });

  it("squeezes through a narrow gap by shrinking the clearance", () => {
    // Two blocks leave a 20px corridor at y 20..40: too narrow for 16px clearance, fine for 8.
    const top = { x: 200, y: -200, width: 100, height: 220 };
    const bottom = { x: 200, y: 40, width: 100, height: 220 };
    const r = route({ obstacles: [top, bottom] });
    expect(r.ok).toBe(true);
    expect(crossesBox(r.points, top)).toBe(false);
    expect(crossesBox(r.points, bottom)).toBe(false);
  });

  it("falls back to a plain elbow when the target is walled in", () => {
    const cage = [
      { x: 450, y: -50, width: 200, height: 20 },
      { x: 450, y: 90, width: 200, height: 20 },
      { x: 450, y: -50, width: 20, height: 160 },
      { x: 630, y: -50, width: 20, height: 160 },
    ];
    const r = route({ obstacles: cage, clearance: 16 });
    expect(r.ok).toBe(false);
    expect(r.points[0]).toEqual({ x: 105, y: 30 });
    expect(r.points.at(-1)).toEqual({ x: 495, y: 30 });
  });

  it("prefers fewer bends at equal length", () => {
    const r = route({ obstacles: [wall] });
    // Around one wall: out, over (or under), back: at most 4 bends.
    expect(r.points.length).toBeLessThanOrEqual(6);
    expect(routeLength(r.points)).toBeLessThan(1200);
  });

  it("treats a shape holding a bend point (or a free end) as a place to route into, not an obstacle", () => {
    const zone = { x: 200, y: 200, width: 300, height: 200 };
    const r = route({ obstacles: [zone], waypoints: [{ x: 350, y: 300 }] });
    expect(r.ok).toBe(true);
    const free = routeAround({ start: portPoint(A, "right", 0.5, 5), startSide: "right", end: { x: 350, y: 300 }, startBox: A, obstacles: [zone] });
    expect(free.ok).toBe(true);
    expect(free.points.at(-1)).toEqual({ x: 350, y: 300 });
  });

  it("widens its search when a detour leaves the nearby region (never runs through a far shape)", () => {
    // A very tall wall between A and B; the way round its top passes a block more than 400px away from both.
    const tall = { x: 250, y: -900, width: 60, height: 1800 };
    const farBlock = { x: 150, y: -1000, width: 300, height: 60 };
    const r = route({ obstacles: [tall, farBlock] });
    expect(r.ok).toBe(true);
    expect(crossesBox(r.points, tall)).toBe(false);
    expect(crossesBox(r.points, farBlock)).toBe(false);
  });

  it("stays fast with many obstacles", () => {
    const obstacles = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) obstacles.push({ x: 150 + i * 30, y: -200 + j * 40, width: 12, height: 12 });
    const t0 = performance.now();
    const r = route({ obstacles, clearance: 6 });
    const ms = performance.now() - t0;
    expect(r.points.length).toBeGreaterThan(1);
    expect(ms).toBeLessThan(250);
  });
});

describe("ports", () => {
  it("puts a port on a side, at a ratio, a gap outside", () => {
    expect(portPoint(A, "right", 0.5, 5)).toEqual({ x: 105, y: 30 });
    expect(portPoint(A, "top", 0.25)).toEqual({ x: 25, y: 0 });
    expect(portPoint(A, "bottom", 2)).toEqual({ x: 100, y: 60 }); // clamped
  });

  it("finds the nearest side and the position along it", () => {
    expect(nearestSide(A, { x: 98, y: 15 })).toEqual({ side: "right", ratio: 0.25 });
    expect(nearestSide(A, { x: 50, y: 58 }).side).toBe("bottom");
    expect(nearestSide(A, { x: 2, y: 30 }).side).toBe("left");
  });

  it("snaps to quarter points, middle only on short sides", () => {
    expect(snapRatio(0.3, 200)).toBe(0.25);
    expect(snapRatio(0.6, 200)).toBe(0.5);
    expect(snapRatio(0.9, 200)).toBe(0.75);
    expect(snapRatio(0.9, 40)).toBe(0.5);
  });
});

describe("fixedSegmentsFor", () => {
  it("fixes every segment that doesn't touch an end, relative to the first point", () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 10 },
      { x: 220, y: 10 },
    ];
    expect(fixedSegmentsFor(pts)).toEqual([
      { index: 2, start: [20, 0], end: [20, 90] },
      { index: 3, start: [20, 90], end: [190, 90] },
      { index: 4, start: [190, 90], end: [190, 0] },
    ]);
  });

  it("has nothing to fix on short routes", () => {
    expect(fixedSegmentsFor([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([]);
    expect(fixedSegmentsFor([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual([]);
  });
});
