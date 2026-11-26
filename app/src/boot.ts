// Electron entry (package.json "main"): the app, or the headless `mydraw` CLI when started by
// bin/mydraw.mjs with MYDRAW_CLI_ARGS. A packaged app can't be pointed at another script, so the
// CLI has to start through the same entry as the app.
import path from "node:path";

const entry = process.env.MYDRAW_CLI_ARGS !== undefined ? "cli.cjs" : "main.cjs";
// A computed path, so esbuild leaves the require alone and the two stay separate bundles.
require(path.join(__dirname, entry));
