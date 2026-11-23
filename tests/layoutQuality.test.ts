import { describe, expect, it } from "vitest";
import { layoutGraph } from "../shared/layout";
import { layoutBest, qualitySummary, translateRoutes, VARIANTS } from "../shared/layoutBest";
import { qualityOfLayout, routesOf } from "../shared/layoutPipeline";
import { aws, homelab } from "./fixtures/diagrams";

// The two diagrams that looked sloppy: ELK's own layout had arrows on top of each other, labels under
// arrows and nodes. layoutBest must beat the plain layout by a wide margin (numbers recorded when the
// quality pass was built: homelab 1257 -> 447, aws 3286 -> 958).
describe("layout quality: the big diagrams", () => {
  for (const [name, make, maxScore] of [["homelab", homelab, 520], ["aws", aws, 1100]] as const) {
    it(`${name}: far cleaner than the plain layout, within the time budget`, async () => {
      const input = make();
      const plain = qualityOfLayout(await layoutGraph(input), input);
      const t0 = Date.now();
      const best = await layoutBest(input);
      const ms = Date.now() - t0;

      expect(best.quality.score).toBeLessThan(plain.score * 0.6);
      expect(best.quality.score).toBeLessThan(maxScore);
      // never worse than the plain layout, whatever variant won
      expect(best.quality.score).toBeLessThanOrEqual(Math.min(...best.tried.map((t) => t.score)) + 1e-9);
      expect(best.quality.metrics.labelCollision).toBeLessThanOrEqual(1);
      expect(best.quality.metrics.throughNode).toBe(0);
      expect(best.quality.metrics.edgeOverlap).toBeLessThanOrEqual(2);
      expect(plain.metrics.labelCollision).toBeGreaterThanOrEqual(5);
      expect(ms).toBeLessThan(4000);
      expect(best.routes).toHaveLength(input.edges!.length);
    }, 60000);
  }

  it("homelab: the report gives advice about the crowded node", async () => {
    const best = await layoutBest(homelab());
    expect(best.quality.advice.join(" ")).toMatch(/"npm" has \d+ arrows/);
    const s = qualitySummary(best);
    expect(s).toMatchObject({ labelsColliding: 0, arrowsThroughNodes: 0 });
    expect(typeof s.score).toBe("number");
  });

  it("is deterministic", async () => {
    const a = await layoutBest(homelab());
    const b = await layoutBest(homelab());
    expect(a.variant).toBe(b.variant);
    expect(a.quality.score).toBe(b.quality.score);
    expect(a.routes.map((r) => r.points)).toEqual(b.routes.map((r) => r.points));
  });

  it("small graphs try two variants at most, and a clean one stops early", async () => {
    const input = { nodes: [{ id: "a", width: 100, height: 60 }, { id: "b", width: 100, height: 60 }], edges: [{ id: "e1", from: "a", to: "b" }] };
    const best = await layoutBest(input);
    expect(best.tried.length).toBe(1);
    expect(best.variant).toBe("base");
  });

  it("respects the time budget (always keeps the first result)", async () => {
    let t = 0;
    const best = await layoutBest(homelab(), { budgetMs: 10, now: () => (t += 50) });
    expect(best.tried.length).toBe(1);
    expect(best.layout.nodes.size).toBeGreaterThan(30);
  });

  it("tries the other direction only when the direction is left open", async () => {
    const open = await layoutBest({ ...homelab(), direction: undefined }, { maxVariants: VARIANTS.length });
    expect(open.tried.map((t) => t.name)).toContain("other-direction");
    const fixed = await layoutBest(homelab());
    expect(fixed.tried.map((t) => t.name)).not.toContain("other-direction");
  });

  it("non-layered algorithms are laid out once, with straight routes", async () => {
    const best = await layoutBest({ ...homelab(), algorithm: "force" });
    expect(best.tried).toHaveLength(1);
    expect(best.layout.orthogonal).toBe(false);
  });

  it("translating the routes follows the layout", async () => {
    const input = homelab();
    const plainRoutes = routesOf(await layoutGraph(input), input);
    const moved = translateRoutes(plainRoutes, 100, -50);
    expect(moved[0].points[0]).toEqual({ x: plainRoutes[0].points[0].x + 100, y: plainRoutes[0].points[0].y - 50 });
    const labelled = plainRoutes.findIndex((r) => r.label);
    expect(moved[labelled].label?.width).toBe(plainRoutes[labelled].label?.width);
  });
});
