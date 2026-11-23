import { describe, expect, it } from "vitest";
import { measureQuality, QUALITY_WEIGHTS, scoreOf, segmentHitsBox, type QNode, type QRoute, type QualityInput } from "../shared/diagramQuality";

const box = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });
const pts = (...p: [number, number][]) => p.map(([x, y]) => ({ x, y }));

/** a (0,0) ... b (400,0), c (200,200) below the middle, d (500, 200) */
function scene(routes: QRoute[], extra: Partial<QualityInput> = {}): QualityInput {
  return {
    nodes: new Map([
      ["a", box(0, 0)],
      ["b", box(400, 0)],
      ["c", box(200, 200)],
      ["d", box(500, 200)],
    ]),
    zones: new Map(),
    routes,
    ...extra,
  };
}

describe("diagram quality", () => {
  it("a clean diagram has no issues", () => {
    const q = measureQuality(scene([{ id: "e1", from: "a", to: "b", points: pts([105, 30], [395, 30]), label: { width: 40, height: 20 } }]));
    expect(q.issues).toEqual([]);
    expect(q.metrics).toMatchObject({ edgeOverlap: 0, throughNode: 0, labelCollision: 0, crossings: 0, bends: 0 });
  });

  it("finds arrows lying on top of each other, but not arrows fanning out of one node", () => {
    const on = measureQuality(
      scene([
        { id: "e1", from: "a", to: "b", points: pts([105, 30], [250, 30], [250, 100], [395, 100]) },
        { id: "e2", from: "a", to: "d", points: pts([105, 36], [250, 36], [250, 250], [495, 250]) },
      ]),
    );
    expect(on.metrics.edgeOverlap).toBe(1);
    expect(on.issues[0]).toMatchObject({ kind: "edge-overlap", edge: "e1", other: "e2" });
    // 20 px apart everywhere: fine
    const apart = measureQuality(
      scene([
        { id: "e1", from: "a", to: "b", points: pts([105, 20], [250, 20], [250, 100], [395, 100]) },
        { id: "e2", from: "a", to: "d", points: pts([105, 40], [280, 40], [280, 250], [495, 250]) },
      ]),
    );
    expect(apart.metrics.edgeOverlap).toBe(0);
    // both leave the same point: the shared first run (35 px) is only the fan-out out of the node
    const fan = measureQuality(
      scene([
        { id: "e1", from: "a", to: "b", points: pts([105, 30], [140, 30], [140, 90], [395, 90]) },
        { id: "e2", from: "a", to: "d", points: pts([105, 30], [160, 30], [160, 250], [495, 250]) },
      ]),
    );
    expect(fan.metrics.edgeOverlap).toBe(0);
  });

  it("finds an arrow through a node it doesn't connect, but not through a zone it ends at", () => {
    const through = measureQuality(scene([{ id: "e1", from: "a", to: "d", points: pts([105, 30], [250, 30], [250, 230], [495, 230]) }]));
    expect(through.metrics.throughNode).toBe(1);
    expect(through.issues[0]).toMatchObject({ kind: "edge-through-node", other: "c" });
    // c sits inside zone z and the arrow ends at the zone: not a problem
    const inZone = measureQuality(
      scene([{ id: "e1", from: "a", to: "z", points: pts([105, 30], [250, 30], [250, 230], [495, 230]) }], {
        nodes: new Map<string, QNode>([
          ["a", box(0, 0)],
          ["c", { ...box(200, 200), zone: "z" }],
        ]),
        zones: new Map([["z", { ...box(150, 150, 300, 200), titleWidth: 80, titleHeight: 30 }]]),
      }),
    );
    expect(inZone.metrics.throughNode).toBe(0);
  });

  it("finds labels under nodes, zone titles, other labels and other arrows", () => {
    const under = (center: { x: number; y: number }, others: QRoute[] = [], extra: Partial<QualityInput> = {}) =>
      measureQuality(scene([{ id: "e1", from: "a", to: "b", points: pts([105, 30], [395, 30]), label: { width: 60, height: 20, center } }, ...others], extra));
    expect(under({ x: 250, y: 30 }).metrics.labelCollision).toBe(0);
    expect(under({ x: 50, y: 30 }).issues[0].message).toMatch(/overlaps node "a"/);
    expect(
      under({ x: 250, y: 30 }, [{ id: "e2", from: "c", to: "d", points: pts([250, 0], [250, 120]) }]).issues[0].message,
    ).toMatch(/sits under arrow "e2"/);
    expect(
      under({ x: 250, y: 30 }, [{ id: "e2", from: "c", to: "d", points: pts([100, 300], [300, 300]), label: { width: 60, height: 20, center: { x: 260, y: 36 } } }]).issues[0].message,
    ).toMatch(/overlaps the label of "e2"/);
    expect(
      under({ x: 250, y: 30 }, [], { zones: new Map([["z", { ...box(200, 0, 300, 200), titleWidth: 120, titleHeight: 30 }]]) }).issues[0].message,
    ).toMatch(/title of zone "z"/);
  });

  it("counts crossings, bends and length", () => {
    const q = measureQuality(
      scene([
        { id: "e1", from: "a", to: "b", points: pts([105, 30], [395, 30]) },
        { id: "e2", from: "c", to: "d", points: pts([250, -50], [250, 100]) },
      ]),
    );
    expect(q.metrics.crossings).toBe(1);
    expect(q.metrics.length).toBe(440);
    const bent = measureQuality(scene([{ id: "e1", from: "a", to: "d", points: pts([105, 30], [250, 30], [250, 100], [495, 100]) }]));
    expect(bent.metrics.bends).toBe(2);
  });

  it("scores problems far above bends and length, and an extreme aspect ratio", () => {
    const base = { nodes: 10, edges: 1, edgeOverlap: 0, throughNode: 0, labelCollision: 0, crossings: 0, bends: 0, length: 0, aspect: 1 };
    expect(scoreOf({ ...base, labelCollision: 1 })).toBe(QUALITY_WEIGHTS.labelCollision);
    expect(scoreOf({ ...base, bends: 10, length: 1000 })).toBe(20);
    expect(scoreOf({ ...base, aspect: 5 })).toBe(60);
    expect(scoreOf({ ...base, nodes: 3, aspect: 5 })).toBe(0); // a short chain is naturally wide
    expect(scoreOf({ ...base, throughNode: 1 })).toBeGreaterThan(scoreOf({ ...base, crossings: 10 }));
  });

  it("gives advice about structure", () => {
    const routes: QRoute[] = Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, from: "a", to: i % 2 ? "b" : "c", points: pts([105, 30 + i * 20], [395, 30 + i * 20]) }));
    expect(measureQuality(scene(routes)).advice.join(" ")).toMatch(/"a" has 8 arrows/);
  });

  it("segment-box hit test", () => {
    expect(segmentHitsBox({ x: 0, y: 5 }, { x: 100, y: 5 }, box(40, 0, 20, 10))).toBe(true);
    expect(segmentHitsBox({ x: 0, y: 50 }, { x: 100, y: 50 }, box(40, 0, 20, 10))).toBe(false);
    expect(segmentHitsBox({ x: 50, y: 5 }, { x: 50, y: 5 }, box(40, 0, 20, 10))).toBe(true);
  });
});
