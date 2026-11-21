// Color palettes and name resolution. Pure (no DOM), shared by the renderer, main and tests.
import { hsvToHex, normalizeHex, hexToHsv } from "./colorMath";

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Hue anchors (the 500 shade) for the generated ramps. */
const HUES: Array<[name: string, hex: string]> = [
  ["red", "#e03131"],
  ["rose", "#e64980"],
  ["pink", "#c2255c"],
  ["fuchsia", "#ae3ec9"],
  ["purple", "#8c4fff"],
  ["violet", "#6741d9"],
  ["indigo", "#4c6ef5"],
  ["blue", "#1971c2"],
  ["sky", "#1c9be6"],
  ["cyan", "#0c8599"],
  ["teal", "#12a594"],
  ["emerald", "#0ca678"],
  ["green", "#2f9e44"],
  ["lime", "#7aa116"],
  ["yellow", "#f2b705"],
  ["amber", "#f59f00"],
  ["orange", "#f08c00"],
  ["tangerine", "#e8590c"],
  ["brown", "#8d5a3b"],
  ["slate", "#64748b"],
  ["gray", "#868e96"],
  ["zinc", "#71717a"],
];

/** [saturation factor, value] per shade, relative to the 500 anchor. Light shades are pale, dark ones deep. */
const RAMP: Record<number, [number, number]> = {
  50: [0.1, 0.99],
  100: [0.2, 0.97],
  200: [0.4, 0.95],
  300: [0.6, 0.92],
  400: [0.8, 0.9],
  500: [1, 0],
  600: [1, -0.1],
  700: [1, -0.2],
  800: [1, -0.32],
  900: [1, -0.45],
};

function ramp(anchor: string): Record<number, string> {
  const { h, s, v } = hexToHsv(anchor);
  const out: Record<number, string> = {};
  for (const shade of SHADES) {
    const [sf, dv] = RAMP[shade];
    if (shade === 500) out[shade] = anchor;
    else if (shade < 500) out[shade] = hsvToHex({ h, s: Math.min(1, s * sf), v: Math.max(v, dv) });
    else out[shade] = hsvToHex({ h, s: Math.min(1, s * 1.05), v: Math.max(0.15, v + dv) });
  }
  return out;
}

/** Ten shades (50..900) of any color, treating it as the 500 shade. */
export function shadesOf(hex: string): Array<{ shade: number; color: string }> {
  const r = ramp(normalizeHex(hex) ?? "#868e96");
  return SHADES.map((shade) => ({ shade, color: r[shade] }));
}

export interface Palette {
  id: string;
  title: string;
  description: string;
  /** name -> hex */
  colors: Record<string, string>;
}

const ramps: Palette["colors"] = {};
for (const [name, anchor] of HUES) {
  const r = ramp(anchor);
  for (const shade of SHADES) ramps[`${name}-${shade}`] = r[shade];
}

/** Basic colors: neutrals plus common named colors. Names that are also ramp hues use the ramp's 500 shade. */
const basic: Palette["colors"] = {
  white: "#ffffff",
  snow: "#f8f9fa",
  "light-gray": "#dee2e6",
  silver: "#adb5bd",
  gray: "#868e96",
  "dark-gray": "#495057",
  charcoal: "#2b2f33",
  black: "#1e1e1e",
  red: ramps["red-500"],
  crimson: "#a61e4d",
  maroon: "#7a1f1f",
  salmon: "#ff8787",
  coral: "#ff6b6b",
  pink: ramps["pink-500"],
  "hot-pink": "#f06595",
  magenta: "#d6336c",
  orange: ramps["orange-500"],
  tangerine: ramps["tangerine-500"],
  peach: "#ffc078",
  gold: "#fcc419",
  yellow: ramps["yellow-500"],
  cream: "#fff3bf",
  olive: "#80882c",
  lime: ramps["lime-500"],
  "light-green": "#8ce99a",
  green: ramps["green-500"],
  forest: "#1b5e20",
  emerald: ramps["emerald-500"],
  mint: "#96f2d7",
  teal: ramps["teal-500"],
  cyan: ramps["cyan-500"],
  aqua: "#66d9e8",
  sky: ramps["sky-500"],
  "light-blue": "#a5d8ff",
  blue: ramps["blue-500"],
  navy: "#0b2e6f",
  indigo: ramps["indigo-500"],
  violet: ramps["violet-500"],
  purple: ramps["purple-500"],
  lavender: "#d0bfff",
  plum: "#862e9c",
  brown: ramps["brown-500"],
  tan: "#d2b48c",
  beige: "#f5e6cc",
  slate: ramps["slate-500"],
};

export const PALETTES: Palette[] = [
  {
    id: "basic",
    title: "Basic",
    description: "Neutrals and common named colors (red, navy, mint, ...).",
    colors: basic,
  },
  {
    id: "ramp",
    title: "Color ramp",
    description: `${HUES.length} hues x ${SHADES.length} shades, named hue-shade (e.g. blue-600). Plain hue names mean shade 500.`,
    colors: ramps,
  },
];

export const CANVAS_NAMES: Record<string, string> = { transparent: "transparent", none: "transparent" };

export function paletteById(id: string): Palette | undefined {
  return PALETTES.find((p) => p.id === id);
}

/** One row of the 500 shade per hue, for the hue chooser. */
export function mainSwatches(): Array<{ name: string; color: string }> {
  return HUES.map(([name]) => ({ name, color: ramps[`${name}-500`] }));
}

/**
 * Resolve a color given as hex ("#f90", "ff9900"), a ramp name ("blue-600", "blue"), a basic name
 * ("navy") or "transparent". Returns null if unknown.
 */
export function resolveColor(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (CANVAS_NAMES[s]) return CANVAS_NAMES[s];
  // Names win over look-alike hex ("red" is not hex, but "fed" or "bad" would be).
  return basic[s] ?? ramps[s] ?? ramps[`${s}-500`] ?? normalizeHex(s);
}

/** Like `resolveColor` but throws a message listing how to write colors. */
export function requireColor(input: unknown, what = "color"): string {
  if (typeof input !== "string") throw new Error(`${what} must be a string`);
  const c = resolveColor(input);
  if (!c) throw new Error(`unknown ${what} "${input}": use hex (#ff9900), a ramp name like blue-600, or a basic name like red or navy (list_palettes shows them)`);
  return c;
}
