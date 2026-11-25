// Fill styles. Excalidraw's own picker offers hachure, cross-hatch and solid (zigzag is an Alt-click
// variant of hachure). Excalidraw hands `fillStyle` straight to roughjs, and its file loader keeps any
// string, so roughjs's other fillers (dots, dashed, zigzag-line) draw on screen, in every export, in
// the headless CLI and even on excalidraw.com without any patch. Pure: used by the style panel,
// styles/presets, the agent and draw.io.

export type FillStyleId = "solid" | "hachure" | "cross-hatch" | "zigzag" | "dots" | "dashed" | "zigzag-line";

export interface FillStyleInfo {
  id: FillStyleId;
  label: string;
  hint: string;
  /** Excalidraw's own Fill row has a button for it. */
  native: boolean;
}

export const FILL_STYLES: readonly FillStyleInfo[] = [
  { id: "hachure", label: "Hatch", hint: "Diagonal sketch lines", native: true },
  { id: "cross-hatch", label: "Cross-hatch", hint: "Crossed sketch lines", native: true },
  { id: "solid", label: "Solid", hint: "Plain solid fill", native: true },
  { id: "zigzag", label: "Scribble", hint: "One continuous zigzag stroke", native: false },
  { id: "zigzag-line", label: "Zigzag", hint: "Rows of small zigzags", native: false },
  { id: "dots", label: "Dots", hint: "Stippled dots", native: false },
  { id: "dashed", label: "Dashes", hint: "Short dashed hatching", native: false },
];

export const FILL_STYLE_IDS = FILL_STYLES.map((f) => f.id);
/** The fills only our "More fills" popover offers. */
export const EXTRA_FILLS = FILL_STYLES.filter((f) => !f.native);

export function isFillStyle(v: unknown): v is FillStyleId {
  return typeof v === "string" && (FILL_STYLE_IDS as string[]).includes(v);
}

/** A fill Excalidraw's own buttons don't show as selected. */
export function isExtraFill(v: unknown): boolean {
  return isFillStyle(v) && !FILL_STYLES.find((f) => f.id === v)!.native;
}

/** Validate an untrusted fill style (agent, styles); throws with the allowed names. */
export function requireFillStyle(v: unknown): FillStyleId {
  if (!isFillStyle(v)) throw new Error(`fillStyle must be one of ${FILL_STYLE_IDS.join(", ")}`);
  return v;
}

export const fillLabel = (id: string) => FILL_STYLES.find((f) => f.id === id)?.label ?? id;
