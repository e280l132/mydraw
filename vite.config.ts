import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
// @ts-expect-error plain .mjs without types
import { excalidrawPanelPin } from "./scripts/excalidrawPatch.mjs";

// Strict CSP for the packaged app. Dev mode skips it because Vite injects inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: mdlib:",
  "font-src 'self' data: mdfont:",
  "connect-src 'self' data: blob: mdlib: mdfont:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "mydraw-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<!-- %CSP% -->", `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// Excalidraw's bundled chunk that holds its font registry (`Fonts`, not a public export). The
// renderer imports it under this alias to register mydraw's extra fonts (web/src/excalidrawFonts.ts).
// It must be the same file Excalidraw's own index.js imports, so it is the same module instance.
// File names change with every Excalidraw release: see EXCALIDRAW-UPGRADE.md.
const EXCALIDRAW_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "node_modules/@excalidraw/excalidraw/dist");
export const EXCALIDRAW_FONT_CHUNK = {
  development: path.join(EXCALIDRAW_DIST, "dev/chunk-4FTI6OG3.js"),
  production: path.join(EXCALIDRAW_DIST, "prod/chunk-K2UTITRG.js"),
};

export default defineConfig(({ mode }) => ({
  root: "web",
  base: "./",
  // The pin patch rewrites the same chunk the font alias points at (see scripts/excalidrawPatch.mjs).
  plugins: [react(), cspPlugin(), excalidrawPanelPin(Object.values(EXCALIDRAW_FONT_CHUNK))],
  resolve: {
    alias: {
      "mydraw-excalidraw-chunk": mode === "development" ? EXCALIDRAW_FONT_CHUNK.development : EXCALIDRAW_FONT_CHUNK.production,
    },
  },
  // Dev: pre-bundle the chunk together with Excalidraw so both share one copy of the font registry.
  optimizeDeps: { include: ["@excalidraw/excalidraw", "mydraw-excalidraw-chunk"] },
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: { port: 5183, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
}));
