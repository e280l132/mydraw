import { describe, expect, it } from "vitest";
import { captureLook, iconColorOf, lookSwatchCss, lookUpdates, normalizeLookParts, partsFor, type LookEl } from "../shared/styleCopy";

const grad = { kind: "linear" as const, from: "#e0e7ff", to: "#7c3aed", angle: 45 };
const rect = (id: string, extra: Partial<LookEl> = {}): LookEl => ({
  id,
  type: "rectangle",
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  customData: null,
  ...extra,
});
const gradRect = rect("a", { backgroundColor: grad.from, customData: { mydrawGradient: grad } });
const text = (id: string, extra: Partial<LookEl> = {}): LookEl => ({ id, type: "text", strokeColor: "#000000", fontFamily: 5, fontSize: 20, opacity: 100, customData: null, ...extra });

describe("captureLook", () => {
  it("picks up a gradient fill", () => {
    const look = captureLook({ el: gradRect });
    expect(look.fill).toEqual({ backgroundColor: grad.from, fillStyle: "solid", gradient: grad });
    expect(lookSwatchCss(look)).toContain("linear-gradient");
  });
  it("ignores a stored gradient that is not drawn (fill changed since)", () => {
    const look = captureLook({ el: rect("a", { backgroundColor: "#ff0000", customData: { mydrawGradient: grad } }) });
    expect(look.fill?.gradient).toBeNull();
  });
  it("names extra dashes in the stroke", () => {
    const look = captureLook({ el: rect("a", { strokeStyle: "dashed", customData: { mydrawDash: "dash-dot" } }) });
    expect(look.stroke?.strokeStyle).toBe("dash-dot");
  });
  it("has no fill for an arrow, and the label gives the text part", () => {
    const look = captureLook({ el: { id: "ar", type: "arrow", strokeColor: "#f00" }, label: text("t") });
    expect(look.fill).toBeUndefined();
    expect(look.stroke?.strokeColor).toBe("#f00");
    expect(look.text?.fontSize).toBe(20);
  });
  it("an icon node's fill is its icon colour", () => {
    const node = rect("n", { customData: { mydrawNode: "icon" } });
    const look = captureLook({ el: node, iconImage: { id: "img", type: "image", customData: { mydrawIconColor: "#2563eb" } } });
    expect(look.fill?.backgroundColor).toBe("#2563eb");
    expect(look.stroke).toBeUndefined();
  });
});

describe("lookUpdates", () => {
  const look = captureLook({ el: gradRect });

  it("copies a gradient onto a plain rectangle (fill only by default)", () => {
    const ch = lookUpdates(look, { el: rect("b") }, ["fill"]);
    expect(ch?.updates).toEqual([{ id: "b", backgroundColor: grad.from, fillStyle: "solid", gradient: grad }]);
  });
  it("a plain or pattern fill takes a gradient off", () => {
    const dots = captureLook({ el: rect("p", { backgroundColor: "#fde68a", fillStyle: "dots" }) });
    const ch = lookUpdates(dots, { el: gradRect }, ["fill"]);
    expect(ch?.updates[0]).toMatchObject({ backgroundColor: "#fde68a", fillStyle: "dots", gradient: null });
  });
  it("copies the hatch as the source draws it", () => {
    // Source: stroke 2, hatch follows it (1 / 8). Target: thick stroke 8 would hatch at 4 / 32.
    const src = captureLook({ el: rect("h", { backgroundColor: "#fde68a", fillStyle: "hachure" }) });
    expect(src.fill?.pattern).toEqual({ weight: 1, gap: 8 });
    const ch = lookUpdates(src, { el: rect("t", { strokeWidth: 8 }) }, ["fill"]);
    expect(ch?.updates[0]).toMatchObject({ fillStyle: "hachure", fillPattern: { weight: 1, gap: 8 } });
    const own = captureLook({ el: rect("o", { fillStyle: "cross-hatch", customData: { mydrawFillPattern: { weight: 3, gap: 20 } } }) });
    expect(own.fill?.pattern).toEqual({ weight: 3, gap: 20 });
    // Solid fills carry no pattern (the target keeps its own).
    expect(captureLook({ el: rect("s", { backgroundColor: "#fde68a" }) }).fill?.pattern).toBeUndefined();
  });
  it("does nothing for a target that can't take the parts", () => {
    expect(lookUpdates(look, { el: { id: "ar", type: "arrow" } }, ["fill"])).toBeNull();
    expect(lookUpdates(look, { el: rect("z", { customData: { mydrawZone: true } }) }, ["fill"])).toBeNull();
    expect(lookUpdates(look, { el: rect("l", { locked: true }) }, ["fill"])).toBeNull();
  });
  it("each chip limits the fields", () => {
    const src = captureLook({ el: rect("s", { strokeColor: "#dc2626", strokeWidth: 4, opacity: 60, customData: { mydrawShadow: { color: "#000000", opacity: 0.3, blur: 8, distance: 4, angle: 90 } } }) });
    const stroke = lookUpdates(src, { el: rect("b") }, ["stroke"])!.updates[0];
    expect(Object.keys(stroke).sort()).toEqual(["id", "roughness", "strokeColor", "strokeStyle", "strokeWidth"]);
    const fx = lookUpdates(src, { el: rect("b") }, ["effects"])!.updates[0];
    expect(fx).toMatchObject({ opacity: 60, shadow: { blur: 8 } });
    expect(fx.backgroundColor).toBeUndefined();
  });
  it("text goes to the label and asks for a re-fit when the font changes", () => {
    const src = captureLook({ el: rect("s"), label: text("st", { fontSize: 28, customData: { mydrawTextOutline: { color: "#ffffff", width: 2 } } }) });
    const ch = lookUpdates(src, { el: rect("b"), label: text("bt") }, ["text"])!;
    expect(ch.updates).toEqual([
      { id: "b", textOutline: { color: "#ffffff", width: 2 } },
      { id: "bt", strokeColor: "#000000", fontFamily: 5, fontSize: 28 },
    ]);
    expect(ch.refit).toBe("b");
    expect(lookUpdates(src, { el: rect("c") }, ["text"])).toBeNull(); // no label
  });
  it("a fill on an icon node recolours its image", () => {
    const node = rect("n", { customData: { mydrawNode: "icon" } });
    const ch = lookUpdates(look, { el: node, iconImage: { id: "img", type: "image" } }, ["fill", "stroke"])!;
    expect(ch.iconColor).toEqual({ imageId: "img", color: grad.from });
    expect(ch.updates).toEqual([]);
    expect(iconColorOf(captureLook({ el: rect("t") }))).toBeNull(); // transparent: nothing to give
  });
  it("keeps other customData (applyUpdates merges)", () => {
    expect(partsFor(look, { el: rect("b", { customData: { ip: "10.0.0.1" } }) }, ["fill"])).toEqual(["fill"]);
  });
});

describe("normalizeLookParts", () => {
  it("defaults to fill and orders parts", () => {
    expect(normalizeLookParts(null)).toEqual(["fill"]);
    expect(normalizeLookParts([])).toEqual(["fill"]);
    expect(normalizeLookParts(["text", "fill", "bogus"])).toEqual(["fill", "text"]);
  });
});
