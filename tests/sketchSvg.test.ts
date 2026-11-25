import { describe, expect, it } from "vitest";
import {
  DEFAULT_ICON_SKETCH,
  ellipsePath,
  iconSketchFor,
  iconSketchPreset,
  normalizeIconSketch,
  offsetVector,
  outlineColor,
  presetSketch,
  ICON_STYLE_PRESET_IDS,
  grainFilter,
  INK,
  pathBox,
  polyPath,
  prefersWobble,
  rectPath,
  scalePathData,
  sketchMarkup,
  sketchShape,
  storedIconSketch,
  wobbleSvg,
} from "../shared/sketchSvg";

const square = (s: number) => `M0 0H${s}V${s}H0Z`;

describe("normalizeIconSketch", () => {
  it("reads presets, objects and 'original'", () => {
    expect(normalizeIconSketch("original")).toBeNull();
    expect(normalizeIconSketch(null)).toBeNull();
    expect(normalizeIconSketch("hand-drawn")).toEqual({ ...DEFAULT_ICON_SKETCH, preset: "pen" });
    expect(normalizeIconSketch("pen")).toEqual({ ...DEFAULT_ICON_SKETCH, preset: "pen" });
    expect(normalizeIconSketch("hatch")?.fill).toBe("hachure");
    expect(normalizeIconSketch("wobble")?.mode).toBe("wobble");
    expect(normalizeIconSketch({ roughness: 99, seed: 5 })).toMatchObject({ roughness: 3, seed: 5 });
    expect(normalizeIconSketch({ preset: "hatch", roughness: 1 })).toMatchObject({ fill: "hachure", roughness: 1 });
  });
  it("rejects junk", () => {
    expect(() => normalizeIconSketch("watercolour")).toThrow(/iconStyle/);
    expect(() => normalizeIconSketch({ outline: "glitter" })).toThrow(/outline/);
    expect(() => normalizeIconSketch({ doubleStroke: "yes" })).toThrow(/doubleStroke/);
    expect(() => normalizeIconSketch({ fill: "plaid" })).toThrow(/fill/);
    expect(storedIconSketch({ fill: "plaid" })).toBeNull();
    expect(storedIconSketch(undefined)).toBeNull();
  });
  it("names presets", () => {
    expect(iconSketchPreset(DEFAULT_ICON_SKETCH)).toBe("pen");
    expect(iconSketchPreset({ ...DEFAULT_ICON_SKETCH, fill: "cross-hatch" })).toBeNull();
    for (const id of ICON_STYLE_PRESET_IDS) expect(iconSketchPreset(presetSketch(id, 9))).toBe(id);
  });
  it("keeps sketches stored before the new fields existed", () => {
    const old = storedIconSketch({ roughness: 1.1, fill: "hachure", seed: 4, mode: "rough" })!;
    expect(old).toMatchObject({ roughness: 1.1, fill: "hachure", seed: 4, outline: "shade", weight: 1, offset: 0, texture: "none" });
  });
  it("applies a preset first, then fields; the tag follows the look", () => {
    const m = normalizeIconSketch({ preset: "marker", seed: 3 })!;
    expect(m).toMatchObject({ outline: "ink", weight: 1.7, offset: 2, seed: 3, preset: "marker" });
    const tweaked = normalizeIconSketch({ preset: "marker", weight: 1.5 })!;
    expect(tweaked.preset).toBeUndefined();
    expect(normalizeIconSketch({ weight: 99, offset: -3, hatchGap: 1 })).toMatchObject({ weight: 3, offset: 0, hatchGap: 2 });
  });
});

describe("iconSketchFor", () => {
  it("follows the drawing style on auto", () => {
    expect(iconSketchFor("auto", "sketch")).not.toBeNull();
    expect(iconSketchFor("auto", "clean")).toBeNull();
    expect(iconSketchFor(undefined, "sketch")).not.toBeNull();
    expect(iconSketchFor("hand-drawn", "clean")).not.toBeNull();
    expect(iconSketchFor("original", "sketch")).toBeNull();
  });
});

describe("geometry", () => {
  it("scales path data, arcs included", () => {
    const box = pathBox(scalePathData(ellipsePath(12, 12, 10, 10), 3))!;
    expect(box.w).toBeGreaterThan(59);
    expect(box.w).toBeLessThan(70);
    expect(pathBox(scalePathData("m1 1 l2 0 0 2z", 10))).toEqual({ w: 20, h: 20 });
  });
  it("builds rect, rounded rect and polygon paths", () => {
    expect(pathBox(rectPath(2, 3, 10, 4))).toEqual({ w: 10, h: 4 });
    expect(rectPath(0, 0, 10, 10, 2)).toContain("A2 2");
    expect(polyPath("0,0 10,0 10,10", true)).toBe("M0 0L10 0L10 10Z");
    expect(polyPath("0,0", false)).toBe("");
  });
});

describe("sketchShape", () => {
  const filled = { d: square(24), fill: "#ff9900", stroke: null, strokeWidth: 0, scale: 64 / 24 };

  it("is deterministic per seed and differs between seeds", () => {
    const a = sketchShape(filled, DEFAULT_ICON_SKETCH);
    const b = sketchShape(filled, DEFAULT_ICON_SKETCH);
    const c = sketchShape(filled, { ...DEFAULT_ICON_SKETCH, seed: 2 });
    expect(a).toEqual(b);
    expect(a.map((p) => p.d)).not.toEqual(c.map((p) => p.d));
  });

  it("keeps the fill colour and outlines it a little darker", () => {
    const paths = sketchShape(filled, DEFAULT_ICON_SKETCH);
    expect(paths.some((p) => p.fill === "#ff9900")).toBe(true);
    expect(paths.some((p) => p.stroke === outlineColor("#ff9900") && p.fill === "none")).toBe(true);
    expect(outlineColor("#ff9900")).toBe("#9e5f00");
    expect(outlineColor("rgb(255, 255, 255)")).toBe("rgb(255, 255, 255)");
    expect(outlineColor('url("#g")')).toBe('url("#g")');
  });

  it("works in px space whatever the viewBox", () => {
    const small = sketchShape({ ...filled, d: square(24), scale: 64 / 24 }, DEFAULT_ICON_SKETCH);
    const big = sketchShape({ ...filled, d: square(512), scale: 64 / 512 }, DEFAULT_ICON_SKETCH);
    const w = (ps: typeof small) => pathBox(ps[0].d)!.w;
    expect(Math.abs(w(small) - 64)).toBeLessThan(8);
    expect(Math.abs(w(big) - 64)).toBeLessThan(8);
  });

  it("hatches big shapes only, and never gradients", () => {
    const hatch = { ...DEFAULT_ICON_SKETCH, fill: "hachure" as const };
    const big = sketchShape(filled, hatch);
    expect(big.some((p) => p.fill === "none" && p.stroke === "#ff9900" && p.d.split("M").length > 4)).toBe(true); // hatch lines
    expect(big.some((p) => p.fill === "#ff9900")).toBe(false);
    const tiny = sketchShape({ ...filled, d: square(3) }, hatch);
    expect(tiny.some((p) => p.fill === "#ff9900")).toBe(true);
    const grad = sketchShape({ ...filled, fill: 'url("#g")' }, hatch);
    expect(grad.some((p) => p.fill === 'url("#g")')).toBe(true);
  });

  it("strokes line icons with a px stroke width", () => {
    const paths = sketchShape({ d: "M2 12H22", fill: null, stroke: "#000", strokeWidth: 2, scale: 64 / 24 }, DEFAULT_ICON_SKETCH);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.fill === "none" && p.stroke === "#000")).toBe(true);
    expect(paths[0].strokeWidth).toBeCloseTo(2 * (64 / 24));
  });

  it("line art: outline only, in ink", () => {
    const paths = sketchShape(filled, presetSketch("line-art"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.fill === "none" && p.stroke === INK && p.role === "line")).toBe(true);
  });

  it("outline modes and pen weight", () => {
    const ink = sketchShape(filled, { ...DEFAULT_ICON_SKETCH, outline: "ink" });
    expect(ink.some((p) => p.role === "line" && p.stroke === INK)).toBe(true);
    expect(sketchShape(filled, { ...DEFAULT_ICON_SKETCH, outline: "none" }).every((p) => p.role === "fill")).toBe(true);
    const heavy = sketchShape(filled, { ...DEFAULT_ICON_SKETCH, weight: 3 }).find((p) => p.role === "line")!;
    const light = sketchShape(filled, DEFAULT_ICON_SKETCH).find((p) => p.role === "line")!;
    expect(heavy.strokeWidth).toBeCloseTo(light.strokeWidth * 3);
    // Ink keeps coloured line icons coloured, turns dark strokes into the pen colour.
    const line = { d: "M2 12H22", fill: null, stroke: "#e03131", strokeWidth: 2, scale: 2 };
    expect(sketchShape(line, { ...DEFAULT_ICON_SKETCH, outline: "ink" })[0].stroke).toBe("#e03131");
    expect(sketchShape({ ...line, stroke: "#333" }, { ...DEFAULT_ICON_SKETCH, outline: "ink" })[0].stroke).toBe(INK);
  });

  it("offset moves the fill, not the outline", () => {
    const s = { ...DEFAULT_ICON_SKETCH, offset: 2, seed: 5 };
    const v = offsetVector(s);
    expect(Math.hypot(v.dx, v.dy)).toBeCloseTo(2, 1);
    const paths = sketchShape(filled, s);
    expect(paths.filter((p) => p.role === "fill").every((p) => p.dx === v.dx && p.dy === v.dy)).toBe(true);
    expect(paths.filter((p) => p.role === "line").every((p) => p.dx === undefined)).toBe(true);
    expect(sketchMarkup(paths, 1)).toContain(`translate(${v.dx} ${v.dy})`);
  });

  it("other fillers and textures", () => {
    for (const fill of ["zigzag", "dashed", "cross-hatch"] as const) {
      const paths = sketchShape(filled, { ...DEFAULT_ICON_SKETCH, fill });
      expect(paths.some((p) => p.role === "fill" && p.fill === "none" && p.stroke === "#ff9900")).toBe(true);
      expect(paths.reduce((n, p) => n + p.d.length, 0)).toBeLessThan(30000);
    }
    expect(() => normalizeIconSketch({ fill: "dots" })).toThrow(/fill/);
    expect(grainFilter("none")).toBe("");
    expect(grainFilter("pencil")).toContain('id="md-grain-pencil"');
    const paths = sketchShape(filled, DEFAULT_ICON_SKETCH);
    expect(sketchMarkup(paths, 1, undefined, "pencil")).toMatch(/^<g transform="scale\(1\)" filter="url\(#md-grain-pencil\)">/);
    const paper = sketchMarkup(paths, 1, undefined, "paper");
    expect(paper.match(/md-grain-paper/g)?.length).toBe(1);
  });

  it("draws nothing for unpainted or broken shapes", () => {
    expect(sketchShape({ ...filled, fill: "none" }, DEFAULT_ICON_SKETCH)).toEqual([]);
    expect(sketchShape({ ...filled, d: "" }, DEFAULT_ICON_SKETCH)).toEqual([]);
  });

  it("wraps markup back into user units and escapes quotes", () => {
    const m = sketchMarkup([{ d: "M0 0L1 1", fill: 'url("#g")', stroke: "none", strokeWidth: 1, role: "fill" }], 4, "evenodd");
    expect(m).toContain('transform="scale(0.25)"');
    expect(m).toContain("url('#g')");
    expect(m).toContain("fill-rule:evenodd");
  });
});

describe("whole icons", () => {
  it("wobbles complex or raster content", () => {
    expect(prefersWobble('<svg><path d="M0 0L1 1"/></svg>')).toBe(false);
    expect(prefersWobble('<svg><image href="x.png"/></svg>')).toBe(true);
    expect(prefersWobble("<svg></svg>")).toBe(true);
    expect(prefersWobble(`<svg>${'<path d="M0 0L1 1"/>'.repeat(500)}</svg>`)).toBe(true);
  });
  it("builds a wobble wrapper at the given size", () => {
    const svg = wobbleSvg("data:image/png;base64,AAAA", 64, 32, DEFAULT_ICON_SKETCH);
    expect(svg).toContain('width="64" height="32"');
    expect(svg).toContain("feDisplacementMap");
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
  });
});

describe("caption fonts", () => {
  it("match follows the icon; hand and drawing are fixed", async () => {
    const { captionFontName, normalizeHandFont } = await import("../shared/iconSketch");
    expect(captionFontName("match", true, "Caveat")).toBe("Caveat");
    expect(captionFontName("match", false, "Caveat")).toBeNull();
    expect(captionFontName(undefined, true, undefined)).toBe("Excalifont");
    expect(captionFontName("hand", false, "")).toBe("Excalifont");
    expect(captionFontName("drawing", true, "Caveat")).toBeNull();
    expect(normalizeHandFont("Patrick Hand")).toBe("Patrick Hand");
    expect(normalizeHandFont("x;}{")).toBeNull();
  });
  it("settings keep valid caption values only", async () => {
    const { DEFAULT_SETTINGS, mergeSettings } = await import("../shared/settings");
    expect(DEFAULT_SETTINGS.captionFont).toBe("match");
    const s = mergeSettings(DEFAULT_SETTINGS, { captionFont: "hand", captionHandFont: "Kalam" });
    expect([s.captionFont, s.captionHandFont]).toEqual(["hand", "Kalam"]);
    const bad = mergeSettings(s, { captionFont: "comic", captionHandFont: 7 });
    expect([bad.captionFont, bad.captionHandFont]).toEqual(["hand", "Kalam"]);
  });
});
