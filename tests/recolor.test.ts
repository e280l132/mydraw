import { describe, expect, it } from "vitest";
import { dominantSvgColor, ensureSvgSize, isNearWhite, parseColor, recolorSvg, svgFromDataURL, svgToDataURL } from "../shared/recolor";

const BLUE = "#1971c2";

describe("parseColor", () => {
  it("parses hex, rgb and names", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#ED7100")).toEqual([237, 113, 0, 1]);
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30, 1]);
    expect(parseColor("black")).toEqual([0, 0, 0, 1]);
    expect(parseColor("url(#g)")).toBeNull();
  });
  it("detects near-white", () => {
    expect(isNearWhite("#FFFFFF")).toBe(true);
    expect(isNearWhite("#f5f5f5")).toBe(true);
    expect(isNearWhite("#ED7100")).toBe(false);
  });
});

describe("recolorSvg", () => {
  it("recolors an AWS-style icon but keeps the white glyph", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect fill="#ED7100" width="64" height="64"/><path fill="#FFFFFF" d="M1 1"/></svg>`;
    const out = recolorSvg(svg, BLUE);
    expect(out).toContain(`<rect fill="${BLUE}"`);
    expect(out).toContain(`fill="#FFFFFF"`);
    expect(out).not.toContain("#ED7100");
  });

  it("recolors gradient stops, strokes and inline styles; leaves none/url() alone", () => {
    const svg = `<svg viewBox="0 0 1 1"><linearGradient id="g"><stop stop-color="#0078d4"/><stop offset="1" style="stop-color:#5ea0ef"/></linearGradient><path fill="url(#g)" stroke="#333" style="fill:none;stroke:#8C4FFF"/></svg>`;
    const out = recolorSvg(svg, BLUE);
    expect(out).toContain(`stop-color="${BLUE}"`);
    expect(out).toContain(`stop-color:${BLUE}`);
    expect(out).toContain(`fill="url(#g)"`);
    expect(out).toContain(`stroke="${BLUE}"`);
    expect(out).toContain(`fill:none;stroke:${BLUE}`);
  });

  it("handles currentColor icons and shapes with no fill (default black)", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" style="color:#1e1e1e"><path fill="currentColor" d="M1 1"/><path d="M2 2"/></svg>`;
    const out = recolorSvg(svg, BLUE);
    expect(out).toContain(`fill="${BLUE}"`); // currentColor replaced
    expect(out).toContain(`style="color:${BLUE}"`);
    expect(out).toMatch(new RegExp(`<svg[^>]* fill="${BLUE}"`)); // root fill for unfilled shapes
  });

  it("recolors <style> blocks", () => {
    const svg = `<svg><style>.a{fill:#c925d1}.b{fill:#fff}</style><path class="a"/></svg>`;
    const out = recolorSvg(svg, BLUE);
    expect(out).toContain(`.a{fill:${BLUE}}`);
    expect(out).toContain(`.b{fill:#fff}`);
  });

  it("can recolor again after a previous recolor", () => {
    const svg = `<svg><rect fill="#ED7100"/></svg>`;
    expect(recolorSvg(recolorSvg(svg, BLUE), "#e03131")).toContain(`<rect fill="#e03131"`);
  });

  it("rejects non-hex colors", () => {
    expect(() => recolorSvg("<svg/>", "javascript:alert(1)")).toThrow();
  });
});

describe("data URLs", () => {
  it("round-trips UTF-8 SVG text", () => {
    const svg = `<svg><title>Ünïcode — test</title></svg>`;
    expect(svgFromDataURL(svgToDataURL(svg))).toBe(svg);
    expect(svgFromDataURL(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toBe(svg);
  });
});

describe("ensureSvgSize", () => {
  it("adds width/height from the viewBox", () => {
    expect(ensureSvgSize(`<svg id="x" viewBox="0 0 512 256"><g/></svg>`)).toBe(`<svg id="x" viewBox="0 0 512 256" width="512" height="256"><g/></svg>`);
  });
  it("replaces percentage sizes and keeps numeric ones", () => {
    expect(ensureSvgSize(`<svg viewBox="0 0 32 32" width="100%" height="100%">`)).toBe(`<svg viewBox="0 0 32 32" width="32" height="32">`);
    const sized = `<svg viewBox="0 0 32 32" width="64" height="64">`;
    expect(ensureSvgSize(sized)).toBe(sized);
  });
  it("falls back when there is no viewBox", () => {
    expect(ensureSvgSize(`<svg>`)).toBe(`<svg width="64" height="64">`);
  });
});

describe("dominantSvgColor", () => {
  it("finds an AWS icon's background color, not its white glyph", () => {
    expect(dominantSvgColor(`<svg><rect fill="#ED7100"/><path fill="#FFFFFF"/><path fill="#FFF"/></svg>`)).toBe("#ed7100");
  });
  it("uses the most frequent color, from attributes, styles and <style>", () => {
    const svg = `<svg><style>.a{fill:#4285f4}.b{fill:#4285f4}</style><path style="fill:#34a853"/><path class="a"/></svg>`;
    expect(dominantSvgColor(svg)).toBe("#4285f4");
  });
  it("resolves currentColor and default black", () => {
    expect(dominantSvgColor(`<svg style="color:#1e1e1e"><path fill="currentColor"/></svg>`)).toBe("#1e1e1e");
    expect(dominantSvgColor(`<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>`)).toBe("#000000");
  });
  it("returns null for an all-white icon", () => {
    expect(dominantSvgColor(`<svg><rect fill="#fff"/></svg>`)).toBeNull();
  });
});
