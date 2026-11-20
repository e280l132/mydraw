import { describe, expect, it } from "vitest";
import { ensureExtension, safeFileName, titleFromPath } from "../shared/names";
import { DEFAULT_SETTINGS, MAX_RECENT, addRecent, mergeSettings } from "../shared/settings";

describe("mergeSettings", () => {
  it("returns defaults for missing or invalid input", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, "nope")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values and drops invalid ones", () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      theme: "dark",
      drawingStyle: "neon",
      autosave: "yes",
      recentFiles: ["/a.excalidraw", 42, "/b.excalidraw"],
      extra: true,
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, theme: "dark", recentFiles: ["/a.excalidraw", "/b.excalidraw"] });
  });

  it("does not mutate the base", () => {
    const base = { ...DEFAULT_SETTINGS, recentFiles: ["/x"] };
    mergeSettings(base, { recentFiles: [] });
    expect(base.recentFiles).toEqual(["/x"]);
  });

  it("caps the recent list", () => {
    const many = Array.from({ length: 30 }, (_, i) => `/f${i}`);
    expect(mergeSettings(DEFAULT_SETTINGS, { recentFiles: many }).recentFiles).toHaveLength(MAX_RECENT);
  });
});

describe("addRecent", () => {
  it("moves an existing path to the front without duplicates", () => {
    expect(addRecent(["/a", "/b", "/c"], "/c")).toEqual(["/c", "/a", "/b"]);
  });
  it("caps the length", () => {
    expect(addRecent(["/a", "/b", "/c"], "/d", 3)).toEqual(["/d", "/a", "/b"]);
  });
});

describe("names", () => {
  it("derives titles from paths", () => {
    expect(titleFromPath("/Users/x/Home Network.excalidraw")).toBe("Home Network");
    expect(titleFromPath("C:\\dia\\aws.excalidraw.json")).toBe("aws");
  });
  it("makes safe file names", () => {
    expect(safeFileName('a/b:c*"d"')).toBe("a-b-c--d-");
    expect(safeFileName("   ")).toBe("drawing");
  });
  it("adds an extension only when missing", () => {
    expect(ensureExtension("/x/net", "excalidraw")).toBe("/x/net.excalidraw");
    expect(ensureExtension("/x/net.EXCALIDRAW", "excalidraw")).toBe("/x/net.EXCALIDRAW");
  });
});
