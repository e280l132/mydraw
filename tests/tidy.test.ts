import { describe, expect, it } from "vitest";
import { byReadingOrder, inferDirection, nodeOverlaps, tidyLayout } from "../shared/tidy";

const b = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

describe("tidyLayout", () => {
  it("lines up a ragged row on its median centre", () => {
    const r = tidyLayout([{ id: "a", box: b(0, 0) }, { id: "b", box: b(200, 8) }, { id: "c", box: b(400, -5) }], []);
    expect(r.stats.rows).toBe(1);
    expect(r.moves.get("a")).toBeUndefined();
    expect(r.moves.get("b")).toEqual({ dx: 0, dy: -8 });
    expect(r.moves.get("c")).toEqual({ dx: 0, dy: 5 });
  });

  it("evens nearly even gaps, keeping the ends", () => {
    const r = tidyLayout([{ id: "a", box: b(0, 0) }, { id: "b", box: b(130, 0) }, { id: "c", box: b(300, 0) }], []);
    expect(r.stats.evened).toBe(1);
    expect(r.moves.get("b")).toEqual({ dx: 20, dy: 0 });
    expect(r.moves.has("a") || r.moves.has("c")).toBe(false);
  });

  it("leaves very uneven gaps alone (likely on purpose)", () => {
    const r = tidyLayout([{ id: "a", box: b(0, 0) }, { id: "b", box: b(120, 0) }, { id: "c", box: b(600, 0) }], []);
    expect(r.stats.evened).toBe(0);
    expect(r.moves.size).toBe(0);
  });

  it("pushes overlapping items apart with a gap", () => {
    const r = tidyLayout([{ id: "a", box: b(0, 0) }, { id: "b", box: b(60, 200) }, { id: "c", box: b(70, 30) }], [], { minGap: 20 });
    expect(r.stats.overlaps).toBeGreaterThan(0);
    const c = r.moves.get("c")!;
    const boxes = [b(0, 0), b(60 + (r.moves.get("b")?.dx ?? 0), 200 + (r.moves.get("b")?.dy ?? 0)), b(70 + c.dx, 30 + c.dy)];
    expect(nodeOverlaps(boxes, 0)).toBe(0);
  });

  it("does nothing to a tidy drawing", () => {
    const r = tidyLayout([{ id: "a", box: b(0, 0) }, { id: "b", box: b(200, 0) }, { id: "c", box: b(0, 200) }, { id: "d", box: b(200, 200) }], []);
    expect(r.moves.size).toBe(0);
    expect(r.zones.size).toBe(0);
  });

  it("tidies inside zones, grows the zone, and moves a zone with its contents", () => {
    const r = tidyLayout(
      [
        { id: "a", box: b(20, 50), zone: "z" },
        { id: "b", box: b(160, 70), zone: "z" },
        { id: "x", box: b(250, 400) },
        { id: "y", box: b(50, 405) },
      ],
      [{ id: "z", box: b(0, 0, 240, 150), titleRoom: 40 }],
      { zonePad: 20 },
    );
    expect(r.moves.get("b")!.dy).toBe(-10);
    const z = r.zones.get("z")!;
    expect(z.x + z.width).toBeGreaterThanOrEqual(160 + 100 + 20);
    expect(r.moves.get("y")!.dy).toBeCloseTo(-2.5);
  });
});

describe("inferDirection", () => {
  const boxes = new Map([["a", b(0, 0)], ["b", b(300, 20)], ["c", b(600, -10)], ["d", b(0, 300)]]);
  it("reads a left-to-right flow", () => {
    expect(inferDirection(boxes, [{ from: "a", to: "b" }, { from: "b", to: "c" }])).toBe("right");
  });
  it("reads a top-down flow", () => {
    expect(inferDirection(boxes, [{ from: "a", to: "d" }])).toBe("down");
  });
  it("is unsure about mixed or missing arrows", () => {
    expect(inferDirection(boxes, [{ from: "a", to: "b" }, { from: "b", to: "a" }])).toBeUndefined();
    expect(inferDirection(boxes, [])).toBeUndefined();
  });
});

describe("byReadingOrder", () => {
  it("sorts columns left to right, top to bottom within a column", () => {
    const items = [{ id: "c", box: b(300, 0) }, { id: "b", box: b(0, 200) }, { id: "a", box: b(10, 0) }];
    expect(byReadingOrder(items, "right").map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(byReadingOrder(items, "down").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
});
