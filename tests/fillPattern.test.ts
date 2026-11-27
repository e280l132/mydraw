import { describe, expect, it } from "vitest";
import {
  defaultPattern,
  fillPatternFor,
  normalizePattern,
  patternOf,
  patternPins,
  pinPatternPatch,
  resolvePatternInput,
  withPattern,
  PATTERN_KEY,
} from "../shared/fillPattern";
import { normalizeStyle, stylePatch } from "../shared/styles";
import { normalizeSpec } from "../shared/diagram";
// @ts-expect-error plain JS build script
import { patchFillPattern } from "../scripts/excalidrawPatch.mjs";

const rect = (sw: number, customData?: Record<string, unknown>) => ({ id: "r", type: "rectangle", strokeWidth: sw, customData });

describe("fill pattern", () => {
  it("follows the stroke width until one is stored", () => {
    expect(patternOf(rect(4))).toEqual({ weight: 2, gap: 16 });
    expect(fillPatternFor(rect(4))).toBeUndefined();
    const own = rect(4, { [PATTERN_KEY]: { weight: 1, gap: 8 } });
    expect(patternOf(own)).toEqual({ weight: 1, gap: 8 });
    expect(fillPatternFor(own)).toEqual({ fillWeight: 1, hachureGap: 8 });
    expect(fillPatternFor({ ...own, type: "arrow" })).toBeUndefined();
  });

  it("validates and clamps untrusted values", () => {
    expect(normalizePattern({ weight: 100, gap: 0 })).toEqual({ weight: 8, gap: 2 });
    expect(normalizePattern({ weight: "1", gap: 8 })).toBeNull();
    expect(normalizePattern(null)).toBeNull();
  });

  it("resolves agent input, filling missing fields from the base", () => {
    expect(resolvePatternInput({ gap: 12 }, { weight: 1, gap: 8 })).toEqual({ weight: 1, gap: 12 });
    expect(resolvePatternInput({ weight: 99, gap: 12 }, { weight: 1, gap: 8 })).toEqual({ weight: 8, gap: 12 });
    expect(resolvePatternInput(null, { weight: 1, gap: 8 })).toBeNull();
    expect(() => resolvePatternInput({}, { weight: 1, gap: 8 })).toThrow(/weight and\/or gap/);
    expect(() => resolvePatternInput({ gap: "x" }, { weight: 1, gap: 8 })).toThrow(/gap must be a number/);
    expect(() => resolvePatternInput("thin", { weight: 1, gap: 8 })).toThrow();
  });

  it("styles and build_diagram nodes take a partial pattern", () => {
    expect(normalizeStyle({ fillPattern: { gap: 12 } }).fillPattern).toEqual({ gap: 12 });
    expect(normalizeStyle({ fillPattern: null }).fillPattern).toBeNull();
    expect(stylePatch({ fillPattern: { weight: 1 } }, "shape").fillPattern).toEqual({ weight: 1 });
    expect(() => normalizeStyle({ fillPattern: { gap: "wide" } })).toThrow();
    const spec = normalizeSpec({ nodes: [{ id: "a", fillStyle: "hachure", fillPattern: { gap: 14 } }], edges: [] });
    expect(spec.nodes[0].fillPattern).toEqual({ gap: 14 });
    expect(() => normalizeSpec({ nodes: [{ id: "a", fillPattern: 3 }], edges: [] })).toThrow(/node a fillPattern/);
  });

  it("withPattern keeps other customData and always returns an object", () => {
    expect(withPattern({ a: 1 }, { weight: 1, gap: 8 })).toEqual({ a: 1, [PATTERN_KEY]: { weight: 1, gap: 8 } });
    expect(withPattern({ a: 1, [PATTERN_KEY]: { weight: 1, gap: 8 } }, null)).toEqual({ a: 1 });
    expect(withPattern(undefined, null)).toEqual({});
  });

  it("pinPatternPatch keeps the old look when the stroke width changes", () => {
    expect(pinPatternPatch(rect(2), 6)).toEqual({ customData: { [PATTERN_KEY]: defaultPattern(2) } });
    expect(pinPatternPatch(rect(2), 2)).toEqual({});
    expect(pinPatternPatch(rect(2, { [PATTERN_KEY]: { weight: 3, gap: 9 } }), 6)).toEqual({});
    expect(pinPatternPatch({ ...rect(2), type: "arrow" }, 6)).toEqual({});
  });

  it("patternPins pins the old width's pattern and survives an undo", () => {
    let r = patternPins(null, [rect(2)]);
    expect(r.pins).toEqual([]);
    r = patternPins(r.basis, [rect(4)]);
    expect(r.pins).toEqual([{ id: "r", pattern: { weight: 1, gap: 8 } }]);
    // The pin lands: nothing more to do.
    r = patternPins(r.basis, [rect(4, { [PATTERN_KEY]: { weight: 1, gap: 8 } })]);
    expect(r.pins).toEqual([]);
    // Undo takes both the width and the pin away: the width the pattern came from is back.
    r = patternPins(r.basis, [rect(2)]);
    expect(r.pins).toEqual([]);
    // New and deleted elements are only recorded.
    r = patternPins(r.basis, [{ ...rect(3), id: "n" }, { ...rect(9), isDeleted: true }]);
    expect(r.pins).toEqual([]);
  });

  it("patches Excalidraw's roughjs options", () => {
    const code = "var rt=(e)=>({seed:e.seed,fillWeight:e.strokeWidth/2,hachureGap:e.strokeWidth*4,roughness:1})";
    const out = patchFillPattern(code);
    const run = (el: object, hook?: unknown) => {
      (globalThis as { __mydrawFillPattern?: unknown }).__mydrawFillPattern = hook;
      const o = new Function(`${out};return rt;`)()(el);
      return [o.fillWeight, o.hachureGap];
    };
    expect(run({ strokeWidth: 4 })).toEqual([2, 16]);
    expect(run({ strokeWidth: 4 }, () => undefined)).toEqual([2, 16]);
    expect(run({ strokeWidth: 4 }, () => ({ fillWeight: 1, hachureGap: 8 }))).toEqual([1, 8]);
    const dev = "const o = {\n    fillWeight: element.strokeWidth / 2,\n    hachureGap: element.strokeWidth * 4,\n}";
    expect(patchFillPattern(dev)).toContain("globalThis.__mydrawFillPattern?.(element)");
    expect(patchFillPattern("nothing here")).toBeNull();
  });
});
