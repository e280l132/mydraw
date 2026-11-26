// Bundles the Electron entry (boot), main process, CLI main and preload script to CommonJS in app/dist.
import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssSafeFamily, faceFamilyName, fontIdFor, lineHeightFor } from "../shared/fonts.ts";
import { woff2Metrics } from "../shared/woff2.ts";
import { ALLOWED_LICENSES, BUILTIN_FONTS, BUILTIN_SUBSETS } from "./builtin-fonts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** package.json "version": the app version (shared/appVersion.ts). */
export function pkgVersion() {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
}

export const buildOptions = {
  entryPoints: {
    boot: path.join(root, "app/src/boot.ts"),
    main: path.join(root, "app/src/main.ts"),
    preload: path.join(root, "app/src/preload.ts"),
    cli: path.join(root, "app/src/cli.ts"),
  },
  outdir: path.join(root, "app/dist"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  define: { __MYDRAW_VERSION__: JSON.stringify(pkgVersion()) },
  sourcemap: true,
  logLevel: "info",
};

/** Excalidraw loads fonts from EXCALIDRAW_ASSET_PATH; serve them locally instead of from a CDN. */
export function copyFonts() {
  const src = path.join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
  const dest = path.join(root, "web/public/fonts");
  if (!existsSync(src)) throw new Error(`Excalidraw fonts not found at ${src}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  copyExtraFonts(path.join(dest, "extra"));
}

/**
 * mydraw's own extra fonts (scripts/builtin-fonts.mjs): latin + latin-ext woff2 files of each
 * listed weight, the licences, and manifest.json (FontEntry[] of shared/fonts.ts, metrics read
 * from the woff2 files by shared/woff2.ts) that web/src/fontRegistry.tsx loads at startup.
 */
export function copyExtraFonts(dest) {
  mkdirSync(path.join(dest, "LICENSES"), { recursive: true });
  const faces = [];
  for (const font of BUILTIN_FONTS) {
    const pkgDir = path.join(root, "node_modules/@fontsource", font.pkg);
    const meta = JSON.parse(readFileSync(path.join(pkgDir, "metadata.json"), "utf8"));
    const ranges = JSON.parse(readFileSync(path.join(pkgDir, "unicode.json"), "utf8"));
    const license = meta.license?.type ?? "";
    if (!ALLOWED_LICENSES.test(license)) throw new Error(`${font.pkg}: licence ${license} is not allowed`);
    cpSync(path.join(pkgDir, "LICENSE"), path.join(dest, "LICENSES", `${font.pkg}.txt`));
    // Italic faces ship for professional and mono typefaces (the fun ones are hand-drawn; they
    // have no real italic). Same weights as upright; a missing file is skipped, not an error.
    const variants = [];
    for (const weight of font.weights) variants.push({ weight, style: "normal" });
    if (font.category !== "fun") for (const weight of font.weights) variants.push({ weight, style: "italic" });
    for (const { weight, style } of variants) {
      const files = [];
      let metrics = null;
      for (const subset of BUILTIN_SUBSETS) {
        const name = `${font.pkg}-${subset}-${weight}-${style}.woff2`;
        const file = path.join(pkgDir, "files", name);
        if (!existsSync(file)) continue;
        cpSync(file, path.join(dest, name));
        files.push({ url: `fonts/extra/${name}`, unicodeRange: ranges[subset] ?? "" });
        if (!metrics) {
          const m = woff2Metrics(readFileSync(file), (b) => brotliDecompressSync(b));
          metrics = { ...m, lineHeight: lineHeightFor(m) };
        }
      }
      if (!files.length) {
        if (style === "italic") continue;
        throw new Error(`${font.pkg} ${weight}: no font files found`);
      }
      const family = faceFamilyName(font.typeface, weight, style);
      faces.push({
        id: fontIdFor(family),
        family,
        typeface: cssSafeFamily(font.typeface),
        weight,
        style,
        category: font.category,
        source: "builtin",
        metrics,
        files,
        license,
      });
    }
  }
  const ids = new Set(faces.map((f) => f.id));
  if (ids.size !== faces.length) throw new Error("built-in font id collision: rename a family");
  writeFileSync(path.join(dest, "manifest.json"), JSON.stringify({ version: 1, faces }, null, 2));
}

export async function watchApp(onRebuild) {
  const ctx = await context({
    ...buildOptions,
    plugins: [{ name: "notify", setup: (b) => b.onEnd((r) => !r.errors.length && onRebuild()) }],
  });
  await ctx.watch();
  return ctx;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyFonts();
  await build(buildOptions);
}
