import { describe, expect, it } from "vitest";
import { normalizeSpec, tint, zoneColors, zoneDepths } from "../shared/diagram";
import type { Box } from "../shared/geometry";
import { layoutGraph, translateLayout } from "../shared/layout";
import { findStencil, type LibraryItem } from "../shared/library";
import { isFlowchart, parseMermaidFlowchart, splitStatements } from "../shared/mermaid";
import { curvedPoints, elbowRoute, fixedPointFor, inset, isOrthogonal, tidyRoute } from "../shared/routing";
import { TEMPLATES, findTemplate } from "../shared/templates";

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 0.01 &&
  inner.y >= outer.y - 0.01 &&
  inner.x + inner.width <= outer.x + outer.width + 0.01 &&
  inner.y + inner.height <= outer.y + outer.height + 0.01;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("layoutGraph (ELK)", () => {
  it("lays out a layered flow left to right with orthogonal edges", async () => {
    const r = await layoutGraph({
      nodes: [
        { id: "a", width: 100, height: 50 },
        { id: "b", width: 100, height: 50 },
        { id: "c", width: 100, height: 50 },
      ],
      edges: [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "b", to: "c", label: { width: 40, height: 16 } },
      ],
    });
    const [a, b, c] = ["a", "b", "c"].map((id) => r.nodes.get(id)!);
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(b.x + b.width).toBeLessThan(c.x);
    expect(r.orthogonal).toBe(true);
    for (const pts of r.edges.values()) expect(isOrthogonal(pts)).toBe(true);
    // Edge e1 starts on a's right side and ends on b's left side.
    const e1 = r.edges.get("e1")!;
    expect(e1[0].x).toBeCloseTo(a.x + a.width, 0);
    expect(e1[e1.length - 1].x).toBeCloseTo(b.x, 0);
  });

  it("puts nodes inside nested zones, below the zone title", async () => {
    const r = await layoutGraph({
      zones: [
        { id: "vpc", titleHeight: 30, minWidth: 200 },
        { id: "sub", parent: "vpc", titleHeight: 30, minWidth: 120 },
      ],
      nodes: [
        { id: "out", width: 80, height: 40 },
        { id: "in1", width: 80, height: 40, zone: "sub" },
        { id: "in2", width: 80, height: 40, zone: "vpc" },
      ],
      edges: [
        { id: "x", from: "out", to: "in1" },
        { id: "y", from: "in1", to: "in2" },
      ],
      direction: "down",
    });
    const vpc = r.zones.get("vpc")!;
    const sub = r.zones.get("sub")!;
    expect(contains(vpc, sub)).toBe(true);
    expect(contains(sub, r.nodes.get("in1")!)).toBe(true);
    expect(contains(vpc, r.nodes.get("in2")!)).toBe(true);
    expect(contains(vpc, r.nodes.get("out")!)).toBe(false);
    expect(r.nodes.get("in1")!.y).toBeGreaterThanOrEqual(sub.y + 30);
    expect(vpc.width).toBeGreaterThanOrEqual(200);
    // Coordinates are absolute (edge into the nested zone ends at in1's top).
    const x = r.edges.get("x")!;
    expect(x[x.length - 1].y).toBeCloseTo(r.nodes.get("in1")!.y, 0);
  });

  it("other algorithms give non-overlapping nodes", async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, width: 60, height: 40 }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: "n0", to: n.id }));
    for (const algorithm of ["tree", "radial", "force", "grid"] as const) {
      const r = await layoutGraph({ nodes, edges, algorithm });
      const boxes = [...r.nodes.values()];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), algorithm).toBe(false);
    }
  });

  it("rejects bad input and translates results", async () => {
    await expect(layoutGraph({ nodes: [{ id: "a", width: 1, height: 1, zone: "z" }] })).rejects.toThrow(/no zone "z"/);
    await expect(
      layoutGraph({
        nodes: [],
        zones: [
          { id: "a", parent: "b", titleHeight: 1, minWidth: 1 },
          { id: "b", parent: "a", titleHeight: 1, minWidth: 1 },
        ],
      }),
    ).rejects.toThrow(/inside itself/);
    const r = await layoutGraph({ nodes: [{ id: "a", width: 10, height: 10 }] });
    const t = translateLayout(r, { x: 500, y: -20 });
    expect(t.bounds.x).toBe(500);
    expect(t.nodes.get("a")!.y).toBe(-20);
  });
});

describe("routing", () => {
  const a: Box = { x: 0, y: 0, width: 100, height: 50 };
  it("elbow: straight run between side-by-side boxes at the same height", () => {
    const r = elbowRoute(a, { x: 300, y: 0, width: 100, height: 50 });
    expect(r.start).toBe("right");
    expect(r.end).toBe("left");
    expect(r.points).toEqual([
      { x: 105, y: 25 },
      { x: 295, y: 25 },
    ]);
  });
  it("elbow: Z route with two bends", () => {
    const r = elbowRoute(a, { x: 300, y: 200, width: 100, height: 50 });
    expect(r.points.length).toBe(4);
    expect(isOrthogonal(r.points)).toBe(true);
  });
  it("elbow: vertical when stacked, around when overlapping", () => {
    const v = elbowRoute(a, { x: 20, y: 200, width: 100, height: 50 });
    expect(v.start).toBe("bottom");
    expect(v.end).toBe("top");
    expect(isOrthogonal(v.points)).toBe(true);
    const o = elbowRoute(a, { x: 10, y: 10, width: 100, height: 50 });
    expect(o.start).toBe("right");
    expect(o.end).toBe("right");
    expect(isOrthogonal(o.points)).toBe(true);
  });
  it("tidyRoute lengthens short end runs and drops collinear points", () => {
    const P = (x: number, y: number) => ({ x, y });
    expect(tidyRoute([P(0, 0), P(60, 0), P(60, -69), P(70, -69)], 20)).toEqual([P(0, 0), P(50, 0), P(50, -69), P(70, -69)]);
    expect(tidyRoute([P(0, 0), P(228, 0), P(281, 0)])).toEqual([P(0, 0), P(281, 0)]);
    // Would flip a segment: left alone.
    expect(tidyRoute([P(0, 0), P(5, 0), P(5, 50), P(10, 50)], 20)).toEqual([P(0, 0), P(5, 0), P(5, 50), P(10, 50)]);
  });
  it("inset, fixedPointFor, curvedPoints", () => {
    expect(
      inset(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
        ],
        5,
      ),
    ).toEqual([
      { x: 5, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 95 },
    ]);
    expect(fixedPointFor(a, { x: 105, y: 25 })).toEqual([1.05, 0.5]);
    const c = curvedPoints({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(c.length).toBe(3);
    expect(c[1].x).toBe(50);
    expect(c[1].y).not.toBe(0);
  });
});

describe("diagram spec", () => {
  it("normalizes and fills edge ids", () => {
    const s = normalizeSpec({
      nodes: [{ id: "a", label: "A", color: "#F00" }, { id: "b" }],
      edges: [{ from: "a", to: "b" }, { id: "e1", from: "b", to: "a" }],
      zones: [{ id: "z", label: "Zone" }],
      direction: "down",
    });
    expect(s.nodes[0].color).toBe("#ff0000");
    expect(s.edges!.map((e) => e.id)).toEqual(["e2", "e1"]);
  });
  it("reports bad input clearly", () => {
    expect(() => normalizeSpec({ nodes: [{ id: "a" }, { id: "a" }] })).toThrow(/used twice/);
    expect(() => normalizeSpec({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "x" }] })).toThrow(/no node or zone "x"/);
    expect(() => normalizeSpec({ nodes: [{ id: "a", zone: "nope" }] })).toThrow(/no zone/);
    expect(() => normalizeSpec({ nodes: [{ id: "a", color: "bluish" }] })).toThrow(/hex/);
    expect(() => normalizeSpec({ nodes: [{ id: "a" }], direction: "sideways" })).toThrow(/direction/);
    expect(() => normalizeSpec({ nodes: [] })).toThrow(/at least one node/);
  });
  it("zone colors and depths", () => {
    const zones = [{ id: "a" }, { id: "b", parent: "a" }, { id: "c", parent: "b", color: "#ff0000" }];
    expect([...zoneDepths(zones).values()]).toEqual([0, 1, 2]);
    const c = zoneColors(zones);
    expect(c.get("c")).toEqual({ stroke: "#ff0000", fill: tint("#ff0000") });
    expect(c.get("a")!.stroke).not.toBe(c.get("b")!.stroke);
    expect(tint("#000000", 0.5)).toBe("#808080");
  });
  it("every template is a valid diagram", () => {
    for (const t of TEMPLATES) expect(() => normalizeSpec(t.spec), t.name).not.toThrow();
    expect(findTemplate("AWS VPC (2 AZs)")?.name).toBe("aws-vpc");
  });
});

describe("Mermaid flowcharts", () => {
  it("detects flowcharts", () => {
    expect(isFlowchart("%% hi\nflowchart LR\nA-->B")).toBe(true);
    expect(isFlowchart("graph TD; A-->B")).toBe(true);
    expect(isFlowchart("sequenceDiagram\nA->>B: hi")).toBe(false);
  });
  it("parses shapes, chains, labels, &, subgraphs and styles", () => {
    const s = parseMermaidFlowchart(`flowchart LR
      A[Web server] -->|HTTP| B(App)
      B --> C[(Database)] --> D{OK?}
      D -- yes --> E((Done))
      D -. retry .-> B
      A & B --- F
      G <-- H
      X ==> Y
      subgraph vpc [My VPC]
        B
        C
        subgraph inner
          E
        end
      end
      style A fill:#ffd8a8,stroke:#e8590c
      classDef hot fill:#ffc9c9
      class E hot
      Z:::hot --> A`);
    expect(s.direction).toBe("right");
    const n = (id: string) => s.nodes.find((x) => x.id === id)!;
    expect(n("A").label).toBe("Web server");
    expect(n("C").shape).toBe("ellipse");
    expect(n("D").shape).toBe("diamond");
    expect(n("E").shape).toBe("ellipse");
    expect(n("A").fill).toBe("#ffd8a8");
    expect(n("A").color).toBe("#e8590c");
    expect(n("E").fill).toBe("#ffc9c9");
    expect(n("Z").fill).toBe("#ffc9c9");
    expect(n("B").zone).toBe("vpc");
    expect(n("E").zone).toBe("inner");
    expect(s.zones!.find((z) => z.id === "vpc")!.label).toBe("My VPC");
    expect(s.zones!.find((z) => z.id === "inner")!.parent).toBe("vpc");
    const e = (from: string, to: string) => s.edges!.find((x) => x.from === from && x.to === to)!;
    expect(e("A", "B").label).toBe("HTTP");
    expect(e("C", "D")).toBeTruthy();
    expect(e("D", "E").label).toBe("yes");
    expect(e("D", "B").style).toBe("dashed");
    expect(e("D", "B").label).toBe("retry");
    expect(e("A", "F").arrow).toBe("none");
    expect(e("B", "F")).toBeTruthy();
    expect(e("H", "G").arrow).toBe("end");
    expect(e("X", "Y").width).toBe(4);
    expect(() => normalizeSpec(s)).not.toThrow();
  });
  it("reports errors", () => {
    expect(() => parseMermaidFlowchart("flowchart LR\nsubgraph x\nA-->B")).toThrow(/no "end"/);
    expect(() => parseMermaidFlowchart("pie\n'a': 1")).toThrow(/only Mermaid flowcharts/);
  });
});

describe("findStencil", () => {
  const item = (collection: string, name: string, kind: LibraryItem["kind"] = "svg"): LibraryItem => ({
    id: `${collection}/${name}.svg`,
    collection,
    groups: [],
    name,
    tags: [],
    kind,
    file: `${collection}/${name}.svg`,
    mtime: 0,
  });
  const items = [item("AWS", "Amazon EC2"), item("AWS", "Amazon EC2 Auto Scaling"), item("Network", "Router"), item("My Stencils", "Core pair", "stencil")];
  it("by id, exact name, search, and collection prefix", () => {
    expect(findStencil(items, "AWS/Amazon EC2.svg")?.name).toBe("Amazon EC2");
    expect(findStencil(items, "amazon ec2")?.name).toBe("Amazon EC2");
    expect(findStencil(items, "ec2")?.name).toBe("Amazon EC2");
    expect(findStencil(items, "Network:router")?.name).toBe("Router");
    expect(findStencil(items, "AWS:router")).toBeNull();
    expect(findStencil(items, "Azure:vm")).toBeNull();
    expect(findStencil(items, "core pair", true)).toBeNull();
    expect(findStencil(items, "core pair")?.name).toBe("Core pair");
  });
});

describe("mermaid statement splitting", () => {
  it("splits on ; but not inside quotes, brackets or |labels|", () => {
    expect(splitStatements("A-->B; B-->C")).toEqual(["A-->B", " B-->C"]);
    expect(splitStatements('A["read; parse"] --> B')).toEqual(['A["read; parse"] --> B']);
    expect(splitStatements("A[x; y] --> B")).toEqual(["A[x; y] --> B"]);
    expect(splitStatements("A -->|a;b| B; C")).toEqual(["A -->|a;b| B", " C"]);
  });

  it("parses a label containing a semicolon", () => {
    const spec = parseMermaidFlowchart('flowchart LR\n A["read; parse"] --> B');
    expect(spec.nodes.find((n) => n.id === "A")?.label).toBe("read; parse");
    expect(spec.edges).toHaveLength(1);
  });
});
