import { describe, expect, it } from "vitest";
import { DEFAULT_GRID, applyDarkFilter, excalidrawGridState, normalizeGrid, planGrid, preDarkColor, snapOffset, snapValue, type GridSettings } from "../shared/grid";

const g = (patch: Partial<GridSettings> = {}): GridSettings => ({ ...DEFAULT_GRID, enabled: true, ...patch });
const view = (patch = {}) => ({ scrollX: 0, scrollY: 0, zoom: 1, width: 200, height: 100, ...patch });

describe("normalizeGrid", () => {
  it("keeps valid values and clamps numbers", () => {
    const n = normalizeGrid({ enabled: true, size: 3, majorEvery: 99, snap: false, opacity: 5, style: "dots", color: "#ABCDEF" });
    expect(n).toMatchObject({ enabled: true, snap: false, size: 4, majorEvery: 20, opacity: 1, style: "dots", color: "#abcdef" });
  });
  it("ignores junk and falls back to the base", () => {
    expect(normalizeGrid({ size: "x", color: "red", style: "zig", enabled: 1 })).toEqual(DEFAULT_GRID);
    expect(normalizeGrid(null)).toEqual(DEFAULT_GRID);
    expect(normalizeGrid({ size: NaN })).toEqual(DEFAULT_GRID);
  });
  it("accepts 3-digit hex", () => {
    expect(normalizeGrid({ color: "#f00" }).color).toBe("#ff0000");
  });
});

describe("planGrid", () => {
  it("places lines at scene multiples and marks majors", () => {
    const p = planGrid(view(), g({ size: 20, majorEvery: 5 }));
    expect(p.vertical.map((l) => l.at).slice(0, 3)).toEqual([0, 20, 40]);
    expect(p.vertical.filter((l) => l.major).map((l) => l.at)).toEqual([0, 100, 200]);
    expect(p.skip).toBe(1);
  });
  it("follows scroll and zoom", () => {
    // scene x=0 is at screen (0+50)*2 = 100
    const p = planGrid(view({ scrollX: 50, zoom: 2 }), g({ size: 20 }));
    expect(p.vertical.some((l) => l.at === 100 && l.major)).toBe(true);
    expect(p.vertical.some((l) => l.at === 140)).toBe(true);
  });
  it("covers the whole viewport", () => {
    const p = planGrid(view({ scrollX: -33 }), g({ size: 20 }));
    expect(p.vertical[0].at).toBeLessThanOrEqual(0);
    expect(p.vertical[p.vertical.length - 1].at).toBeGreaterThanOrEqual(200);
  });
  it("has no major lines when majorEvery is 0", () => {
    expect(planGrid(view(), g({ majorEvery: 0 })).vertical.some((l) => l.major)).toBe(false);
  });
  it("thins out when zoomed far out but keeps the majors", () => {
    const p = planGrid(view({ zoom: 0.1, width: 2000, height: 1000 }), g({ size: 20, majorEvery: 5 }));
    expect(p.skip).toBeGreaterThan(1);
    const steps = p.vertical.slice(1).map((l, i) => l.at - p.vertical[i].at);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(8 - 1e-9);
  });
  it("never produces an unbounded number of lines", () => {
    const p = planGrid(view({ zoom: 0.0001, width: 1e6, height: 1e6 }), g({ size: 4, majorEvery: 1 }));
    expect(p.vertical.length).toBeLessThanOrEqual(600);
  });
});

describe("snap", () => {
  it("rounds to the nearest line", () => {
    expect(snapValue(29, 20)).toBe(20);
    expect(snapValue(31, 20)).toBe(40);
    expect(snapValue(-31, 20)).toBe(-40);
  });
  it("gives the offset onto the grid", () => {
    expect(snapOffset({ x: 33, y: -7 }, 20)).toEqual({ dx: 7, dy: 7 });
    expect(snapOffset({ x: 40, y: 0 }, 20)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("size limit", () => {
  it("caps spacing at 100 (Excalidraw clamps gridSize to 1..100 on load)", () => {
    expect(normalizeGrid({ size: 400 }).size).toBe(100);
  });
});

describe("excalidrawGridState", () => {
  it("turns Excalidraw grid mode on only for a visible grid with snapping that works", () => {
    expect(excalidrawGridState(g({ snap: true }), true)).toEqual({ gridModeEnabled: true, gridSize: 20 });
    expect(excalidrawGridState(g({ snap: false }), true).gridModeEnabled).toBe(false);
    expect(excalidrawGridState(g({ enabled: false }), true).gridModeEnabled).toBe(false);
    expect(excalidrawGridState(g(), false).gridModeEnabled).toBe(false);
  });
});

describe("dark mode colour", () => {
  const dist = (a: string, b: string) =>
    Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16))));
  it("models the filter: white -> near black, black -> near white", () => {
    expect(dist(applyDarkFilter("#ffffff"), "#121212")).toBeLessThanOrEqual(1);
    expect(dist(applyDarkFilter("#000000"), "#ededed")).toBeLessThanOrEqual(1);
  });
  it("pre-compensates mid colours so they show as chosen", () => {
    for (const c of ["#7a8ba3", "#4f8cff", "#2fa84f", "#9b59d0", "#808080"]) {
      expect(dist(applyDarkFilter(preDarkColor(c)), c)).toBeLessThanOrEqual(3);
    }
    // Saturated warm colours are partly out of the filter's reach: close, not exact.
    for (const c of ["#e08a1e", "#d64545"]) expect(dist(applyDarkFilter(preDarkColor(c)), c)).toBeLessThanOrEqual(30);
  });
  it("gets as close as the filter allows for extremes", () => {
    expect(dist(applyDarkFilter(preDarkColor("#ffffff")), "#ededed")).toBeLessThanOrEqual(2);
  });
});
