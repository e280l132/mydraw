import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canShadow,
  commonShadow,
  DEFAULT_SHADOW,
  describeShadow,
  drawnBox,
  maxShadowExtent,
  normalizeShadow,
  presetOf,
  resolveShadowInput,
  SHADOW_KEY,
  SHADOW_PRESETS,
  shadowAmount,
  shadowExtent,
  shadowOf,
  shadowOffset,
  shadowRgba,
  withAmount,
  withShadow,
} from "../shared/shadow";
import { normalizeSpec } from "../shared/diagram";
import { BUILTIN_PRESETS, normalizeStyle, stylePatch } from "../shared/styles";
import { toDrawio } from "../shared/drawioWriter";
import { readDrawio } from "../shared/drawioReader";
// @ts-expect-error plain JS build script
import { patchPanelPin, patchShadow, patchTextOutline } from "../scripts/excalidrawPatch.mjs";

describe("normalizeShadow", () => {
  it("fills missing fields, clamps, expands short hex", () => {
    expect(normalizeShadow({ color: "#F00" })).toEqual({ ...DEFAULT_SHADOW, color: "#ff0000" });
    expect(normalizeShadow({ opacity: 3, blur: -5, distance: 999, angle: -90 })).toEqual({ color: "#000000", opacity: 1, blur: 0, distance: 80, angle: 270 });
    expect(normalizeShadow({ angle: 450 })!.angle).toBe(90);
  });
  it("rejects junk", () => {
    expect(normalizeShadow(null)).toBeNull();
    expect(normalizeShadow("soft")).toBeNull();
    expect(normalizeShadow({ color: "red" })).toBeNull();
    expect(normalizeShadow({ color: "#000;filter:url(x)" })).toBeNull();
  });
});

describe("customData helpers", () => {
  it("sets, reads and removes the shadow, keeping other keys", () => {
    const cd = withShadow({ ip: "10.0.0.1" }, SHADOW_PRESETS.hard.shadow);
    expect(shadowOf({ customData: cd })).toEqual(SHADOW_PRESETS.hard.shadow);
    expect(withShadow(cd, null)).toEqual({ ip: "10.0.0.1" });
    expect(withShadow(undefined, null)).toEqual({});
    expect(shadowOf({ customData: { [SHADOW_KEY]: { color: "nope" } } })).toBeNull();
  });
  it("finds the shared value or reports mixed", () => {
    const a = { customData: withShadow({}, SHADOW_PRESETS.soft.shadow) };
    const b = { customData: withShadow({}, SHADOW_PRESETS.drop.shadow) };
    expect(commonShadow([])).toBeNull();
    expect(commonShadow([a, { customData: { ...a.customData } }])).toEqual(SHADOW_PRESETS.soft.shadow);
    expect(commonShadow([a, b])).toBe("mixed");
    expect(commonShadow([a, {}])).toBe("mixed");
    expect(commonShadow([{}, {}])).toBeNull();
  });
  it("names presets", () => {
    expect(presetOf(SHADOW_PRESETS.glow.shadow)).toBe("glow");
    expect(presetOf({ ...SHADOW_PRESETS.glow.shadow, blur: 3 })).toBeNull();
    expect(describeShadow(SHADOW_PRESETS.long.shadow)).toBe("long");
    expect(describeShadow(null)).toBeUndefined();
  });
  it("knows which elements can carry a shadow", () => {
    for (const t of ["rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "image", "text"]) expect(canShadow(t)).toBe(true);
    for (const t of ["frame", "magicframe", "iframe", "embeddable", undefined]) expect(canShadow(t)).toBe(false);
  });
});

describe("amount", () => {
  it("is blur + distance", () => {
    expect(shadowAmount(SHADOW_PRESETS.soft.shadow)).toBe(22);
  });
  it("scales blur and distance together, keeping their ratio", () => {
    const s = withAmount(SHADOW_PRESETS.soft.shadow, 44);
    expect(s.blur).toBeCloseTo(32);
    expect(s.distance).toBeCloseTo(12);
    expect(s.opacity).toBe(SHADOW_PRESETS.soft.shadow.opacity);
    expect(shadowAmount(s)).toBe(44);
  });
  it("starts from Soft's ratio at zero and clamps", () => {
    const zero = withAmount(SHADOW_PRESETS.soft.shadow, 0);
    expect(zero.blur + zero.distance).toBe(0);
    const back = withAmount(zero, 22);
    expect(back.blur).toBeCloseTo(16);
    expect(back.distance).toBeCloseTo(6);
    expect(shadowAmount(withAmount(SHADOW_PRESETS.soft.shadow, 500))).toBe(100);
  });
});

describe("geometry", () => {
  it("offsets along the angle, scaled", () => {
    expect(shadowOffset({ ...DEFAULT_SHADOW, angle: 90, distance: 10 })).toEqual({ dx: 0, dy: 10 });
    const d = shadowOffset({ ...DEFAULT_SHADOW, angle: 45, distance: 10 }, 2);
    expect(d.dx).toBeCloseTo(14.142, 2);
    expect(d.dy).toBeCloseTo(14.142, 2);
    expect(shadowOffset({ ...DEFAULT_SHADOW, angle: 180, distance: 5 }).dx).toBeCloseTo(-5);
  });
  it("extent covers offset and blur", () => {
    expect(shadowExtent(null)).toBe(0);
    expect(shadowExtent({ ...DEFAULT_SHADOW, blur: 10, distance: 4 })).toBe(21);
    expect(maxShadowExtent([{}, { customData: withShadow({}, { ...DEFAULT_SHADOW, blur: 10, distance: 4 }) }])).toBe(21);
  });
  it("rgba", () => {
    expect(shadowRgba("#ff8000", 0.5)).toBe("rgba(255, 128, 0, 0.5)");
  });
  it("drawn box holds points, rotation and strokes", () => {
    const line = drawnBox({ type: "arrow", x: 100, y: 100, width: 200, height: 0, points: [[0, 0], [200, 0]], strokeWidth: 2 });
    expect(line.x).toBeLessThan(100);
    expect(line.x + line.width).toBeGreaterThan(300);
    expect(line.height).toBeGreaterThan(0); // zero-height lines keep a region
    const back = drawnBox({ type: "line", x: 100, y: 100, width: 50, height: 50, points: [[0, 0], [-50, -50]] });
    expect(back.x).toBeLessThan(50);
    const r = drawnBox({ type: "rectangle", x: 0, y: 0, width: 100, height: 10, angle: Math.PI / 2 });
    expect(r.y).toBeLessThan(-45); // a rotated bar reaches above its unrotated box
  });
});

describe("agent input", () => {
  it("reads true, presets, objects and removal", () => {
    expect(resolveShadowInput(undefined)).toBeUndefined();
    expect(resolveShadowInput(null)).toBeNull();
    expect(resolveShadowInput(false)).toBeNull();
    expect(resolveShadowInput("none")).toBeNull();
    expect(resolveShadowInput(true)).toEqual(DEFAULT_SHADOW);
    expect(resolveShadowInput("Hard")).toEqual(SHADOW_PRESETS.hard.shadow);
    expect(resolveShadowInput({ preset: "glow", color: "#ff0000" })).toEqual({ ...SHADOW_PRESETS.glow.shadow, color: "#ff0000" });
    expect(resolveShadowInput({ blur: 4 })).toEqual({ ...DEFAULT_SHADOW, blur: 4 });
    expect(shadowAmount(resolveShadowInput({ preset: "drop", amount: 50 })!)).toBe(50);
  });
  it("throws readable errors", () => {
    expect(() => resolveShadowInput("fuzzy")).toThrow(/Unknown shadow preset/);
    expect(() => resolveShadowInput({ color: "red" })).toThrow(/hex/);
    expect(() => resolveShadowInput(5)).toThrow(/shadow must be/);
  });
});

describe("diagram spec", () => {
  it("takes node and diagram shadows", () => {
    const spec = normalizeSpec({ nodes: [{ id: "a", shadow: "hard" }, { id: "b", shadow: null }, { id: "c" }], shadow: true });
    expect(spec.shadow).toEqual(DEFAULT_SHADOW);
    expect(spec.nodes[0].shadow).toEqual(SHADOW_PRESETS.hard.shadow);
    expect(spec.nodes[1].shadow).toBeNull();
    expect(spec.nodes[2].shadow).toBeUndefined();
    expect(() => normalizeSpec({ nodes: [{ id: "a", shadow: "huge" }] })).toThrow(/node a shadow/);
  });
});

describe("styles", () => {
  it("presets carry shadows into the element patch", () => {
    const card = BUILTIN_PRESETS.find((p) => p.id === "card")!;
    expect(stylePatch(card.style, "shape").shadow).toEqual(SHADOW_PRESETS.soft.shadow);
    expect(stylePatch(card.style, "text").shadow).toEqual(SHADOW_PRESETS.soft.shadow);
    const none = BUILTIN_PRESETS.find((p) => p.id === "no-shadow")!;
    expect(stylePatch(none.style, "line").shadow).toBeNull();
    expect(stylePatch({ strokeColor: "#000000" }, "shape")).not.toHaveProperty("shadow");
  });
  it("validates saved styles", () => {
    expect(normalizeStyle({ shadow: "lifted" }).shadow).toEqual(SHADOW_PRESETS.lifted.shadow);
    expect(normalizeStyle({ shadow: null }).shadow).toBeNull();
    expect(() => normalizeStyle({ shadow: "nope" })).toThrow();
  });
});

describe("draw.io", () => {
  it("writes shadow=1 and reads it back", async () => {
    const { xml } = toDrawio(
      [
        {
          name: "P",
          elements: [
            { id: "a", type: "rectangle", x: 0, y: 0, width: 80, height: 40, customData: withShadow({}, DEFAULT_SHADOW) },
            { id: "b", type: "rectangle", x: 200, y: 0, width: 80, height: 40 },
          ],
        },
      ],
      {},
    );
    expect(xml).toMatch(/shadow=1/);
    const p = (await readDrawio(xml)).pages[0];
    expect(p.shapes.find((s) => s.id === "a")?.shadow).toBe(true);
    expect(p.shapes.find((s) => s.id === "b")?.shadow).toBeUndefined();
  });
});

describe("Excalidraw renderer patch", () => {
  const dist = path.join(__dirname, "../node_modules/@excalidraw/excalidraw/dist");
  for (const [name, file] of [
    ["dev", "dev/chunk-4FTI6OG3.js"],
    ["prod", "prod/chunk-K2UTITRG.js"],
  ] as const) {
    it(`delegates renderElement and renderElementToSvg in the ${name} chunk`, () => {
      const code = patchTextOutline(patchPanelPin(readFileSync(path.join(dist, file), "utf8")));
      const out: string | null = patchShadow(code);
      expect(out).not.toBeNull();
      expect(out!.match(/globalThis\.__mydrawShadowRender\?\.wants\(/g)).toHaveLength(1);
      expect(out!.match(/globalThis\.__mydrawSvgShadow\?\.wants\(/g)).toHaveLength(1);
      // The original bodies stay intact after the delegation.
      expect(out!.length).toBeGreaterThan(code.length);
      expect(out!.replace(/if\(globalThis\.__mydraw(ShadowRender|SvgShadow)\?\.wants\([^;]*;/g, "")).toBe(code);
    });
  }
  it("returns null when the renderers are missing", () => {
    expect(patchShadow("const x = 1;")).toBeNull();
  });
});

describe("shadow kinds", () => {
  it("drop shadows carry no kind; other kinds survive normalisation", async () => {
    const { normalizeShadow, shadowKind, resolveShadowInput, describeShadow } = await import("../shared/shadow");
    expect(normalizeShadow({ color: "#000", kind: "drop" })).not.toHaveProperty("kind");
    expect(normalizeShadow({ color: "#000", kind: "inner" })?.kind).toBe("inner");
    expect(normalizeShadow({ color: "#000", kind: "wobbly" })).toBeNull();
    expect(shadowKind(normalizeShadow({ color: "#000" }))).toBe("drop");
    expect(resolveShadowInput("float")?.kind).toBe("contact");
    expect(resolveShadowInput({ preset: "soft", kind: "layered" })?.kind).toBe("layered");
    expect(describeShadow(resolveShadowInput("neon")!)).toBe("neon");
  });

  it("sameShadow tells kinds apart", async () => {
    const { sameShadow, SHADOW_PRESETS } = await import("../shared/shadow");
    const soft = SHADOW_PRESETS.soft.shadow;
    expect(sameShadow(soft, { ...soft })).toBe(true);
    expect(sameShadow(soft, { ...soft, kind: "inner" })).toBe(false);
  });

  it("shadowLayers: one for drop, two for layered, a step per px for extrude", async () => {
    const { shadowLayers, EXTRUDE_MAX_STEPS } = await import("../shared/shadow");
    const base = { color: "#000000", opacity: 0.5, blur: 10, distance: 10, angle: 90 };
    expect(shadowLayers(base)).toHaveLength(1);
    const two = shadowLayers({ ...base, kind: "layered" });
    expect(two).toHaveLength(2);
    expect(two[0].blur).toBeGreaterThan(two[1].blur);
    const ex = shadowLayers({ ...base, kind: "extrude" });
    expect(ex).toHaveLength(10);
    expect(ex.at(-1)!.dy).toBeCloseTo(1);
    expect(ex[0].dy).toBeCloseTo(10);
    expect(shadowLayers({ ...base, distance: 80, kind: "extrude" })).toHaveLength(EXTRUDE_MAX_STEPS);
    expect(shadowLayers({ ...base, kind: "inner" })).toEqual([]);
    expect(shadowLayers({ ...base, kind: "contact" })).toEqual([]);
  });

  it("contact shadows sit under the box and need extra export padding", async () => {
    const { contactEllipse, shadowExtent } = await import("../shared/shadow");
    const s = { color: "#000000", opacity: 0.4, blur: 10, distance: 14, angle: 90, kind: "contact" as const };
    const e = contactEllipse(s, { x: 0, y: 0, width: 100, height: 50 });
    expect(e.cx).toBeCloseTo(50);
    expect(e.cy).toBeCloseTo(57);
    expect(e.rx).toBeLessThan(60);
    expect(e.cy + e.ry - 50).toBeLessThanOrEqual(shadowExtent(s));
    expect(shadowExtent(s)).toBeGreaterThan(shadowExtent({ ...s, kind: undefined }));
  });
});
