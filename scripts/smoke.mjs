// End-to-end smoke test: launches the built app with Playwright and exercises Phase 1 features.
// Usage: npm run smoke   (set SMOKE_SCREENSHOTS=<dir> to keep screenshots)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";
import { electronBinary } from "./electron-app.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-smoke-"));
const userData = path.join(work, "userData");
const libraryDir = path.join(work, "library");
const shots = process.env.SMOKE_SCREENSHOTS || work;
fs.mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

async function launch() {
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: [root],
    env: { ...process.env, MYDRAW_TEST: "1", MYDRAW_USER_DATA: userData, MYDRAW_LIBRARY: libraryDir },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 860 });
  await page.waitForSelector(".excalidraw .excalidraw__canvas", { timeout: 20000 });
  await page.waitForFunction(() => !!window.__mydrawTest);
  const t = (fn, ...args) => page.evaluate(([src, a]) => new Function("t", "a", `return (${src})(t, ...a)`)(window.__mydrawTest, a), [fn.toString(), args]);
  return { app, page, t };
}

const step = (name) => console.log(`• ${name}`);
const errors = [];

let { app, page, t } = await launch();
page.on("pageerror", (e) => errors.push(e.message));

step("starts with one clean Untitled tab in Clean style");
let state = await t((x) => x.state());
assert.equal(state.tabs.length, 1);
assert.equal(state.tabs[0].title, "Untitled");
assert.equal(state.tabs[0].dirty, false);
assert.equal(await t((x) => x.currentItemRoughness()), 0);

step("editing marks the tab dirty");
await t((x) => x.addSample("Core switch"));
await waitFor(async () => (await t((x) => x.state())).tabs[0].dirty, "dirty flag");

step("save writes a valid .excalidraw file and clears dirty");
const file = path.join(work, "network.excalidraw");
assert.equal(await t((x, p) => x.saveAs(p), file), true);
state = await t((x) => x.state());
assert.equal(state.tabs[0].dirty, false);
assert.equal(state.tabs[0].title, "network");
let saved = JSON.parse(fs.readFileSync(file, "utf8"));
assert.equal(saved.type, "excalidraw");
assert.equal(saved.elements.filter((e) => e.type === "rectangle").length, 1);

step("autosave writes edits to disk");
await t((x) => x.addSample("Firewall"));
await waitFor(
  () => JSON.parse(fs.readFileSync(file, "utf8")).elements.filter((e) => e.type === "rectangle").length === 2,
  "autosave",
);
await waitFor(async () => !(await t((x) => x.state())).tabs[0].dirty, "clean after autosave");

step("exports PNG, JPG and SVG");
const png = path.join(work, "out.png");
const jpg = path.join(work, "out.jpg");
const svg = path.join(work, "out.svg");
await t((x, p) => x.exportTo(p, { format: "png", scale: 2 }), png);
await t((x, p) => x.exportTo(p, { format: "jpg", scale: 1, jpgQuality: 0.8 }), jpg);
await t((x, p) => x.exportTo(p, { format: "svg", embedScene: true }), svg);
assert.deepEqual([...fs.readFileSync(png).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic");
assert.deepEqual([...fs.readFileSync(jpg).subarray(0, 3)], [0xff, 0xd8, 0xff], "JPEG magic");
const svgText = fs.readFileSync(svg, "utf8");
assert.ok(svgText.includes("<svg") && svgText.includes("payload-type:application/vnd.excalidraw+json"), "SVG with embedded scene");
const pngW = fs.readFileSync(png).readUInt32BE(16);
assert.ok(pngW > 400, `PNG at 2x should be wide, got ${pngW}`);

step("external change on disk reloads a clean tab");
saved = JSON.parse(fs.readFileSync(file, "utf8"));
saved.elements = saved.elements.filter((e) => e.type === "rectangle").slice(0, 1);
fs.writeFileSync(file, JSON.stringify(saved));
await waitFor(async () => (await t((x) => x.elementCount())) === 1, "reload from disk", 8000);
assert.equal((await t((x) => x.state())).tabs[0].dirty, false);

step("export dialog opens");
await t((x) => x.openExportDialog());
await page.waitForSelector(".md-export-preview img", { timeout: 10000 });
await page.screenshot({ path: path.join(shots, "export-dialog.png") });
await page.keyboard.press("Escape");

step("in-app menu: recent files, theme, drawing style, autosave");
const MENU = ".App-menu_top__left .dropdown-menu";
const openMenu = async () => {
  if (!(await page.$(MENU))) await page.click('[data-testid="main-menu-trigger"]');
  await page.waitForSelector(MENU);
};
const getSettings = () => page.evaluate(() => window.mydraw.getSettings());
await openMenu();
assert.ok(await page.isVisible(`${MENU} >> text=Open recent`), "recent group shown");
assert.ok(await page.isVisible(`${MENU} .dropdown-menu-item >> text=network`), "recent file listed");
await page.screenshot({ path: path.join(shots, "app-menu-light.png") });

await page.click(`${MENU} [role=radiogroup][aria-label="Theme"] >> text=Dark`);
await waitFor(async () => (await getSettings()).theme === "dark", "theme setting dark");
await page.waitForSelector(".excalidraw.theme--dark");

await openMenu();
await page.click(`${MENU} [role=radiogroup][aria-label="Drawing style"] >> text=Sketch`);
await waitFor(async () => (await t((x) => x.currentItemRoughness())) === 1, "sketch style applied");

await openMenu();
await page.click(`${MENU} >> text=Autosave saved files`);
await waitFor(async () => (await getSettings()).autosave === false, "autosave off");
assert.ok(await page.$(MENU), "menu stays open after toggling autosave");
await page.screenshot({ path: path.join(shots, "app-menu-dark.png") });

// restore defaults for the remaining steps
await page.evaluate(() => window.mydraw.updateSettings({ theme: "light", drawingStyle: "clean", autosave: true }));
await waitFor(async () => (await t((x) => x.currentItemRoughness())) === 0, "clean style restored");
await page.keyboard.press("Escape");

step("stencil library: import SVG + .excalidrawlib, panel lists them");
const svgFile = path.join(work, "TestRouter.svg");
fs.writeFileSync(
  svgFile,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><rect x="2" y="8" width="28" height="16" rx="3" fill="#2f6fde"/><circle cx="8" cy="16" r="2" fill="#fff"/></svg>',
);
const xlibFile = path.join(work, "team-shapes.excalidrawlib");
fs.writeFileSync(
  xlibFile,
  JSON.stringify({
    type: "excalidrawlib",
    version: 2,
    libraryItems: [
      { id: "li1", status: "unpublished", created: 1, name: "Team box", elements: [{ type: "rectangle", id: "r1", x: 0, y: 0, width: 120, height: 60 }] },
    ],
  }),
);
assert.ok(fs.existsSync(path.join(libraryDir, "My Stencils")), "library folder created");
assert.equal(await page.evaluate((p) => window.mydraw.libraryImport(p), [svgFile, xlibFile]), 2);
const lib = await waitFor(async () => {
  const idx = await t((x) => x.library());
  return idx && idx.items.some((i) => i.name === "TestRouter") && idx.items.some((i) => i.name === "Team box") ? idx : null;
}, "imported stencils in index");
const routerId = lib.items.find((i) => i.name === "TestRouter").id;
const teamId = lib.items.find((i) => i.name === "Team box").id;
await page.waitForSelector(".md-panel .md-section-head >> text=My Stencils");
await page.fill(".md-panel-search input", "testrouter");
await page.waitForSelector(".md-panel .md-tile >> text=TestRouter");
await page.screenshot({ path: path.join(shots, "stencil-panel-search.png") });

step("insert stencils by click and by drag-and-drop; images persist in the saved file");
const before = await t((x) => x.elementCount());
await t((x, id) => x.insertStencil(id), routerId);
await waitFor(async () => (await t((x) => x.elementCount())) === before + 2, "icon + label inserted");
assert.ok((await t((x) => x.imageFileCount())) >= 1, "image file registered");
await page.dragAndDrop(".md-panel .md-tile", ".md-drawing:not([style*='none']) canvas.interactive", {
  targetPosition: { x: 500, y: 400 },
});
await waitFor(async () => (await t((x) => x.elementCount())) === before + 4, "drag-and-drop insert");
await t((x, id) => x.insertStencil(id), teamId);
await waitFor(async () => (await t((x) => x.elementCount())) === before + 5, "excalidrawlib item inserted");
await waitFor(() => {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  return d.elements.some((e) => e.type === "image") && Object.keys(d.files ?? {}).length >= 1;
}, "autosaved file contains image + embedded file");
await page.fill(".md-panel-search input", "");

step("save selection as stencil; it appears in the library");
// Excalidraw handles keys only when its canvas has focus: click an empty spot first.
await page.click(".md-drawing:not([style*='none']) canvas.interactive", { position: { x: 900, y: 700 } });
await page.keyboard.press("Meta+A");
await waitFor(async () => (await t((x) => x.selectedCount())) > 1, "shapes selected");
const savedRel = await t((x) => x.saveSelectionAsStencil("Core pair", "My Stencils"));
assert.ok(fs.existsSync(path.join(libraryDir, savedRel)), "stencil file written");
assert.equal(
  JSON.parse(fs.readFileSync(path.join(libraryDir, savedRel), "utf8")).elements.length,
  await t((x) => x.elementCount()),
  "stencil holds every element, including text bound inside shapes",
);
const stencilItem = await waitFor(async () => (await t((x) => x.library())).items.find((i) => i.name === "Core pair"), "saved stencil indexed");
const beforeStencil = await t((x) => x.elementCount());
await t((x, id) => x.insertStencil(id), stencilItem.id);
await waitFor(async () => (await t((x) => x.elementCount())) === beforeStencil * 2, "saved stencil inserted (all elements)");
await page.screenshot({ path: path.join(shots, "stencils-inserted.png") });

step("Excalidraw Library panel is saved to the library folder and shared by tabs");
await t((x) => x.addToExcalidrawLibrary());
const xlibPath = path.join(libraryDir, "Excalidraw Library", "library.excalidrawlib");
await waitFor(() => fs.existsSync(xlibPath) && JSON.parse(fs.readFileSync(xlibPath, "utf8")).libraryItems?.length === 1, "library file written");

step("new tab + crash recovery of unsaved drawing");
await t((x) => x.newTab());
await waitFor(async () => (await t((x) => x.elementCount())) === 0, "new tab mounted");
assert.equal(await t((x) => x.excalidrawLibraryCount()), 1, "new tab sees the shared Excalidraw library");
await t((x) => x.addSample("Unsaved NAS"));
state = await t((x) => x.state());
assert.equal(state.tabs.length, 2);
assert.equal(state.tabs[1].dirty, true);
await waitFor(() => fs.existsSync(path.join(userData, "recovery")) && fs.readdirSync(path.join(userData, "recovery")).length > 0, "recovery file");
await page.screenshot({ path: path.join(shots, "main-window.png") });

// Simulate a crash: kill the process without the close flow.
app.process().kill("SIGKILL");
await sleep(500);

({ app, page, t } = await launch());
page.on("pageerror", (e) => errors.push(e.message));
state = await waitFor(async () => {
  const s = await t((x) => x.state());
  return s.tabs.some((tab) => tab.dirty) ? s : null;
}, "recovered tab");
const recoveredTab = state.tabs.find((tab) => tab.dirty);
assert.equal(recoveredTab.filePath, null);
assert.ok(recoveredTab.title.startsWith("Untitled"));
// rectangle + its bound label text
assert.equal(await t((x) => x.elementCount()), 2);
await page.screenshot({ path: path.join(shots, "recovered.png") });
assert.equal(await t((x) => x.excalidrawLibraryCount()), 1, "Excalidraw library survives restart");
assert.ok((await t((x) => x.library())).items.some((i) => i.name === "Core pair"), "saved stencil survives restart");
app.process().kill("SIGKILL");

assert.deepEqual(errors, [], "no uncaught page errors");
console.log(`\nAll smoke checks passed. Screenshots in ${shots}`);
