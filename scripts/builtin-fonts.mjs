// The extra fonts shipped with mydraw (all OFL or Apache, from @fontsource/* devDependencies).
// A mix of fun (hand-drawn, cartoon, whiteboard) and professional (classic, technical) fonts.
// Each weight becomes its own entry in Excalidraw's font picker ("Inter", "Inter Bold").
// build-app.mjs copies the latin + latin-ext files to web/public/fonts/extra and writes manifest.json.

/** @type {{pkg: string, typeface: string, category: "fun"|"professional"|"mono", weights: number[]}[]} */
export const BUILTIN_FONTS = [
  // Fun: hand-drawn, cartoon, whiteboard
  { pkg: "caveat", typeface: "Caveat", category: "fun", weights: [400, 700] },
  { pkg: "kalam", typeface: "Kalam", category: "fun", weights: [400, 700] },
  { pkg: "patrick-hand", typeface: "Patrick Hand", category: "fun", weights: [400] },
  { pkg: "architects-daughter", typeface: "Architects Daughter", category: "fun", weights: [400] },
  { pkg: "gochi-hand", typeface: "Gochi Hand", category: "fun", weights: [400] },
  { pkg: "permanent-marker", typeface: "Permanent Marker", category: "fun", weights: [400] },
  { pkg: "indie-flower", typeface: "Indie Flower", category: "fun", weights: [400] },
  { pkg: "comic-neue", typeface: "Comic Neue", category: "fun", weights: [400, 700] },
  { pkg: "bangers", typeface: "Bangers", category: "fun", weights: [400] },
  { pkg: "luckiest-guy", typeface: "Luckiest Guy", category: "fun", weights: [400] },
  { pkg: "fredoka", typeface: "Fredoka", category: "fun", weights: [400, 600] },
  // Professional: classic and technical
  { pkg: "inter", typeface: "Inter", category: "professional", weights: [400, 600, 700] },
  { pkg: "roboto", typeface: "Roboto", category: "professional", weights: [400, 700] },
  { pkg: "open-sans", typeface: "Open Sans", category: "professional", weights: [400, 700] },
  { pkg: "lato", typeface: "Lato", category: "professional", weights: [400, 700] },
  { pkg: "ibm-plex-sans", typeface: "IBM Plex Sans", category: "professional", weights: [400, 600] },
  { pkg: "montserrat", typeface: "Montserrat", category: "professional", weights: [400, 700] },
  { pkg: "merriweather", typeface: "Merriweather", category: "professional", weights: [400, 700] },
  { pkg: "source-serif-4", typeface: "Source Serif 4", category: "professional", weights: [400, 600] },
  // Mono: code, IPs, config
  { pkg: "ibm-plex-mono", typeface: "IBM Plex Mono", category: "mono", weights: [400, 600] },
  { pkg: "jetbrains-mono", typeface: "JetBrains Mono", category: "mono", weights: [400, 700] },
];

export const BUILTIN_SUBSETS = ["latin", "latin-ext"];
export const ALLOWED_LICENSES = /^(OFL-1\.1|Apache-2\.0|UFL-1\.0)$/;
