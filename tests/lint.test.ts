import { describe, expect, it } from "vitest";
import { tint } from "../shared/diagram";
import { lintScene, nearestPaletteColor, type LintEl } from "../shared/lint";

let n = 0;
const rect = (id: string, x: number, y: number, label?: string, extra: Partial<LintEl> = {}): LintEl[] => {
  const els: LintEl[] = [
    {
      id,
      type: "rectangle",
      x,
      y,
      width: 100,
      height: 60,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      boundElements: label ? [{ id: `${id}-t${++n}`, type: "text" }] : null,
      ...extra,
    },
  ];
  if (label) els.push({ id: els[0].boundElements![0].id, type: "text", x: x + 10, y: y + 20, width: 80, height: 20, text: label, containerId: id, strokeColor: "#1e1e1e" });
  return els;
};
const arrow = (id: string, x: number, y: number, dx: number, dy: number, from?: string, to?: string, extra: Partial<LintEl> = {}): LintEl => ({
  id,
  type: "arrow",
  x,
  y,
  width: Math.abs(dx),
  height: Math.abs(dy),
  points: [
    [0, 0],
    [dx, dy],
  ],
  startBinding: from ? { elementId: from } : null,
  endBinding: to ? { elementId: to } : null,
  strokeColor: "#1e1e1e",
  ...extra,
});
const rules = (els: LintEl[], only?: string[]) => lintScene(els, { rules: only }).issues.map((i) => `${i.rule}:${i.id}`);

describe("lint: overlap", () => {
  it("flags overlapping nodes once, on the one drawn on top", () => {
    const r = lintScene([...rect("a", 0, 0, "A"), ...rect("b", 50, 30, "B")], { rules: ["overlap"] });
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ rule: "overlap", severity: "warning", id: "b", other: "a", label: "B" });
    expect(r.issues[0].message).toContain("A");
  });
  it("ignores small overlaps, touching, other frames, zones, legend and containment", () => {
    expect(rules([...rect("a", 0, 0, "A"), ...rect("b", 97, 0, "B")], ["overlap"])).toEqual([]);
    expect(rules([...rect("a", 0, 0, "A", { frameId: "f1" }), ...rect("b", 10, 10, "B", { frameId: "f2" })], ["overlap"])).toEqual([]);
    const zone: LintEl = { id: "z", type: "rectangle", x: -20, y: -20, width: 300, height: 200, customData: { mydrawZone: true } };
    expect(rules([zone, ...rect("a", 0, 0, "A")], ["overlap"])).toEqual([]);
    expect(rules([...rect("a", 0, 0, "A"), ...rect("l", 10, 10, "Legend", { customData: { mydrawLegend: true } })], ["overlap"])).toEqual([]);
    const big = rect("big", -50, -50, "Rack", { width: 400, height: 300 });
    expect(rules([...big, ...rect("a", 0, 0, "A")], ["overlap"])).toEqual([]);
    // Unlabeled decorations are not nodes.
    expect(rules([...rect("a", 0, 0, "A"), ...rect("d", 10, 10)], ["overlap"])).toEqual([]);
  });
  it("flags near-duplicates (same box)", () => {
    expect(rules([...rect("a", 0, 0, "A"), ...rect("b", 0, 0, "B")], ["overlap"])).toEqual(["overlap:b"]);
  });
});

describe("lint: unconnected arrows", () => {
  it("names the free end and offers to bind it to a nearby node", () => {
    const els = [...rect("a", 0, 0, "A"), ...rect("b", 300, 0, "B"), arrow("ar", 104, 30, 180, 0, "a")];
    const [i] = lintScene(els, { rules: ["unconnected-arrow"] }).issues;
    expect(i).toMatchObject({ id: "ar", ends: ["end"], fix: { kind: "bind", end: "b" } });
    expect(i.message).toContain("end");
  });
  it("no fix when nothing is near; never binds both ends to one node; ignores lines and legend", () => {
    const far = lintScene([...rect("a", 0, 0, "A"), arrow("ar", 104, 30, 100, 0, "a")], { rules: ["unconnected-arrow"] }).issues[0];
    expect(far.fix).toBeUndefined();
    const both = lintScene([...rect("a", 0, 0, "A"), arrow("ar", 104, 30, 10, 0)], { rules: ["unconnected-arrow"] }).issues[0];
    expect(both.ends).toEqual(["start", "end"]);
    expect(both.fix).toEqual({ kind: "bind", start: "a" });
    const line = { ...arrow("ln", 0, 0, 50, 0), type: "line" };
    const legend = arrow("lg", 0, 0, 50, 0, undefined, undefined, { customData: { mydrawLegend: true } });
    expect(rules([line, legend], ["unconnected-arrow"])).toEqual([]);
  });
  it("a binding to a deleted element counts as free; bound arrows are fine", () => {
    expect(rules([...rect("a", 0, 0, "A"), ...rect("b", 300, 0, "B"), arrow("ar", 104, 30, 192, 0, "a", "b")], ["unconnected-arrow"])).toEqual([]);
    expect(rules([...rect("a", 0, 0, "A"), arrow("ar", 104, 30, 192, 0, "a", "gone")], ["unconnected-arrow"])).toEqual(["unconnected-arrow:ar"]);
  });
});

describe("lint: unlabeled nodes", () => {
  it("flags shapes and captionless icons, not zones, legend or free-text-labelled shapes", () => {
    const icon: LintEl = { id: "ic", type: "rectangle", x: 500, y: 0, width: 64, height: 80, strokeColor: "transparent", backgroundColor: "transparent", customData: { mydrawNode: "icon" } };
    const zone: LintEl = { id: "z", type: "rectangle", x: 900, y: 0, width: 100, height: 100, customData: { mydrawZone: true } };
    const labelled = rect("s2", 0, 200);
    const text: LintEl = { id: "tx", type: "text", x: 20, y: 220, width: 40, height: 20, text: "Hi" };
    const r = lintScene([...rect("s", 0, 0), icon, zone, ...labelled, text, ...rect("ok", 200, 0, "OK")], { rules: ["unlabeled-node"] });
    expect(r.issues.map((i) => [i.id, i.severity])).toEqual([
      ["s", "info"],
      ["ic", "info"],
    ]);
    expect(r.issues[1].message).toContain("caption");
  });
});

describe("lint: missing IP", () => {
  it("is silent when no node has an IP", () => {
    expect(rules([...rect("a", 0, 0, "A"), ...rect("b", 200, 0, "B")], ["missing-ip"])).toEqual([]);
  });
  it("flags labelled nodes without one when some node has an IP (aliases count)", () => {
    const els = [
      ...rect("a", 0, 0, "A", { customData: { ip: "10.0.0.1" } }),
      ...rect("b", 200, 0, "B", { customData: { ipAddress: "10.0.0.2" } }),
      ...rect("c", 400, 0, "C"),
      ...rect("d", 600, 0, undefined, { customData: { owner: "x" } }),
    ];
    expect(rules(els, ["missing-ip"])).toEqual(["missing-ip:c"]);
  });
});

describe("lint: off-palette colors", () => {
  it("flags custom colors with a snap-to-palette fix per property", () => {
    const els = rect("a", 0, 0, "A", { strokeColor: "#123457", backgroundColor: "#a5d8ff" });
    const r = lintScene(els, { rules: ["off-palette-color"] });
    // #a5d8ff is "light-blue" in the basic palette.
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ id: "a", fix: { kind: "color", property: "strokeColor" } });
    const fix = r.issues[0].fix as { color: string };
    expect(fix.color).toBe(nearestPaletteColor("#123457").color);
    expect(fix.color).not.toBe("#123457");
  });
  it("accepts palette, theme, white/black, transparent, icon recolors, extra colors and zone tints", () => {
    const els: LintEl[] = [
      ...rect("p", 0, 0, "P", { strokeColor: "#1971c2", backgroundColor: "#ffffff" }),
      ...rect("t", 200, 0, "T", { strokeColor: "#0b4f5c", backgroundColor: "#000000" }),
      { id: "img", type: "image", x: 0, y: 200, width: 10, height: 10, strokeColor: "#abcdef", customData: { mydrawIconColor: "#654321" } },
      ...rect("ic", 400, 0, "I", { strokeColor: "#654321" }),
      ...rect("x", 600, 0, "X", { strokeColor: "#13579b" }),
      { id: "z", type: "rectangle", x: 0, y: 400, width: 10, height: 10, strokeColor: "#13579b", backgroundColor: tint("#13579b"), customData: { mydrawZone: true } },
      { id: "lg", type: "rectangle", x: 0, y: 600, width: 10, height: 10, strokeColor: "#13579c", customData: { mydrawLegend: true } },
    ];
    expect(rules(els, ["off-palette-color"])).toEqual(["off-palette-color:x", "off-palette-color:z"]);
    expect(lintScene(els, { rules: ["off-palette-color"], allowedColors: ["#13579B"] }).issues).toEqual([]);
  });
  it("nearest color is a palette color", () => {
    expect(nearestPaletteColor("#1971c3")).toEqual({ name: "blue", color: "#1971c2" });
  });
});

describe("lint: ordering and summary", () => {
  it("warnings first, then top-left to bottom-right; summary counts every rule", () => {
    const els = [...rect("u", 0, 0), ...rect("a", 0, 300, "A"), ...rect("b", 20, 310, "B"), ...rect("u2", 400, 600)];
    const r = lintScene(els);
    expect(r.issues.map((i) => `${i.rule}:${i.id}`)).toEqual(["overlap:b", "unlabeled-node:u", "unlabeled-node:u2"]);
    expect(r.summary).toEqual({
      overlap: 1,
      "unconnected-arrow": 0,
      "unlabeled-node": 2,
      "missing-ip": 0,
      "off-palette-color": 0,
      "edge-overlap": 0,
      "label-collision": 0,
      "edge-through-node": 0,
      "crowded-node": 0,
      "long-edge": 0,
      "zone-colors": 0,
      "legend-too-big": 0,
    });
  });
  it("skips deleted elements", () => {
    expect(rules([...rect("u", 0, 0, undefined, { isDeleted: true })])).toEqual([]);
  });
});

describe("lint: how clean the arrows are", () => {
  const QUALITY = ["edge-overlap", "label-collision", "edge-through-node", "crowded-node", "long-edge"];
  const labelled = (id: string, x: number, y: number, dx: number, dy: number, from: string, to: string, text: string, at: { x: number; y: number }): LintEl[] => [
    arrow(id, x, y, dx, dy, from, to, { boundElements: [{ id: `${id}-label`, type: "text" }] }),
    { id: `${id}-label`, type: "text", x: at.x - 30, y: at.y - 10, width: 60, height: 20, text, containerId: id },
  ];

  it("finds a label sitting under another arrow and offers a free spot on its own arrow", () => {
    // e1 runs a -> b along y=30; the vertical arrow e2 passes through its midpoint (x=250)
    const els = [...rect("a", 0, 0, "A"), ...rect("b", 400, 0, "B"), ...labelled("e1", 105, 30, 290, 0, "a", "b", "x", { x: 250, y: 30 }), arrow("e2", 250, -100, 0, 200, "c", "d")];
    const issues = lintScene(els, { rules: QUALITY }).issues;
    expect(issues.map((i) => `${i.rule}:${i.id}`)).toEqual(["label-collision:e1"]);
    const fix = issues[0].fix as { kind: string; x: number; y: number };
    expect(fix.kind).toBe("label");
    expect(fix.y).toBe(30); // still on its arrow
    expect(Math.abs(fix.x - 250)).toBeGreaterThan(20); // off the other arrow
  });

  it("does not flag a label that is clear", () => {
    const els = [...rect("a", 0, 0, "A"), ...rect("b", 400, 0, "B"), ...labelled("e1", 105, 30, 290, 0, "a", "b", "x", { x: 250, y: 30 })];
    expect(rules(els, QUALITY)).toEqual([]);
  });

  it("finds arrows on top of each other and arrows through nodes, with a re-route fix for the latter", () => {
    const els = [
      ...rect("a", 0, 0, "A"),
      ...rect("b", 600, 0, "B"),
      ...rect("c", 250, -10, "C"), // in the way of e1
      arrow("e1", 105, 30, 490, 0, "a", "b"),
      arrow("e2", 105, 25, 490, 0, "a", "b"),
    ];
    const issues = lintScene(els, { rules: QUALITY }).issues;
    expect(issues.some((i) => i.rule === "edge-overlap")).toBe(true);
    const through = issues.filter((i) => i.rule === "edge-through-node");
    expect(through.map((i) => i.other)).toEqual(["c", "c"]);
    expect(through[0].fix).toEqual({ kind: "reroute" });
  });

  it("flags crowded nodes and very long arrows only in big diagrams", () => {
    const hub = rect("hub", 0, 0, "Hub");
    const spokes = Array.from({ length: 7 }, (_, i) => [...rect(`s${i}`, 300, i * 100, `S${i}`), arrow(`e${i}`, 105, 30 + i * 10, 190, i * 90, "hub", `s${i}`)]).flat();
    const small = lintScene([...hub, ...spokes], { rules: ["crowded-node", "long-edge"] }).issues;
    expect(small.map((i) => `${i.rule}:${i.id}`)).toEqual(["crowded-node:hub"]);
    // stretch the diagram: one arrow longer than 60% of it
    const far = [...rect("far", 2000, 0, "Far"), arrow("long", 105, 30, 1890, 0, "hub", "far")];
    const big = lintScene([...hub, ...far], { rules: ["long-edge"] }).issues;
    expect(big.map((i) => `${i.rule}:${i.id}`)).toEqual(["long-edge:long"]);
  });
});


describe("lint: zone colours and legend size", () => {
  const zone = (id: string, color: string, kind?: string) => ({ id, type: "rectangle", x: 0, y: 0, width: 100, height: 100, strokeColor: color, backgroundColor: "transparent", customData: { mydrawZone: true, ...(kind ? { mydrawZoneKind: kind } : {}) } });
  it("flags zones coloured in turn, not zones with kinds", () => {
    const rainbow = ["#1971c2", "#2f9e44", "#e8590c", "#9c36b5", "#0c8599"].map((c, i) => zone(`z${i}`, c));
    expect(lintScene(rainbow as never, { rules: ["zone-colors"] }).issues).toHaveLength(1);
    const kinds = ["#1971c2", "#2f9e44", "#e8590c", "#9c36b5", "#0c8599"].map((c, i) => zone(`z${i}`, c, "vpc"));
    expect(lintScene(kinds as never, { rules: ["zone-colors"] }).issues).toHaveLength(0);
  });
  it("flags a legend with too many rows", () => {
    const legend = (rows: number) => [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 100, strokeColor: "#868e96", backgroundColor: "#ffffff", customData: { mydrawLegend: true } },
      ...Array.from({ length: rows + 1 }, (_, i) => ({ id: `t${i}`, type: "text", x: 0, y: i * 40, width: 50, height: 20, strokeColor: "#1e1e1e", backgroundColor: "transparent", text: `row ${i}`, customData: { mydrawLegend: true } })),
    ];
    expect(lintScene(legend(17) as never, { rules: ["legend-too-big"] }).issues.map((i) => i.id)).toEqual(["box"]);
    expect(lintScene(legend(6) as never, { rules: ["legend-too-big"] }).issues).toHaveLength(0);
  });
});
