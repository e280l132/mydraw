import { describe, expect, it } from "vitest";
import { historyIdFromContent, readMeta, withMeta } from "../shared/drawingMeta";
import {
  CUSTOM_FONT_MIN,
  FONTS_KEY,
  canStyle,
  charsPerCustomFont,
  cssSafeFamily,
  faceFamilyName,
  faceFor,
  filesToEmbed,
  fontIdFor,
  lineHeightFor,
  normalizeEmbeddedFonts,
  planFontImport,
  rangeCovers,
  remapFontFamilies,
  type EmbeddedFontFace,
} from "../shared/fonts";
import { BUILTIN_FONTS } from "../scripts/builtin-fonts.mjs";

const metrics = { unitsPerEm: 2048, ascender: 1984, descender: -494, lineHeight: 1.2 };

function face(family: string, id = fontIdFor(family), files = [{ unicodeRange: "U+0000-00FF", data: "AAAA" }]): EmbeddedFontFace {
  return { id, family, typeface: family, weight: 400, style: "normal", category: "professional", metrics, files };
}

describe("font ids", () => {
  it("are stable, case-insensitive and above Excalidraw's own ids", () => {
    expect(fontIdFor("Inter")).toBe(fontIdFor("inter"));
    expect(fontIdFor("Inter")).toBe(fontIdFor(" Inter "));
    expect(fontIdFor("Inter")).not.toBe(fontIdFor("Inter Bold"));
    expect(fontIdFor("Inter")).toBeGreaterThanOrEqual(CUSTOM_FONT_MIN);
    expect(fontIdFor("Inter")).toBeLessThan(1_000_000);
  });

  it("don't collide across the built-in set", () => {
    const names = BUILTIN_FONTS.flatMap((f) => [
      ...f.weights.map((w) => faceFamilyName(f.typeface, w, "normal")),
      ...(f.category === "fun" ? [] : f.weights.map((w) => faceFamilyName(f.typeface, w, "italic"))),
    ]);
    expect(new Set(names.map(fontIdFor)).size).toBe(names.length);
  });
});

describe("family names", () => {
  it("are valid unquoted CSS family names", () => {
    expect(cssSafeFamily("Source Serif 4")).toBe("Source Serif");
    expect(cssSafeFamily("M PLUS 1p")).toBe("M PLUS Onep");
    expect(cssSafeFamily("Noto Sans (JP)")).toBe("Noto Sans JP");
    expect(cssSafeFamily("--weird")).toBe("weird");
    expect(cssSafeFamily("!!!")).toBe("Font");
    for (const f of BUILTIN_FONTS) {
      for (const w of f.weights) expect(faceFamilyName(f.typeface, w, "normal")).toMatch(/^[A-Za-z_][\w-]*( [A-Za-z_][\w-]*)*$/);
    }
  });

  it("name weights and styles", () => {
    expect(faceFamilyName("Inter", 400, "normal")).toBe("Inter");
    expect(faceFamilyName("Inter", 700, "normal")).toBe("Inter Bold");
    expect(faceFamilyName("Inter", 600, "italic")).toBe("Inter SemiBold Italic");
    expect(faceFamilyName("Source Serif 4", 600, "normal")).toBe("Source Serif SemiBold");
  });

  it("give a mix of fun and professional built-ins", () => {
    const cats = new Set(BUILTIN_FONTS.map((f) => f.category));
    expect(cats).toEqual(new Set(["fun", "professional", "mono"]));
    expect(BUILTIN_FONTS.filter((f) => f.category === "fun").length).toBeGreaterThanOrEqual(8);
    expect(BUILTIN_FONTS.filter((f) => f.category === "professional").length).toBeGreaterThanOrEqual(8);
  });
});

describe("metrics and ranges", () => {
  it("line height comes from hhea metrics, rounded and clamped", () => {
    expect(lineHeightFor({ unitsPerEm: 1000, ascender: 1011, descender: -353 })).toBe(1.35);
    expect(lineHeightFor({ unitsPerEm: 1000, ascender: 2000, descender: -500 })).toBe(1.6);
  });

  it("unicode ranges", () => {
    expect(rangeCovers("U+0000-00FF", ["a"])).toBe(true);
    expect(rangeCovers("U+0100-02BA,U+1E00-1E9F", ["a"])).toBe(false);
    expect(rangeCovers("U+0100-02BA", ["a", "ł"])).toBe(true);
    expect(rangeCovers("U+00??", ["Z"])).toBe(true);
    expect(rangeCovers("", ["Z"])).toBe(true);
  });

  it("embeds only files covering used characters, at least one", () => {
    const entry = {
      files: [
        { url: "a", unicodeRange: "U+0000-00FF" },
        { url: "b", unicodeRange: "U+0100-02BA" },
      ],
    };
    expect(filesToEmbed(entry, new Set("Hello")).map((f) => f.url)).toEqual(["a"]);
    expect(filesToEmbed(entry, new Set("Łódź")).map((f) => f.url)).toEqual(["a", "b"]);
    expect(filesToEmbed(entry, new Set()).map((f) => f.url)).toEqual(["a"]);
  });

  it("collects characters per custom font, skipping deleted and built-in", () => {
    const id = fontIdFor("Inter");
    const m = charsPerCustomFont([
      { type: "text", fontFamily: id, originalText: "ab" },
      { type: "text", fontFamily: id, originalText: "bc", isDeleted: true },
      { type: "text", fontFamily: 5, originalText: "xyz" },
      { type: "rectangle" },
    ]);
    expect([...m.keys()]).toEqual([id]);
    expect([...m.get(id)!].sort()).toEqual(["a", "b"]);
  });
});

describe("embedded fonts in files", () => {
  it("normalizes untrusted input", () => {
    const out = normalizeEmbeddedFonts({
      faces: [
        face("Inter"),
        face("Inter"), // duplicate
        { ...face("Bad Name;}"), family: "Bad;}" },
        { ...face("No Metrics"), metrics: null },
        { ...face("Bad Data"), files: [{ unicodeRange: "", data: "<script>" }] },
        "junk",
      ],
    });
    expect(out.faces.map((f) => f.family)).toEqual(["Inter", "Bad Data"]);
    expect(out.faces[1].files).toEqual([]);
    expect(normalizeEmbeddedFonts(null).faces).toEqual([]);
  });

  it("plans import: reuse known families, keep free ids, move taken ones", () => {
    const known = new Map([
      ["inter", 12345],
      ["other", fontIdFor("Caveat")],
    ]);
    const plan = planFontImport([face("Inter"), face("Caveat"), face("Kalam")], known);
    expect(plan.remap.get(fontIdFor("Inter"))).toBe(12345);
    expect(plan.register.map((f) => f.family)).toEqual(["Caveat", "Kalam"]);
    const caveat = plan.register[0];
    expect(caveat.id).not.toBe(fontIdFor("Caveat"));
    expect(plan.remap.get(fontIdFor("Caveat"))).toBe(caveat.id);
    expect(plan.remap.has(fontIdFor("Kalam"))).toBe(false);
  });

  it("remaps text elements only", () => {
    const els = [
      { type: "text", fontFamily: 20000 },
      { type: "text", fontFamily: 5 },
      { type: "rectangle" },
    ];
    const out = remapFontFamilies(els, new Map([[20000, 30000]]));
    expect(out.map((e) => e.fontFamily)).toEqual([30000, 5, undefined]);
    expect(remapFontFamilies(els, new Map())).toBe(els);
  });

  it("go before the meta block, so the history id is still in the last 4 KB", () => {
    const json = JSON.stringify({ type: "excalidraw", elements: [] }, null, 2);
    const big = "A".repeat(500_000);
    const fonts = { version: 1 as const, faces: [face("Inter", fontIdFor("Inter"), [{ unicodeRange: "", data: big }])] };
    const meta = { id: "0123456789abcdef", palette: ["#ff0000"] };
    const out = withMeta(json, meta, fonts);
    const data = JSON.parse(out);
    expect(Object.keys(data).slice(-2)).toEqual([FONTS_KEY, "mydraw"]);
    expect(historyIdFromContent(out)).toBe(meta.id);
    expect(readMeta(out)).toEqual(meta);
    expect(normalizeEmbeddedFonts(data[FONTS_KEY]).faces[0].files[0].data.length).toBe(big.length);
    // no fonts -> no key
    expect(JSON.parse(withMeta(json, meta, null))).not.toHaveProperty(FONTS_KEY);
  });
});

describe("woff2 metrics", () => {
  it("reads unitsPerEm and hhea ascender/descender without a font library", async () => {
    const { readFileSync } = await import("node:fs");
    const { brotliDecompressSync } = await import("node:zlib");
    const { woff2Metrics, isWoff2 } = await import("../shared/woff2");
    const bytes = readFileSync("node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2");
    expect(isWoff2(bytes)).toBe(true);
    // Values as reported by fontkit for this file.
    expect(woff2Metrics(bytes, (b) => brotliDecompressSync(b))).toEqual({ unitsPerEm: 2048, ascender: 1984, descender: -494 });
    expect(() => woff2Metrics(new Uint8Array(100), (b) => b)).toThrow(/woff2/);
  });
});

describe("bold / italic faces", () => {
  const mk = (typeface: string, weight: number, style: "normal" | "italic" = "normal") => ({
    typeface,
    weight,
    style,
    family: faceFamilyName(typeface, weight, style),
  });
  const inter = [mk("Inter", 400), mk("Inter", 600), mk("Inter", 700), mk("Inter", 400, "italic"), mk("Inter", 700, "italic")];
  const caveat = [mk("Caveat", 400), mk("Caveat", 700)];
  const marker = [mk("Permanent Marker", 400)];
  const all = [...inter, ...caveat, ...marker];

  it("names the faces", () => {
    expect(inter.map((f) => f.family)).toEqual(["Inter", "Inter SemiBold", "Inter Bold", "Inter Italic", "Inter Bold Italic"]);
  });

  it("switches weight and keeps the other property", () => {
    expect(faceFor(inter[0], all, { bold: true })?.family).toBe("Inter Bold");
    expect(faceFor(inter[2], all, { bold: false })?.family).toBe("Inter");
    expect(faceFor(inter[0], all, { italic: true })?.family).toBe("Inter Italic");
    expect(faceFor(inter[4], all, { italic: false })?.family).toBe("Inter Bold");
    expect(faceFor(inter[3], all, { bold: true })?.family).toBe("Inter Bold Italic");
    expect(faceFor(inter[4], all, { bold: false })?.family).toBe("Inter Italic");
  });

  it("treats SemiBold as bold and leaves it bold when italic changes", () => {
    expect(faceFor(inter[1], all, { bold: false })?.family).toBe("Inter");
    // no SemiBold Italic: a SemiBold text made italic becomes Bold Italic
    expect(faceFor(inter[1], all, { italic: true })?.family).toBe("Inter Bold Italic");
  });

  it("is case-insensitive about the typeface and null when a face is missing", () => {
    expect(faceFor({ typeface: "inter", weight: 400, style: "normal" }, all, { bold: true })?.family).toBe("Inter Bold");
    expect(faceFor(caveat[0], all, { italic: true })).toBeNull();
    expect(faceFor(marker[0], all, { bold: true })).toBeNull();
  });

  it("says which buttons can work", () => {
    expect(canStyle(inter[0], all)).toEqual({ bold: true, italic: true });
    expect(canStyle(caveat[0], all)).toEqual({ bold: true, italic: false });
    expect(canStyle(marker[0], all)).toEqual({ bold: false, italic: false });
    expect(canStyle({ typeface: "Unknown", weight: 400, style: "normal" }, all)).toEqual({ bold: false, italic: false });
  });
});
