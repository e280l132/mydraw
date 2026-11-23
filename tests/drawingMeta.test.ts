import { describe, expect, it } from "vitest";
import {
  PALETTE_MAX,
  addToPalette,
  emptyMeta,
  historyIdFromContent,
  normalizeMeta,
  normalizePalette,
  readMeta,
  withMeta,
} from "../shared/drawingMeta";

const FILE = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} }, null, 2);

describe("palette", () => {
  it("keeps valid hex colors, lower-cased, without duplicates", () => {
    expect(normalizePalette(["#FF0000", "#ff0000", "red", 3, " #00ff00 "])).toEqual(["#ff0000", "#00ff00"]);
    expect(normalizePalette("nope")).toEqual([]);
  });
  it("adds the newest color first and caps the length", () => {
    expect(addToPalette(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    const many = Array.from({ length: PALETTE_MAX + 3 }, (_, i) => `#${String(i).padStart(6, "0")}`);
    expect(addToPalette(many.slice(0, PALETTE_MAX), "#abcdef")).toHaveLength(PALETTE_MAX);
    expect(addToPalette(["#111111"], "blue")).toEqual(["#111111"]);
  });
});

describe("meta in a file", () => {
  it("round-trips id and palette and leaves the rest of the file alone", () => {
    const meta = { id: "0a1b2c3d-1111-2222-3333-444455556666", palette: ["#112233"] };
    const text = withMeta(FILE, meta);
    const parsed = JSON.parse(text);
    expect(parsed.type).toBe("excalidraw");
    expect(parsed.elements).toEqual([]);
    expect(readMeta(text)).toEqual(meta);
    expect(historyIdFromContent(text)).toBe(meta.id);
  });
  it("replaces an existing block instead of adding a second", () => {
    const first = withMeta(FILE, { id: "aaaaaaaa-0000", palette: ["#111111"] });
    const second = withMeta(first, { id: "aaaaaaaa-0000", palette: ["#222222", "#111111"] });
    expect(second.match(/"mydraw"/g)).toHaveLength(1);
    expect(readMeta(second).palette).toEqual(["#222222", "#111111"]);
  });
  it("finds the id in the tail of a big file", () => {
    const big = JSON.stringify({ elements: "x".repeat(100000) }, null, 2);
    const text = withMeta(big, { id: "bbbbbbbb-1234", palette: [] });
    expect(historyIdFromContent(text)).toBe("bbbbbbbb-1234");
  });
  it("gives a file without meta (or with a bad id) a fresh id and no palette", () => {
    expect(readMeta(FILE).palette).toEqual([]);
    expect(readMeta(FILE).id).toMatch(/^[0-9a-f-]{8,64}$/);
    expect(historyIdFromContent(FILE)).toBeNull();
    expect(normalizeMeta({ id: "../../etc", palette: ["#ffffff"] }).id).not.toContain("..");
    expect(readMeta("not json").palette).toEqual([]);
    expect(emptyMeta().id).not.toBe(emptyMeta().id);
  });
  it("never reads an id that could escape the history folder", () => {
    const evil = withMeta(FILE, { id: "x", palette: [] }).replace('"id":"x"', '"id":"../../x"');
    expect(historyIdFromContent(evil)).toBeNull();
  });
});
