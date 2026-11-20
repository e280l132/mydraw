import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Strict CSP for the packaged app. Dev mode skips it because Vite injects inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: mdlib:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: mdlib:",
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

export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react(), cspPlugin()],
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  server: { port: 5183, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
  },
});
