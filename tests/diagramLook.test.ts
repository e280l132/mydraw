import { describe, expect, it } from "vitest";
import { edgeLook, KIND_PALETTE, kindStyles, LOOKS, lookOf } from "../shared/diagramLook";
import { BUILTIN_FONTS } from "../scripts/builtin-fonts.mjs";
import { faceFamilyName } from "../shared/fonts";

const builtinFamilies = new Set(BUILTIN_FONTS.flatMap((f) => f.weights.map((w) => faceFamilyName(f.typeface, w, "normal"))));
const EXCALIDRAW = new Set(["Excalifont", "Virgil", "Comic Shanns", "Lilita One", "Nunito", "Helvetica", "Cascadia", "Liberation Sans"]);

describe("diagram looks", () => {
  it("professional is the default; sketch only when asked", () => {
    expect(lookOf(undefined).name).toBe("professional");
    expect(lookOf("nonsense").name).toBe("professional");
    expect(lookOf("sketch").name).toBe("sketch");
    expect(LOOKS.professional.roughness).toBe(0);
    expect(LOOKS.sketch.roughness).toBe(1);
  });

  it("names only fonts that ship with mydraw, and falls back to Excalidraw's own", () => {
    for (const look of Object.values(LOOKS)) {
      for (const k of ["title", "diagramSubtitle", "zoneTitle", "nodeLabel", "nodeLabelBold", "caption", "nodeSubtitle", "edgeLabel"] as const) {
        expect(builtinFamilies.has(look[k].font), `${look.name}.${k} ${look[k].font}`).toBe(true);
        expect(EXCALIDRAW.has(look[k].fallback), `${look.name}.${k} fallback`).toBe(true);
      }
    }
  });

  it("has a type hierarchy: title > zone/node labels > captions, arrow labels", () => {
    for (const l of Object.values(LOOKS)) {
      expect(l.title.size).toBeGreaterThan(l.nodeLabel.size);
      expect(l.nodeLabelBold.size).toBeGreaterThanOrEqual(l.nodeLabel.size);
      expect(l.nodeLabel.size).toBeGreaterThanOrEqual(l.caption.size);
      expect(l.edgeWidth.primary).toBeGreaterThan(l.edgeWidth.normal);
      expect(l.edgeWidth.normal).toBeGreaterThan(l.edgeWidth.secondary);
    }
    expect(LOOKS.professional.title.font).toMatch(/Bold/);
  });
});

describe("arrow kinds and semantics", () => {
  it("gives kinds without a colour distinct, stable colours, skipping declared ones", () => {
    const k = kindStyles(["Traffic", "Data", "Traffic", undefined, "Async"], { Data: { color: KIND_PALETTE[0] } });
    expect(k.get("Data")!.color).toBe(KIND_PALETTE[0]);
    const colors = [...k.values()].map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(kindStyles(["Traffic", "Async"]).get("Async")!.color).toBe(kindStyles(["Traffic", "Async"]).get("Async")!.color);
  });

  it("an edge's own fields win, then its kind, then the look", () => {
    const look = LOOKS.professional;
    const kinds = kindStyles(["Async"], { Async: { style: "dashed", weight: "secondary", head: "triangle_outline", color: "#e8590c" } });
    expect(edgeLook({ kind: "Async" }, look, kinds, "#1e1e1e")).toEqual({
      color: "#e8590c",
      style: "dashed",
      width: look.edgeWidth.secondary,
      opacity: look.faded,
      startArrowhead: null,
      endArrowhead: "triangle_outline",
    });
    const own = edgeLook({ kind: "Async", color: "#000000", weight: "primary", head: "dot", tail: "diamond" }, look, kinds, "#1e1e1e");
    expect(own).toMatchObject({ color: "#000000", width: look.edgeWidth.primary, opacity: 100, endArrowhead: "dot", startArrowhead: "diamond" });
    expect(edgeLook({}, look, kinds, "#1e1e1e")).toMatchObject({ color: "#1e1e1e", width: 2, startArrowhead: null, endArrowhead: "arrow" });
    expect(edgeLook({ arrow: "both" }, look, kinds, "#1e1e1e")).toMatchObject({ startArrowhead: "arrow", endArrowhead: "arrow" });
    expect(edgeLook({ arrow: "none" }, look, kinds, "#1e1e1e")).toMatchObject({ startArrowhead: null, endArrowhead: null });
    expect(edgeLook({ head: "none" }, look, kinds, "#1e1e1e").endArrowhead).toBeNull();
    expect(edgeLook({ width: 5 }, look, kinds, "#1e1e1e").width).toBe(5);
  });
});
