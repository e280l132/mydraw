// Bundles the Electron main process and preload script to CommonJS in app/dist.
import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const buildOptions = {
  entryPoints: {
    main: path.join(root, "app/src/main.ts"),
    preload: path.join(root, "app/src/preload.ts"),
  },
  outdir: path.join(root, "app/dist"),
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
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
