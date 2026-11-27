// Diagram-lint rules about how clean the arrows are (arrows on top of each other, through nodes,
// labels in the way, crowded nodes, very long arrows). Pure: reads loose element JSON, uses the same
// measurements as the layout search (shared/diagramQuality.ts) and the label placement of
// shared/edgeTidy.ts. Called by shared/lint.ts; tests/lint.test.ts.
import { measureQuality, segLength, segmentsOf, type QNode, type QRoute, type QZone, type QualityInput } from "./diagramQuality";
import { placeLabels } from "./edgeTidy";

/** The element fields this reads (a subset of lint's LintEl). */
export interface QEl {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  isDeleted?: boolean;
  containerId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  customData?: Record<string, unknown> | null;
  points?: readonly (readonly [number, number])[];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
}

export type QualityLintRule = "edge-overlap" | "label-collision" | "edge-through-node" | "crowded-node" | "long-edge";

export type QualityLintFix =
  /** Move the arrow's label so its centre is here. */
  | { kind: "label"; x: number; y: number }
  /** Re-route the arrow around the shapes in its way. */
  | { kind: "reroute" };

export interface QualityLintIssue {
  rule: QualityLintRule;
  /** The arrow (or crowded node) with the problem. */
  id: string;
  message: string;
  other?: string;
  fix?: QualityLintFix;
}

const CROWDED = 7;
/** Arrows longer than this share of the diagram's longest side are "very long". */
const LONG_SHARE = 0.6;
/** ... but only in diagrams at least this big (a short diagram has no long arrows). */
const LONG_MIN_SPAN = 800;

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

/** The scene as the quality code reads it. */
export function qualityInputOf(elements: readonly QEl[]): QualityInput & { arrows: Map<string, QEl> } {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  // Legend rows and step badges (which sit on their own arrow, shared/stepBadges.ts) are not nodes.
  const isLegend = (e: QEl) => !!e.customData?.mydrawLegend || !!e.customData?.mydrawStep || !!e.customData?.mydrawSteps;
  const isZone = (e: QEl) => !!e.customData?.mydrawZone;
  const box = (e: QEl) => ({ x: e.x ?? 0, y: e.y ?? 0, width: Math.abs(e.width ?? 0), height: Math.abs(e.height ?? 0) });

  const nodes = new Map<string, QNode>();
  const zones = new Map<string, QZone>();
  for (const e of live) {
    if (isLegend(e)) continue;
    if (isZone(e)) {
      const title = live.find((t) => t.type === "text" && t.customData?.mydrawZoneTitle === e.id);
      const parent = e.customData?.mydrawZoneId as string | undefined;
      zones.set(e.id, { ...box(e), parent, titleWidth: 14 + (title?.width ?? 0), titleHeight: 14 + (title?.height ?? 0) });
    } else if (e.customData?.mydrawNode === "icon" || SHAPES.has(e.type)) {
      nodes.set(e.id, { ...box(e), zone: e.customData?.mydrawZoneId as string | undefined });
    }
  }

  const arrows = new Map<string, QEl>();
  const routes: QRoute[] = [];
  for (const a of live) {
    if (a.type !== "arrow" || isLegend(a) || !a.points || a.points.length < 2) continue;
    const ref = a.boundElements?.find((b) => b.type === "text");
    const t = ref ? byId.get(ref.id) : undefined;
    routes.push({
      id: a.id,
      from: a.startBinding?.elementId ?? "",
      to: a.endBinding?.elementId ?? "",
      points: a.points.map(([px, py]) => ({ x: (a.x ?? 0) + px, y: (a.y ?? 0) + py })),
      label: t ? { width: t.width ?? 0, height: t.height ?? 0, center: { x: (t.x ?? 0) + (t.width ?? 0) / 2, y: (t.y ?? 0) + (t.height ?? 0) / 2 } } : undefined,
    });
    arrows.set(a.id, a);
  }
  return { nodes, zones, routes, arrows };
}

export function qualityLint(elements: readonly QEl[], want: ReadonlySet<string>): QualityLintIssue[] {
  const rules: QualityLintRule[] = ["edge-overlap", "label-collision", "edge-through-node", "crowded-node", "long-edge"];
  if (!rules.some((r) => want.has(r))) return [];
  const input = qualityInputOf(elements);
  if (!input.routes.length) return [];
  const out: QualityLintIssue[] = [];
  const report = measureQuality(input);

  for (const i of report.issues) {
    if (i.kind === "edge-overlap" && want.has("edge-overlap")) {
      out.push({ rule: "edge-overlap", id: i.edge, other: i.other, message: `Runs on top of another arrow (${i.other})` });
    } else if (i.kind === "edge-through-node" && want.has("edge-through-node")) {
      out.push({ rule: "edge-through-node", id: i.edge, other: i.other, message: `Runs through a node it does not connect (${i.other})`, fix: { kind: "reroute" } });
    }
  }
  if (want.has("label-collision")) {
    const centers = placeLabels(input);
    for (const i of report.issues) {
      if (i.kind !== "label-collision") continue;
      const c = centers.get(i.edge);
      const now = input.routes.find((r) => r.id === i.edge)?.label?.center;
      const moved = c && now && Math.hypot(c.x - now.x, c.y - now.y) > 1;
      out.push({ rule: "label-collision", id: i.edge, other: i.other, message: `Label ${i.message.replace(/^label of "[^"]*" /, "")}`, ...(moved ? { fix: { kind: "label" as const, x: c.x, y: c.y } } : {}) });
    }
  }
  if (want.has("crowded-node")) {
    const degree = new Map<string, number>();
    for (const r of input.routes) for (const id of [r.from, r.to]) if (id) degree.set(id, (degree.get(id) ?? 0) + 1);
    for (const [id, n] of degree) {
      if (n >= CROWDED && (input.nodes.has(id) || input.zones.has(id))) out.push({ rule: "crowded-node", id, message: `${n} arrows meet here: use one arrow to a zone, drop labels, or split the diagram` });
    }
  }
  if (want.has("long-edge")) {
    const boxes = [...input.nodes.values(), ...input.zones.values()];
    if (boxes.length) {
      const span = Math.max(
        Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
        Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
      );
      if (span >= LONG_MIN_SPAN) {
        for (const r of input.routes) {
          const len = segmentsOf(r.points).reduce((n, s) => n + segLength(s), 0);
          if (len > span * LONG_SHARE) out.push({ rule: "long-edge", id: r.id, message: `Very long arrow (${Math.round(len)} px, ${Math.round((len / span) * 100)}% of the diagram)` });
        }
      }
    }
  }
  return out;
}
