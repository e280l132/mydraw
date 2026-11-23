// Diagram lint: finds common problems (overlapping nodes, arrows with a free end, unlabeled nodes,
// missing IP addresses, colors outside the palette) and proposes safe fixes. Pure: works on loose
// element JSON (no Excalidraw), unit-tested in tests/lint.test.ts. The panel (web/src/LintPanel.tsx)
// and the MCP tool `lint_diagram` both run it through web/src/lintOps.ts, which applies the fixes.
import { normalizeHex, hexToRgb } from "./colorMath";
import { tint, ZONE_PALETTE } from "./diagram";
import { inventoryField } from "./inventory";
import { qualityLint, type QEl } from "./lintQuality";
import { PALETTES, resolveColor } from "./palettes";
import { extractGraph, type SceneEl } from "./sceneGraph";
import { BUILTIN_PRESETS, BUILTIN_THEMES } from "./styles";

export const LINT_RULES = ["overlap", "unconnected-arrow", "unlabeled-node", "missing-ip", "off-palette-color", "edge-overlap", "label-collision", "edge-through-node", "crowded-node", "long-edge"] as const;
export type LintRule = (typeof LINT_RULES)[number];
export type LintSeverity = "warning" | "info";

export const LINT_SEVERITY: Record<LintRule, LintSeverity> = {
  overlap: "warning",
  "unconnected-arrow": "warning",
  "unlabeled-node": "info",
  "missing-ip": "info",
  "off-palette-color": "info",
  "edge-overlap": "warning",
  "label-collision": "warning",
  "edge-through-node": "warning",
  "crowded-node": "info",
  "long-edge": "info",
};

export type ArrowEnd = "start" | "end";

export type LintFix =
  /** Bind the free end(s) of an arrow to these nodes. */
  | { kind: "bind"; start?: string; end?: string }
  /** Set one color property to a palette color. */
  | { kind: "color"; property: "strokeColor" | "backgroundColor"; color: string; name: string }
  /** Move an arrow's label so its centre is at (x, y), a free stretch of its arrow. */
  | { kind: "label"; x: number; y: number }
  /** Re-route an arrow around the shapes in its way. */
  | { kind: "reroute" };

export interface LintIssue {
  rule: LintRule;
  severity: LintSeverity;
  /** The element with the problem. */
  id: string;
  /** Its label (or type), for display. */
  label: string;
  message: string;
  /** overlap: the other node. */
  other?: string;
  /** unconnected-arrow: the free ends. */
  ends?: ArrowEnd[];
  fix?: LintFix;
  /** Position (top-left) used for ordering. */
  x: number;
  y: number;
}

export interface LintResult {
  issues: LintIssue[];
  summary: Record<LintRule, number>;
}

export interface LintEl extends SceneEl {
  frameId?: string | null;
  groupIds?: readonly string[];
  points?: readonly (readonly [number, number])[];
}

export interface LintOptions {
  /** Only these rules (default: all). */
  rules?: readonly string[];
  /** More colors that count as on-palette (user themes and presets, the canvas color, ...). */
  allowedColors?: readonly string[];
}

/** Boxes must overlap by more than this (both ways) to count. */
export const OVERLAP_TOLERANCE = 4;
/** A free arrow end is attached by the fix only to a node at most this far away. */
export const BIND_DISTANCE = 40;

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const COLOR_SKIP = new Set(["image", "frame", "magicframe", "iframe", "embeddable", "selection"]);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (e: LintEl): Box => ({ x: e.x ?? 0, y: e.y ?? 0, width: Math.abs(e.width ?? 0), height: Math.abs(e.height ?? 0) });

function intersection(a: Box, b: Box): { w: number; h: number } {
  return {
    w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/** Distance from a point to a box (0 inside). */
function distanceTo(b: Box, px: number, py: number): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.width));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.height));
  return Math.hypot(dx, dy);
}

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39)}…` : s}”`;

// ---------- palette ----------

/** Palette colors (basic names first, so ties pick the friendlier name). */
const PALETTE_COLORS: Array<{ name: string; hex: string; rgb: [number, number, number] }> = PALETTES.flatMap((p) =>
  Object.entries(p.colors).map(([name, hex]) => ({ name, hex: hex.toLowerCase(), rgb: hexToRgb(hex) })),
);

/** Nearest palette color by RGB distance. */
export function nearestPaletteColor(hex: string): { name: string; color: string } {
  const [r, g, b] = hexToRgb(hex);
  let best = PALETTE_COLORS[0];
  let bestD = Infinity;
  for (const c of PALETTE_COLORS) {
    const d = (c.rgb[0] - r) ** 2 + (c.rgb[1] - g) ** 2 + (c.rgb[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return { name: best.name, color: best.hex };
}

function builtinAllowed(): Set<string> {
  const out = new Set<string>(["#ffffff", "#000000"]);
  for (const c of PALETTE_COLORS) out.add(c.hex);
  for (const t of BUILTIN_THEMES) for (const c of [t.ink, t.background]) out.add(c.toLowerCase());
  for (const p of BUILTIN_PRESETS) {
    for (const c of [p.style.strokeColor, p.style.backgroundColor]) {
      const r = c ? resolveColor(c) : null;
      if (r && r !== "transparent") out.add(r);
    }
  }
  for (const pair of ZONE_PALETTE) for (const c of pair) out.add(c.toLowerCase());
  return out;
}
let BUILTIN_ALLOWED: Set<string> | null = null;

/** A color as lowercase #rrggbb, "transparent", or null when it can't be read (left alone). */
function canonical(c: string | undefined | null): string | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  if (s === "transparent" || s === "none" || s === "") return "transparent";
  // #rrggbbaa: judge the color part.
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  return normalizeHex(s) ?? resolveColor(s);
}

// ---------- lint ----------

export function lintScene(elements: readonly LintEl[], opts: LintOptions = {}): LintResult {
  const want = new Set<string>(opts.rules?.length ? opts.rules : LINT_RULES);
  const on = (r: LintRule) => want.has(r);
  const live = elements.filter((e) => !e.isDeleted);
  const map = new Map(live.map((e) => [e.id, e]));
  const issues: LintIssue[] = [];

  const labelOf = (el: LintEl): string => {
    const ref = el.boundElements?.find((b) => b.type === "text");
    const t = ref ? map.get(ref.id) : undefined;
    return (t?.text ?? "").trim();
  };
  const isLegend = (e: LintEl) => !!e.customData?.mydrawLegend;
  const isZone = (e: LintEl) => !!e.customData?.mydrawZone;
  const isIcon = (e: LintEl) => e.customData?.mydrawNode === "icon";
  const stencilName = (e: LintEl) => (e.customData?.mydrawStencil as { name?: string } | undefined)?.name;

  // Nodes as the exporters see them: icon nodes + shapes with a label or user data.
  const graph = extractGraph(live);
  const graphNodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes = graph.nodes.map((n) => map.get(n.id)!).filter(Boolean);

  // Node-like elements: shapes and icon nodes that are not zones or legend (also unlabeled ones).
  const nodeLike = live.filter((e) => (isIcon(e) || SHAPES.has(e.type)) && !isZone(e) && !isLegend(e));

  // Free text labels a shape when its centre is inside the shape (hand-drawn diagrams do that).
  const freeTexts = live.filter((e) => e.type === "text" && !e.containerId && !e.customData?.mydrawZoneTitle && !isLegend(e) && (e.text ?? "").trim());
  const hasFreeLabel = (el: LintEl) => {
    const b = boxOf(el);
    return freeTexts.some((t) => {
      const tb = boxOf(t);
      const cx = tb.x + tb.width / 2;
      const cy = tb.y + tb.height / 2;
      return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
    });
  };

  const display = (el: LintEl): string => {
    if (el.type === "text") return (el.text ?? "").trim() || "text";
    const l = labelOf(el);
    if (l) return l;
    if (isIcon(el)) return stencilName(el) ?? "icon";
    return el.type;
  };

  const push = (rule: LintRule, el: LintEl, message: string, extra: Partial<LintIssue> = {}) =>
    issues.push({ rule, severity: LINT_SEVERITY[rule], id: el.id, label: display(el), message, x: el.x ?? 0, y: el.y ?? 0, ...extra });

  // 1. overlap
  if (on("overlap")) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        if ((a.frameId ?? null) !== (b.frameId ?? null)) continue;
        const ba = boxOf(a);
        const bb = boxOf(b);
        const { w, h } = intersection(ba, bb);
        if (w <= OVERLAP_TOLERANCE || h <= OVERLAP_TOLERANCE) continue;
        // A node drawn as a container around a much smaller one is deliberate; near-duplicates are not.
        const areaA = ba.width * ba.height;
        const areaB = bb.width * bb.height;
        if ((contains(ba, bb) && areaA >= 1.5 * areaB) || (contains(bb, ba) && areaB >= 1.5 * areaA)) continue;
        // Report on the one drawn later (on top): that is usually the one to move.
        const ia = live.indexOf(a);
        const ib = live.indexOf(b);
        const [top, under] = ib > ia ? [b, a] : [a, b];
        push("overlap", top, `Overlaps ${quote(display(under))}`, { other: under.id });
      }
    }
  }

  // 2. unconnected-arrow
  if (on("unconnected-arrow")) {
    for (const el of live) {
      if (el.type !== "arrow" || isLegend(el)) continue;
      const bound = (b: { elementId: string } | null | undefined) => !!b && map.has(b.elementId);
      const ends: ArrowEnd[] = [];
      if (!bound(el.startBinding)) ends.push("start");
      if (!bound(el.endBinding)) ends.push("end");
      if (!ends.length) continue;
      const pts = el.points?.length ? el.points : [[0, 0] as const];
      const pointOf = (end: ArrowEnd) => {
        const p = end === "start" ? pts[0] : pts[pts.length - 1];
        return { x: (el.x ?? 0) + p[0], y: (el.y ?? 0) + p[1] };
      };
      const taken = new Set<string>();
      if (el.startBinding && bound(el.startBinding)) taken.add(el.startBinding.elementId);
      if (el.endBinding && bound(el.endBinding)) taken.add(el.endBinding.elementId);
      const fix: { kind: "bind"; start?: string; end?: string } = { kind: "bind" };
      const targets: string[] = [];
      for (const end of ends) {
        const p = pointOf(end);
        let best: LintEl | undefined;
        let bestD = Infinity;
        for (const n of nodeLike) {
          if (taken.has(n.id)) continue;
          const d = distanceTo(boxOf(n), p.x, p.y);
          if (d <= BIND_DISTANCE && d < bestD) {
            best = n;
            bestD = d;
          }
        }
        if (best) {
          fix[end] = best.id;
          taken.add(best.id);
          targets.push(`${end} → ${quote(display(best))}`);
        }
      }
      const what = ends.length === 2 ? "Arrow is not connected at either end" : `Arrow ${ends[0]} is not connected`;
      push("unconnected-arrow", el, targets.length ? `${what} (can attach ${targets.join(", ")})` : what, {
        ends,
        ...(targets.length ? { fix } : {}),
      });
    }
  }

  // 3. unlabeled-node
  if (on("unlabeled-node")) {
    for (const el of nodeLike) {
      if (labelOf(el)) continue;
      if (isIcon(el)) push("unlabeled-node", el, "Icon has no caption");
      else if (!hasFreeLabel(el)) push("unlabeled-node", el, "Shape has no label");
    }
  }

  // 4. missing-ip: only for drawings where some node has an IP address.
  if (on("missing-ip")) {
    const ipOf = (id: string) => {
      const n = graphNodes.get(id);
      return n ? inventoryField(n, "ip") : "";
    };
    if (nodes.some((n) => ipOf(n.id))) {
      for (const el of nodes) {
        if (!labelOf(el) || ipOf(el.id)) continue;
        push("missing-ip", el, "No IP address (other nodes have one)");
      }
    }
  }

  // 5. off-palette-color
  if (on("off-palette-color")) {
    BUILTIN_ALLOWED ??= builtinAllowed();
    const allowed = new Set(BUILTIN_ALLOWED);
    for (const c of opts.allowedColors ?? []) {
      const k = canonical(c);
      if (k) allowed.add(k);
    }
    for (const el of live) {
      const k = canonical(el.customData?.mydrawIconColor as string | undefined);
      if (k) allowed.add(k);
    }
    for (const el of live) {
      if (COLOR_SKIP.has(el.type) || isLegend(el)) continue;
      const props: Array<"strokeColor" | "backgroundColor"> =
        el.type === "text" || el.type === "arrow" || el.type === "line" || el.type === "freedraw" ? ["strokeColor"] : ["strokeColor", "backgroundColor"];
      for (const prop of props) {
        const raw = el[prop];
        const c = canonical(raw);
        if (!c || c === "transparent" || allowed.has(c)) continue;
        // A zone's fill is a tint of its border color.
        if (isZone(el) && prop === "backgroundColor") {
          const stroke = canonical(el.strokeColor);
          if (stroke && stroke !== "transparent" && tint(stroke) === c) continue;
        }
        const near = nearestPaletteColor(c);
        const what = prop === "strokeColor" ? (el.type === "text" ? "Text color" : "Stroke color") : "Fill color";
        push("off-palette-color", el, `${what} ${c} is not in the palette (nearest: ${near.name} ${near.color})`, {
          fix: { kind: "color", property: prop, color: near.color, name: near.name },
        });
      }
    }
  }

  // 6-10. arrows: on top of each other, through nodes, labels in the way, crowded nodes, very long arrows
  for (const q of qualityLint(live as unknown as QEl[], want)) {
    const el = map.get(q.id);
    if (el) push(q.rule, el, q.message, { ...(q.other ? { other: q.other } : {}), ...(q.fix ? { fix: q.fix } : {}) });
  }

  const order = (i: LintIssue) => LINT_RULES.indexOf(i.rule);
  issues.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1) ||
      Math.round(a.y / 40) - Math.round(b.y / 40) ||
      a.x - b.x ||
      order(a) - order(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const summary = Object.fromEntries(LINT_RULES.map((r) => [r, 0])) as Record<LintRule, number>;
  for (const i of issues) summary[i.rule]++;
  return { issues, summary };
}

/** Is a rule name valid? */
export function isLintRule(s: string): s is LintRule {
  return (LINT_RULES as readonly string[]).includes(s);
}
