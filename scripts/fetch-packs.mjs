// Download icon packs into a stencil library from the command line.
// Usage: node scripts/fetch-packs.mjs [--root <folder>] [aws azure gcp k8s network logos]
// Default root: ~/Documents/mydraw/Library. Default packs: all.
import { build } from "esbuild";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", ".electron", "packs.mjs");
await build({
  entryPoints: [path.join(here, "..", "app/src/packs.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "warning",
});
const { PACKS, installPacks } = await import(pathToFileURL(out).href);

const args = process.argv.slice(2);
let root = path.join(os.homedir(), "Documents", "mydraw", "Library");
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root") root = path.resolve(args[++i]);
  else ids.push(args[i]);
}
const packs = ids.length ? ids : PACKS.map((p) => p.id);
console.log(`Installing ${packs.join(", ")} into ${root}`);
const results = await installPacks(root, packs, (m) => console.log(`  ${m}`));
const failed = results.filter((r) => !r.ok);
process.exit(failed.length ? 1 : 0);
