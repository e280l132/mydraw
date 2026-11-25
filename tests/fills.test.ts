import { describe, expect, it } from "vitest";
import { EXTRA_FILLS, FILL_STYLE_IDS, isExtraFill, isFillStyle, requireFillStyle } from "../shared/fills";
import { normalizeStyle } from "../shared/styles";

describe("fill styles", () => {
  it("lists Excalidraw's fills and the extra roughjs fillers", () => {
    expect(FILL_STYLE_IDS).toEqual(expect.arrayContaining(["solid", "hachure", "cross-hatch", "zigzag", "dots", "dashed", "zigzag-line"]));
    expect(EXTRA_FILLS.map((f) => f.id)).toEqual(["zigzag", "zigzag-line", "dots", "dashed"]);
  });

  it("tells native from extra fills", () => {
    expect(isExtraFill("dots")).toBe(true);
    expect(isExtraFill("solid")).toBe(false);
    expect(isExtraFill("plaid")).toBe(false);
    expect(isFillStyle("zigzag-line")).toBe(true);
  });

  it("validates untrusted input", () => {
    expect(requireFillStyle("dashed")).toBe("dashed");
    expect(() => requireFillStyle("plaid")).toThrow(/fillStyle must be one of/);
    expect(normalizeStyle({ fillStyle: "dots" }).fillStyle).toBe("dots");
    expect(() => normalizeStyle({ fillStyle: "stripes" })).toThrow();
  });
});
