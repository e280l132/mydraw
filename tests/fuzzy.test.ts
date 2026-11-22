import { describe, expect, it } from "vitest";
import { fuzzyRank, fuzzyScore } from "../shared/fuzzy";

describe("fuzzyScore", () => {
  it("matches everything for an empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("   ", "anything")).toBe(0);
  });

  it("requires every token to match", () => {
    expect(fuzzyScore("export pdf", "Export as PDF")).not.toBeNull();
    expect(fuzzyScore("export zip", "Export as PDF")).toBeNull();
  });

  it("matches in-order subsequences but not out-of-order ones", () => {
    expect(fuzzyScore("ecs", "EC2 Container Service")).not.toBeNull();
    expect(fuzzyScore("sce", "ec2 container service")).not.toBeNull();
    expect(fuzzyScore("zzz", "export")).toBeNull();
    expect(fuzzyScore("xe", "ex")).toBeNull();
  });

  it("ranks prefix and word-start matches above mid-word ones", () => {
    const prefix = fuzzyScore("sav", "Save drawing")!;
    const word = fuzzyScore("sav", "Auto save")!;
    const mid = fuzzyScore("sav", "Passaving")!;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(mid);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("PDF", "export pdf")).not.toBeNull();
  });
});

describe("fuzzyRank", () => {
  const items = ["Save", "Save as…", "Export as PDF", "New drawing", "Open…"];
  it("returns the first items for an empty query", () => {
    expect(fuzzyRank(items, "", (s) => s, 2)).toEqual(["Save", "Save as…"]);
  });
  it("filters and orders by score", () => {
    expect(fuzzyRank(items, "sav", (s) => s)).toEqual(["Save", "Save as…"]);
    expect(fuzzyRank(items, "pdf", (s) => s)).toEqual(["Export as PDF"]);
    expect(fuzzyRank(items, "nothing-matches", (s) => s)).toEqual([]);
  });
  it("respects the limit", () => {
    expect(fuzzyRank(items, "a", (s) => s, 1)).toHaveLength(1);
  });
});
