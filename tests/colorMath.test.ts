import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, normalizeHex } from "../shared/colorMath";

describe("colorMath", () => {
  it("normalizes hex input", () => {
    expect(normalizeHex("1971C2")).toBe("#1971c2");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("blue")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("converts primaries", () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
    expect(hsvToHex({ h: 0, s: 0, v: 0 })).toBe("#000000");
    expect(hsvToHex({ h: 0, s: 0, v: 1 })).toBe("#ffffff");
  });

  it("round-trips hex -> hsv -> hex", () => {
    for (const hex of ["#1971c2", "#e03131", "#2f9e44", "#1b5021", "#f2b705", "#868e96", "#6741d9"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });
});
