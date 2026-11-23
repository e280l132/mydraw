// Picks the cleanest of a few layouts of the same graph (tests/layoutQuality.test.ts).
//
// ELK lays a graph out once with one set of options; the result can have arrows on top of each other,
// labels on arrows, a very wide shape. Here the graph is laid out with a few option sets, each result
// goes through the same steps that draw it (route tidying, overlap separation, label placement), is
// scored (shared/diagramQuality.ts) and the lowest score wins. Deterministic: fixed variant order.
import { QUALITY_WEIGHTS, type QRoute, type QualityReport } from "./diagramQuality";
import { layoutGraph, type LayoutInput, type LayoutResult } from "./layout";
import { qualityOfLayout, tidiedRoutes } from "./layoutPipeline";

export interface LayoutVariant {
  name: string;
  /** ELK options on top of the defaults. */
  elk: Record<string, string>;
  /** Space between nodes, relative to the requested one. */
  spacingFactor?: number;
  /** Try this direction instead (only when the caller left the direction open). */
  direction?: LayoutInput["direction"];
}

/** In the order they are tried. The first is the plain layout. */
export const VARIANTS: readonly LayoutVariant[] = [
  { name: "base", elk: {} },
  { name: "wide-tracks", elk: { "elk.spacing.edgeEdge": "24", "elk.layered.spacing.edgeEdgeBetweenLayers": "20" } },
  {
    name: "balanced",
    elk: {
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.nodePlacement.bk.fixedAlignment": "BALANCED",
      "elk.layered.thoroughness": "40",
      "elk.spacing.edgeEdge": "22",
    },
  },
  { name: "roomy", elk: { "elk.spacing.edgeEdge": "22" }, spacingFactor: 1.3 },
  { name: "linear", elk: { "elk.layered.nodePlacement.strategy": "LINEAR_SEGMENTS", "elk.layered.thoroughness": "30", "elk.spacing.edgeEdge": "22" } },
  { name: "other-direction", elk: { "elk.layered.thoroughness": "30", "elk.spacing.edgeEdge": "22" }, direction: "down" },
];

export interface LayoutBestOptions {
  /** Stop trying variants after this many ms (default 4000). */
  budgetMs?: number;
  /** Most variants to try (default 6; small graphs try 2). */
  maxVariants?: number;
  now?: () => number;
}

export interface LayoutBestResult {
  layout: LayoutResult;
  /** The routes to draw (tidied), labels carrying where they go. */
  routes: QRoute[];
  quality: QualityReport;
  /** The variant that won, and every one tried. */
  variant: string;
  tried: { name: string; score: number; ms: number }[];
}

const SMALL_GRAPH = 12;

export async function layoutBest(input: LayoutInput, opts: LayoutBestOptions = {}): Promise<LayoutBestResult> {
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? 4000;
  const algorithm = input.algorithm ?? "layered";
  const small = input.nodes.length <= SMALL_GRAPH;
  const max = Math.min(opts.maxVariants ?? VARIANTS.length, small ? 2 : VARIANTS.length);
  const directionOpen = input.direction === undefined;
  const start = now();

  let best: LayoutBestResult | null = null;
  const tried: LayoutBestResult["tried"] = [];
  const variants = algorithm === "layered" ? VARIANTS.filter((v) => !v.direction || directionOpen).slice(0, max) : VARIANTS.slice(0, 1);
  for (const v of variants) {
    if (best && now() - start > budget) break;
    const t0 = now();
    const variantInput: LayoutInput = {
      ...input,
      direction: v.direction ?? input.direction,
      spacing: input.spacing !== undefined && v.spacingFactor ? Math.round(input.spacing * v.spacingFactor) : v.spacingFactor ? Math.round(60 * v.spacingFactor) : input.spacing,
      elkOptions: { ...input.elkOptions, ...v.elk },
    };
    const layout = await layoutGraph(variantInput);
    const routes = tidiedRoutes(layout, variantInput);
    const quality = qualityOfLayout(layout, variantInput, routes);
    tried.push({ name: v.name, score: quality.score, ms: now() - t0 });
    if (!best || quality.score < best.quality.score - 1e-9) best = { layout, routes, quality, variant: v.name, tried };
    // Nothing left to improve: no problems and a sensible shape.
    const m = quality.metrics;
    if (m.edgeOverlap + m.throughNode + m.labelCollision === 0 && (m.nodes < QUALITY_WEIGHTS.aspectMinNodes || m.aspect <= QUALITY_WEIGHTS.aspectFree) && (small || m.crossings === 0)) break;
  }
  return best!;
}

/** What `build_diagram` and `auto_layout` report about the layout they chose. */
export function qualitySummary(best: Pick<LayoutBestResult, "quality" | "variant">): Record<string, unknown> {
  const m = best.quality.metrics;
  return {
    score: best.quality.score,
    layout: best.variant,
    arrowsOnTopOfEachOther: m.edgeOverlap,
    arrowsThroughNodes: m.throughNode,
    labelsColliding: m.labelCollision,
    crossings: m.crossings,
    aspect: m.aspect,
    ...(best.quality.advice.length ? { advice: best.quality.advice } : {}),
  };
}

/** Move routes (and their label centres) by the same offset `translateLayout` applied to the layout. */
export function translateRoutes(routes: readonly QRoute[], dx: number, dy: number): QRoute[] {
  const mv = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  return routes.map((r) => ({ ...r, points: r.points.map(mv), label: r.label ? { ...r.label, center: r.label.center ? mv(r.label.center) : undefined } : undefined }));
}
