import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commonOutline, drawnOutlineWidth, normalizeOutline, OUTLINE_KEY, outlineOf, withOutline } from "../shared/textOutline";
// @ts-expect-error plain JS build script
import { patchPanelPin, patchTextOutline } from "../scripts/excalidrawPatch.mjs";

describe("normalizeOutline", () => {
  it("accepts a color and clamps the width", () => {
    expect(normalizeOutline({ color: "#ff0000", width: 3 })).toEqual({ color: "#ff0000", width: 3 });
    expect(normalizeOutline({ color: "#ff0000", width: 99 })).toEqual({ color: "#ff0000", width: 16 });
    expect(normalizeOutline({ color: "#ff0000", width: 0 })).toEqual({ color: "#ff0000", width: 0.5 });
    expect(normalizeOutline({ color: "white" })).toEqual({ color: "white", width: 2 });
  });
  it("rejects junk", () => {
    expect(normalizeOutline(null)).toBeNull();
    expect(normalizeOutline({ color: "transparent", width: 2 })).toBeNull();
    expect(normalizeOutline({ color: "red;stroke:url(x)" })).toBeNull();
    expect(normalizeOutline({ color: 5 })).toBeNull();
  });
});

describe("customData helpers", () => {
  it("sets, reads and removes the outline, keeping other keys", () => {
    const cd = withOutline({ ip: "10.0.0.1" }, { color: "#000", width: 2 });
    expect(outlineOf({ customData: cd })).toEqual({ color: "#000", width: 2 });
    expect(withOutline(cd, null)).toEqual({ ip: "10.0.0.1" });
    expect(withOutline({ [OUTLINE_KEY]: { color: "#000", width: 2 } }, null)).toEqual({});
  });
  it("caps the drawn width at a quarter of the font size", () => {
    expect(drawnOutlineWidth({ color: "#000", width: 4 }, 20)).toBe(4);
    expect(drawnOutlineWidth({ color: "#000", width: 8 }, 20)).toBe(5);
  });
  it("finds the common outline", () => {
    const a = { customData: withOutline(null, { color: "#000", width: 2 }) };
    const b = { customData: withOutline(null, { color: "#fff", width: 2 }) };
    expect(commonOutline([a, a])).toEqual({ color: "#000", width: 2 });
    expect(commonOutline([a, b])).toBe("mixed");
    expect(commonOutline([{}, {}])).toBeNull();
  });
});

describe("Excalidraw text renderer patch", () => {
  const dist = path.join(__dirname, "../node_modules/@excalidraw/excalidraw/dist");
  for (const file of ["dev/chunk-4FTI6OG3.js", "prod/chunk-K2UTITRG.js"]) {
    it(`patches canvas and SVG text in ${file}`, () => {
      const out: string | null = patchTextOutline(patchPanelPin(readFileSync(path.join(dist, file), "utf8")));
      expect(out).not.toBeNull();
      expect(out!.split("globalThis.__mydrawTextOutline?.(").length - 1).toBe(1);
      expect(out!.split("globalThis.__mydrawSvgTextOutline?.(").length - 1).toBe(1);
      // The canvas hook runs right before the fill loop.
      expect(out).toMatch(/__mydrawTextOutline\?\.\([^)]*\);for\s*\(/);
    });
  }
  it("returns null when the renderers are missing", () => {
    expect(patchTextOutline("const x = 1;")).toBeNull();
  });
});
