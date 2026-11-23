import { describe, expect, it } from "vitest";
import { measureQuality, type QNode, type QRoute, type QZone } from "../shared/diagramQuality";
import { labelOffsetLimit, placeLabels, separateParallel, tidyRoutes, TRACK } from "../shared/edgeTidy";
import { distToPolyline } from "../shared/labelGuard";

const box = (x: number, y: number, width = 100, height = 80) => ({ x, y, width, height });
const pts = (...p: [number, number][]) => p.map(([x, y]) => ({ x, y }));
const nodes = (): Map<string, QNode> =>
  new Map<string, QNode>([
    ["a", box(0, 0)],
    ["b", box(500, 0)],
    ["c", box(500, 300)],
    ["d", box(0, 300)],
  ]);
const zones = new Map<string, QZone>();

describe("separate parallel arrows", () => {
  it("moves a run that lies on top of another one aside", () => {
    // a->b and a->c share the vertical run at x=300 between y=40 and y=100
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 30], [300, 30], [300, 100], [495, 100]) },
      { id: "e2", from: "a", to: "c", points: pts([105, 35], [300, 35], [300, 340], [495, 340]) },
    ];
    const before = measureQuality({ nodes: nodes(), zones, routes });
    expect(before.metrics.edgeOverlap).toBe(1);
    const out = separateParallel({ nodes: nodes(), zones, routes });
    const after = measureQuality({ nodes: nodes(), zones, routes: out });
    expect(after.metrics.edgeOverlap).toBe(0);
    // still orthogonal, same ends
    for (const r of out) {
      for (let i = 1; i < r.points.length; i++) expect(Math.abs(r.points[i].x - r.points[i - 1].x) < 0.5 || Math.abs(r.points[i].y - r.points[i - 1].y) < 0.5).toBe(true);
    }
    expect(out[0].points[0]).toEqual(routes[0].points[0]);
    expect(out[1].points.at(-1)).toEqual(routes[1].points.at(-1));
    // the input is not modified
    expect(routes[1].points[1]).toEqual({ x: 300, y: 35 });
  });

  it("slides an arrow along its node's side, never off it", () => {
    // two straight arrows on top of each other between a and b: one slides along the sides
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 40], [495, 40]) },
      { id: "e2", from: "a", to: "b", points: pts([105, 44], [495, 44]) },
    ];
    const out = separateParallel({ nodes: nodes(), zones, routes });
    expect(measureQuality({ nodes: nodes(), zones, routes: out }).metrics.edgeOverlap).toBe(0);
    for (const r of out) for (const p of r.points) expect(p.y).toBeGreaterThanOrEqual(6), expect(p.y).toBeLessThanOrEqual(74);
    expect(Math.abs(out[0].points[0].y - out[1].points[0].y)).toBeGreaterThanOrEqual(TRACK - 1);
  });

  it("leaves a diagram with no overlaps exactly as it is", () => {
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 20], [495, 20]) },
      { id: "e2", from: "d", to: "c", points: pts([105, 340], [495, 340]) },
    ];
    expect(separateParallel({ nodes: nodes(), zones, routes })).toEqual(routes);
  });

  it("does not move a run into a node", () => {
    // the only room to move the run would be through node c: keep the overlap rather than make it worse
    const n = new Map(nodes());
    n.set("blocker", box(150, 120, 120, 150));
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 30], [300, 30], [300, 100], [495, 100]) },
      { id: "e2", from: "a", to: "c", points: pts([105, 35], [300, 35], [300, 340], [495, 340]) },
    ];
    const out = separateParallel({ nodes: n, zones, routes });
    expect(measureQuality({ nodes: n, zones, routes: out }).metrics.throughNode).toBe(0);
  });
});

describe("label placement", () => {
  const label = { width: 80, height: 21 };

  it("keeps a label where it is when it is already clear", () => {
    const routes: QRoute[] = [{ id: "e1", from: "a", to: "b", points: pts([105, 40], [495, 40]), label }];
    expect(placeLabels({ nodes: nodes(), zones, routes }).get("e1")).toEqual({ x: 300, y: 40 });
  });

  it("moves a label off another arrow", () => {
    // the midpoint (300, 40) has a vertical arrow through it
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 40], [495, 40]), label },
      { id: "e2", from: "d", to: "c", points: pts([300, -60], [300, 160]) },
    ];
    const before = measureQuality({ nodes: nodes(), zones, routes });
    expect(before.metrics.labelCollision).toBe(1);
    const c = placeLabels({ nodes: nodes(), zones, routes }).get("e1")!;
    expect(c.y).toBe(40); // still on its arrow
    expect(c.x).toBeGreaterThan(105);
    expect(c.x).toBeLessThan(495);
    const after = measureQuality({ nodes: nodes(), zones, routes: [{ ...routes[0], label: { ...label, center: c } }, routes[1]] });
    expect(after.metrics.labelCollision).toBe(0);
  });

  it("moves a label off another label and off a zone title", () => {
    const z = new Map<string, QZone>([["z", { ...box(200, 0, 250, 150), titleWidth: 120, titleHeight: 30 }]]);
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 20], [495, 20]), label },
      { id: "e2", from: "d", to: "c", points: pts([105, 340], [495, 340]), label: { ...label, center: { x: 300, y: 340 } } },
    ];
    const centers = placeLabels({ nodes: nodes(), zones: z, routes });
    const out = routes.map((r) => ({ ...r, label: { ...r.label!, center: centers.get(r.id) } }));
    expect(measureQuality({ nodes: nodes(), zones: z, routes: out }).metrics.labelCollision).toBe(0);
    const c1 = centers.get("e1")!;
    expect(c1.x - 40).toBeGreaterThanOrEqual(200 + 120); // right of the title
  });

  it("never leaves the arrow running through its text: on a horizontal stretch, or beside a vertical one", () => {
    // the label's current spot is centred on the long vertical run
    const routes: QRoute[] = [{ id: "e1", from: "a", to: "c", points: pts([105, 40], [300, 40], [300, 340], [495, 340]), label: { ...label, center: { x: 300, y: 190 } } }];
    const c = placeLabels({ nodes: nodes(), zones, routes }).get("e1")!;
    const onHorizontal = c.y === 40 || c.y === 340;
    const besideVertical = Math.abs(c.x - 300) >= label.width / 2;
    expect(onHorizontal || besideVertical).toBe(true);
    expect(measureQuality({ nodes: nodes(), zones, routes: [{ ...routes[0], label: { ...label, center: c } }] }).metrics.labelCollision).toBe(0);
  });

  it("puts a label beside a vertical arrow when that is the only free stretch", () => {
    // only a vertical run (a straight arrow between stacked nodes)
    const routes: QRoute[] = [{ id: "e1", from: "a", to: "d", points: pts([50, 85], [50, 295]), label }];
    const c = placeLabels({ nodes: nodes(), zones, routes }).get("e1")!;
    expect(Math.abs(c.x - 50)).toBeGreaterThanOrEqual(label.width / 2);
    expect(Math.abs(c.x - 50)).toBeLessThanOrEqual(labelOffsetLimit(label.width));
  });

  it("puts every label on its own route", () => {
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "c", points: pts([105, 40], [300, 40], [300, 340], [495, 340]), label },
      { id: "e2", from: "d", to: "b", points: pts([105, 340], [200, 340], [200, 40], [495, 40]), label },
    ];
    const centers = placeLabels({ nodes: nodes(), zones, routes });
    for (const r of routes) {
      const c = centers.get(r.id)!;
      expect(distToPolyline(c, r.points)).toBeLessThanOrEqual(labelOffsetLimit(label.width));
    }
  });

  it("tidyRoutes separates, then places labels", () => {
    const routes: QRoute[] = [
      { id: "e1", from: "a", to: "b", points: pts([105, 30], [300, 30], [300, 100], [495, 100]), label },
      { id: "e2", from: "a", to: "c", points: pts([105, 35], [300, 35], [300, 340], [495, 340]), label },
    ];
    const out = tidyRoutes({ nodes: nodes(), zones, routes });
    const q = measureQuality({ nodes: nodes(), zones, routes: out });
    expect(q.metrics.edgeOverlap).toBe(0);
    expect(q.metrics.labelCollision).toBe(0);
  });
});
