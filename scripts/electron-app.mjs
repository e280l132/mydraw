// Returns the Electron binary to launch in dev/start/smoke.
// On macOS the menu bar title and Dock name come from the app bundle's Info.plist, which code
// cannot change at runtime. So we keep a copy of Electron.app renamed to "mydraw" with our icon
// in .electron/ (rebuilt when Electron or the icon changes). Packaged builds (Phase 9) get this
// from electron-builder instead.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export const APP_NAME = "mydraw";
export const BUNDLE_ID = "dev.mydraw.app";

export function electronBinary() {
  const stock = require("electron");
  if (process.platform !== "darwin") return stock;

  const src = path.join(root, "node_modules/electron/dist/Electron.app");
  const dest = path.join(root, ".electron", `${APP_NAME}.app`);
  const icon = path.join(root, "assets/icon.icns");
  const version = require("electron/package.json").version;
  const stamp = `${version}:${crypto.createHash("sha256").update(fs.readFileSync(icon)).digest("hex")}`;
  const stampFile = path.join(root, ".electron", "stamp");
  const binary = path.join(dest, "Contents/MacOS/Electron");

  if (fs.existsSync(binary) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp) {
    return binary;
  }

  console.log(`[electron-app] building ${path.relative(root, dest)}`);
  fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync("ditto", [src, dest]);

  const plist = path.join(dest, "Contents/Info.plist");
  const set = (key, value) => execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  set("CFBundleName", APP_NAME);
  set("CFBundleDisplayName", APP_NAME);
  set("CFBundleIdentifier", BUNDLE_ID);
  fs.copyFileSync(icon, path.join(dest, "Contents/Resources/electron.icns"));

  // Editing Info.plist breaks the bundle signature; re-sign ad hoc so macOS will launch it.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", dest], { stdio: "ignore" });
  fs.writeFileSync(stampFile, stamp);
  return binary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(electronBinary());
}
