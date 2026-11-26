// Renders packaging/dmg-background.html to packaging/dmg-background.tiff (1x + 2x for Retina),
// the DMG window background. Run with `npm run dmg-background` after editing the HTML; the TIFF is
// committed so `npm run package` doesn't need to render it. MYDRAW_BG_PREVIEW=<file.png> also
// writes the 2x image there for a look.
const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const W = 560;
const H = 400;
const dir = path.join(__dirname, "..", "packaging");

/** One window for both sizes (a second window after destroying the first fails to load). */
async function render(win, scale, out) {
  win.setContentSize(W * scale, H * scale);
  win.webContents.setZoomFactor(scale);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: W * scale, height: H * scale });
  const png = img.resize({ width: W * scale, height: H * scale });
  fs.writeFileSync(out, png.toPNG());
}

app.dock?.hide();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, enableLargerThanScreen: true });
    await win.loadFile(path.join(dir, "dmg-background.html"));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-dmgbg-"));
    const one = path.join(tmp, "bg.png");
    const two = path.join(tmp, "bg@2x.png");
    await render(win, 1, one);
    await render(win, 2, two);
    // The 2x image must say 144 dpi so tiffutil/Finder treat it as the Retina version.
    execFileSync("sips", ["-s", "dpiWidth", "72", "-s", "dpiHeight", "72", one], { stdio: "ignore" });
    execFileSync("sips", ["-s", "dpiWidth", "144", "-s", "dpiHeight", "144", two], { stdio: "ignore" });
    const out = path.join(dir, "dmg-background.tiff");
    execFileSync("tiffutil", ["-cathidpicheck", one, two, "-out", out], { stdio: "ignore" });
    if (process.env.MYDRAW_BG_PREVIEW) fs.copyFileSync(two, process.env.MYDRAW_BG_PREVIEW);
    console.log(`wrote ${path.relative(process.cwd(), out)}`);
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
