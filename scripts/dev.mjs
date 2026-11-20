// Dev mode: Vite dev server for the UI + esbuild watch for the main process; restarts Electron on main changes.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import electronPath from "electron";
import { copyFonts, watchApp } from "./build-app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

copyFonts();
const server = await createServer({ configFile: path.join(root, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] UI at ${url}`);

let child = null;
let restarting = false;

function startElectron() {
  child = spawn(electronPath, [root, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, MYDRAW_DEV_URL: url },
  });
  child.on("exit", (code) => {
    if (restarting) return;
    console.log(`[dev] Electron exited (${code ?? 0})`);
    void server.close();
    process.exit(code ?? 0);
  });
}

let first = true;
await watchApp(() => {
  if (first) {
    first = false;
    startElectron();
    return;
  }
  console.log("[dev] main process changed, restarting Electron");
  restarting = true;
  child?.once("exit", () => {
    restarting = false;
    startElectron();
  });
  child?.kill();
});
