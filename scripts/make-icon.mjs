// Renders assets/icon.svg to assets/icon.png (1024) and assets/icon.icns (macOS).
// Run after editing the SVG: node scripts/make-icon.mjs
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "assets");
const svg = fs.readFileSync(path.join(assets, "icon.svg"));

const render = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

fs.writeFileSync(path.join(assets, "icon.png"), render(1024));

if (process.platform === "darwin") {
  const iconset = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-icon-")), "icon.iconset");
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), render(size));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), render(size * 2));
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(assets, "icon.icns")]);
  fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
}

console.log("wrote assets/icon.png" + (process.platform === "darwin" ? " and assets/icon.icns" : ""));
