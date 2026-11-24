import { describe, expect, it } from "vitest";
import { recolorSvg } from "../shared/recolor";
import { isSvgShape, shapeSvg, SVG_SHAPES } from "../shared/shapeSvgs";

describe("drawn node shapes", () => {
  for (const kind of SVG_SHAPES) {
    it(`${kind}: a sized SVG in the node's colours`, () => {
      const svg = shapeSvg(kind, { width: 160, height: 90, stroke: "#1971c2", fill: "#ffffff", strokeWidth: 2 });
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="160" height="90" viewBox="0 0 160 90">/);
      expect(svg).toContain('stroke="#1971c2"');
      expect(svg.endsWith("</svg>")).toBe(true);
      // Recolouring changes the outline, keeps the white fill.
      const red = recolorSvg(svg, "#e03131");
      expect(red).toContain("#e03131");
      expect(red).not.toContain("#1971c2");
    });
  }

  it("a transparent fill draws no fill", () => {
    expect(shapeSvg("cylinder", { width: 100, height: 80, stroke: "#000000", fill: "transparent", strokeWidth: 1 })).toContain('fill="none"');
  });

  it("stays inside its box: stroke inset by half its width", () => {
    const svg = shapeSvg("hexagon", { width: 100, height: 60, stroke: "#000000", fill: "#ffffff", strokeWidth: 4 });
    const nums = [...svg.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    for (const [x, y] of nums) {
      expect(x).toBeGreaterThanOrEqual(2);
      expect(x).toBeLessThanOrEqual(98);
      expect(y).toBeGreaterThanOrEqual(2);
      expect(y).toBeLessThanOrEqual(58);
    }
  });

  it("keeps odd characters out of the SVG", () => {
    const svg = shapeSvg("document", { width: 80, height: 60, stroke: '#000"/><script>', fill: "#fff", strokeWidth: 1 });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('stroke="#000script"'); // quotes and angle brackets are dropped
    expect(svg).not.toContain('"#000"');
  });

  it("knows its shapes", () => {
    expect(isSvgShape("cylinder")).toBe(true);
    expect(isSvgShape("rectangle")).toBe(false);
  });
});
