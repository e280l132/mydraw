// Bundles the MCP server (mcp/src) into a single ESM file: mcp/dist/index.js.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const mcpBuildOptions = {
  entryPoints: [path.join(root, "mcp/src/index.ts")],
  outfile: path.join(root, "mcp/dist/index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // Some bundled CommonJS dependencies call require(); give ESM output a working one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build(mcpBuildOptions);
}
