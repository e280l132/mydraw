#!/usr/bin/env node
// `mydraw` command. Two homes:
// - Repo checkout (package.json "bin", `npm link`): run by Node; Electron = $MYDRAW_ELECTRON or this
//   checkout's node_modules/electron, started on the checkout (app/dist/boot.cjs -> cli.cjs).
// - Installed app: Contents/Resources/bin/mydraw.mjs, run by the app's own binary in Node mode
//   (the shell wrapper packaging/mydraw sets ELECTRON_RUN_AS_NODE). Electron = that binary.
// Export/convert run headless in Electron (app/src/cli.ts); `mydraw mcp` runs the MCP server
// (stdio) in this process.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const packaged = !!process.versions.electron;
const args = process.argv.slice(2);

if (args[0] === "--version" || args[0] === "-v" || args[0] === "version") {
  // Answered here (no Electron start). Installed: Resources/app.asar/package.json (Electron's
  // Node mode reads inside asar archives); checkout: package.json. Shown like shared/version.ts.
  const pkg = [path.join(root, "app.asar", "package.json"), path.join(root, "package.json")].find((f) => fs.existsSync(f));
  const version = pkg ? String(JSON.parse(fs.readFileSync(pkg, "utf8")).version ?? "?") : "?";
  console.log(`mydraw ${version.replace(/^(\d+\.\d+)\.0(?=$|-)/, "$1")}`);
} else if (args[0] === "mcp") {
  // Installed: Resources/mcp/index.js; repo: mcp/dist/index.js. Nothing else may go to stdout.
  const server = [path.join(root, "mcp", "index.js"), path.join(root, "mcp", "dist", "index.js")].find((f) => fs.existsSync(f));
  if (!server) {
    console.error(`mydraw: MCP server not found next to ${here}; run \`npm run build\``);
    process.exit(1);
  }
  await import(pathToFileURL(server).href);
} else {
  runCli();
}

function runCli() {
  let electron = packaged ? process.execPath : process.env.MYDRAW_ELECTRON;
  if (!packaged) {
    if (!fs.existsSync(path.join(root, "app", "dist", "boot.cjs"))) {
      console.error(`mydraw: app/dist/boot.cjs not found; run \`npm run build\` in ${root}`);
      process.exit(1);
    }
    if (!electron) {
      try {
        electron = createRequire(import.meta.url)("electron");
      } catch {
        console.error("mydraw: Electron not found; run `npm install` in " + root + " or set MYDRAW_ELECTRON");
        process.exit(1);
      }
    }
  }

  const env = { ...process.env, MYDRAW_CLI_ARGS: JSON.stringify(args), MYDRAW_CLI_CWD: process.cwd() };
  delete env.ELECTRON_RUN_AS_NODE;
  // A packaged app always runs its own code (boot.cjs); a dev Electron is pointed at the checkout.
  const child = spawn(electron, packaged ? [] : [root], { stdio: ["ignore", "inherit", "pipe"], env });
  // Chromium logs noise on stderr; pass through only our own messages (and everything with MYDRAW_CLI_DEBUG).
  let buf = "";
  child.stderr.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl + 1);
      buf = buf.slice(nl + 1);
      if (process.env.MYDRAW_CLI_DEBUG || !/^\[\d+:\d+\/|^\d{4}-\d\d-\d\d .*(ERROR|WARNING|INFO):|^\s*$/.test(line)) process.stderr.write(line);
    }
  });
  // "close" (not "exit"): fires only after the child's stderr has been read to the end. Set
  // exitCode instead of calling process.exit so our own pending writes are flushed.
  child.on("close", (code, signal) => {
    if (buf) process.stderr.write(buf);
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}
