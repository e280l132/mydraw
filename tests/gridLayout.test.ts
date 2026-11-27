import { describe, expect, it } from "vitest";
import { layoutGrid, parseCell, routeBetweenBoxes, routeEdges, type DiagramGrid } from "../shared/gridLayout";
import { normalizeSpec } from "../shared/diagram";
import { crossesBox } from "../shared/avoidRoute";

const grid: DiagramGrid = {
  id: "g",
  rows: [
    { id: "public", label: "Public subnet" },
    { id: "app", label: "Private subnet" },
  ],
  columns: [
    { id: "a", label: "AZ-a" },
    { id: "b", label: "AZ-b" },
  ],
};
const opts = { titleHeight: (l?: string) => (l ? 30 : 4), titleWidth: (l?: string) => (l ? l.length * 8 : 0) };
const inside = (inner: { x: number; y: number; width: number; height: number }, outer: typeof inner) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

describe("grid layout", () => {
  const nodes = [
    { id: "nat-a", width: 80, height: 90, row: "public", col: "a" },
    { id: "nat-b", width: 80, height: 90, row: "public", col: "b" },
    { id: "alb", width: 100, height: 90, row: "public", col: null },
    { id: "web-a1", width: 80, height: 90, row: "app", col: "a" },
    { id: "web-a2", width: 80, height: 90, row: "app", col: "a" },
    { id: "web-b", width: 80, height: 90, row: "app", col: "b" },
  ];
  const lay = layoutGrid(grid, nodes, opts);

  it("puts every node in its cell, cells in their column", () => {
    for (const n of nodes.filter((n) => n.col)) expect(inside(lay.nodes.get(n.id)!, lay.cells.get(`${n.row}/${n.col}`)!), n.id).toBe(true);
    for (const r of grid.rows) for (const c of grid.columns) expect(inside(lay.cells.get(`${r.id}/${c.id}`)!, lay.columns.get(c.id)!)).toBe(true);
  });
  it("lines up rows across columns and columns across rows", () => {
    expect(lay.cells.get("public/a")!.y).toBe(lay.cells.get("public/b")!.y);
    expect(lay.cells.get("public/a")!.height).toBe(lay.cells.get("public/b")!.height);
    expect(lay.cells.get("public/a")!.width).toBe(lay.cells.get("app/a")!.width);
    expect(lay.nodes.get("nat-a")!.y).toBe(lay.nodes.get("nat-b")!.y);
  });
  it("puts a row-spanning node between two AZ columns, level with the row", () => {
    const alb = lay.nodes.get("alb")!;
    const a = lay.columns.get("a")!;
    const b = lay.columns.get("b")!;
    expect(alb.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(alb.x + alb.width).toBeLessThanOrEqual(b.x);
    expect(alb.y + alb.height / 2).toBeCloseTo(lay.nodes.get("nat-a")!.y + lay.nodes.get("nat-a")!.height / 2);
  });
  it("with an odd number of columns puts it in a strip above the row", () => {
    const g3 = { ...grid, columns: [...grid.columns, { id: "c", label: "AZ-c" }] };
    const l3 = layoutGrid(g3, nodes, opts);
    const alb = l3.nodes.get("alb")!;
    expect(alb.y + alb.height).toBeLessThanOrEqual(l3.cells.get("public/a")!.y);
    expect(alb.x + alb.width / 2).toBeCloseTo(l3.width / 2);
  });
  it("puts a column-spanning node between two AZ rows (tiers as columns)", () => {
    const t: DiagramGrid = { id: "t", rows: [{ id: "aza", label: "AZ a" }, { id: "azb", label: "AZ b" }], columns: [{ id: "pub", label: "Public" }, { id: "app", label: "App" }] };
    const l = layoutGrid(t, [
      { id: "lb", width: 100, height: 90, row: null, col: "pub" },
      { id: "n1", width: 80, height: 90, row: "aza", col: "pub" },
      { id: "n2", width: 80, height: 90, row: "azb", col: "pub" },
    ], opts);
    const lb = l.nodes.get("lb")!;
    expect(lb.y).toBeGreaterThanOrEqual(l.cells.get("aza/pub")!.y + l.cells.get("aza/pub")!.height);
    expect(lb.y + lb.height).toBeLessThanOrEqual(l.cells.get("azb/pub")!.y);
    expect(inside(lb, l.columns.get("pub")!)).toBe(true);
  });
  it("keeps nodes apart", () => {
    const boxes = [...lay.nodes.values()];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
  });
  it("parses cells", () => {
    expect(parseCell("public/a", grid)).toEqual({ row: "public", col: "a" });
    expect(parseCell("app/*", grid)).toEqual({ row: "app", col: null });
    expect(parseCell("*/b", grid)).toEqual({ row: null, col: "b" });
    expect(() => parseCell("*/*", grid)).toThrow(/row or a column/);
    expect(() => parseCell("data/a", grid)).toThrow(/no row/);
    expect(() => parseCell("public/c", grid)).toThrow(/no column/);
    expect(() => parseCell("public", grid)).toThrow(/row\/column/);
  });
  it("routes between boxes around obstacles", () => {
    const a = { x: 0, y: 0, width: 50, height: 50 };
    const b = { x: 300, y: 0, width: 50, height: 50 };
    const wall = { x: 140, y: -40, width: 40, height: 130 };
    const pts = routeBetweenBoxes(a, b, [wall]).points;
    expect(crossesBox(pts, wall)).toBe(false);
  });
  it("fans arrows out of one side instead of stacking them", () => {
    const boxes = new Map([
      ["lb", { x: 0, y: 200, width: 60, height: 60 }],
      ["w1", { x: 300, y: 0, width: 60, height: 60 }],
      ["w2", { x: 300, y: 400, width: 60, height: 60 }],
    ]);
    const r = routeEdges([{ id: "e1", from: "lb", to: "w1" }, { id: "e2", from: "lb", to: "w2" }], boxes);
    const s1 = r.get("e1")![0];
    const s2 = r.get("e2")![0];
    expect(s1.x === s2.x && s1.y === s2.y).toBe(false);
  });
});

describe("grid in a diagram spec", () => {
  const spec = normalizeSpec({
    zones: [{ id: "vpc", label: "VPC" }],
    grid: { id: "net", parent: "vpc", rows: [{ id: "pub", label: "Public subnet" }, { id: "app", label: "Private subnet" }], columns: ["AZ-a", "AZ-b"], cells: { "pub/AZ-a": "Public 10.0.1.0/24" } },
    nodes: [
      { id: "alb", cell: "pub/*" },
      { id: "w1", cell: "app/AZ-a" },
      { id: "w2", cell: "app/AZ-b" },
    ],
    edges: [{ from: "alb", to: "w1" }],
  });
  it("adds column and cell zones with kinds", () => {
    const z = new Map(spec.zones!.map((x) => [x.id, x]));
    expect(z.get("net.AZ-a")).toMatchObject({ kind: "az", parent: "vpc", grid: "net" });
    expect(z.get("net.pub.AZ-a")).toMatchObject({ kind: "subnet-public", parent: "net.AZ-a", label: "Public 10.0.1.0/24" });
    expect(z.get("net.app.AZ-b")).toMatchObject({ kind: "subnet-private", label: "Private subnet" });
  });
  it("puts nodes in their cell zone (spanning nodes in the grid's parent)", () => {
    const n = new Map(spec.nodes.map((x) => [x.id, x]));
    expect(n.get("w1")!.zone).toBe("net.app.AZ-a");
    expect(n.get("alb")!.zone).toBe("vpc");
    expect(normalizeSpec({ grid: { id: "g", rows: ["a", "b"], columns: ["pub"] }, nodes: [{ id: "lb", cell: "*/pub" }] }).nodes[0].zone).toBe("g.pub");
  });
  it("rejects bad grids", () => {
    expect(() => normalizeSpec({ nodes: [{ id: "a", cell: "x/y" }] })).toThrow(/no grid/);
    expect(() => normalizeSpec({ grid: { rows: [], columns: ["a"] }, nodes: [{ id: "a" }] })).toThrow(/rows/);
    expect(() => normalizeSpec({ grid: { rows: ["r"], columns: ["c"] }, nodes: [{ id: "a", cell: "r/c", zone: "z" }], zones: [{ id: "z" }] })).toThrow(/either zone or cell/);
  });
});

describe("grid spec normalizing", () => {
  it("is idempotent (main and renderer both normalize)", () => {
    const once = normalizeSpec({ grid: { id: "g", rows: ["r1", "r2"], columns: ["a", "b"] }, nodes: [{ id: "n", cell: "r1/a" }] });
    const twice = normalizeSpec(JSON.parse(JSON.stringify(once)));
    expect(twice.zones).toEqual(once.zones);
    expect(twice.nodes).toEqual(once.nodes);
  });
});
