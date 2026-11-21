#!/usr/bin/env node
// `mydraw` command (package.json "bin"; `npm link` puts it on PATH). Starts Electron with the CLI
// entry (app/dist/cli.cjs, built by `npm run build`), which renders headless in a hidden window.
// Electron: $MYDRAW_ELECTRON, else this checkout's node_modules/electron.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "app", "dist", "cli.cjs");
if (!fs.existsSync(entry)) {
  console.error(`mydraw: ${path.relative(process.cwd(), entry)} not found; run \`npm run build\` in ${root}`);
  process.exit(1);
}

let electron = process.env.MYDRAW_ELECTRON;
if (!electron) {
  try {
    electron = createRequire(import.meta.url)("electron");
  } catch {
    console.error("mydraw: Electron not found; run `npm install` in " + root + " or set MYDRAW_ELECTRON");
    process.exit(1);
  }
}

const env = { ...process.env, MYDRAW_CLI_ARGS: JSON.stringify(process.argv.slice(2)), MYDRAW_CLI_CWD: process.cwd() };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [entry], { stdio: ["ignore", "inherit", "pipe"], env });
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
