import { describe, expect, it } from "vitest";
import { boxesOverlap, facingSide, growToContain, OPPOSITE_SIDE, pickAnchor, pickPrimary, quickConnectBox, QUICK_COPY_GAP, QUICK_COPY_MARGIN, QUICK_GAP, unionBox } from "../shared/quickConnect";

const src = { x: 100, y: 100, width: 160, height: 80 };
const size = { width: 160, height: 80 };

describe("quickConnectBox", () => {
  it("puts the node beside the source on each side, centred and a gap away", () => {
    expect(quickConnectBox({ source: src, side: "right", size, obstacles: [] })).toEqual({ x: 260 + QUICK_GAP, y: 100, width: 160, height: 80 });
    expect(quickConnectBox({ source: src, side: "left", size, obstacles: [] })).toEqual({ x: 100 - QUICK_GAP - 160, y: 100, width: 160, height: 80 });
    expect(quickConnectBox({ source: src, side: "bottom", size, obstacles: [] })).toEqual({ x: 100, y: 180 + QUICK_GAP, width: 160, height: 80 });
    expect(quickConnectBox({ source: src, side: "top", size, obstacles: [] })).toEqual({ x: 100, y: 100 - QUICK_GAP - 80, width: 160, height: 80 });
  });

  it("centres a node of another size on the source", () => {
    const b = quickConnectBox({ source: src, side: "right", size: { width: 72, height: 100 }, obstacles: [], gap: 50 });
    expect(b.x).toBe(310);
    expect(b.y + b.height / 2).toBe(140);
  });

  it("ignores elements that are out of the way", () => {
    const far = { x: 2000, y: 2000, width: 50, height: 50 };
    expect(quickConnectBox({ source: src, side: "right", size, obstacles: [far, src] })).toEqual({ x: 340, y: 100, width: 160, height: 80 });
  });

  it("slides along the side when the spot is taken, nearest free spot first (down before up)", () => {
    const blocker = { x: 340, y: 100, width: 160, height: 80 };
    const b = quickConnectBox({ source: src, side: "right", size, obstacles: [src, blocker] });
    expect(b.x).toBe(340);
    expect(b.y).toBeGreaterThan(100);
    expect(boxesOverlap(b, blocker, 20)).toBe(false);
    // Blocked below too: goes up.
    const below = { x: 340, y: 180, width: 160, height: 400 };
    const up = quickConnectBox({ source: src, side: "right", size, obstacles: [src, blocker, below] });
    expect(up.x).toBe(340);
    expect(up.y).toBeLessThan(100);
    expect([blocker, below].some((o) => boxesOverlap(up, o, 20))).toBe(false);
  });

  it("pushes further out when the whole side is blocked nearby", () => {
    // A wall right of the source, much taller than the search slides.
    const wall = { x: 330, y: -5000, width: 40, height: 10000 };
    const b = quickConnectBox({ source: src, side: "right", size, obstacles: [src, wall] });
    expect(b.x).toBeGreaterThanOrEqual(370 + 20);
    expect(boxesOverlap(b, wall, 20)).toBe(false);
  });

  it("works vertically too", () => {
    const blocker = { x: 100, y: 260, width: 160, height: 80 };
    const b = quickConnectBox({ source: src, side: "bottom", size, obstacles: [src, blocker] });
    expect(b.y).toBe(260);
    expect(b.x).toBeGreaterThan(100);
    expect(boxesOverlap(b, blocker, 20)).toBe(false);
  });

  it("falls back to the centred spot when nothing nearby is free", () => {
    const everything = { x: -1e5, y: -1e5, width: 2e5, height: 2e5 };
    expect(quickConnectBox({ source: src, side: "left", size, obstacles: [everything] })).toEqual({ x: -140, y: 100, width: 160, height: 80 });
  });
});

describe("quickConnectBox: inside a container", () => {
  // A big shape with a small icon in its top-left corner (the user's case).
  const container = { x: 0, y: 0, width: 400, height: 260 };
  const icon = { x: 30, y: 30, width: 64, height: 64 };
  const node = { width: 64, height: 64 };
  const inside = (b: { x: number; y: number; width: number; height: number }) => b.x >= 0 && b.y >= 0 && b.x + b.width <= 400 && b.y + b.height <= 260;

  it("stays inside the container when there is room, on every side that has room", () => {
    for (const side of ["right", "bottom"] as const) {
      const b = quickConnectBox({ source: icon, side, size: node, obstacles: [], within: container });
      expect(inside(b)).toBe(true);
    }
  });

  it("uses a smaller gap rather than leaving the container", () => {
    // Below the icon there are 260 - 94 = 166px: a 64px node fits with the normal gap (80) only if the margin allows; force a tight container.
    const tight = { x: 0, y: 0, width: 400, height: 200 };
    const b = quickConnectBox({ source: icon, side: "bottom", size: node, obstacles: [], within: tight });
    expect(b.y).toBeGreaterThanOrEqual(94 + 30);
    expect(b.y + b.height).toBeLessThanOrEqual(200 - 8);
  });

  it("falls back to placing it outside when the container has no room", () => {
    const small = { x: 0, y: 0, width: 130, height: 130 };
    const b = quickConnectBox({ source: icon, side: "bottom", size: node, obstacles: [], within: small });
    expect(b.y).toBe(94 + QUICK_GAP); // the usual spot, below the container
    expect(b.y + b.height).toBeGreaterThan(130);
  });

  it("still avoids other things inside the container", () => {
    const sibling = { x: 30, y: 174, width: 64, height: 64 }; // where the bottom node would go
    const b = quickConnectBox({ source: icon, side: "bottom", size: node, obstacles: [sibling], within: container });
    expect(boxesOverlap(b, sibling, 20)).toBe(false);
    expect(inside(b)).toBe(true);
  });

  it("puts a plain copy close beside the source (tight gap and margin)", () => {
    const b = quickConnectBox({ source: icon, side: "right", size: node, obstacles: [icon], gap: QUICK_COPY_GAP, margin: QUICK_COPY_MARGIN, minGap: 12, within: container });
    expect(b.x).toBe(94 + QUICK_COPY_GAP);
    expect(b.y).toBe(30);
  });

  it("does not squeeze a connected node closer than 30px", () => {
    const narrow = { x: 0, y: 0, width: 400, height: 140 }; // 46px below the icon: only gaps under 30 would fit
    const b = quickConnectBox({ source: icon, side: "bottom", size: { width: 64, height: 20 }, obstacles: [], within: narrow });
    expect(b.y - 94).toBeGreaterThanOrEqual(30);
  });

  it("behaves as before without a container", () => {
    expect(quickConnectBox({ source: src, side: "right", size, obstacles: [] })).toEqual({ x: 340, y: 100, width: 160, height: 80 });
  });
});

describe("boxesOverlap", () => {
  it("respects the margin", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(boxesOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(boxesOverlap(a, { x: 15, y: 0, width: 10, height: 10 }, 10)).toBe(true);
    expect(boxesOverlap(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });
});

describe("growToContain", () => {
  const zone = { x: 0, y: 0, width: 300, height: 200 };
  const pad = { top: 40, right: 20, bottom: 20, left: 20 };
  it("returns null when the box already fits", () => {
    expect(growToContain(zone, { x: 50, y: 50, width: 100, height: 50 }, pad)).toBeNull();
  });
  it("grows to the right and bottom", () => {
    expect(growToContain(zone, { x: 250, y: 150, width: 100, height: 100 }, pad)).toEqual({ x: 0, y: 0, width: 370, height: 270 });
  });
  it("grows to the left and top, keeping the far edges", () => {
    expect(growToContain(zone, { x: -50, y: 10, width: 60, height: 60 }, pad)).toEqual({ x: -70, y: -30, width: 370, height: 230 });
  });
});

describe("units: pickPrimary / pickAnchor", () => {
  const shape = { id: "s", type: "rectangle", x: 0, y: 0, width: 160, height: 80 };
  const image = { id: "img", type: "image", x: 0, y: 0, width: 64, height: 64 };
  const caption = { id: "cap", type: "text", x: -10, y: 70, width: 84, height: 18 };
  const label = { id: "lbl", type: "text", x: 20, y: 30, width: 60, height: 18, containerId: "s" };

  it("takes the biggest shape or image as the main element", () => {
    expect(pickPrimary([label, shape])?.id).toBe("s");
    expect(pickPrimary([caption, image])?.id).toBe("img");
    expect(pickPrimary([image, shape])?.id).toBe("s");
  });

  it("falls back to a free text, never to text inside a shape", () => {
    expect(pickPrimary([caption])?.id).toBe("cap");
    expect(pickPrimary([label])).toBeNull();
    expect(pickPrimary([])).toBeNull();
  });

  it("binds a stencil's caption on the bottom side and the image on the others", () => {
    const stencil = [image, caption];
    expect(pickAnchor(stencil, "bottom")?.id).toBe("cap");
    for (const side of ["top", "left", "right"] as const) expect(pickAnchor(stencil, side)?.id).toBe("img");
  });

  it("uses the shape for every side when its label is inside it", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) expect(pickAnchor([shape, label], side)?.id).toBe("s");
  });

  it("ignores text that is not below the main element", () => {
    const above = { id: "above", type: "text", x: 0, y: -30, width: 60, height: 18 };
    expect(pickAnchor([image, above], "bottom")?.id).toBe("img");
  });

  it("anchors a group of shapes on the member on the clicked side", () => {
    const left = { id: "l", type: "rectangle", x: 0, y: 0, width: 120, height: 60 };
    const right = { id: "r", type: "rectangle", x: 140, y: 0, width: 120, height: 60 };
    const lower = { id: "d", type: "rectangle", x: 0, y: 100, width: 120, height: 60 };
    const g = [left, right];
    expect(pickAnchor(g, "right")?.id).toBe("r");
    expect(pickAnchor(g, "left")?.id).toBe("l");
    expect(pickAnchor([left, lower], "bottom")?.id).toBe("d");
    expect(pickAnchor([left, lower], "top")?.id).toBe("l");
  });

  it("breaks ties by closeness to the middle of the side", () => {
    const a = { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 40 };
    const b = { id: "b", type: "rectangle", x: 0, y: 50, width: 100, height: 40 };
    const c = { id: "c", type: "rectangle", x: 0, y: 100, width: 100, height: 40 };
    expect(pickAnchor([a, b, c], "right")?.id).toBe("b");
  });

  it("flips sides", () => {
    expect(OPPOSITE_SIDE).toEqual({ top: "bottom", right: "left", bottom: "top", left: "right" });
  });
});

describe("facingSide", () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };
  it("names the side of the target that looks at the source", () => {
    expect(facingSide(a, { x: 300, y: 0, width: 100, height: 50 })).toBe("left");
    expect(facingSide(a, { x: -300, y: 20, width: 100, height: 50 })).toBe("right");
    expect(facingSide(a, { x: 10, y: 300, width: 100, height: 50 })).toBe("top");
    expect(facingSide(a, { x: 10, y: -300, width: 100, height: 50 })).toBe("bottom");
  });
});

describe("unionBox", () => {
  it("is the box around all boxes", () => {
    expect(unionBox([{ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 10, height: 10 }])).toEqual({ x: 0, y: -5, width: 30, height: 15 });
    expect(unionBox([])).toBeNull();
  });
});
