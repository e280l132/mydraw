import { describe, expect, it } from "vitest";
import {
  cssGradient,
  drawioDirection,
  gradientFromDrawio,
  gradientOf,
  gradientPatch,
  gradientPresetOf,
  GRADIENT_PRESETS,
  linearEnds,
  normalizeGradient,
  radialEnds,
  resolveGradientInput,
} from "../shared/gradient";
import { toDrawio } from "../shared/drawioWriter";
import { readDrawio } from "../shared/drawioReader";

const g = { kind: "linear" as const, from: "#ffffff", to: "#000000", angle: 90 };

describe("gradients", () => {
  it("normalises untrusted input", () => {
    expect(normalizeGradient({ from: "#FFF", to: "#000", angle: 450 })).toEqual({ kind: "linear", from: "#ffffff", to: "#000000", angle: 90 });
    expect(normalizeGradient({ from: "#fff", to: "#000", kind: "radial" })?.kind).toBe("radial");
    expect(normalizeGradient({ from: "red", to: "#000" })).toBeNull();
    expect(normalizeGradient(null)).toBeNull();
  });

  it("is drawn only on a solid fill that is still the start color", () => {
    const el = { type: "rectangle", fillStyle: "solid", backgroundColor: "#ffffff", customData: { mydrawGradient: g } };
    expect(gradientOf(el)).toEqual(g);
    expect(gradientOf({ ...el, backgroundColor: "#ff0000" })).toBeNull();
    expect(gradientOf({ ...el, fillStyle: "hachure" })).toBeNull();
    expect(gradientOf({ ...el, type: "arrow" })).toBeNull();
  });

  it("gradientPatch sets the fill and removes cleanly", () => {
    expect(gradientPatch({ a: 1 }, g)).toEqual({ customData: { a: 1, mydrawGradient: g }, fillStyle: "solid", backgroundColor: "#ffffff" });
    expect(gradientPatch({ a: 1, mydrawGradient: g }, null)).toEqual({ customData: { a: 1 } });
  });

  it("linear ends span the box along the angle; radial reaches the corners", () => {
    expect(linearEnds(g, 100, 50)).toEqual({ x1: 50, y1: 0, x2: 50, y2: 50 });
    expect(linearEnds({ ...g, angle: 0 }, 100, 50)).toEqual({ x1: 0, y1: 25, x2: 100, y2: 25 });
    const d = linearEnds({ ...g, angle: 45 }, 100, 100);
    expect(d.x1).toBeCloseTo(0);
    expect(d.y2).toBeCloseTo(100);
    expect(radialEnds(60, 80)).toEqual({ cx: 30, cy: 40, r: 50 });
  });

  it("agent input: presets, objects, errors", () => {
    expect(resolveGradientInput("sky")).toEqual(GRADIENT_PRESETS.sky.gradient);
    expect(resolveGradientInput({ preset: "sky", angle: 0 })?.angle).toBe(0);
    expect(resolveGradientInput(null)).toBeNull();
    expect(resolveGradientInput(undefined)).toBeUndefined();
    expect(() => resolveGradientInput("plaid")).toThrow(/Unknown gradient/);
    expect(() => resolveGradientInput({ from: "#fff" })).toThrow(/from and to/);
    expect(gradientPresetOf(GRADIENT_PRESETS.glow.gradient)).toBe("glow");
    expect(cssGradient(g)).toBe("linear-gradient(180deg, #ffffff, #000000)");
  });

  it("draw.io: four directions and radial, both ways", async () => {
    for (const [angle, dir] of [[0, "east"], [90, "south"], [180, "west"], [270, "north"]] as const) {
      expect(drawioDirection({ ...g, angle })).toBe(dir);
      expect(gradientFromDrawio("#ffffff", "#000000", dir)?.angle).toBe(angle);
    }
    expect(drawioDirection({ ...g, kind: "radial" })).toBe("radial");
    expect(gradientFromDrawio("#fff", undefined, "south")).toBeNull();
    const el = { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 60, strokeColor: "#000000", backgroundColor: "#ffffff", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid", customData: { mydrawGradient: g } };
    const { xml } = toDrawio([{ name: "p", elements: [el] as never }], {});
    expect(xml).toContain("gradientColor=#000000");
    const shape = (await readDrawio(xml)).pages[0].shapes[0];
    expect(gradientFromDrawio(shape.fill, shape.gradient?.color, shape.gradient?.direction)).toEqual(g);
  });
});
