import { describe, expect, it } from "vitest";
import { shadesOf, PALETTES, SHADES, mainSwatches, paletteById, requireColor, resolveColor } from "../shared/palettes";
import { BUILTIN_PRESETS, BUILTIN_THEMES as THEMES, INK_COLORS, normalizeLibrary, normalizeTheme, slugId, normalizeStyle, stylePatch, themeById } from "../shared/styles";

describe("palettes", () => {
  it("builds a 22 x 10 ramp of valid hex colors", () => {
    const ramp = paletteById("ramp")!;
    expect(Object.keys(ramp.colors)).toHaveLength(22 * SHADES.length);
    for (const c of Object.values(ramp.colors)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(mainSwatches()).toHaveLength(22);
  });

  it("shades get darker from 50 to 900", () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
    };
    for (const hue of ["blue", "red", "green", "slate"]) {
      const r = paletteById("ramp")!.colors;
      const l = SHADES.map((s) => lum(r[`${hue}-${s}`]));
      for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1] + 0.01);
    }
  });

  it("resolves hex, names, brand names and transparent", () => {
    expect(resolveColor("#F90")).toBe("#ff9900");
    expect(resolveColor("ff9900")).toBe("#ff9900");
    expect(resolveColor("blue")).toBe(paletteById("ramp")!.colors["blue-500"]);
    expect(resolveColor("blue-600")).toBe(paletteById("ramp")!.colors["blue-600"]);
    expect(resolveColor("navy")).toBe("#0b2e6f");
    expect(resolveColor("Navy")).toBe("#0b2e6f");
    expect(resolveColor("black")).toBe("#1e1e1e");
    expect(resolveColor("transparent")).toBe("transparent");
    expect(resolveColor("nonsense")).toBeNull();
    expect(resolveColor("aws.orange")).toBeNull();
  });

  it("names win over look-alike hex (e.g. 'red' is not hex)", () => {
    expect(resolveColor("red")).not.toBeNull();
    expect(resolveColor("fed")).toBe("#ffeedd");
  });

  it("requireColor explains valid forms", () => {
    expect(() => requireColor("bluish")).toThrow(/blue-600/);
    expect(() => requireColor(5)).toThrow(/string/);
  });

  it("every palette color is hex", () => {
    for (const p of PALETTES) for (const c of Object.values(p.colors)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("shadesOf", () => {
  it("ramps any color into 10 ordered shades with the color as 500", () => {
    const sh = shadesOf("#f08c00");
    expect(sh).toHaveLength(10);
    expect(sh[5]).toEqual({ shade: 500, color: "#f08c00" });
    expect(sh[0].color).not.toBe(sh[9].color);
    for (const s of sh) expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(shadesOf("#ffffff")).toHaveLength(10);
  });
});

describe("themes and presets", () => {
  it("basic palette is big and its ramp-named colors match the ramp", () => {
    const basic = paletteById("basic")!.colors;
    expect(Object.keys(basic).length).toBeGreaterThanOrEqual(40);
    expect(paletteById("aws")).toBeUndefined();
    expect(PALETTES.map((p) => p.id)).toEqual(["basic", "ramp"]);
    expect(basic.blue).toBe(paletteById("ramp")!.colors["blue-500"]);
  });

  it("ships plenty of categorized presets and themes with unique ids", () => {
    expect(BUILTIN_PRESETS.length).toBeGreaterThanOrEqual(30);
    expect(THEMES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(BUILTIN_PRESETS.map((p) => p.category)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(THEMES.map((t) => t.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("normalizes user themes and presets and loads tolerant libraries", () => {
    const t = normalizeTheme({ name: "My Look", background: "navy", ink: "#fff", fontFamily: "Cascadia", roundness: "round" });
    expect(t).toMatchObject({ id: "my-look", category: "My themes", background: "#0b2e6f", ink: "#ffffff", dark: true });
    expect(() => normalizeTheme({ name: "x", background: "bluish", ink: "#fff" })).toThrow();
    const lib = normalizeLibrary({
      presets: [{ title: "A", category: "Mine", style: { strokeColor: "red" } }, { title: "Bad", style: { opacity: 999 } }, 5],
      themes: [{ name: "T", background: "#000", ink: "#fff" }, { nope: 1 }],
    });
    expect(lib.presets.map((p) => p.id)).toEqual(["a"]);
    expect(lib.themes.map((x) => x.id)).toEqual(["t"]);
    expect(normalizeLibrary("garbage")).toEqual({ presets: [], themes: [] });
  });

  it("gives non-ASCII names distinct ids", () => {
    expect(slugId("My Preset!")).toBe("my-preset");
    const a = slugId("数据库");
    const b = slugId("网络");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^x[0-9a-z]+$/);
    expect(slugId("数据库")).toBe(a);
    const lib = normalizeLibrary({ presets: [{ title: "数据库", style: {} }, { title: "网络", style: {} }] });
    expect(lib.presets).toHaveLength(2);
  });

  it("finds themes by id or title; inks are known", () => {
    expect(themeById("Blueprint")?.id).toBe("blueprint");
    expect(themeById("nope")).toBeUndefined();
    expect(INK_COLORS).toContain("#1e1e1e");
    expect(THEMES.every((t) => INK_COLORS.includes(t.ink.toLowerCase()))).toBe(true);
  });

  it("built-in presets are valid and resolve to element fields", () => {
    for (const p of BUILTIN_PRESETS) {
      expect(() => normalizeStyle(p.style)).not.toThrow();
      expect(() => stylePatch(p.style, "shape")).not.toThrow();
    }
    const dmz = stylePatch(BUILTIN_PRESETS.find((p) => p.id === "dmz")!.style, "shape");
    expect(dmz.strokeStyle).toBe("dashed");
    expect(dmz.fillStyle).toBe("solid");
    expect(dmz.backgroundColor).toMatch(/^#/);
  });

  it("stylePatch respects the element kind", () => {
    const style = normalizeStyle({ strokeColor: "red", backgroundColor: "blue-100", strokeWidth: 3, roundness: "round", fontFamily: "Cascadia" });
    expect(stylePatch(style, "text")).toEqual({ strokeColor: expect.any(String), fontFamily: 3 });
    const line = stylePatch(style, "line");
    expect(line.backgroundColor).toBeUndefined();
    expect(line.roundness).toBeUndefined();
    expect(line.strokeWidth).toBe(3);
    expect(stylePatch(style, "shape").roundness).toEqual({ type: 3 });
  });

  it("normalizeStyle rejects bad input", () => {
    expect(() => normalizeStyle({ strokeColor: "bluish" })).toThrow();
    expect(() => normalizeStyle({ strokeStyle: "wavy" })).toThrow(/strokeStyle/);
    expect(() => normalizeStyle({ opacity: 150 })).toThrow(/opacity/);
    expect(() => normalizeStyle({ fontFamily: "Comic Sans" })).toThrow(/fontFamily/);
    expect(() => normalizeStyle("x")).toThrow();
  });
});
