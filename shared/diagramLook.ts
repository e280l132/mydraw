// How generated diagrams look (pure, tests/diagramLook.test.ts): two looks, "professional" (the
// default: crisp lines, a type hierarchy in Inter / Montserrat / IBM Plex Mono) and "sketch"
// (hand-drawn: rough lines, Kalam / Caveat / Permanent Marker). A look fixes fonts, sizes, stroke
// widths and roughness; arrow semantics (weight, arrowheads, kinds) map onto it here too.
// Fonts are named; the renderer resolves names to Excalidraw font ids (web/src/fontRegistry.tsx)
// and falls back to Excalidraw's own font when mydraw's extra fonts are off.
import type { LineStyle } from "./diagram";

export const LOOKS_LIST = ["professional", "sketch"] as const;
export type LookName = (typeof LOOKS_LIST)[number];

export const EDGE_WEIGHTS = ["primary", "normal", "secondary"] as const;
export type EdgeWeight = (typeof EDGE_WEIGHTS)[number];

export const NODE_EMPHASES = ["primary", "muted"] as const;
export type NodeEmphasis = (typeof NODE_EMPHASES)[number];

/** Excalidraw 0.18's arrowheads, plus "none". */
export const ARROWHEADS = [
  "arrow",
  "triangle",
  "triangle_outline",
  "dot",
  "circle",
  "circle_outline",
  "diamond",
  "diamond_outline",
  "bar",
  "crowfoot_one",
  "crowfoot_many",
  "crowfoot_one_or_many",
  "none",
] as const;
export type Arrowhead = (typeof ARROWHEADS)[number];

export interface TextStyle {
  /** mydraw font name (see list_fonts). */
  font: string;
  /** Excalidraw's own font used when the extra fonts are off. */
  fallback: string;
  size: number;
}

export interface DiagramLook {
  name: LookName;
  roughness: number;
  title: TextStyle;
  /** Line under the title. */
  diagramSubtitle: TextStyle;
  zoneTitle: TextStyle;
  nodeLabel: TextStyle;
  /** Label of an emphasised (primary) node. */
  nodeLabelBold: TextStyle;
  /** Caption under an icon. */
  caption: TextStyle;
  /** Second line of a node (IP, role, ...). */
  nodeSubtitle: TextStyle;
  edgeLabel: TextStyle;
  zoneStroke: { outer: number; inner: number };
  nodeStroke: { normal: number; primary: number; muted: number };
  edgeWidth: Record<EdgeWeight, number>;
  /** Opacity of secondary arrows and muted nodes (0-100). */
  faded: number;
  /** Grey for muted nodes and subtitles. */
  muted: string;
}

const PRO = (font: string, size: number): TextStyle => ({ font, fallback: "Nunito", size });
const HAND = (font: string, size: number): TextStyle => ({ font, fallback: "Excalifont", size });

export const LOOKS: Record<LookName, DiagramLook> = {
  professional: {
    name: "professional",
    roughness: 0,
    title: { font: "Montserrat Bold", fallback: "Lilita One", size: 30 },
    diagramSubtitle: PRO("Inter", 16),
    zoneTitle: PRO("Inter SemiBold", 15),
    nodeLabel: PRO("Inter SemiBold", 15),
    nodeLabelBold: PRO("Inter Bold", 16),
    caption: PRO("Inter", 13),
    nodeSubtitle: { font: "IBM Plex Mono", fallback: "Cascadia", size: 12 },
    edgeLabel: PRO("Inter", 12),
    zoneStroke: { outer: 1.5, inner: 1 },
    nodeStroke: { normal: 1.5, primary: 3, muted: 1 },
    edgeWidth: { primary: 3, normal: 2, secondary: 1.25 },
    faded: 70,
    muted: "#868e96",
  },
  sketch: {
    name: "sketch",
    roughness: 1,
    title: HAND("Permanent Marker", 32),
    diagramSubtitle: HAND("Caveat", 22),
    zoneTitle: HAND("Kalam Bold", 16),
    nodeLabel: HAND("Kalam", 16),
    nodeLabelBold: HAND("Kalam Bold", 17),
    caption: HAND("Kalam", 14),
    nodeSubtitle: HAND("Caveat", 16),
    edgeLabel: HAND("Caveat", 17),
    zoneStroke: { outer: 2, inner: 1.5 },
    nodeStroke: { normal: 2, primary: 3.5, muted: 1.5 },
    edgeWidth: { primary: 3.5, normal: 2.5, secondary: 1.5 },
    faded: 70,
    muted: "#868e96",
  },
};

export function lookOf(name?: string | null): DiagramLook {
  return name === "sketch" ? LOOKS.sketch : LOOKS.professional;
}

// ---------- arrow kinds ----------

/** How every arrow of one kind ("Traffic", "Replication", ...) is drawn. */
export interface KindStyle {
  color?: string;
  style?: LineStyle;
  weight?: EdgeWeight;
  head?: Arrowhead;
  tail?: Arrowhead;
}

/** Distinct colours for kinds that don't name one, in this order. */
export const KIND_PALETTE = ["#1971c2", "#e8590c", "#2f9e44", "#9c36b5", "#c2255c", "#0c8599", "#f08c00", "#5f3dc4", "#66a80f", "#495057"] as const;

/**
 * The style of each kind used by `edgeKinds` (in order of first use): the declared style, with a
 * colour from KIND_PALETTE when none is given (skipping colours other kinds already declare).
 */
export function kindStyles(edgeKinds: readonly (string | undefined)[], declared: Readonly<Record<string, KindStyle>> = {}): Map<string, KindStyle> {
  const out = new Map<string, KindStyle>();
  const order: string[] = [];
  for (const k of [...Object.keys(declared), ...edgeKinds]) if (k && !order.includes(k)) order.push(k);
  const used = new Set(Object.values(declared).map((s) => s.color?.toLowerCase()).filter(Boolean) as string[]);
  const free = KIND_PALETTE.filter((c) => !used.has(c));
  let next = 0;
  for (const k of order) {
    const d = declared[k] ?? {};
    const color = d.color ?? (free.length ? free[next++ % free.length] : KIND_PALETTE[next++ % KIND_PALETTE.length]);
    out.set(k, { ...d, color });
  }
  return out;
}

export interface EdgeLook {
  color: string;
  style: LineStyle;
  width: number;
  opacity: number;
  startArrowhead: Exclude<Arrowhead, "none"> | null;
  endArrowhead: Exclude<Arrowhead, "none"> | null;
}

/** Edge fields this reads (a subset of DiagramEdge). */
export interface EdgeLookInput {
  color?: string;
  style?: LineStyle;
  width?: number;
  weight?: EdgeWeight;
  arrow?: "end" | "both" | "none";
  head?: Arrowhead;
  tail?: Arrowhead;
  kind?: string;
}

const head = (h: Arrowhead | undefined): Exclude<Arrowhead, "none"> | null | undefined => (h === undefined ? undefined : h === "none" ? null : h);

/** Colour, dash, width, opacity and arrowheads of an edge: its own fields, then its kind's, then the look's. */
export function edgeLook(e: EdgeLookInput, look: DiagramLook, kinds: ReadonlyMap<string, KindStyle>, ink: string): EdgeLook {
  const k = (e.kind ? kinds.get(e.kind) : undefined) ?? {};
  const weight = e.weight ?? k.weight ?? "normal";
  // `arrow` is the old shortcut: both / none / end.
  const fromArrow = e.arrow === "both" ? { start: "arrow" as const, end: "arrow" as const } : e.arrow === "none" ? { start: null, end: null } : e.arrow === "end" ? { start: null, end: "arrow" as const } : undefined;
  // First defined value wins (null = no arrowhead is a value, so `??` won't do).
  const pick = <T>(...xs: (T | undefined)[]): T | undefined => xs.find((x) => x !== undefined);
  const endPick = pick(head(e.head), fromArrow?.end, head(k.head));
  const startPick = pick(head(e.tail), fromArrow?.start, head(k.tail));
  const end = endPick === undefined ? "arrow" : endPick;
  const start = startPick === undefined ? null : startPick;
  return {
    color: e.color ?? k.color ?? ink,
    style: e.style ?? k.style ?? "solid",
    width: e.width ?? look.edgeWidth[weight],
    opacity: weight === "secondary" ? look.faded : 100,
    startArrowhead: start,
    endArrowhead: end,
  };
}
