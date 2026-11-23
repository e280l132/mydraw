import { describe, expect, it } from "vitest";
import { displayOrder, mergeOrder, moveSection, nativeOrder, normalizePanelOrder } from "../shared/panelOrder";
import { mergeSettings, DEFAULT_SETTINGS } from "../shared/settings";

describe("panel section order", () => {
  it("normalizes untrusted input", () => {
    expect(normalizePanelOrder(null)).toEqual([]);
    expect(normalizePanelOrder(["colors", "colors", 3, "Bad Key", "stroke-width", "", "x".repeat(60)])).toEqual(["colors", "stroke-width"]);
    expect(normalizePanelOrder(Array.from({ length: 100 }, (_, i) => `k${i}`))).toHaveLength(64);
  });

  it("settings keep a valid order and drop junk", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { panelOrder: ["properties", "opacity"] }).panelOrder).toEqual(["properties", "opacity"]);
    expect(mergeSettings(DEFAULT_SETTINGS, { panelOrder: "nope" }).panelOrder).toEqual([]);
    expect(mergeSettings(DEFAULT_SETTINGS, {}).panelOrder).toEqual([]);
  });

  it("native order lifts Align above Edges", () => {
    expect(nativeOrder(["colors", "edges", "opacity", "layers", "align"])).toEqual(["colors", "align", "edges", "opacity", "layers"]);
    expect(nativeOrder(["colors", "opacity", "align"])).toEqual(["colors", "opacity", "align"]);
  });

  it("no saved order = native order", () => {
    expect(displayOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("unsaved sections go after their native predecessor", () => {
    expect(mergeOrder(["c", "a"], ["a", "b", "c", "d"])).toEqual(["c", "d", "a", "b"]);
    expect(mergeOrder(["b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("moves a section and keeps hidden ones in their slots", () => {
    const present = ["colors", "properties", "stroke-width", "opacity"];
    const saved = moveSection([], present, "properties", 3);
    expect(displayOrder(saved, present)).toEqual(["colors", "stroke-width", "opacity", "properties"]);
    // "align" appears later (2+ selected), then disappears again: the others keep their order.
    const withAlign = ["colors", "properties", "stroke-width", "align", "opacity"];
    const saved2 = moveSection(saved, withAlign, "align", 0);
    expect(displayOrder(saved2, withAlign)).toEqual(["align", "colors", "stroke-width", "opacity", "properties"]);
    expect(displayOrder(saved2, present)).toEqual(["colors", "stroke-width", "opacity", "properties"]);
  });

  it("clamps the target and ignores unknown keys", () => {
    expect(moveSection([], ["a", "b"], "a", 99)).toEqual(["b", "a"]);
    expect(moveSection([], ["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});
