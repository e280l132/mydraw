import { describe, expect, it } from "vitest";
import { dashArrayFor, dashFromDrawio, dashOf, dashPatch, drawioDashPattern, DASH_IDS, DASH_STYLES, NATIVE_DASH, requireStrokeStyle, strokeStyleName } from "../shared/dash";
// @ts-expect-error plain JS build script
import { patchDash } from "../scripts/excalidrawPatch.mjs";
import { normalizeStyle } from "../shared/styles";

describe("dash styles", () => {
  it("only applies while the fallback strokeStyle still matches", () => {
    const el = { strokeStyle: "dashed", strokeWidth: 2, customData: { mydrawDash: "dash-dot" } };
    expect(dashOf(el)).toBe("dash-dot");
    expect(dashArrayFor(el)).toEqual([12, 7, 1.5, 7]);
    expect(dashOf({ ...el, strokeStyle: "solid" })).toBeNull();
    expect(dashOf({ ...el, strokeStyle: "dotted" })).toBeNull();
    expect(dashArrayFor({ strokeStyle: "dashed", strokeWidth: 2 })).toBeUndefined();
    expect(strokeStyleName(el)).toBe("dash-dot");
    expect(strokeStyleName({ strokeStyle: "dotted" })).toBe("dotted");
  });

  it("dashPatch sets the fallback and keeps other customData", () => {
    expect(dashPatch({ a: 1 }, "sparse-dot")).toEqual({ strokeStyle: "dotted", customData: { a: 1, mydrawDash: "sparse-dot" } });
    expect(dashPatch({ a: 1, mydrawDash: "long-dash" }, null, "solid")).toEqual({ strokeStyle: "solid", customData: { a: 1 } });
    for (const id of DASH_IDS) expect(dashOf({ ...dashPatch(null, id), strokeWidth: 1 })).toBe(id);
  });

  it("validates names", () => {
    expect(requireStrokeStyle("long-dash")).toBe("long-dash");
    expect(() => requireStrokeStyle("wavy")).toThrow(/strokeStyle must be one of/);
    expect(normalizeStyle({ strokeStyle: "dash-dot" }).strokeStyle).toBe("dash-dot");
  });

  it("round-trips draw.io dash patterns", () => {
    for (const w of [1, 2, 4]) {
      for (const id of DASH_IDS) expect(dashFromDrawio(drawioDashPattern(DASH_STYLES[id].pattern(w), w), w)).toBe(id);
      expect(dashFromDrawio(drawioDashPattern(NATIVE_DASH.dashed(w), w), w)).toBeNull();
      expect(dashFromDrawio(drawioDashPattern(NATIVE_DASH.dotted(w), w), w)).toBeNull();
    }
    expect(dashFromDrawio(undefined, 2)).toBeNull();
  });

  it("patches Excalidraw's strokeLineDash without changing its own branches", () => {
    const code = 'var rt=(e)=>({seed:e.seed,strokeLineDash:e.strokeStyle==="dashed"?Cm(e.strokeWidth):e.strokeStyle==="dotted"?k1(e.strokeWidth):void 0})';
    const out = patchDash(code);
    expect(out).toContain('strokeLineDash:globalThis.__mydrawDash?.(e)?globalThis.__mydrawDash(e):e.strokeStyle==="dashed"');
    const Cm = (w: number) => [8, 8 + w];
    const k1 = (w: number) => [1.5, 6 + w];
    const run = (el: object, hook?: (e: object) => number[] | undefined) => {
      (globalThis as { __mydrawDash?: unknown }).__mydrawDash = hook;
      return new Function("Cm", "k1", `${out};return rt;`)(Cm, k1)(el).strokeLineDash;
    };
    expect(run({ strokeStyle: "dashed", strokeWidth: 2 })).toEqual([8, 10]);
    expect(run({ strokeStyle: "dotted", strokeWidth: 2 }, () => undefined)).toEqual([1.5, 8]);
    expect(run({ strokeStyle: "solid", strokeWidth: 2 }, () => undefined)).toBeUndefined();
    expect(run({ strokeStyle: "dashed", strokeWidth: 2 }, () => [1, 2])).toEqual([1, 2]);
    expect(patchDash("nothing here")).toBeNull();
  });
});

describe("draw.io dash patterns", () => {
  it("writes and reads extra dash styles", async () => {
    const { toDrawio } = await import("../shared/drawioWriter");
    const { readDrawio } = await import("../shared/drawioReader");
    const { strokeFromDrawio } = await import("../shared/dash");
    const el = (id: string, strokeStyle: string, dash?: string) => ({
      id, type: "rectangle", x: 0, y: 0, width: 100, height: 60, strokeColor: "#000000", backgroundColor: "transparent",
      strokeWidth: 2, strokeStyle, customData: dash ? { mydrawDash: dash } : null,
    });
    const { xml } = toDrawio([{ name: "p", elements: [el("a", "dashed", "dash-dot"), el("b", "dotted"), el("c", "dotted", "sparse-dot")] as never }], {});
    const page = (await readDrawio(xml)).pages[0];
    const shapes = new Map(page.shapes.map((s) => [s.id, s]));
    const back = (id: string) => strokeFromDrawio(shapes.get(id)!.dashPattern, shapes.get(id)!.strokeWidth ?? 1);
    expect(back("a")).toBe("dash-dot");
    expect(back("b")).toBe("dotted");
    expect(back("c")).toBe("sparse-dot");
  });
});
