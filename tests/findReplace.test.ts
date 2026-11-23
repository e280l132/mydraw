import { describe, expect, it } from "vitest";
import { countMatches, replaceInText, replaceNth } from "../shared/findReplace";

const ci = { matchCase: false };
const cs = { matchCase: true };

describe("countMatches", () => {
  it("counts matches, ignoring case by default", () => {
    expect(countMatches("Web web WEB", "web", ci)).toBe(3);
    expect(countMatches("Web web WEB", "web", cs)).toBe(1);
  });
  it("returns 0 for an empty search", () => {
    expect(countMatches("anything", "", ci)).toBe(0);
  });
  it("treats regex characters literally", () => {
    expect(countMatches("a.b a*b (x)", ".", ci)).toBe(1);
    expect(countMatches("a.b a*b (x)", "(x)", ci)).toBe(1);
    expect(countMatches("a+b", "a+b", ci)).toBe(1);
  });
  it("matches whole words only when asked", () => {
    expect(countMatches("sw switch sw-1 sw_2", "sw", { matchCase: false, wholeWord: true })).toBe(2);
    expect(countMatches("sw switch", "sw", ci)).toBe(2);
  });
  it("handles accented letters and newlines", () => {
    expect(countMatches("Café\ncafé", "café", ci)).toBe(2);
  });
});

describe("replaceInText", () => {
  it("replaces every match and reports the count", () => {
    expect(replaceInText("web-1, web-2", "web", "app", ci)).toEqual({ text: "app-1, app-2", count: 2 });
  });
  it("keeps the text when nothing matches", () => {
    expect(replaceInText("router", "switch", "x", ci)).toEqual({ text: "router", count: 0 });
  });
  it("takes the replacement literally", () => {
    expect(replaceInText("price", "price", "$& $1 $$", ci).text).toBe("$& $1 $$");
  });
  it("can delete matches with an empty replacement", () => {
    expect(replaceInText("Core (old)", " (old)", "", cs)).toEqual({ text: "Core", count: 1 });
  });
  it("respects case sensitivity", () => {
    expect(replaceInText("Web web", "web", "x", cs)).toEqual({ text: "Web x", count: 1 });
  });
});

describe("replaceNth", () => {
  const o = { matchCase: false };
  it("replaces only the chosen occurrence", () => {
    expect(replaceNth("web web web", "web", "app", o, 1)).toEqual({ text: "web app web", replaced: true });
    expect(replaceNth("web web web", "web", "app", o, 0).text).toBe("app web web");
  });
  it("reports a missing occurrence and leaves the text alone", () => {
    expect(replaceNth("web", "web", "app", o, 1)).toEqual({ text: "web", replaced: false });
    expect(replaceNth("web", "", "app", o, 0).replaced).toBe(false);
    expect(replaceNth("web", "web", "app", o, -1).replaced).toBe(false);
  });
  it("counts occurrences the same way as countMatches (whole word, case)", () => {
    const w = { matchCase: true, wholeWord: true };
    expect(replaceNth("web website Web web", "web", "X", w, 1).text).toBe("web website Web X");
  });
  it("takes the replacement literally", () => {
    expect(replaceNth("a a", "a", "$&", o, 0).text).toBe("$& a");
  });
});
