// End-to-end smoke test: launches the built app with Playwright and exercises its features,
// including the MCP server driving the app (Phase 2).
// Usage: npm run smoke   (set SMOKE_SCREENSHOTS=<dir> to keep screenshots)
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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

step("auto-export on save writes a PNG, then an SVG, next to the file");
await page.evaluate((f) => window.mydraw.updateSettings({ autoExport: { [f]: "png" } }), file);
await t((x) => x.addSample("Switch"));
const autoPng = path.join(work, "network.png");
await waitFor(() => fs.existsSync(autoPng), "auto-exported PNG");
assert.deepEqual([...fs.readFileSync(autoPng).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "auto-export PNG magic");
await page.evaluate((f) => window.mydraw.updateSettings({ autoExport: { [f]: "svg" } }), file);
await t((x) => x.addSample("Switch 2"));
const autoSvg = path.join(work, "network.svg");
await waitFor(() => fs.existsSync(autoSvg), "auto-exported SVG");
assert.ok(fs.readFileSync(autoSvg, "utf8").includes("<svg"), "auto-export SVG");
await page.evaluate((f) => window.mydraw.updateSettings({ autoExport: {} }), file);
await waitFor(async () => !(await t((x) => x.state())).tabs[0].dirty, "clean after auto-export");

step("exports PNG, JPG and SVG");
const png = path.join(work, "out.png");
const jpg = path.join(work, "out.jpg");
const svg = path.join(work, "out.svg");
await t((x, p) => x.exportTo(p, { format: "png", scale: 2 }), png);
await t((x, p) => x.exportTo(p, { format: "jpg", scale: 1, quality: 0.8 }), jpg);
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

step("export dialog opens; WebP, Mermaid and CSV previews");
await t((x) => x.addSample("Router"));
await t((x) => x.openExportDialog());
await page.waitForSelector(".md-export-preview img", { timeout: 10000 });
await page.screenshot({ path: path.join(shots, "export-dialog.png") });
await page.click('.md-export-options .md-seg button:text-is("WebP")');
await page.waitForSelector(".md-export-preview img", { timeout: 10000 });
await page.click('.md-export-options .md-seg button:text-is("Mermaid")');
await page.waitForSelector(".md-export-preview .md-export-text", { timeout: 10000 });
assert.ok((await page.textContent(".md-export-text")).startsWith("flowchart"), "Mermaid preview");
await page.click('.md-export-options .md-seg button:text-is("CSV")');
await waitFor(async () => (await page.textContent(".md-export-text").catch(() => ""))?.startsWith("name,kind,type"), "CSV preview");
// Paged formats: option rows and a PNG preview.
await page.click('.md-export-options .md-seg button:text-is("PDF")');
await page.waitForSelector('.md-export-options button:text-is("Fit to content")');
await page.click('.md-export-options button:text-is("A4")');
assert.equal(await page.isEnabled('.md-export-options label.md-check:has-text("Actual size") input'), true, "actual size is available for A4");
await page.waitForSelector(".md-export-preview img", { timeout: 10000 });
await page.click('.md-export-options .md-seg button:text-is("PowerPoint")');
await page.waitForSelector('.md-export-options button:text-is("4:3")');
await page.click('.md-export-options .md-seg button:text-is("draw.io")');
await page.waitForSelector('.md-export-options small:has-text("draw.io cells")');
assert.equal(await page.$('.md-export-options label:text-is("Padding (px)")'), null, "draw.io has no picture options");
await page.click('.md-export-options .md-seg button:text-is("PNG")');
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

step("recolor icons from the Colors tab (Icon target): swatch, any-color picker (live), Original, undo");
await t((x) => x.selectImages());
const SECTION = ".md-drawing:not([style*='none']) .App-menu__left .md-style";
await page.waitForSelector(`${SECTION} .md-chip:text-is('Icon')`);
assert.match(await t((x) => x.iconSelection()), /^2:0:original$/, "two SVG icons selected, original colors");
assert.equal(await page.locator(`${SECTION} .md-chip:text-is('Icon')`).getAttribute("class").then((c) => c.includes("on")), true, "Icon target is active when only icons are selected");
assert.equal(await page.locator(`${SECTION} .md-chip:text-is('Fill')`).isDisabled(), true, "Fill is disabled when only icons are selected (it would do nothing)");
assert.equal(await page.locator(".md-drawing:not([style*='none']) .App-menu__left .md-iconcolor").count(), 0, "no separate icon color section any more");
await page.click(`${SECTION} .md-iconcolor-grid [aria-label="blue"]`);
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === "#1971c2"), "icons recolored blue");
await waitFor(() => {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const imgs = d.elements.filter((e) => e.type === "image");
  return imgs.length && imgs.every((e) => e.customData?.mydrawIconColor === "#1971c2" && d.files[e.fileId]);
}, "recolor autosaved with its file");

// Custom picker: drag across the color square; icons follow live, then the color is committed.
await page.click(`${SECTION} >> text=Any color`);
const sv = await page.waitForSelector(`${SECTION} .md-picker-sv`);
const box = await sv.boundingBox();
await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4, { steps: 4 });
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c !== "#1971c2" && c !== "original"), "live preview while dragging");
await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3, { steps: 4 });
await page.mouse.up();
const custom = await page.$eval(`${SECTION} .md-picker-hex`, (el) => el.value);
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === custom), "custom color committed");
const slotBg = await page.$eval(`${SECTION} .md-swatch-slot`, (el) => getComputedStyle(el).backgroundColor);
assert.notEqual(slotBg, "rgba(0, 0, 0, 0)", "custom color shown as the 12th swatch");
await page.screenshot({ path: path.join(shots, "icons-recolored.png") });

// The whole drag is one undo step: undo goes straight back to blue.
await page.evaluate(() => document.querySelector(".md-drawing:not([style*='none']) .excalidraw-container")?.focus());
await page.keyboard.press("Meta+Z");
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === "#1971c2"), "one undo step for the whole drag");

await page.click(`${SECTION} >> text=Original`);
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === "original"), "original colors restored");

// Eyedropper: copy an icon's color into the custom swatch without changing the selection, then apply it.
await page.click(`${SECTION} .md-chip-pick`);
let at = await t((x) => x.screenCenter("image", 0));
await page.mouse.click(at.x, at.y);
await waitFor(async () => (await page.$eval(`${SECTION} .md-swatch-slot`, (el) => el.title)).includes("#2f6fde"), "icon color picked");
assert.match(await t((x) => x.iconSelection()), /^2:0:original$/, "picking did not change the selection");
await page.click(`${SECTION} .md-swatch-slot`);
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === "#2f6fde"), "picked color applied");
// ...and from a shape (rectangle outline, no fill).
await page.click(`${SECTION} .md-chip-pick`);
at = await t((x) => x.screenCenter("rectangle", -1, true)); // on its outline: hollow shapes are picked by their edge
await page.mouse.click(at.x, at.y);
await waitFor(async () => (await page.$eval(`${SECTION} .md-swatch-slot`, (el) => el.title)).includes("#1e1e1e"), "shape color picked");
await page.screenshot({ path: path.join(shots, "eyedropper.png") });
await page.click(`${SECTION} >> text=Original`);
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === "original"), "back to original colors");

step("properties panel: palette swatch, style preset and theme act on the selection");
await t((x) => x.addSample("Styled"));
await t((x) => x.selectType("rectangle"));
const STYLE = ".md-drawing:not([style*='none']) .App-menu__left .md-style";
await page.waitForSelector(STYLE);
await page.click(`${STYLE} .md-swatch[title='orange']`);
await waitFor(async () => (await t((x) => x.elementProps("rectangle"))).every((e) => e.strokeColor === "#f08c00"), "palette swatch sets stroke");
await page.waitForSelector(`${STYLE} .md-shades .md-shade`);
assert.equal(await page.locator(`${STYLE} .md-shades .md-shade`).count(), 10, "ten shades ramp off the chosen basic color");
await page.screenshot({ path: path.join(shots, "style-colors.png") });
await page.click(`${STYLE} .md-shade[title='orange 800']`);
await waitFor(async () => (await t((x) => x.elementProps("rectangle"))).every((e) => e.strokeColor !== "#f08c00"), "shade applied");
await page.click(`${STYLE} [role=tab]:text-is('Presets')`);
await page.click(`${STYLE} .md-group-head:has-text('Zones')`);
await page.click(`${STYLE} .md-chip:text-is('DMZ')`);
await waitFor(async () => (await t((x) => x.elementProps("rectangle"))).every((e) => e.strokeStyle === "dashed"), "DMZ preset applied");
await page.click(`${STYLE} [role=tab]:text-is('Themes')`);
await page.click(`${STYLE} .md-group-head:has-text('Technical')`);
await page.click(`${STYLE} .md-chip:text-is('Blueprint')`);
await waitFor(async () => (await t((x) => x.viewBackground())) === "#0b3a75", "theme changes the canvas");
await page.screenshot({ path: path.join(shots, "style-panel.png") });
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelector(".md-drawing:not([style*='none']) .excalidraw-container")?.focus());
await page.keyboard.press("Meta+Z");
await waitFor(async () => (await t((x) => x.viewBackground())) === "#ffffff", "theme is one undo step");

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

step("quick save stencil; Excalidraw's own Library UI is hidden");
await t((x) => x.command({ type: "quickSaveStencil" }));
await waitFor(async () => (await t((x) => x.library())).items.filter((i) => i.collection === "My Stencils" && i.kind === "stencil").length >= 2, "quick-saved stencil indexed");
assert.equal(
  await page.evaluate(() => {
    const el = document.querySelector(".default-sidebar-trigger");
    return !el || getComputedStyle(el).display === "none";
  }),
  true,
  "Excalidraw Library button is hidden",
);
assert.ok(!fs.existsSync(path.join(libraryDir, "Excalidraw Library", "library.excalidrawlib")), "no Excalidraw Library file is created");
const stencilCount = async () => (await t((x) => x.library())).items.filter((i) => i.collection === "My Stencils" && i.kind === "stencil").length;
const beforeCtx = await stencilCount();
const ctxAt = await t((x) => x.screenCenter("image", 0));
await page.mouse.click(ctxAt.x, ctxAt.y, { button: "right" });
await waitFor(async () => (await page.locator(".context-menu .md-ctx-quick").count()) === 1, "context menu offers Quick save as stencil");
assert.equal(await page.locator(".context-menu .md-ctx-save").count(), 1, "...and Save as stencil…");
assert.equal(await page.locator('.context-menu li[data-testid="addToLibrary"]:visible').count(), 0, "...but not Add to library");
await page.locator(".context-menu .md-ctx-quick").click();
await waitFor(async () => (await stencilCount()) === beforeCtx + 1, "context-menu quick save adds a stencil");
await waitFor(async () => (await page.locator(".context-menu").count()) === 0, "context menu closes after the click");

step("icon packs: button by the title, nothing pre-ticked, search, sort, remove");
const fakePack = path.join(libraryDir, "Network");
fs.mkdirSync(path.join(fakePack, "Devices"), { recursive: true });
fs.writeFileSync(path.join(fakePack, "collection.json"), JSON.stringify({ managedBy: "mydraw-packs", pack: "network", items: {} }));
fs.writeFileSync(path.join(fakePack, "Devices", "Router.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="16" height="16"><rect width="8" height="8"/></svg>');
assert.equal(await page.locator(".md-panel-labels input").isVisible(), true, "name-under-icons checkbox is on the panel");
assert.equal(await page.locator(".md-panel-head .md-packs-btn").isVisible(), true, "Icon packs button beside the title");
assert.equal(await page.locator(".md-panel-head", { hasText: "Browse" }).count(), 0, "no Browse libraries button");
await page.click(".md-panel-head .md-packs-btn");
await waitFor(async () => (await page.locator('.md-pack[data-pack="network"] .md-badge').count()) === 1, "installed pack is badged");
assert.equal(await page.locator(".md-pack input:checked").count(), 0, "no pack is ticked by default");
await page.fill(".md-packs-search", "proxmox");
await waitFor(async () => (await page.locator(".md-pack").count()) === 1, "search narrows to one pack");
assert.equal(await page.locator('.md-pack[data-pack="dashboard"]').count(), 1, "...the Dashboard Icons pack");
await page.fill(".md-packs-search", "");
await page.selectOption(".md-packs-sort", "size-desc");
await waitFor(async () => (await page.locator(".md-pack").first().getAttribute("data-pack")) === "dashboard", "largest pack first");
await page.selectOption(".md-packs-sort", "installed");
await waitFor(async () => (await page.locator(".md-pack").first().getAttribute("data-pack")) === "network", "installed pack first");
await page.click('.md-pack[data-pack="network"] .md-pack-remove');
await page.click(".md-pack-confirm .danger");
await waitFor(() => !fs.existsSync(fakePack), "removing a pack deletes its folder");
await waitFor(async () => (await page.locator('.md-pack[data-pack="network"] .md-badge').count()) === 0, "pack no longer shows installed");
await page.keyboard.press("Escape");
await waitFor(async () => (await page.locator(".md-packs-search").count()) === 0, "dialog closes");

step("new tab + crash recovery of unsaved drawing");
await t((x) => x.newTab());
await waitFor(async () => (await t((x) => x.elementCount())) === 0, "new tab mounted");
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
assert.ok((await t((x) => x.library())).items.some((i) => i.name === "Core pair"), "saved stencil survives restart");

step("MCP: control file is private; requests without the key are refused");
const controlFile = path.join(userData, "control.json");
const control = await waitFor(() => fs.existsSync(controlFile) && JSON.parse(fs.readFileSync(controlFile, "utf8")), "control.json");
assert.equal(fs.statSync(controlFile).mode & 0o777, 0o600, "control.json is chmod 600");
const noKey = await fetch(`http://127.0.0.1:${control.port}/rpc`, { method: "POST", body: '{"method":"list_drawings"}' });
assert.equal(noKey.status, 401);

step("MCP: Claude builds, edits, checks and saves a diagram end to end");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const client = new Client({ name: "mydraw-smoke", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "mcp/dist/index.js")],
    env: { ...process.env, MYDRAW_USER_DATA: userData, MYDRAW_NO_LAUNCH: "1" },
    stderr: "inherit",
  }),
);
const callRaw = (name, args = {}) => client.callTool({ name, arguments: args });
const call = async (name, args = {}) => {
  const r = await callRaw(name, args);
  if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
  return JSON.parse(r.content[0].text);
};
assert.ok((await client.listTools()).tools.length >= 30, "MCP tools listed");

const drawing = await call("new_drawing", { title: "MCP test" });
assert.equal(drawing.active, true);
assert.equal((await t((x) => x.state())).activeId, drawing.id, "new drawing is the active tab");

const added = await call("add_elements", {
  elements: [
    { type: "rectangle", id: "web", x: 0, y: 0, width: 160, height: 80, label: "Web" },
    { type: "ellipse", id: "db", x: 400, y: 0, width: 140, height: 90, label: "DB", backgroundColor: "#a5d8ff", fillStyle: "solid" },
    { type: "arrow", id: "a1", from: "web", to: "db", label: "SQL" },
  ],
});
assert.deepEqual(added.ids, ["web", "db", "a1"]);
let scene = await call("get_scene");
const el = (id) => scene.elements.find((e) => e.id === id);
assert.equal(el("web").label, "Web");
assert.equal(el("a1").from, "web");
assert.equal(el("a1").to, "db");
assert.ok(Math.abs(el("a1").points[0][0] - 164) < 1 && Math.abs(el("a1").points[1][0] - 396) < 1, "arrow runs edge to edge");
let [webFull] = await call("get_element", { id: "web" });
assert.ok(webFull.element.boundElements.some((b) => b.id === "a1"), "arrow bound to its shape");
assert.equal(webFull.element.roughness, 0, "new shapes use the Clean drawing style");

const found = await call("search_stencils", { query: "testrouter" });
assert.equal(found.items[0].name, "TestRouter");
const placed = await call("place_stencil", { id: found.items[0].id, right_of: "db", label: "edge-rtr", color: "#e8590c" });
assert.ok(placed.node && placed.icon && placed.label, "stencil placed as an icon node with icon + caption");
scene = await call("get_scene");
assert.equal(el(placed.node).type, "icon-node");
assert.equal(el(placed.node).icon.color, "#e8590c", "stencil recolored on insert");
assert.ok(el(placed.node).x > el("db").x + el("db").width, "stencil is right of db");
const [iconFull] = await call("get_element", { id: placed.icon });
assert.ok(Math.abs(iconFull.element.y + iconFull.element.height / 2 - (el("db").y + el("db").height / 2)) < 1, "centres aligned");
// Connecting to the image binds to the node, so the arrow stops at the node's edge (clear of the caption).
const link = await call("connect", { from: "db", to: placed.icon, style: { strokeStyle: "dashed" } });
scene = await call("get_scene");
assert.equal(el(link.id).to, placed.node, "arrow bound to the icon node");

await call("update_elements", { updates: [{ id: "db", dy: 200 }] });
scene = await call("get_scene");
assert.ok(el("a1").points[1][1] > 150, "arrow follows a moved shape");
assert.ok(el(link.id).points[0][1] > 150, "second arrow follows too");

await call("update_elements", { updates: [{ id: "web", label: "Web tier", data: { ip: "10.0.0.5" } }] });
scene = await call("get_scene");
assert.equal(el("web").label, "Web tier");
assert.equal(el("web").data.ip, "10.0.0.5");
await call("undo");
scene = await call("get_scene");
assert.equal(el("web").label, "Web", "undo reverts the agent's last call as one step");
await call("redo");

await call("recolor", { ids: ["web"], color: "#2f9e44" });
assert.equal((await call("get_color", { id: "web" })).color, "#2f9e44");

const shot = await callRaw("screenshot", {});
assert.equal(shot.content[0].type, "image");
assert.deepEqual([...Buffer.from(shot.content[0].data, "base64").subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "screenshot is a PNG");
const mcpJpg = path.join(work, "mcp.jpg");
await call("export", { path: mcpJpg });
assert.deepEqual([...fs.readFileSync(mcpJpg).subarray(0, 3)], [0xff, 0xd8, 0xff], "exported JPEG");
await call("export", { path: path.join(work, "mcp-db.svg"), ids: ["db"] });
assert.ok(fs.readFileSync(path.join(work, "mcp-db.svg"), "utf8").includes("<svg"));

const savedPath = (await call("save", { path: path.join(work, "mcp-diagram") })).path;
assert.equal(savedPath, path.join(work, "mcp-diagram.excalidraw"));
const savedScene = JSON.parse(fs.readFileSync(savedPath, "utf8"));
assert.ok(savedScene.elements.some((e) => e.id === "a1") && Object.keys(savedScene.files).length >= 1, "saved with icon file");
assert.equal((await call("list_drawings")).find((d) => d.id === drawing.id).title, "mcp-diagram");

const stencil = await call("save_as_stencil", { name: "Web box", ids: ["web"] });
assert.ok(fs.existsSync(path.join(libraryDir, stencil.id)), "agent saved a stencil");

// move takes the stencil's whole group (icon + label) along, and its arrow follows.
const nodeBefore = el(placed.node);
const moved = await call("move", { ids: [placed.icon], dx: 100 });
assert.ok(moved.moved.includes(placed.node), "the whole icon node moves");
scene = await call("get_scene");
assert.equal(el(placed.node).x, nodeBefore.x + 100);
const g = await call("group", { ids: ["web", "db"] });
scene = await call("get_scene");
assert.ok(el("web").groupIds.includes(g.groupId) && el("db").groupIds.includes(g.groupId));
await call("ungroup", { groupId: g.groupId });
await call("select", { ids: ["web"] });
assert.deepEqual((await call("get_selection")).map((e) => e.id), ["web"]);
await call("zoom_to_fit");

// Frames bring their contents along; deleting a stencil icon removes its caption too.
await call("add_elements", { elements: [{ type: "frame", id: "zone", x: -50, y: 400, width: 300, height: 200, name: "Zone", children: [] }, { type: "rectangle", id: "inzone", x: 0, y: 450, width: 100, height: 60 }] });
await call("raw_update", { elements: [{ id: "inzone", frameId: "zone" }] });
await call("move", { ids: ["zone"], dx: 40 });
scene = await call("get_scene");
assert.equal(el("inzone").x, 40, "frame contents move with the frame");
await call("delete_elements", { ids: [placed.icon] });
scene = await call("get_scene");
assert.ok(!el(placed.node), "icon node deleted with its icon");
assert.equal((await callRaw("get_element", { id: placed.label })).isError, true, "caption deleted too");
const exp = await callRaw("export", { path: path.join(work, "part.excalidraw"), ids: ["web"] });
assert.ok(exp.isError, "partial .excalidraw export is refused");

await call("delete_elements", { ids: ["db"] });
scene = await call("get_scene");
assert.ok(!el("db") && !el("a1").to, "deleted shape is gone and its arrow came loose");

const bad = await callRaw("connect", { from: "nope", to: "web" });
assert.ok(bad.isError && /no element/.test(bad.content[0].text), "errors are reported to the agent");
await page.screenshot({ path: path.join(shots, "mcp-diagram.png") });

step("MCP: build_diagram lays out nodes, icons, zones and elbow arrows with a legend");
await call("new_drawing", { title: "Generated" });
const built = await call("build_diagram", {
  zones: [
    { id: "net", label: "Network" },
    { id: "lan", label: "LAN", parent: "net" },
  ],
  nodes: [
    { id: "inet", label: "Internet", shape: "ellipse" },
    { id: "rtr", label: "Router", icon: "TestRouter", zone: "net" },
    { id: "srv", label: "Server", zone: "lan", kind: "Server" },
    { id: "nas", label: "NAS", zone: "lan", kind: "Server", icon: "Azure:nothing" },
  ],
  edges: [
    { from: "inet", to: "rtr", label: "WAN" },
    { from: "rtr", to: "srv" },
    { from: "rtr", to: "nas", style: "dashed", kind: "Backup" },
  ],
  legend: true,
});
assert.deepEqual(built.nodes, ["inet", "rtr", "srv", "nas"]);
assert.ok(built.warnings?.some((w) => w.includes("Azure:nothing")), "missing icon reported");
scene = await call("get_scene");
assert.equal(el("rtr").type, "icon-node", "icon node from the library");
assert.equal(el("lan").type, "zone");
assert.equal(el("lan").zone, "net", "nested zone");
assert.equal(el("srv").zone, "lan");
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
assert.ok(inside(el("srv"), el("lan")) && inside(el("lan"), el("net")), "nodes inside their zones");
assert.ok(!inside(el("inet"), el("net")), "node outside the zone stays outside");
assert.equal(el("e1").routing, "elbow");
assert.equal(el("e1").from, "inet");
assert.ok(built.legend, "legend added");
const [e2Full] = await call("get_element", { id: "e2" });
assert.ok(e2Full.element.elbowed && e2Full.element.startBinding.fixedPoint, "elbow arrow with fixed-point bindings");
// Moving a zone moves its contents; the arrow into it follows.
const srvBefore = el("srv");
await call("move", { ids: ["lan"], dy: 60 });
scene = await call("get_scene");
assert.equal(Math.round(el("srv").y - srvBefore.y), 60, "zone contents move with the zone");

step("MCP: zones, legends, Mermaid, templates, auto layout, routed connectors");
const z = await call("create_zone", { label: "Outside", ids: ["inet"], color: "#e8590c" });
scene = await call("get_scene");
assert.ok(inside(el("inet"), el(z.zone)) && el("inet").zone === z.zone, "zone drawn around its member");
const curved = await call("connect", { from: "inet", to: "srv", routing: "curved" });
scene = await call("get_scene");
assert.equal(el(curved.id).routing, "curved");
assert.equal(el(curved.id).points.length, 3);
await call("update_elements", { updates: [{ id: curved.id, routing: "elbow" }] });
scene = await call("get_scene");
assert.equal(el(curved.id).routing, "elbow");
const leg = await call("add_legend", { title: "Key" });
assert.equal(leg.replaced > 0, true, "add_legend replaces the old legend");
const mer = await call("mermaid_to_scene", { mermaid: "flowchart TD\n  A[Client] -->|req| B(API)\n  subgraph be [Backend]\n    B --> C[(DB)]\n  end" });
assert.equal(mer.parsedAs, "flowchart");
scene = await call("get_scene");
assert.equal(el(mer.zones[0]).label, "Backend");
const again = await call("mermaid_to_scene", { mermaid: "graph LR; A-->B" });
assert.ok(again.nodes.every((id) => id !== "A" && id !== "B"), "clashing Mermaid ids are renamed");
const seq = await call("mermaid_to_scene", { mermaid: "sequenceDiagram\n  Alice->>Bob: Hi" });
assert.equal(seq.parsedAs, "mermaid");
assert.ok((await call("list_templates")).some((t) => t.name === "home-network"));
await call("new_drawing", { title: "Template" });
const tpl = await call("apply_template", { name: "three-tier-web" });
assert.ok(tpl.nodes.includes("db1") && tpl.zones.includes("data"));
const laid = await call("auto_layout", { direction: "down" });
assert.ok(laid.nodes >= 8 && laid.zones === 3, "auto_layout found nodes and zones");
scene = await call("get_scene");
assert.ok(el("users").y < el("db1").y, "laid out top to bottom");
const tplPath = (await call("save", { path: path.join(work, "template") })).path;
const tplSaved = JSON.parse(fs.readFileSync(tplPath, "utf8"));
assert.ok(tplSaved.elements.some((e) => e.elbowed && e.startBinding?.fixedPoint), "elbow arrows saved");
await page.screenshot({ path: path.join(shots, "mcp-generated.png") });

step("MCP: palettes, color names, themes and style presets");
const pals = await call("list_palettes");
assert.deepEqual(pals.map((p) => p.id), ["basic", "ramp"]);
assert.ok(Object.keys((await call("list_palettes", { palette: "ramp" }))[0].colors).length === 220, "full ramp listed on request");
await call("new_drawing", { title: "Styles" });
await call("add_elements", {
  elements: [
    { id: "s1", type: "rectangle", x: 0, y: 0, width: 160, height: 80, label: "App", strokeColor: "tangerine-600", backgroundColor: "blue-100" },
    { id: "s2", type: "rectangle", x: 300, y: 0, width: 160, height: 80, label: "Edge" },
    { id: "s3", type: "arrow", from: "s1", to: "s2", label: "https" },
    { id: "s4", type: "text", x: 0, y: 160, text: "Notes" },
  ],
});
scene = await call("get_scene");
assert.match(el("s1").stroke ?? el("s1").strokeColor, /^#[0-9a-f]{6}$/, "color name resolved");
await call("apply_style_preset", { ids: ["s2"], preset: "DMZ" });
await call("apply_style_preset", { ids: ["s3"], preset: "Critical" });
await call("recolor", { ids: ["s4"], color: "teal-600" });
let th = await call("apply_theme", { theme: "blueprint" });
assert.equal(th.background, "#0b3a75");
assert.ok(th.restyled >= 4);
const themed = await call("export", { path: path.join(work, "blueprint.excalidraw") });
const bp = JSON.parse(fs.readFileSync(themed.path ?? path.join(work, "blueprint.excalidraw"), "utf8"));
assert.equal(bp.appState.viewBackgroundColor, "#0b3a75", "canvas takes the theme background");
const bpText = bp.elements.find((e) => e.id === "s4");
assert.equal(bpText.fontFamily, 3, "text moved to Cascadia");
const bpBox = bp.elements.find((e) => e.id === "s1");
assert.match(bpBox.strokeColor, /^#[0-9a-f]{6}$/);
assert.notEqual(bpBox.strokeColor, "#e8f1ff", "custom colors survive a theme");
assert.equal(bpBox.roughness, 0);
await call("undo");
th = await call("apply_theme", { theme: "sketch" });
assert.ok(th.restyled >= 4);
await call("save_style_preset", { name: "Orange box", id: "s1" });
assert.ok((await call("list_themes")).presets.some((p) => p.title === "Orange box"));
await call("apply_style_preset", { ids: ["s4"], preset: "orange box" });
await call("save_theme", { name: "Smoke theme", category: "Smoke", background: "navy", ink: "#ffffff", roundness: "round" });
const stylesFile = path.join(userData, "styles.json");
await waitFor(() => fs.existsSync(stylesFile), "styles.json written");
const savedStyles = JSON.parse(fs.readFileSync(stylesFile, "utf8"));
assert.ok(savedStyles.presets.some((p) => p.title === "Orange box" && p.category === "My presets"), "preset persisted to the app's styles file");
assert.ok(savedStyles.themes.some((t) => t.id === "smoke-theme" && t.background === "#0b2e6f"), "theme persisted");
await call("new_drawing", { title: "Another drawing" });
const lists = await call("list_themes");
assert.ok(lists.presets.some((p) => p.title === "Orange box") && lists.themes.some((t) => t.title === "Smoke theme"), "saved styles are available in every drawing");
assert.ok(lists.presets.length >= 30 && lists.themes.length >= 15, "plenty of built-ins");
await call("apply_theme", { theme: "smoke theme" });
await call("delete_theme", { name: "Smoke theme" });
await call("delete_style_preset", { name: "Orange box" });
await assert.rejects(() => call("delete_style_preset", { name: "DMZ" }), /built in/);
assert.ok(!JSON.parse(fs.readFileSync(stylesFile, "utf8")).presets.some((p) => p.title === "Orange box"), "deleted preset removed from disk");
await assert.rejects(() => call("apply_theme", { theme: "nope" }), /unknown theme/);
await assert.rejects(() => call("recolor", { ids: ["s4"], color: "bluish" }), /palette name/);
await page.screenshot({ path: path.join(shots, "mcp-themes.png") });

step("MCP: review fixes (second diagram, legend, zone styling, zone colors, elbow, zone title)");
await call("new_drawing", { title: "Fixes" });
const d1 = await call("build_diagram", { nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "b" }] });
const d2 = await call("build_diagram", { nodes: [{ id: "c" }, { id: "d" }], edges: [{ from: "c", to: "d", label: "x" }] });
assert.notDeepEqual(d1.edges, d2.edges, "second diagram gets its own edge ids");
const lg = await call("build_diagram", { nodes: [{ id: "p" }, { id: "q" }], edges: [{ from: "p", to: "q" }], legend: true });
assert.ok(lg.nodes.includes("p") && lg.warnings?.some((w) => /legend/.test(w)), "empty legend warns instead of failing the build");
await call("create_zone", { id: "zc", label: "Named", ids: ["p", "q"], color: "blue-600" });
scene = await call("get_scene");
assert.match(el("zc").stroke ?? el("zc").strokeColor, /^#[0-9a-f]{6}$/, "create_zone accepts color names");
const beforeInner = JSON.stringify(el("p"));
await call("apply_style_preset", { ids: ["zc"], preset: "DMZ" });
scene = await call("get_scene");
assert.equal(JSON.stringify(el("p")), beforeInner, "styling a zone leaves its contents alone");
await call("add_elements", { elements: [{ id: "fa", type: "arrow", x: 0, y: 600, points: [[0, 0], [120, 90]] }] });
await call("update_elements", { updates: [{ id: "fa", routing: "elbow" }] });
const rawFa = JSON.parse(fs.readFileSync((await call("save", { path: path.join(work, "fixes") })).path, "utf8")).elements.find((e) => e.id === "fa");
assert.ok(rawFa.points.every((pt, i, all) => i === 0 || pt[0] === all[i - 1][0] || pt[1] === all[i - 1][1]), "free elbow arrow is orthogonal");
await call("create_zone", { id: "zn", x: 600, y: 600, width: 200, height: 120 });
await call("update_elements", { updates: [{ id: "zn", label: "Late title" }] });
scene = await call("get_scene");
assert.ok(JSON.stringify(scene).includes("Late title"), "label added to a zone without a title");

step("MCP: zone contents follow the zone; auto_layout moves the legend; edges clear zone titles");
scene = await call("get_scene");
const pBefore = el("p").x;
const zBefore = el("zc").x;
await call("update_elements", { updates: [{ id: "zc", dx: 200 }] });
await waitFor(async () => {
  scene = await call("get_scene");
  return Math.abs(el("p").x - (pBefore + 200)) < 1;
}, "zone contents follow the zone");
assert.ok(Math.abs(el("zc").x - (zBefore + 200)) < 1);
await call("undo");
await waitFor(async () => {
  scene = await call("get_scene");
  return Math.abs(el("p").x - pBefore) < 1 && Math.abs(el("zc").x - zBefore) < 1;
}, "one undo puts the zone and its contents back");

await call("new_drawing", { title: "Legend layout" });
await call("build_diagram", {
  nodes: [{ id: "k1", kind: "Web" }, { id: "k2", kind: "DB" }, { id: "k3", kind: "Web" }],
  edges: [{ from: "k1", to: "k2" }, { from: "k1", to: "k3" }],
  legend: true,
  direction: "right",
});
await call("auto_layout", { direction: "down" });
const legendFile = JSON.parse(fs.readFileSync((await call("save", { path: path.join(work, "legend-layout") })).path, "utf8"));
const legendEls = legendFile.elements.filter((e) => e.customData?.mydrawLegend && !e.isDeleted);
const nodeEls = legendFile.elements.filter((e) => ["k1", "k2", "k3"].includes(e.id));
assert.ok(legendEls.length > 0, "legend present");
assert.ok(Math.min(...legendEls.map((e) => e.y)) > Math.max(...nodeEls.map((e) => e.y + e.height)), "legend sits below the laid-out diagram");
step("MCP: export WebP, scopes, frames, Mermaid, CSV, Markdown, HTML; copy to clipboard");
await call("new_drawing", { title: "Exports" });
await call("build_diagram", {
  zones: [
    { id: "dmz", label: "DMZ" },
    { id: "core", label: "Core" },
  ],
  nodes: [
    { id: "web", label: "Web | 1", zone: "dmz", kind: "Server", data: { ip: "10.0.0.5", hostname: "web-1", notes: "public, \"edge\"" }, link: "https://example.com/web" },
    { id: "db", label: "Database", shape: "ellipse", zone: "core", data: { ip: "10.0.1.9" } },
    { id: "fw", label: "Firewall", fill: "#ffc9c9" },
  ],
  edges: [
    { from: "fw", to: "web", label: "https" },
    { from: "web", to: "db", style: "dashed" },
  ],
  direction: "right",
});
await call("add_elements", {
  elements: [
    { type: "frame", id: "fa", x: -400, y: -300, width: 260, height: 180, name: "Prod", children: [] },
    { type: "rectangle", id: "fa1", x: -380, y: -260, width: 120, height: 60, label: "In Prod" },
    { type: "frame", id: "fb", x: -400, y: 300, width: 260, height: 180, name: "Staging", children: [] },
    { type: "rectangle", id: "fb1", x: -380, y: 340, width: 120, height: 60, label: "In Staging" },
  ],
});
await call("raw_update", { elements: [{ id: "fa1", frameId: "fa" }, { id: "fb1", frameId: "fb" }] });

const outDir = path.join(work, "exports");
fs.mkdirSync(outDir);
const pngWidth = (f) => fs.readFileSync(f).readUInt32BE(16);
const riff = (f) => {
  const b = fs.readFileSync(f);
  return { head: b.subarray(0, 4).toString("latin1"), webp: b.subarray(8, 12).toString("latin1"), b };
};

const webp = path.join(outDir, "all.webp");
await call("export", { path: webp });
assert.equal(riff(webp).head, "RIFF");
assert.equal(riff(webp).webp, "WEBP", "WebP magic");
const webpT = path.join(outDir, "transparent.webp");
await call("export", { path: webpT, background: false, quality: 0.8 });
const tb = riff(webpT).b;
assert.equal(tb.subarray(8, 12).toString("latin1"), "WEBP");
assert.ok(tb.includes("ALPH") || tb.includes("VP8L"), "transparent WebP carries alpha");

const pngAll = path.join(outDir, "all.png");
const pngFrame = path.join(outDir, "frame.png");
await call("export", { path: pngAll, scale: 1, padding: 0 });
await call("export", { path: pngFrame, scale: 1, scope: "frame", frame: "Staging" });
assert.deepEqual([...fs.readFileSync(pngFrame).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
assert.ok(pngWidth(pngFrame) < pngWidth(pngAll), "a frame export is smaller than the whole drawing");
assert.ok(pngWidth(pngFrame) <= 262, `frame PNG is the frame's size, got ${pngWidth(pngFrame)}`);
const noFrame = await callRaw("export", { path: path.join(outDir, "x.png"), scope: "frame", frame: "Nope" });
assert.ok(noFrame.isError && /no frame "Nope"/.test(noFrame.content[0].text), "unknown frame is reported");

const batchDir = path.join(outDir, "frames");
const batch = await call("export", { path: batchDir, scope: "frames", format: "png", scale: 1 });
assert.deepEqual(batch.files.map((f) => f.frame).sort(), ["Prod", "Staging"]);
for (const f of batch.files) assert.deepEqual([...fs.readFileSync(f.path).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "frame PNG");
assert.deepEqual(fs.readdirSync(batchDir).sort(), ["Prod.png", "Staging.png"]);

const dark = path.join(outDir, "dark.svg");
await call("export", { path: dark, darkMode: true, background: false });
assert.ok(fs.readFileSync(dark, "utf8").includes("<svg"));

// Mermaid: text, and it reads back through our own parser (mermaid_to_scene).
const mmd = path.join(outDir, "diagram.mmd");
await call("export", { path: mmd });
const mermaidText = fs.readFileSync(mmd, "utf8");
assert.ok(/^flowchart (LR|TD)\n/.test(mermaidText), "Mermaid flowchart header");
assert.ok(mermaidText.includes("subgraph") && mermaidText.includes("-.->") && mermaidText.includes("Database"), "zones, dashed edge, labels");
await call("new_drawing", { title: "Round trip" });
await call("mermaid_to_scene", { mermaid: mermaidText });
const rt = await call("get_scene");
const labels = rt.elements.map((e) => e.label).filter(Boolean);
for (const l of ["Web | 1", "Database", "Firewall"]) assert.ok(labels.includes(l), `round trip keeps "${l}"`);
assert.equal(rt.elements.filter((e) => e.type === "zone").length, 2, "round trip keeps the zones");
assert.equal(rt.elements.filter((e) => e.type === "arrow").length, 2, "round trip keeps the edges");
await call("activate_drawing", { drawing: "Exports" });

const csv = path.join(outDir, "inventory.csv");
await call("export", { path: csv });
const csvLines = fs.readFileSync(csv, "utf8").split("\r\n");
assert.equal(csvLines[0], "name,kind,type,zone,ip,hostname,vlan,role,owner,url,notes", "CSV header");
assert.ok(csvLines.some((l) => l.startsWith("Web | 1,Server,rectangle,DMZ,") && l.includes("10.0.0.5") && l.includes("web-1") && l.includes("DMZ")), "CSV row for the web node");
assert.ok(csvLines.some((l) => l.startsWith("Database,") && l.includes("Core") && l.includes("10.0.1.9")), "CSV row for the database");
assert.ok(fs.readFileSync(csv, "utf8").includes('"public, ""edge"""'), "CSV quotes notes");
const md = path.join(outDir, "inventory.md");
await call("export", { path: md });
const mdLines = fs.readFileSync(md, "utf8").split("\n");
assert.equal(mdLines[0], "| Name | Kind | Type | Zone | Ip | Hostname | Vlan | Role | Owner | Url | Notes |", "Markdown table header");
assert.ok(mdLines.some((l) => l.includes("Web \\| 1") && l.includes("10.0.0.5")), "Markdown row, pipe escaped");

const html = path.join(outDir, "diagram.html");
await call("export", { path: html });
const htmlText = fs.readFileSync(html, "utf8");
assert.ok(htmlText.startsWith("<!doctype html>") && htmlText.includes("<svg") && htmlText.includes("Database"), "HTML embeds the SVG");
assert.ok(htmlText.includes("https://example.com/web"), "HTML keeps node links clickable");
assert.ok(htmlText.includes('addEventListener("wheel"'), "HTML has pan/zoom");
assert.ok(!/<script src|<link /i.test(htmlText), "HTML is self-contained");

// Selection scope + explicit format override of the path.
await call("select", { ids: ["web", "db"] });
const selCsv = path.join(outDir, "selection.txt");
await call("export", { path: selCsv, format: "csv", scope: "selection" });
const selRows = fs.readFileSync(selCsv, "utf8").trim().split("\r\n");
assert.equal(selRows.length, 3, "selection exports only the selected nodes");
assert.ok(!selRows.join("").includes("Firewall"));
await call("add_elements", { elements: [{ type: "rectangle", id: "bare", x: 900, y: 900, width: 50, height: 50 }] });
const emptySel = await callRaw("export", { path: path.join(outDir, "e.csv"), ids: ["bare"] });
assert.ok(emptySel.isError && /no nodes/.test(emptySel.content[0].text), "inventory without labelled nodes is refused");
assert.ok(!fs.existsSync(path.join(outDir, "e.csv")), "nothing is written on error");
await call("select", { ids: [] });

// PDF, PPTX, draw.io (Phase 6 part 2).
step("MCP: export PDF, PPTX and draw.io; frames become pages/slides");
const pdfPages = (f) => {
  const b = fs.readFileSync(f);
  assert.equal(b.subarray(0, 5).toString("latin1"), "%PDF-", `${f}: PDF magic`);
  return (b.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
};
const mediaBoxes = (f) => [...fs.readFileSync(f).toString("latin1").matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
const zipSlides = (f) => {
  const b = fs.readFileSync(f);
  assert.equal(b.subarray(0, 2).toString("latin1"), "PK", `${f}: zip magic`);
  return new Set(b.toString("latin1").match(/ppt\/slides\/slide\d+\.xml/g) ?? []).size;
};
const pdfAll = path.join(outDir, "all.pdf");
const pdfRes = await call("export", { path: pdfAll });
assert.equal(pdfPages(pdfAll), 1, "whole drawing = one PDF page");
assert.equal(pdfRes.pages, 1);
assert.ok(fs.readFileSync(pdfAll).length > 1000);
const pdfFrames = path.join(outDir, "frames.pdf");
const pf = await call("export", { path: pdfFrames, scope: "frames" });
assert.equal(pf.path, pdfFrames, "paged formats write one file for scope frames");
assert.equal(pdfPages(pdfFrames), 2, "one PDF page per frame");
const pdfA4 = path.join(outDir, "a4.pdf");
await call("export", { path: pdfA4, pageSize: "a4", darkMode: true });
const [a4Box] = mediaBoxes(pdfA4);
assert.ok(Math.abs(Math.max(a4Box[2], a4Box[3]) - 841.9) < 1.5 && Math.abs(Math.min(a4Box[2], a4Box[3]) - 595.3) < 1.5, `A4 page, got ${a4Box}`);
const pdfLetter = path.join(outDir, "letter.pdf");
await call("export", { path: pdfLetter, pageSize: "letter", actualSize: true, scope: "frame", frame: "Prod" });
assert.equal(pdfPages(pdfLetter), 1);
assert.deepEqual(mediaBoxes(pdfLetter)[0].slice(2).sort((a, b) => a - b), [612, 792], "Letter page");
const badPdf = await callRaw("export", { path: path.join(outDir, "bad.pdf"), actualSize: true });
assert.ok(badPdf.isError && /actualSize needs/.test(badPdf.content[0].text), "actualSize without a sheet size is refused");

const pptxAll = path.join(outDir, "all.pptx");
await call("export", { path: pptxAll, slideSize: "4:3" });
assert.equal(zipSlides(pptxAll), 1, "whole drawing = one slide");
assert.ok(fs.readFileSync(pptxAll).toString("latin1").includes("ppt/media/"), "slide carries the picture");
const pptxFrames = path.join(outDir, "frames.pptx");
const ppf = await call("export", { path: pptxFrames, scope: "frames" });
assert.equal(ppf.pages, 2);
assert.equal(zipSlides(pptxFrames), 2, "one slide per frame");

const drawioFile = path.join(outDir, "diagram.drawio");
const dr = await call("export", { path: drawioFile });
const drawioXml = fs.readFileSync(drawioFile, "utf8");
execFileSync("xmllint", ["--noout", drawioFile]); // well-formed XML (throws otherwise)
assert.ok(drawioXml.includes("<mxfile") && drawioXml.includes("<mxGraphModel"), "draw.io mxfile");
assert.ok(/<object label="Web \| 1"[^>]* ip="10\.0\.0\.5"/.test(drawioXml), "node properties as <object> attributes");
assert.ok(drawioXml.includes("container=1") && drawioXml.includes("edge=\"1\""), "zones as containers, edges");
assert.equal(dr.pages, 1);
const drawioFrames = path.join(outDir, "frames.drawio");
await call("export", { path: drawioFrames, scope: "frames" });
assert.equal((fs.readFileSync(drawioFrames, "utf8").match(/<diagram /g) ?? []).length, 2, "one draw.io page per frame");
const exportsFile = (await call("save", { path: path.join(work, "exports-test.excalidraw") })).path;
// Autosave keeps rewriting that file while later steps edit the drawing; the CLI checks need it as it was.
const frozenDir = path.join(work, "frozen");
fs.mkdirSync(frozenDir, { recursive: true });
const exportsFrozen = path.join(frozenDir, "exports-test.excalidraw");
fs.copyFileSync(exportsFile, exportsFrozen);

// Clipboard (File > Copy As ...): text and image.
const clip = (fn) => app.evaluate(fn);
await t((x) => x.command({ type: "copyAs", format: "mermaid" }));
await waitFor(async () => (await clip(({ clipboard }) => clipboard.readText())).startsWith("flowchart"), "Mermaid on the clipboard");
await t((x) => x.command({ type: "copyAs", format: "svg" }));
await waitFor(async () => (await clip(({ clipboard }) => clipboard.readText())).includes("<svg"), "SVG on the clipboard");
await t((x) => x.command({ type: "copyAs", format: "png" }));
await waitFor(async () => clip(async ({ clipboard }) => (await clipboard.has("image/png")) === true), "PNG on the clipboard");

// ---------- Phase 7: ease of use ----------
step("Phase 7: command palette (⇧⌘P) runs mydraw commands, themes and templates");
const MOD = "ControlOrMeta";
await page.keyboard.press("Escape");
await page.keyboard.press(`${MOD}+Shift+P`);
await page.waitForSelector(".md-pal-input");
await page.fill(".md-pal-input", "export pdf");
assert.ok((await page.textContent(".md-pal-item.on")).includes("Export as PDF"), "best match is Export as PDF");
await page.keyboard.press("Enter");
await page.waitForSelector(".md-export-options .md-seg button.on:text-is('PDF')", { timeout: 10000 });
await page.keyboard.press("Escape");
await page.click(".md-modal-actions button:text-is('Close'), .md-modal-actions button:text-is('Cancel')").catch(() => {});
await page.waitForSelector(".md-export", { state: "detached", timeout: 5000 }).catch(() => {});
assert.equal(await page.$(".md-pal-input"), null, "palette closes after running a command");

await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "theme blueprint");
const bgBefore = await t((x) => x.viewBackground());
await page.keyboard.press("Enter");
await waitFor(async () => (await t((x) => x.viewBackground())) !== bgBefore, "palette theme changes the background");

const countBefore = await t((x) => x.elementCount());
await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "template 3-tier");
await page.keyboard.press("Enter");
await waitFor(async () => (await t((x) => x.elementCount())) > countBefore + 5, "palette template builds a diagram");

await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "zzzzqqq");
assert.ok(await page.isVisible(".md-pal-empty"), "no-match message");
await page.keyboard.press("Escape");
assert.equal(await page.$(".md-pal-input"), null, "Escape closes the palette");

step("Phase 7: Excalidraw's own search, help and snap still work; ⌘K leaves link editing alone");
await page.waitForFunction(() => document.activeElement?.closest(".excalidraw"), null, { timeout: 5000 }); // focus returns to the drawing
await page.keyboard.press(`${MOD}+f`);
await page.waitForSelector(".layer-ui__search", { timeout: 5000 });
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
const snapBefore = await t((x) => x.appStateValue("objectsSnapModeEnabled"));
await page.keyboard.press("Alt+KeyS");
await waitFor(async () => (await t((x) => x.appStateValue("objectsSnapModeEnabled"))) !== snapBefore, "Alt+S toggles object snapping");
await page.keyboard.press("Alt+KeyS");
await page.keyboard.press("?");
await page.waitForSelector(".HelpDialog", { timeout: 5000 });
await page.keyboard.press("Escape");
// ⌘K opens the palette with nothing selected, but not with a selection (Excalidraw edits the link then).
await t((x) => x.selectType("rectangle"));
await page.keyboard.press(`${MOD}+k`);
await sleep(300);
assert.equal(await page.$(".md-pal-input"), null, "⌘K with a selection does not open the palette");
await page.keyboard.press("Escape");
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await t((x) => x.appStateValue("selectedElementIds")); // (selection stays; cleared next)
await page.keyboard.press("Escape");

step("Phase 7: find & replace (⌥⌘F): counts, replace all in one undo step, selection scope, select matches");
await call("new_drawing", { title: "Find test" });
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "f1", x: 0, y: 0, width: 160, height: 80, label: "web-1 Web server" },
    { type: "ellipse", id: "f2", x: 300, y: 0, width: 160, height: 90, label: "DB" },
    { type: "text", id: "f3", x: 0, y: 200, text: "WEB notes: web only, website" },
    { type: "arrow", id: "f4", from: "f1", to: "f2", label: "web traffic" },
  ],
});
// Labels wrap inside their shape; compare with line breaks as spaces.
const texts = async () => JSON.stringify(await call("get_scene")).replace(/\\n/g, " ");
await page.waitForFunction(() => document.activeElement !== null);
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+KeyF`);
await page.waitForSelector(".md-find");
await page.fill('.md-find input[placeholder="Find"]', "web");
await waitFor(async () => (await page.textContent(".md-find-count")).trim() === "6 in 3", "case-insensitive count: 6 matches in 3 texts");
await page.check('.md-find-opts label:has-text("Match case") input');
await waitFor(async () => (await page.textContent(".md-find-count")).trim() === "4 in 3", "match case count");
await page.uncheck('.md-find-opts label:has-text("Match case") input');
await page.check('.md-find-opts label:has-text("Whole word") input');
await waitFor(async () => (await page.textContent(".md-find-count")).trim() === "5 in 3", "whole word count");
await page.uncheck('.md-find-opts label:has-text("Whole word") input');

await page.fill('.md-find input[placeholder="Replace with"]', "app");
await page.click('.md-find-btn:text-is("Replace all")');
await waitFor(async () => !(await texts()).toLowerCase().includes("web"), "every web replaced");
let after = await texts();
assert.ok(after.includes("app-1 app server"), "label replaced keeping its case-insensitive match: " + after.slice(0, 300));
assert.ok(after.includes("app notes: app only, appsite"), "standalone text replaced");
assert.ok(after.includes("app traffic"), "arrow label replaced");
await call("undo");
await waitFor(async () => (await texts()).includes("web-1 Web server") && (await texts()).includes("WEB notes: web only, website"), "one undo restores everything");

// Selection scope: only the selected shape's label changes.
await page.fill('.md-find input[placeholder="Find"]', "web");
await call("select", { ids: ["f1"] });
await page.click('.md-find .md-seg button:text-is("Selection")');
await waitFor(async () => (await page.textContent(".md-find-count")).trim() === "2 in 1", "selection count");
await page.click('.md-find-btn:text-is("Replace all")');
await waitFor(async () => (await texts()).includes("app-1 app server"), "selection replaced");
assert.ok((await texts()).includes("WEB notes: web only, website"), "outside the selection untouched");
await call("undo");

// Select matches selects the owning shapes.
await page.fill('.md-find input[placeholder="Find"]', "web");
await page.click('.md-find-btn:text-is("Select matches")');
await waitFor(async () => (await t((x) => x.selectedCount())) >= 3, "matching shapes selected");
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-find")), "Escape closes the find bar");

step("Phase 7: palette jumps to an element by its text");
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "go to db");
assert.ok((await page.textContent(".md-pal-item.on")).includes("Go to: DB"));
await page.keyboard.press("Enter");
await waitFor(async () => (await t((x) => x.selectedCount())) === 1, "element selected by palette");

step("Phase 7: pages panel (⌥⌘P) adds, renames, reorders and zooms to pages; exports follow the order");
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+KeyP`);
await page.waitForSelector(".md-pages");
assert.ok(await page.isVisible(".md-pages-empty"), "empty hint without frames");
await page.click('.md-pages button[aria-label="Add page"]');
await page.click('.md-pages button[aria-label="Add page"]');
await waitFor(async () => (await t((x) => x.frameNames())).join() === "Page 1,Page 2", "two pages added");
await waitFor(async () => (await page.locator(".md-page").count()) === 2, "two rows listed");
await page.dblclick('.md-page-name:text-is("Page 1")');
await page.fill(".md-page-edit", "Intro");
await page.keyboard.press("Enter");
await waitFor(async () => (await t((x) => x.frameNames())).join() === "Intro,Page 2", "page renamed");
await page.hover('.md-page:has-text("Intro")');
await page.click('.md-page:has-text("Intro") button[aria-label="Move Intro down"]');
await waitFor(async () => (await t((x) => x.frameNames())).join() === "Page 2,Intro", "page moved down");
await call("undo"); // moving a page is one undo step
await waitFor(async () => (await t((x) => x.frameNames())).join() === "Intro,Page 2", "reorder undone in one step");
await call("redo");
await waitFor(async () => (await t((x) => x.frameNames())).join() === "Page 2,Intro", "reorder redone");
// Empty pages are skipped by paged exports, so put a shape in each.
const pageFrames = (await call("get_scene")).elements.filter((e) => e.type === "frame");
assert.equal(pageFrames.length, 2);
await call("add_elements", { elements: pageFrames.map((f, i) => ({ type: "rectangle", id: `pg${i}`, x: f.x + 60, y: f.y + 60, width: 120, height: 60, label: `P${i}` })) });
await call("raw_update", { elements: pageFrames.map((f, i) => ({ id: `pg${i}`, frameId: f.id })) });
const pagesDrawio = path.join(outDir, "pages-order.drawio");
await call("export", { path: pagesDrawio, scope: "frames" });
const diagramNames = [...fs.readFileSync(pagesDrawio, "utf8").matchAll(/<diagram [^>]*name="([^"]*)"/g)].map((m) => m[1]);
assert.deepEqual(diagramNames, ["Page 2", "Intro"], "export follows the page order");
await page.click('.md-page:has-text("Page 2")');
await waitFor(async () => (await t((x) => x.selectedCount())) === 1, "clicking a page selects it");
await page.keyboard.press(`${MOD}+Alt+KeyP`);
await waitFor(async () => !(await page.$(".md-pages")), "panel toggles closed");

step("Phase 7: drill-down links open another drawing in a tab; bad links are refused");
const linkDir = path.join(work, "links");
fs.mkdirSync(linkDir, { recursive: true });
fs.writeFileSync(
  path.join(linkDir, "rack-target.excalidraw"),
  JSON.stringify({ type: "excalidraw", version: 2, source: "smoke", elements: [], appState: {}, files: {} }),
);
await call("new_drawing", { title: "Link A" });
await call("add_elements", {
  elements: [
    // Away from the top edge, where Excalidraw's toolbars would cover the link badge.
    { type: "rectangle", id: "ra", x: 300, y: 300, width: 160, height: 80, label: "Rack", link: "rack-target.excalidraw" },
    { type: "rectangle", id: "rb", x: 700, y: 300, width: 160, height: 80, label: "Gone", link: "missing.excalidraw" },
  ],
});
await call("save", { path: path.join(linkDir, "a.excalidraw") });
assert.equal((await callRaw("update_elements", { updates: [{ id: "ra", link: "javascript:alert(1)" }] })).isError, true, "javascript: links are refused");
assert.equal((await callRaw("update_elements", { updates: [{ id: "ra", link: "notes.txt" }] })).isError, true, "non-drawing links are refused");
assert.equal((await callRaw("add_elements", { elements: [{ type: "rectangle", id: "bad", x: 0, y: 300, width: 50, height: 50, link: "data:text/html,x" }] })).isError, true, "add_elements refuses bad links");
assert.equal((await callRaw("build_diagram", { nodes: [{ id: "n", label: "N", link: "javascript:1" }] })).isError, true, "build_diagram refuses bad links");
await call("update_elements", { updates: [{ id: "ra", link: "https://example.com/docs" }] });
await call("update_elements", { updates: [{ id: "ra", link: "rack-target.excalidraw" }] });
const linkOf = async (id) => (await call("get_element", { id }))[0].element.link;
assert.equal(await linkOf("ra"), "rack-target.excalidraw");

// The main process validates and opens: web addresses (not launched in tests), drawings as tabs, nothing else.
const follow = (link, base) => page.evaluate(([l, b]) => window.mydraw.openLink(l, b), [link, base]);
assert.deepEqual(await follow("https://example.com/x", null), { type: "external" });
assert.equal((await follow("javascript:alert(1)", null)).type, "error");
assert.equal((await follow("/etc/hosts", null)).type, "error");
assert.equal((await follow("../../outside.excalidraw", path.join(linkDir, "a.excalidraw"))).type, "error", "missing drawing");

// Click the real link badge on the canvas.
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
const badge = await t((x) => x.linkBadge("ra"));
await page.mouse.move(badge.x, badge.y);
await sleep(200);
await page.mouse.move(badge.x + 1, badge.y + 1);
await sleep(150);
await page.mouse.click(badge.x + 1, badge.y + 1);
await waitFor(async () => {
  const st = await t((x) => x.state());
  return st.tabs.find((tab) => tab.id === st.activeId)?.title === "rack-target";
}, "clicking the link badge opens the linked drawing in a tab");
const tabsBefore = (await t((x) => x.state())).tabs.length;

// Back in A: following the same link again focuses the existing tab instead of opening a second one.
const clickBadge = async (id) => {
  const bd = await t((x, i) => x.linkBadge(i), id);
  await page.mouse.move(bd.x - 30, bd.y + 40);
  await sleep(100);
  await page.mouse.move(bd.x, bd.y);
  await sleep(200);
  await page.mouse.move(bd.x + 1, bd.y + 1);
  await sleep(150);
  await page.mouse.click(bd.x + 1, bd.y + 1);
};
const tabA = (await t((x) => x.state())).tabs.find((tab) => tab.title === "a");
await call("activate_drawing", { drawing: tabA.id });
await waitFor(async () => (await t((x) => x.state())).activeId === tabA.id, "A active again");
await clickBadge("ra");
await waitFor(async () => {
  const st = await t((x) => x.state());
  return st.tabs.find((tab) => tab.id === st.activeId)?.title === "rack-target";
}, "second click focuses the linked drawing");
assert.equal((await t((x) => x.state())).tabs.length, tabsBefore, "no duplicate tab");

// A link to a drawing that is gone shows an error instead of failing silently.
await call("activate_drawing", { drawing: tabA.id });
await waitFor(async () => (await t((x) => x.state())).activeId === tabA.id, "A active for the broken link");
await clickBadge("rb");
await page.waitForSelector(".md-toast.error", { timeout: 5000 });
assert.ok((await page.textContent(".md-toast.error")).includes("not found"), "missing drawing is reported");

// Authoring from the palette: link the selection to a chosen drawing, then remove it.
await call("activate_drawing", { drawing: tabA.id });
await app.evaluate(({ dialog }, file) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
}, path.join(linkDir, "rack-target.excalidraw"));
await call("select", { ids: ["rb"] });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "link selection");
await page.keyboard.press("Enter");
await waitFor(async () => (await linkOf("rb")) === "rack-target.excalidraw", "palette links the selection (relative path)");
await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "remove links");
await page.keyboard.press("Enter");
await waitFor(async () => !(await linkOf("rb")), "palette removes the link");

step("Phase 7: quick connect: hover handles, connected copy as one undo step, stencil search, zones");
await call("new_drawing", { title: "Quick connect" });
await call("add_elements", {
  elements: [
    // Below the toolbars. "qblock" takes the spot right of "qa", so the copy has to slide.
    { type: "rectangle", id: "qa", x: 300, y: 360, width: 160, height: 80, label: "App", strokeColor: "#1971c2", backgroundColor: "#a5d8ff", fillStyle: "solid" },
    { type: "ellipse", id: "qblock", x: 560, y: 330, width: 120, height: 70, label: "Busy" },
  ],
});
const qcHandles = () => page.$$eval(".md-qc-handle", (els) => els.map((e) => e.dataset.side).sort());
const hoverQa = async () => {
  await call("select", { ids: [] }); // handles of a selected shape would show at once
  await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
  const c = await t((x) => x.toScreen(380, 400));
  await page.mouse.move(c.x - 40, c.y + 5);
  await page.mouse.move(c.x, c.y);
  await sleep(250);
  assert.equal((await qcHandles()).length, 0, "passing over a shape shows no handles: the pointer has to rest on it");
  await waitFor(async () => (await qcHandles()).length === 4, "4 quick connect handles once the pointer rests on the shape");
};
await hoverQa();
assert.deepEqual(await qcHandles(), ["bottom", "left", "right", "top"]);
const qcCount = await t((x) => x.elementCount());
// Moving from the shape to a handle keeps the handles up; clicking adds copy + label + arrow.
const rightHandle = await page.$eval('.md-qc-handle[data-side="right"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(rightHandle.x - 15, rightHandle.y, { steps: 3 });
await page.mouse.move(rightHandle.x, rightHandle.y, { steps: 2 });
await page.keyboard.down("Alt"); // Option-click: a copy joined by an arrow
await page.mouse.click(rightHandle.x, rightHandle.y);
await page.keyboard.up("Alt");
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount + 3, "copy, its label and the arrow added");
scene = await call("get_scene");
const qArrow = scene.elements.find((e) => e.type === "arrow" && e.from === "qa");
assert.ok(qArrow, "a bound arrow starts at the source");
const qCopy = el(qArrow.to);
assert.ok(qCopy && qCopy.type === "rectangle" && qCopy.label === "App", "the arrow ends at a copy with the same label");
assert.equal(qCopy.backgroundColor, "#a5d8ff", "copy keeps the fill");
assert.equal(qCopy.strokeColor, "#1971c2", "copy keeps the stroke");
assert.equal(qCopy.width, 160);
assert.ok(qCopy.x >= el("qa").x + el("qa").width + 40, "copy is to the right of the source");
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
assert.ok(!overlaps(qCopy, el("qblock")) && !overlaps(qCopy, el("qa")), "copy does not overlap anything");
const [qArrowFull] = await call("get_element", { id: qArrow.id });
assert.equal(qArrowFull.element.startBinding.elementId, "qa");
assert.equal(qArrowFull.element.endBinding.elementId, qCopy.id);
assert.ok(qArrowFull.element.elbowed && qArrowFull.element.endBinding.fixedPoint, "elbow arrow with fixed-point bindings");
const [qaFull] = await call("get_element", { id: "qa" });
assert.ok(qaFull.element.boundElements.some((b) => b.id === qArrow.id), "source lists the arrow");
assert.equal(await t((x) => x.selectedCount()), 1, "the new node is selected");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount, "ONE undo removes everything quick connect added");
assert.ok(!(await call("get_element", { id: "qa" }))[0].element.boundElements?.some((b) => b.id === qArrow.id), "undo unbinds the source");

// Rebinding (settings persist): physical keys, sides, Control on a Mac, function keys; the tooltip follows.
const setQuick = (bindings) => page.evaluate((b) => window.mydraw.updateSettings({ quickConnect: { bindings: b } }), bindings);
await setQuick({ copy: { keys: ["F5"] }, connectedCopy: { keys: ["MetaRight"] }, linkTo: { keys: ["Meta"] }, pickStencil: { keys: ["Control"] } });
await waitFor(async () => (await getSettings()).quickConnect.bindings.connectedCopy.keys[0] === "MetaRight", "rebinding saved");
await page.evaluate(() => window.mydraw.updateSettings({ quickConnect: { bindings: { copy: { keys: ["Hyper"] }, connectedCopy: { keys: ["Meta"] } } } }));
await waitFor(async () => (await getSettings()).quickConnect.bindings.connectedCopy.keys[0] === "Alt", "clashing settings fall back to the defaults");
await setQuick({ copy: { keys: ["F5"] }, connectedCopy: { keys: ["MetaRight"] }, linkTo: { keys: ["Meta"] }, pickStencil: { keys: ["Control"] } });
await waitFor(async () => (await getSettings()).quickConnect.bindings.copy.keys[0] === "F5", "rebinding saved again");
/** Hover qa, point at its right handle, hold `keys` and click. */
const clickHandleHolding = async (keys) => {
  const away = await t((x) => x.toScreen(380, 700)); // empty canvas: the handles of the last hover go first
  await page.mouse.move(away.x, away.y, { steps: 2 });
  await waitFor(async () => (await qcHandles()).length === 0, "handles gone");
  await hoverQa();
  const h = await page.$eval('.md-qc-handle[data-side="right"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(h.x - 15, h.y, { steps: 3 });
  await page.mouse.move(h.x, h.y, { steps: 2 });
  for (const k of keys) await page.keyboard.down(k);
  await page.mouse.down();
  await page.mouse.up();
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
};
await hoverQa();
await waitFor(
  async () => (await page.$eval('.md-qc-handle[data-side="right"]', (e) => e.title)).includes("Right ⌘-click: add a copy joined by an arrow"),
  "handle tooltip shows the new shortcuts",
);
await clickHandleHolding(["MetaRight"]);
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount + 3, "right ⌘-click adds a connected copy");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount, "undone");
await clickHandleHolding(["MetaLeft"]); // left ⌘ = the either-side ⌘ binding: link mode
await page.waitForSelector(".md-qc-linkmode");
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-qc-linkmode")), "link mode ends");
assert.equal(await t((x) => x.elementCount()), qcCount, "left ⌘ did not add a copy");
await clickHandleHolding(["F5"]);
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount + 2, "F5-click adds a plain copy (shape + label)");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount, "undone");
await clickHandleHolding(["Control"]);
await page.waitForSelector(".md-qc-search .md-qc-input");
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-qc-search")), "search closes");
await clickHandleHolding([]); // a plain click is bound to nothing now
await sleep(200);
assert.equal(await t((x) => x.elementCount()), qcCount, "plain click does nothing when unbound");
await page.evaluate(() => window.mydraw.updateSettings({ quickConnect: {} })); // back to the defaults
await waitFor(async () => (await getSettings()).quickConnect.bindings.connectedCopy.keys[0] === "Alt", "defaults restored");

// The shortcuts dialog records held keys (sides kept) and saves them.
await t((x) => x.command({ type: "quickConnectSettings" }));
await page.waitForSelector(".md-qcs");
await page.click('.md-qcs-row[data-action="connectedCopy"] .md-qcs-change');
await page.waitForSelector(".md-qcs-capture");
await page.keyboard.down("AltRight");
await page.keyboard.down("F7");
await page.keyboard.up("F7");
await page.keyboard.up("AltRight");
await waitFor(async () => (await page.$$eval('.md-qcs-row[data-action="connectedCopy"] .md-qcs-chip', (els) => els.map((e) => e.textContent))).join() === "Right Option,F7", "recorded Right Option + F7");
await page.click('.md-qcs-row[data-action="connectedCopy"] .md-qcs-chip >> text=Right Option'); // right -> either side
await page.click(".md-qcs .md-modal-actions button.primary");
await waitFor(async () => (await getSettings()).quickConnect.bindings.connectedCopy.keys.join() === "Alt,F7", "dialog saved Option + F7");
await page.evaluate(() => window.mydraw.updateSettings({ quickConnect: {} }));
await waitFor(async () => (await getSettings()).quickConnect.bindings.connectedCopy.keys.join() === "Alt", "defaults restored");
{
  const away = await t((x) => x.toScreen(380, 700));
  await page.mouse.move(away.x, away.y, { steps: 2 });
  await waitFor(async () => (await qcHandles()).length === 0, "handles gone");
}

// In a zone: Shift-click opens the stencil search; the chosen icon joins the zone, which grows to fit.
const qz = await call("create_zone", { label: "Tier", ids: ["qa"] });
scene = await call("get_scene");
const zoneBefore = el(qz.zone);
const qcCount2 = await t((x) => x.elementCount());
await hoverQa();
await page.click('.md-qc-handle[data-side="bottom"]', { modifiers: ["Shift"] });
await page.waitForSelector(".md-qc-search .md-qc-input");
await page.keyboard.type("testrouter");
await page.waitForSelector(".md-qc-result >> text=TestRouter");
await page.keyboard.press("Enter");
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount2 + 4, "icon node (container, image, caption) + arrow added");
assert.ok(!(await page.$(".md-qc-search")), "search closes");
scene = await call("get_scene");
const sArrow = scene.elements.find((e) => e.type === "arrow" && e.from === "qa");
const sNode = el(sArrow?.to);
assert.ok(sNode && sNode.type === "icon-node" && sNode.icon.stencil === "TestRouter", "arrow to a TestRouter icon node");
assert.ok(sNode.y >= el("qa").y + el("qa").height + 40, "icon node is below the source");
assert.equal(sNode.zone, qz.zone, "icon node joins the zone");
assert.ok(inside(sNode, el(qz.zone)) && el(qz.zone).height > zoneBefore.height, "zone grew to contain it");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === qcCount2, "one undo removes the icon node");
scene = await call("get_scene");
assert.equal(el(qz.zone).height, zoneBefore.height, "undo shrinks the zone back");

step("Phase 7: quick connect on stencils and groups; selection shows handles; click copies, Option-click connects, ⌘-click links to a shape");
await call("new_drawing", { title: "QC stencil" });
const clickRightHandle = (mods) => page.click('.md-qc-handle[data-side="right"]', mods ? { modifiers: mods } : {});
// A stencil from the panel is a bare image + a free caption in one group (not an icon node).
await t((x, id) => x.insertStencil(id), routerId);
await waitFor(async () => (await t((x) => x.elementCount())) === 2, "stencil inserted (image + caption)");
await sleep(200);
scene = await call("get_scene");
const stImg = scene.elements.find((e) => e.type === "image");
const stCap = scene.elements.find((e) => e.type === "text");
assert.ok(stImg && stCap, "image and caption");
await waitFor(async () => (await qcHandles()).length === 4, "the selected stencil shows its handles at once (no rest needed)");
const stCount = await t((x) => x.elementCount());

// Option-click: connected copy to the right: image + caption + a bound arrow between the two images.
await clickRightHandle(["Alt"]);
await waitFor(async () => (await t((x) => x.elementCount())) === stCount + 3, "copy (image + caption) and arrow added");
scene = await call("get_scene");
let stArrow = scene.elements.find((e) => e.type === "arrow");
assert.equal(stArrow.from, stImg.id, "arrow starts at the stencil's image");
const stCopy = scene.elements.find((e) => e.type === "image" && e.id !== stImg.id);
assert.equal(stArrow.to, stCopy.id, "arrow ends at the copy's image");
assert.equal((await call("get_element", { id: stCopy.id }))[0].element.fileId, (await call("get_element", { id: stImg.id }))[0].element.fileId, "same icon");
assert.ok(stCopy.x >= stImg.x + stImg.width + 40, "copy is to the right");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === stCount, "one undo removes the copy and the arrow");

// Bottom: the arrow starts at the caption, so it doesn't run through the text.
await call("select", { ids: [stImg.id, stCap.id] });
await waitFor(async () => (await qcHandles()).length === 4, "handles again");
await page.click('.md-qc-handle[data-side="bottom"]', { modifiers: ["Alt"] });
await waitFor(async () => (await t((x) => x.elementCount())) === stCount + 3, "bottom copy added");
scene = await call("get_scene");
stArrow = scene.elements.find((e) => e.type === "arrow");
assert.equal(stArrow.from, stCap.id, "bottom arrow leaves from the caption");
assert.equal(el(stArrow.to).type, "image", "and arrives at the copy's image");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === stCount, "undone");

// Plain click: a copy only, no arrow.
await call("select", { ids: [stImg.id, stCap.id] });
await waitFor(async () => (await qcHandles()).length === 4, "handles for the Option test");
await clickRightHandle();
await waitFor(async () => (await t((x) => x.elementCount())) === stCount + 2, "a plain click adds image + caption only");
scene = await call("get_scene");
assert.equal(scene.elements.filter((e) => e.type === "arrow").length, 0, "no arrow");
assert.equal(scene.elements.filter((e) => e.type === "image").length, 2);
assert.equal(await t((x) => x.selectedCount()), 2, "the new copy is selected");
const plainCopy = scene.elements.find((e) => e.type === "image" && e.id !== stImg.id);
assert.ok(plainCopy.x > stImg.x + stImg.width && plainCopy.x - (stImg.x + stImg.width) < 45, `a plain copy sits close beside the original (gap ${plainCopy.x - (stImg.x + stImg.width)})`);
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === stCount, "one undo removes the plain copy");

// A group of shapes is one unit: copied together, kept as a group.
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "g1", x: 300, y: 600, width: 120, height: 60, label: "One" },
    { type: "rectangle", id: "g2", x: 440, y: 600, width: 120, height: 60, label: "Two" },
  ],
});
await call("select", { ids: ["g1", "g2"] });
await sleep(400);
assert.equal((await qcHandles()).length, 0, "two separate shapes are two units: no handles");
await call("group", { ids: ["g1", "g2"] }); // same selected ids, but now one unit
await waitFor(async () => (await qcHandles()).length === 4, "grouping the selection shows handles");
const gCount = await t((x) => x.elementCount());
// Connected: the arrow leaves from the member on the clicked side, not through the other one.
await clickRightHandle(["Alt"]);
await waitFor(async () => (await t((x) => x.elementCount())) === gCount + 5, "group copied (2 shapes, 2 labels) plus an arrow");
scene = await call("get_scene");
const gArrow = scene.elements.find((e) => e.type === "arrow");
assert.equal(gArrow.from, "g2", "arrow starts at the right-hand member");
const gCopies = scene.elements.filter((e) => e.type === "rectangle" && e.id !== "g1" && e.id !== "g2").sort((a, b) => a.x - b.x);
assert.equal(gArrow.to, gCopies[0].id, "and ends at the left-hand member of the copy");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === gCount, "group copy undone");
await call("select", { ids: ["g1", "g2"] });
await waitFor(async () => (await qcHandles()).length === 4, "handles again");
await clickRightHandle();
await waitFor(async () => (await t((x) => x.elementCount())) === gCount + 4, "both shapes and both labels copied");
scene = await call("get_scene");
const copies = scene.elements.filter((e) => e.type === "rectangle" && e.id !== "g1" && e.id !== "g2");
assert.equal(copies.length, 2);
assert.ok(copies[0].groupIds?.length && copies[0].groupIds[0] === copies[1].groupIds?.[0], "the copies are a group of their own");
assert.ok(!copies[0].groupIds.includes(el("g1").groupIds[0]), "...not the original's group");
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === gCount, "undone");
// Clearing the selection hides the handles again.
await call("select", { ids: [] });
await waitFor(async () => (await qcHandles()).length === 0, "no selection, no handles");

// A shape around the source is where it lives, not an obstacle: the copy stays inside it when there is room.
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "qcont", x: 700, y: 300, width: 420, height: 260 },
    { type: "rectangle", id: "qin", x: 730, y: 330, width: 80, height: 60, label: "In" },
  ],
});
const within = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
// Resting on the empty inside of the box picks nothing (not the box); resting on the shape in it
// shows its handles with an outline that says whose they are.
await call("select", { ids: [] });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
const emptyInside = await t((x) => x.toScreen(1000, 480));
await page.mouse.move(emptyInside.x - 20, emptyInside.y);
await page.mouse.move(emptyInside.x, emptyInside.y);
await sleep(1000);
assert.equal((await qcHandles()).length, 0, "the empty inside of a box that holds things shows no handles");
const onQin = await t((x) => x.toScreen(770, 360));
await page.mouse.move(onQin.x - 5, onQin.y);
await page.mouse.move(onQin.x, onQin.y);
await waitFor(async () => (await qcHandles()).length === 4, "resting on the shape inside the box shows its handles");
const outline = await page.$eval(".md-qc-outline", (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const qinTopLeft = await t((x) => x.toScreen(730, 330));
assert.ok(Math.abs(outline.x - (qinTopLeft.x - 4)) < 3 && Math.abs(outline.y - (qinTopLeft.y - 4)) < 3, "the outline is around the shape that owns the handles");
await page.mouse.move(5, 5);
for (const side of ["bottom", "right"]) {
  // Let the handles of whatever was selected before (the undone copy) go away first, so the click lands on qin's.
  await call("select", { ids: [] });
  await waitFor(async () => (await qcHandles()).length === 0, "handles gone");
  await call("select", { ids: ["qin"] });
  await waitFor(async () => (await qcHandles()).length === 4, `handles on the shape inside a container (${side})`);
  const n = await t((x) => x.elementCount());
  await page.click(`.md-qc-handle[data-side="${side}"]`, { modifiers: ["Alt"] });
  await waitFor(async () => (await t((x) => x.elementCount())) === n + 3, `copy inside the container (${side})`);
  scene = await call("get_scene");
  const arrow = scene.elements.find((e) => e.type === "arrow" && e.from === "qin");
  const copy = el(arrow.to);
  assert.ok(within(copy, el("qcont")), `the ${side} copy stays inside the container`);
  assert.deepEqual([el("qcont").x, el("qcont").y, el("qcont").width, el("qcont").height], [700, 300, 420, 260], "the container is not resized");
  await call("undo");
  await waitFor(async () => (await t((x) => x.elementCount())) === n, `${side} copy undone`);
}
// No room inside a small container: the copy goes outside it, as before.
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "qsmall", x: 700, y: 620, width: 110, height: 90 },
    { type: "rectangle", id: "qin2", x: 720, y: 640, width: 50, height: 30, label: "x" },
  ],
});
await call("select", { ids: [] });
await waitFor(async () => (await qcHandles()).length === 0, "handles gone");
await call("select", { ids: ["qin2"] });
await waitFor(async () => (await qcHandles()).length === 4, "handles in the small container");
const n2 = await t((x) => x.elementCount());
await page.click('.md-qc-handle[data-side="right"]', { modifiers: ["Alt"] });
await waitFor(async () => (await t((x) => x.elementCount())) === n2 + 3, "copy added beside the small container");
scene = await call("get_scene");
const arrow2 = scene.elements.find((e) => e.type === "arrow" && e.from === "qin2");
assert.ok(!within(el(arrow2.to), el("qsmall")) && el(arrow2.to).x >= 810, "with no room inside, the copy goes outside");
await call("undo");
await call("select", { ids: [] });

// ⌘-click: connect to something already there. A line follows the pointer; the target gets an outline.
await call("add_elements", { elements: [{ type: "rectangle", id: "lkT", x: 300, y: 700, width: 140, height: 70, label: "Target" }] });
await page.mouse.move(5, 5); // a pointer resting on another shape would show that one's handles instead
await call("select", { ids: [] });
await waitFor(async () => (await qcHandles()).length === 0, "old handles gone");
await call("select", { ids: ["qin"] });
await waitFor(async () => (await qcHandles()).length === 4, "handles for linking");
const lkCount = await t((x) => x.elementCount());
await page.click('.md-qc-handle[data-side="bottom"]', { modifiers: ["Meta"] });
await page.waitForSelector(".md-qc-linkmode");
assert.equal((await qcHandles()).length, 0, "handles hide while picking the target");
const lkCenter = await t((x) => x.toScreen(370, 735));
await page.mouse.move(lkCenter.x - 30, lkCenter.y - 30);
await page.mouse.move(lkCenter.x, lkCenter.y);
await page.waitForSelector(".md-qc-target");
await page.mouse.click(lkCenter.x, lkCenter.y);
await waitFor(async () => !(await page.$(".md-qc-linkmode")), "link mode ends");
await waitFor(async () => (await t((x) => x.elementCount())) === lkCount + 1, "only an arrow is added");
scene = await call("get_scene");
const lkArrow = scene.elements.find((e) => e.type === "arrow" && e.from === "qin" && e.to === "lkT");
assert.ok(lkArrow, "a bound arrow from the source to the chosen shape: " + JSON.stringify(scene.elements.filter((e) => e.type === "arrow")));
await call("undo");
await waitFor(async () => (await t((x) => x.elementCount())) === lkCount, "one undo removes the link");
// Esc cancels; a click on empty canvas adds a bend point (Backspace takes it back); right-click cancels.
await call("select", { ids: ["qin"] });
await waitFor(async () => (await qcHandles()).length === 4, "handles again");
await page.click('.md-qc-handle[data-side="right"]', { modifiers: ["Meta"] });
await page.waitForSelector(".md-qc-linkmode");
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-qc-linkmode")), "Esc cancels linking");
await waitFor(async () => (await qcHandles()).length === 4, "handles back after cancelling");
await page.click('.md-qc-handle[data-side="right"]', { modifiers: ["Meta"] });
await page.waitForSelector(".md-qc-linkmode");
const emptySpot = await t((x) => x.toScreen(1000, 480)); // empty inside of the big box
await page.mouse.move(emptySpot.x, emptySpot.y);
await page.mouse.click(emptySpot.x, emptySpot.y);
await waitFor(async () => (await page.locator(".md-qc-wp").count()) === 1, "a click on empty canvas adds a bend point");
await page.keyboard.press("Backspace");
await waitFor(async () => (await page.locator(".md-qc-wp").count()) === 0, "Backspace removes it");
await page.mouse.click(emptySpot.x, emptySpot.y, { button: "right" });
await waitFor(async () => !(await page.$(".md-qc-linkmode")), "right-click cancels");
await sleep(200);
assert.equal(await page.$(".context-menu"), null, "...without opening Excalidraw's context menu");
assert.equal(await t((x) => x.elementCount()), lkCount, "nothing added when cancelled");
await call("select", { ids: [] });

step("Phase 7: ⌘-link routes around shapes: preview, sides, bend points, styles, drag, chaining, free end; route_around");
await call("new_drawing", { title: "Route around" });
await page.evaluate(() => localStorage.removeItem("mydraw.linkStyle"));
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "rA", x: 300, y: 400, width: 120, height: 60, label: "A" },
    { type: "rectangle", id: "rB", x: 900, y: 400, width: 120, height: 60, label: "B" },
    { type: "rectangle", id: "rWall", x: 600, y: 300, width: 60, height: 260, label: "Wall" },
  ],
});
const absPts = (a) => a.points.map(([x, y]) => ({ x: a.x + x, y: a.y + y }));
const crossesBox = (pts, b) =>
  pts.some((p, i) => {
    if (!i) return false;
    const q = pts[i - 1];
    const inX = (x) => x > b.x + 1 && x < b.x + b.width - 1;
    const inY = (y) => y > b.y + 1 && y < b.y + b.height - 1;
    if (Math.abs(p.y - q.y) < 0.5) return inY(p.y) && Math.max(p.x, q.x) > b.x + 1 && Math.min(p.x, q.x) < b.x + b.width - 1;
    if (Math.abs(p.x - q.x) < 0.5) return inX(p.x) && Math.max(p.y, q.y) > b.y + 1 && Math.min(p.y, q.y) < b.y + b.height - 1;
    for (let k = 1; k < 20; k++) if (inX(q.x + ((p.x - q.x) * k) / 20) && inY(q.y + ((p.y - q.y) * k) / 20)) return true;
    return false;
  });
const elFull = async (id) => (await call("get_element", { id }))[0].element;
const arrowsNow = async () => (await call("get_scene")).elements.filter((e) => e.type === "arrow");
const screenOf = (x, y) => t((h, p) => h.toScreen(p[0], p[1]), [x, y]);
const startLinkFrom = async (id, side) => {
  await page.mouse.move(5, 5);
  await call("select", { ids: [] });
  await waitFor(async () => (await qcHandles()).length === 0, "no handles before selecting");
  await call("select", { ids: [id] });
  await waitFor(async () => (await qcHandles()).length === 4, `handles on ${id}`);
  await page.click(`.md-qc-handle[data-side="${side}"]`, { modifiers: ["Meta"] });
  await page.waitForSelector(".md-qc-linkmode");
};
const pointAt = async (x, y) => {
  const s = await screenOf(x, y);
  await page.mouse.move(s.x - 6, s.y - 6);
  await page.mouse.move(s.x, s.y);
  return s;
};

// 1) Around the wall, with a live preview of the real route.
await startLinkFrom("rA", "right");
const bCenter = await pointAt(960, 430);
await page.waitForSelector(".md-qc-target");
await waitFor(async () => (await page.$eval(".md-qc-path", (e) => e.getAttribute("d")))?.split("L").length > 2, "the preview shows a bent route, not a straight line");
await page.screenshot({ path: path.join(shots, "link-preview.png") });
await page.mouse.click(bCenter.x, bCenter.y);
await waitFor(async () => !(await page.$(".md-qc-linkmode")), "linking ends after connecting");
let ra = (await arrowsNow())[0];
assert.ok(ra && ra.from === "rA" && ra.to === "rB", "arrow from A to B");
let raFull = await elFull(ra.id);
assert.ok(raFull.elbowed, "a native elbow arrow");
assert.ok(raFull.fixedSegments?.length >= 1, "its middle segments are fixed (they survive moves)");
assert.equal(raFull.customData?.mydrawAvoid, true);
scene = await call("get_scene");
assert.ok(!crossesBox(absPts(raFull), el("rWall")), "the arrow goes around the wall");

// 2) Moving a shape: the agent's move re-routes around shapes; a mouse drag keeps the fixed middle.
const endBefore = absPts(raFull).at(-1);
const bBefore = el("rB");
await call("move", { ids: ["rB"], dy: 120 });
raFull = await elFull(ra.id);
scene = await call("get_scene");
assert.equal(raFull.endBinding?.elementId, "rB", "still bound after moving B");
assert.ok(!crossesBox(absPts(raFull), el("rWall")), "re-routed around the wall after the move");
const raEnd = absPts(raFull).at(-1);
assert.ok(
  Math.abs(raEnd.x - el("rB").x - (endBefore.x - bBefore.x)) < 2 && Math.abs(raEnd.y - el("rB").y - (endBefore.y - bBefore.y)) < 2,
  "still arrives at the same place on B after the move: " + JSON.stringify([endBefore, raEnd]),
);
const bNow = await screenOf(960, 550);
await page.mouse.move(bNow.x, bNow.y);
await page.mouse.down();
await page.mouse.move(bNow.x + 40, bNow.y + 30, { steps: 6 });
await page.mouse.up();
await sleep(300);
raFull = await elFull(ra.id);
assert.equal(raFull.endBinding?.elementId, "rB", "still bound after dragging B");
assert.ok(raFull.elbowed && raFull.points.length >= 3, "still an elbow arrow after the drag");
await call("select", { ids: [] });

// 3) Choosing the target side (near its top edge) and a bend point.
scene = await call("get_scene");
const rbBox = el("rB");
await startLinkFrom("rA", "bottom");
await pointAt(450, 720); // empty canvas below: a bend point
const wpScreen = await screenOf(450, 720);
await page.mouse.click(wpScreen.x, wpScreen.y);
await waitFor(async () => (await page.locator(".md-qc-wp").count()) === 1, "bend point added");
const topOfB = await pointAt(rbBox.x + rbBox.width * 0.75, rbBox.y + 3);
await page.waitForSelector(".md-qc-port");
await page.screenshot({ path: path.join(shots, "link-preview-bend-side.png") });
await page.mouse.click(topOfB.x, topOfB.y);
await waitFor(async () => (await arrowsNow()).length === 2, "second arrow");
const rb2 = (await arrowsNow()).find((a) => a.id !== ra.id);
const rb2Full = await elFull(rb2.id);
const rb2Pts = absPts(rb2Full);
const onRoute = (pts, x, y) =>
  pts.some((p, i) => {
    if (!i) return false;
    const q = pts[i - 1];
    const within = (v, a, b) => v >= Math.min(a, b) - 1.5 && v <= Math.max(a, b) + 1.5;
    return within(x, p.x, q.x) && within(y, p.y, q.y) && (Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5);
  });
assert.ok(onRoute(rb2Pts, 450, 720), "the route passes through the bend point: " + JSON.stringify(rb2Pts));
const last = rb2Pts.at(-1);
assert.ok(last.y < rbBox.y + 1, "it arrives on B's top side, as pointed at");
assert.ok(Math.abs(last.x - (rbBox.x + rbBox.width * 0.75)) < 2, "at the quarter point nearest the pointer");

await page.mouse.move(5, 5);
await page.screenshot({ path: path.join(shots, "link-created.png") });
// 4) Style keys: straight arrows, then a free end with a double-click.
await startLinkFrom("rA", "top");
await page.keyboard.press("r");
await page.keyboard.press("r");
await waitFor(async () => (await page.textContent(".md-qc-link-keys"))?.includes("Straight"), "R cycles to straight");
const cOnWall = await pointAt(630, 430);
await page.mouse.click(cOnWall.x, cOnWall.y);
await waitFor(async () => (await arrowsNow()).length === 3, "straight arrow added");
const straight = (await arrowsNow()).find((a) => a.to === "rWall");
assert.equal((await elFull(straight.id)).elbowed, false, "straight style is not an elbow");
await page.evaluate(() => localStorage.removeItem("mydraw.linkStyle"));
await startLinkFrom("rA", "left");
const freeSpot = await pointAt(500, 780); // clear canvas (the properties panel covers the left side)
await page.mouse.dblclick(freeSpot.x, freeSpot.y);
await waitFor(async () => (await arrowsNow()).length === 4, "free-ended arrow added");
const free = (await arrowsNow()).find((a) => !a.to && a.from === "rA");
assert.ok(free, "a double-click on empty canvas ends the arrow there, unattached");

// 5) ⌘-drag from a handle onto a target; Shift-click keeps linking.
await page.mouse.move(5, 5);
await call("select", { ids: [] });
await waitFor(async () => (await qcHandles()).length === 0, "no handles");
await call("select", { ids: ["rWall"] });
await waitFor(async () => (await qcHandles()).length === 4, "handles on the wall");
const wallRight = await page.$eval('.md-qc-handle[data-side="right"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const bDrop = await screenOf(rbBox.x + 60, rbBox.y + 30);
await page.keyboard.down("Meta");
await page.mouse.move(wallRight.x, wallRight.y);
await page.mouse.down();
await page.mouse.move(bDrop.x, bDrop.y, { steps: 8 });
await page.mouse.up();
await page.keyboard.up("Meta");
await waitFor(async () => (await arrowsNow()).some((a) => a.from === "rWall" && a.to === "rB"), "⌘-drag from a handle onto B connects");
const before5 = (await arrowsNow()).length;
await startLinkFrom("rWall", "bottom");
const aAgain = await pointAt(360, 430);
await page.keyboard.down("Shift");
await page.mouse.click(aAgain.x, aAgain.y);
await page.keyboard.up("Shift");
await waitFor(async () => (await arrowsNow()).length === before5 + 1, "Shift-click connects...");
assert.ok(await page.$(".md-qc-linkmode"), "...and keeps linking from the same shape");
const bAgain = await pointAt(rbBox.x + 60, rbBox.y + 30);
await page.mouse.click(bAgain.x, bAgain.y);
await waitFor(async () => (await arrowsNow()).length === before5 + 2, "second link from the same shape");
await waitFor(async () => !(await page.$(".md-qc-linkmode")), "a plain click ends linking");

// 6) Existing arrows: the palette command and the MCP tools route them around shapes.
await call("delete_elements", { ids: (await arrowsNow()).map((a) => a.id) });
await call("move", { ids: ["rB"], x: 900, y: 400 });
const through = (await call("connect", { from: "rA", to: "rB" })).id;
scene = await call("get_scene");
assert.ok(crossesBox(absPts(await elFull(through)), el("rWall")), "a plain straight arrow crosses the wall");
await call("select", { ids: [through] });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "route arrows around");
await page.keyboard.press("Enter");
await waitFor(async () => !crossesBox(absPts(await elFull(through)), el("rWall")), "the palette command routes it around the wall");
await call("undo");
await waitFor(async () => crossesBox(absPts(await elFull(through)), el("rWall")), "one undo puts it back");
await call("route_around", { ids: [through] });
assert.ok(!crossesBox(absPts(await elFull(through)), el("rWall")), "MCP route_around");
const avoided = (await call("connect", { from: "rB", to: "rA", avoid: true })).id;
assert.ok(!crossesBox(absPts(await elFull(avoided)), el("rWall")), "MCP connect with avoid:true");
assert.equal((await callRaw("route_around", { ids: ["rA"] })).isError, true, "only arrows");
// auto_layout keeps arrows that go around shapes doing so (and their Excalidraw segments match the new route).
await call("auto_layout");
const avoidedAfter = await elFull(avoided);
assert.equal(avoidedAfter.customData?.mydrawAvoid, true, "still routed around shapes after auto_layout");
assert.ok((avoidedAfter.fixedSegments ?? []).every((f) => f.index >= 2 && f.index <= avoidedAfter.points.length - 2), "fixed segments fit the new route");
await call("select", { ids: [] });

step("Phase 7: ⌘-link between shapes side by side (slightly out of line) or stacked close together draws a straight arrow");
await call("new_drawing", { title: "Straight link" });
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "s1", x: 300, y: 400, width: 64, height: 64 },
    { type: "rectangle", id: "s2", x: 520, y: 406, width: 64, height: 64 }, // 6px lower
    { type: "rectangle", id: "s3", x: 760, y: 396, width: 64, height: 64 }, // 4px higher than s1
    { type: "rectangle", id: "s4", x: 300, y: 500, width: 64, height: 64 }, // right below s1, only 36px apart
  ],
});
for (const [from, to, how, side] of [["s1", "s2", "auto", "right"], ["s2", "s3", "side", "right"], ["s1", "s4", "auto", "bottom"]]) {
  await startLinkFrom(from, side);
  scene = await call("get_scene");
  const tb = el(to);
  // auto: over the middle of the target; side: near its left edge (an explicit side).
  const aim = how === "auto" ? await pointAt(tb.x + tb.width / 2, tb.y + tb.height / 2) : await pointAt(tb.x + 3, tb.y + tb.height / 2);
  await page.waitForSelector(".md-qc-target");
  await page.mouse.click(aim.x, aim.y);
  await waitFor(async () => (await arrowsNow()).some((a) => a.from === from && a.to === to), `arrow ${from} -> ${to}`);
  const arrow = (await arrowsNow()).find((a) => a.from === from && a.to === to);
  const pts = absPts(await elFull(arrow.id));
  assert.equal(pts.length, 2, `${from} -> ${to} (${how}) is one straight segment: ` + JSON.stringify(pts));
  assert.ok(side === "right" ? Math.abs(pts[0].y - pts[1].y) < 0.5 : Math.abs(pts[0].x - pts[1].x) < 0.5, "and straight across");
}
await call("select", { ids: [] });

step("Phase 7: diagram lint (⌥⌘L): rules over MCP, fix:true is one undo step, panel rows select and fix");
await call("new_drawing", { title: "Lint" });
await call("add_elements", {
  elements: [
    // Below the toolbars. "lb" overlaps "la"; the free arrow ends 20px left of "lc".
    { type: "rectangle", id: "la", x: 300, y: 320, width: 160, height: 80, label: "Web" },
    { type: "rectangle", id: "lb", x: 420, y: 350, width: 160, height: 80, label: "App" },
    { type: "rectangle", id: "lc", x: 800, y: 320, width: 160, height: 80, label: "DB" },
    { type: "arrow", id: "lar", x: 650, y: 360, points: [[0, 0], [130, 0]] },
    { type: "rectangle", id: "lu", x: 300, y: 560, width: 120, height: 60 },
    { type: "rectangle", id: "ld", x: 800, y: 560, width: 160, height: 80, label: "Cache", strokeColor: "#123457" },
  ],
});
await call("update_elements", { updates: [{ id: "la", data: { ip: "10.0.0.1" } }, { id: "lb", data: { ip: "10.0.0.2" } }] });
let lint = await call("lint_diagram");
const hasIssue = (r, rule, id) => r.issues.some((i) => i.rule === rule && i.id === id);
assert.ok(lint.issues.some((i) => i.rule === "overlap" && [i.id, i.other].sort().join() === "la,lb"), "overlap reported");
const freeArrow = lint.issues.find((i) => i.rule === "unconnected-arrow" && i.id === "lar");
assert.ok(freeArrow && freeArrow.ends.join() === "start,end" && freeArrow.fix?.end === "lc" && !freeArrow.fix.start, "free arrow, end can attach to DB");
assert.ok(hasIssue(lint, "unlabeled-node", "lu"), "unlabeled node reported");
assert.ok(hasIssue(lint, "missing-ip", "lc") && hasIssue(lint, "missing-ip", "ld") && !hasIssue(lint, "missing-ip", "la"), "missing IPs reported");
const offColor = lint.issues.find((i) => i.rule === "off-palette-color" && i.id === "ld");
assert.ok(offColor && offColor.fix?.property === "strokeColor", "off-palette color reported");
assert.equal(lint.issues[0].severity, "warning", "warnings first");
assert.equal(lint.summary.overlap, 1);
assert.deepEqual((await call("lint_diagram", { rules: ["missing-ip"] })).issues.map((i) => i.rule).filter((r) => r !== "missing-ip"), [], "rules limit the check");
assert.equal((await callRaw("lint_diagram", { rules: ["nope"] })).isError, true, "unknown rules are refused");
const fixedLint = await call("lint_diagram", { fix: true });
assert.ok(fixedLint.fixed >= 2, "fixes applied");
assert.ok(!fixedLint.issues.some((i) => i.rule === "off-palette-color"), "colors snapped");
assert.ok(hasIssue(fixedLint, "overlap", "lb") || hasIssue(fixedLint, "overlap", "la"), "overlaps are left alone");
const [ldFixed] = await call("get_element", { id: "ld" });
assert.equal(ldFixed.element.strokeColor, offColor.fix.color, "stroke snapped to the nearest palette color");
let [larFull] = await call("get_element", { id: "lar" });
assert.equal(larFull.element.endBinding?.elementId, "lc", "arrow end bound to DB");
assert.ok((await call("get_element", { id: "lc" }))[0].element.boundElements.some((b) => b.id === "lar"), "DB lists the arrow");
await call("undo");
await waitFor(async () => (await call("get_element", { id: "ld" }))[0].element.strokeColor === "#123457", "ONE undo restores the color");
[larFull] = await call("get_element", { id: "lar" });
assert.ok(!larFull.element.endBinding, "and unbinds the arrow");

// The panel: open with ⌥⌘L, click a row to select its element, fix all from the panel.
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+KeyL`);
await page.waitForSelector(".md-lint");
await waitFor(async () => (await page.locator(".md-lint-row").count()) >= 6, "lint rows listed");
assert.ok(await page.isVisible('.md-lint-row[data-rule="unconnected-arrow"] .md-lint-fix'), "fixable row has a Fix button");
await page.click('.md-lint-row[data-rule="unlabeled-node"][data-id="lu"]');
await waitFor(async () => (await t((x) => x.appStateValue("selectedElementIds")))?.lu === true, "clicking a row selects the element");
await page.click(".md-lint-fixall");
await waitFor(async () => (await page.locator(".md-lint-fix").count()) === 0, "fixable rows gone");
assert.equal(await page.locator('.md-lint-row[data-rule="off-palette-color"]').count(), 0);
assert.equal(await page.locator('.md-lint-row[data-rule="unconnected-arrow"][data-id="lar"]').count(), 1, "arrow start is still free (nothing near)");
assert.equal((await call("get_element", { id: "lar" }))[0].element.endBinding?.elementId, "lc", "panel fix bound the arrow");
assert.ok(await page.isVisible('.md-lint-row[data-rule="overlap"]'), "unfixable rows stay");
await call("delete_elements", { ids: ["la", "lb", "lc", "lar", "lu", "ld"] });
await page.waitForSelector(".md-lint-empty >> text=No problems found");
await page.keyboard.press(`${MOD}+Alt+KeyL`);
await waitFor(async () => !(await page.$(".md-lint")), "lint panel toggles closed");

// ---------- Phase 8: data features ----------
step("Phase 8: properties panel edits a node's hostname/IP/role; get_inventory and set_properties agree");
await call("new_drawing", { title: "Props" });
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "p1", x: 300, y: 300, width: 160, height: 80, label: "Core" },
    { type: "rectangle", id: "p2", x: 700, y: 300, width: 160, height: 80, label: "Edge" },
  ],
});
await call("select", { ids: ["p1"] });
const propInput = (key) => `.md-props [data-prop="${key}"]`;
await page.waitForSelector(propInput("ip"), { timeout: 10000 });
await page.fill(propInput("ip"), "10.0.0.1");
await page.fill(propInput("hostname"), "core-1");
await page.press(propInput("hostname"), "Enter");
await waitFor(async () => {
  const d = (await call("get_element", { id: "p1" }))[0].element.customData ?? {};
  return d.ip === "10.0.0.1" && d.hostname === "core-1";
}, "typing in the panel stores ip and hostname");
await page.fill(propInput("role"), "core switch");
await page.press(propInput("role"), "Tab");
await waitFor(async () => (await call("get_element", { id: "p1" }))[0].element.customData?.role === "core switch", "blur commits");
let inv = await call("get_inventory");
let core = inv.nodes.find((n) => n.name === "Core");
assert.equal(core.ip, "10.0.0.1");
assert.equal(core.hostname, "core-1");
assert.equal(core.role, "core switch");
assert.ok(inv.columns.includes("vlan") && inv.columns.includes("owner"));

await call("set_properties", { id: "p2", properties: { ip: "10.0.0.2", rack: "A1", vlan: "20" } });
inv = await call("get_inventory");
const edge = inv.nodes.find((n) => n.name === "Edge");
assert.deepEqual([edge.ip, edge.vlan, edge.extra.rack], ["10.0.0.2", "20", "A1"]);
await call("select", { ids: ["p2"] });
await waitFor(async () => (await page.inputValue(propInput("ip"))) === "10.0.0.2", "panel follows the selection");
await call("set_properties", { id: "p2", properties: { ip: null } });
assert.equal((await call("get_inventory")).nodes.find((n) => n.name === "Edge").ip, "");
assert.equal((await callRaw("set_properties", { id: "p2", properties: { mydrawNode: "x" } })).isError, true, "reserved keys refused");
await call("select", { ids: ["p1", "p2"] });
await waitFor(async () => !(await page.$(".md-props")), "no properties section for a multi-selection");

step("Phase 8: inventory table (⌥⌘T) lists nodes, filters, sorts, and edits the diagram");
await call("select", { ids: [] });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+KeyT`);
await page.waitForSelector(".md-inv");
const invNames = () => page.$$eval('.md-inv-cell[data-col="name"]', (els) => els.map((e) => e.value));
await waitFor(async () => (await invNames()).join() === "Core,Edge", "both nodes listed");
await page.fill(".md-inv-filter", "core");
await waitFor(async () => (await invNames()).join() === "Core", "filter narrows the rows");
assert.ok((await page.textContent(".md-inv-count")).includes("1 of 2"));
await page.fill(".md-inv-filter", "");
await page.fill('.md-inv-cell[data-row="p2"][data-col="ip"]', "10.0.0.20");
await page.press('.md-inv-cell[data-row="p2"][data-col="ip"]', "Enter");
await waitFor(async () => (await call("get_inventory")).nodes.find((n) => n.id === "p2").ip === "10.0.0.20", "ip edit reaches the diagram");
await page.fill('.md-inv-cell[data-row="p2"][data-col="name"]', "Edge-1");
await page.press('.md-inv-cell[data-row="p2"][data-col="name"]', "Enter");
await waitFor(async () => JSON.stringify(await call("get_scene")).includes("Edge-1"), "rename edits the label on the canvas");
await page.click('.md-inv-table th:has-text("IP")');
await waitFor(async () => (await invNames()).join() === "Core,Edge-1", "sorted by IP ascending");
await page.click('.md-inv-table th:has-text("IP")');
await waitFor(async () => (await invNames()).join() === "Edge-1,Core", "sorted by IP descending");
await page.click('.md-modal-actions button:text-is("Export CSV…")');
await page.waitForSelector(".md-export-options .md-seg button.on:text-is('CSV')", { timeout: 10000 });
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-export")), "export dialog closed");

step("Phase 8: import_diagram builds CSV, YAML and Mermaid; the import dialog (⌥⌘U) does the same");
await call("new_drawing", { title: "Import" });
const csvText = [
  "name,zone,ip,hostname,role,connects_to",
  "core,Prod,10.0.1.1,core-1,switch,web-1;web-2;Internet",
  "web-1,Prod / DMZ,10.0.1.10,,web,",
  "web-2,Prod / DMZ,10.0.1.11,,web,core",
].join("\n");
let imp = await call("import_diagram", { format: "csv", text: csvText });
assert.equal(imp.nodes.length, 4, "three rows plus the linked-to Internet node");
assert.equal(imp.edges.length, 3, "core-web-1, core-web-2 (both ways merged), core-Internet");
assert.equal(imp.zones.length, 2, "Prod and Prod / DMZ");
assert.ok(imp.warnings.some((w) => w.includes("Internet")), "unlisted link target is reported");
inv = await call("get_inventory");
core = inv.nodes.find((n) => n.name === "core");
assert.deepEqual([core.ip, core.hostname, core.role, core.zone], ["10.0.1.1", "core-1", "switch", "Prod"]);
assert.equal(inv.nodes.find((n) => n.name === "web-1").zone, "Prod / DMZ");

const yamlFile = path.join(work, "net.yaml");
fs.writeFileSync(yamlFile, "direction: right\nnodes:\n  users: Users\n  api: { label: API, data: { ip: 10.9.0.1 } }\n  db: Database\nedges:\n  - users -> api: HTTPS\n  - api -> db: SQL\n");
imp = await call("import_diagram", { path: yamlFile });
assert.equal(imp.format, "yaml");
assert.equal(imp.nodes.length, 3);
assert.equal(imp.edges.length, 2);
assert.equal((await call("get_inventory")).nodes.find((n) => n.name === "API").ip, "10.9.0.1");

imp = await call("import_diagram", { format: "mermaid", text: "flowchart LR\n  A[Alpha] --> B[Beta]\n  B --> C[Gamma]" });
assert.equal(imp.nodes.length, 3);

for (const [args, what] of [
  [{ format: "csv", text: "a,b\n1,2" }, "csv without a name column"],
  [{ format: "yaml", text: "nodes: [a\n" }, "invalid yaml"],
  [{ text: "x" }, "no format"],
  [{ format: "csv", path: path.join(work, "does-not-exist.csv") }, "missing file"],
]) {
  assert.equal((await callRaw("import_diagram", args)).isError, true, what);
}

// The dialog.
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
const beforeCount = (await call("get_inventory")).nodes.length;
await page.keyboard.press(`${MOD}+Alt+KeyU`);
await page.waitForSelector(".md-import");
await page.click('.md-import .md-seg button:text-is("YAML")');
await page.fill(".md-import-text", "nodes: [a\n");
await page.click('.md-import .md-modal-actions button:text-is("Import")');
await page.waitForSelector(".md-import-error", { timeout: 10000 });
assert.ok((await page.textContent(".md-import-error")).includes("invalid YAML"), "errors show in the dialog");
await page.fill(".md-import-text", "nodes: [Router A, Router B]\nedges:\n  - Router A -> Router B");
await page.click('.md-import .md-modal-actions button:text-is("Import")');
await waitFor(async () => !(await page.$(".md-import")), "dialog closes after a successful import");
await waitFor(async () => (await call("get_inventory")).nodes.length === beforeCount + 2, "two nodes imported from the dialog");
await page.waitForSelector(".md-toast", { timeout: 5000 });
assert.ok((await page.textContent(".md-toast")).includes("Imported 2 nodes, 1 connection"), "toast summarises the import");

step("Phase 8: version history keeps a snapshot per changed save; preview and restore (one undo step)");
await call("new_drawing", { title: "Snap" });
const snapFile = path.join(work, "snap", "versions.excalidraw");
fs.mkdirSync(path.dirname(snapFile), { recursive: true });
await call("add_elements", { elements: [{ type: "rectangle", id: "s1", x: 300, y: 300, width: 160, height: 80, label: "One" }] });
await call("save", { path: snapFile });
await call("add_elements", { elements: [{ type: "rectangle", id: "s2", x: 600, y: 300, width: 160, height: 80, label: "Two" }] });
await call("save", { path: snapFile });
await call("save", { path: snapFile }); // unchanged: no new snapshot
const snapList = await page.evaluate((f) => window.mydraw.listSnapshots(f), snapFile);
assert.equal(snapList.length, 2, "one snapshot per changed save, none for an identical one");
assert.ok(snapList[0].time > snapList[1].time, "newest first");

await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+KeyV`);
await page.waitForSelector(".md-hist");
await waitFor(async () => (await page.locator(".md-hist-item").count()) === 2, "two versions listed");
await page.waitForSelector(".md-hist-preview img", { timeout: 10000 });
await page.click(".md-hist-item >> nth=1"); // the older version
await page.waitForSelector(".md-hist-preview img", { timeout: 10000 });
await page.click('.md-hist .md-modal-actions button:text-is("Restore this version")');
await waitFor(async () => !(await page.$(".md-hist")), "dialog closes after restoring");
await waitFor(async () => (await call("get_inventory")).nodes.map((n) => n.name).join() === "One", "the older version is back (Two is gone)");
await call("undo");
await waitFor(async () => (await call("get_inventory")).nodes.map((n) => n.name).sort().join() === "One,Two", "one undo brings the newer state back");

await call("new_drawing", { title: "Never saved" });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+KeyV`);
await page.waitForSelector(".md-toast.error", { timeout: 5000 });
assert.ok((await page.textContent(".md-toast.error")).includes("Save the drawing first"), "unsaved drawings have no history yet");
assert.equal(await page.$(".md-hist"), null);

step("Phase 8: presentation mode shows each frame as a slide; keys and clicks navigate; Esc leaves");
await call("new_drawing", { title: "Deck" });
await call("add_elements", {
  elements: [
    { type: "frame", id: "d-intro", x: 0, y: 300, width: 600, height: 340, name: "Intro", children: [] },
    { type: "frame", id: "d-net", x: 700, y: 300, width: 600, height: 340, name: "Network", children: [] },
    { type: "rectangle", id: "d-a", x: 80, y: 380, width: 160, height: 80, label: "Hello" },
    { type: "rectangle", id: "d-b", x: 780, y: 380, width: 160, height: 80, label: "Core" },
  ],
});
await call("raw_update", { elements: [{ id: "d-a", frameId: "d-intro" }, { id: "d-b", frameId: "d-net" }] });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Shift+P`);
await page.fill(".md-pal-input", "start presentation");
await page.keyboard.press("Enter");
await page.waitForSelector(".md-present");
const slideState = () => page.evaluate(() => {
  const el = document.querySelector(".md-present");
  return el ? `${el.dataset.index}/${el.dataset.count}|${document.querySelector(".md-present-hud span:nth-child(2)")?.textContent}` : null;
});
assert.equal(await slideState(), "0/2|Intro");
await page.waitForSelector(".md-present-slide", { timeout: 15000 });
await page.keyboard.press("ArrowRight");
await waitFor(async () => (await slideState()) === "1/2|Network", "arrow right goes to the next slide");
await page.waitForSelector(".md-present-slide", { timeout: 15000 });
await page.keyboard.press("ArrowRight");
assert.equal(await slideState(), "1/2|Network", "stays on the last slide");
await page.keyboard.press("ArrowLeft");
await waitFor(async () => (await slideState()) === "0/2|Intro", "arrow left goes back");
await page.mouse.click(1100, 400); // right part of the window: next
await waitFor(async () => (await slideState()) === "1/2|Network", "clicking the right side advances");
await page.mouse.click(100, 400); // left third: back
await waitFor(async () => (await slideState()) === "0/2|Intro", "clicking the left side goes back");
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-present")), "Escape leaves the presentation");

// Without frames the whole drawing is one slide.
await call("new_drawing", { title: "One slide" });
await call("add_elements", { elements: [{ type: "rectangle", id: "o1", x: 300, y: 300, width: 160, height: 80, label: "Only" }] });
await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
await page.keyboard.press(`${MOD}+Alt+Enter`);
await page.waitForSelector(".md-present");
assert.equal(await slideState(), "0/1|Drawing");
await page.waitForSelector(".md-present-slide", { timeout: 15000 });
await page.click('.md-present-hud button[aria-label="End presentation"]');
await waitFor(async () => !(await page.$(".md-present")), "the close button leaves too");

step("Phase 8: a .drawio file opens as a new unsaved drawing (labels, properties, zones, edges), never saved back into the .drawio");
const opened = await call("open_drawing", { path: drawioFile });
assert.equal(opened.path, null, "an imported drawing has no file yet");
assert.equal((await t((x) => x.state())).tabs.find((tab) => tab.id === opened.id)?.dirty, true, "unsaved import: closing asks, recovery keeps it");
const importedInv = await call("get_inventory");
assert.ok(importedInv.nodes.some((n) => n.name === "Web | 1" && n.ip === "10.0.0.5"), "labels and properties survive");
assert.ok(importedInv.nodes.some((n) => n.name === "Database"));
const importedScene = await call("get_scene");
assert.ok(importedScene.elements.some((e) => e.type === "arrow" && e.from && e.to), "edges come in bound");
assert.ok((await page.evaluate(() => window.mydraw.getSettings())).recentFiles.every((f) => !f.endsWith(".drawio")), "not added to the recent files");
const importedSave = path.join(work, "from-drawio.excalidraw");
await call("save", { path: importedSave });
assert.equal(JSON.parse(fs.readFileSync(importedSave, "utf8")).type, "excalidraw");
assert.ok(fs.readFileSync(drawioFile, "utf8").startsWith("<"), "the .drawio file itself is untouched");

step("Layout grid: painted inside Excalidraw's canvas behind shapes, Excalidraw's own grid hidden, live snapping, ⌘', clean files, fallback");
// If this step fails after an Excalidraw upgrade, read EXCALIDRAW-UPGRADE.md.
// Pixel on screen (after CSS filters), via a screenshot.
/** Screen pixel at a scene point (after CSS filters); with r > 0, all pixels of the (2r+1)² square around it. */
const screenPixel = async (sx, sy, r = 0) => {
  const png = await page.screenshot();
  return page.evaluate(
    async ([b64, sx, sy, r]) => {
      const bm = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
      const c = new OffscreenCanvas(bm.width, bm.height);
      const g = c.getContext("2d");
      g.drawImage(bm, 0, 0);
      const st = window.__mydrawTest.api().getAppState();
      const k = bm.width / window.innerWidth;
      const px = Math.round(((sx + st.scrollX) * st.zoom.value + st.offsetLeft) * k);
      const py = Math.round(((sy + st.scrollY) * st.zoom.value + st.offsetTop) * k);
      const d = g.getImageData(px - r, py - r, 2 * r + 1, 2 * r + 1).data;
      const out = [];
      for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
      return r ? out : out[0];
    },
    [png.toString("base64"), sx, sy, r],
  );
};
const near = (a, hex, tol = 4) => [1, 3, 5].every((i, k) => Math.abs(a[k] - parseInt(hex.slice(i, i + 2), 16)) <= tol);
await page.evaluate(() => window.mydraw.updateSettings({ theme: "light" }));
await call("new_drawing", { title: "Grid" });
await call("add_elements", { elements: [{ type: "rectangle", id: "gbox", x: 333, y: 357, width: 160, height: 80, backgroundColor: "#ffd8a8", fillStyle: "solid" }] });
const gridOn = { enabled: true, snap: true, size: 25, majorEvery: 4, style: "lines", color: "#ff0000", opacity: 1 };
await page.evaluate((g) => window.mydraw.updateSettings({ grid: g }), gridOn);
const gridStatus = () => t((x) => x.canvasStatus());
await waitFor(async () => (await gridStatus())?.mode === "in-canvas", "grid hook reports in-canvas");
assert.equal((await gridStatus()).snapOk, true, "Excalidraw's grid lines were recognised and hidden (snapping usable)");
assert.ok((await gridStatus()).gridModeRendersSuppressed > 0, "Excalidraw grid strokes were suppressed");
// Read pixels of the active tab's static canvas around a scene point (±1 device px).
const staticPixels = (sx, sy) =>
  page.evaluate(([sx, sy]) => {
    const api = window.__mydrawTest.api();
    const st = api.getAppState();
    const dpr = window.devicePixelRatio || 1;
    const c = document.querySelector('.md-drawing:not([style*="display: none"]) canvas.excalidraw__canvas.static');
    const px = Math.round((sx + st.scrollX) * st.zoom.value * dpr);
    const py = Math.round((sy + st.scrollY) * st.zoom.value * dpr);
    const d = c.getContext("2d").getImageData(px - 1, py - 1, 3, 3).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, [sx, sy]);
const isRed = ([r, g, b]) => r > 200 && g < 90 && b < 90;
const isGray = ([r, g, b]) => Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r > 180 && r < 240;
// A grid line away from the shape: red (ours), never Excalidraw's grey.
assert.ok((await staticPixels(600, 625)).some(isRed), "our grid line is painted in the canvas");
assert.ok(!(await staticPixels(600, 612)).some(isGray), "Excalidraw's own grey grid is hidden");
// The same line inside the filled shape: covered by the fill, i.e. the grid is BEHIND the shape.
assert.ok(!(await staticPixels(400, 400)).some(isRed), "the grid is behind filled shapes");
// With a shape selected (style panel open), the main menu must open ON TOP of the panel.
await page.mouse.click(...Object.values(await t((x) => x.toScreen(340, 400))));
await page.waitForSelector(".md-style");
await page.click('.md-drawing:not([style*="display: none"]) .dropdown-menu-button');
const menuOnTop = await page.evaluate(() => {
  const m = document.querySelector(".md-drawing:not([style*='display: none']) .dropdown-menu");
  const r = m.getBoundingClientRect();
  return !!document.elementFromPoint(r.left + 60, r.top + 150)?.closest(".dropdown-menu");
});
assert.ok(menuOnTop, "the main menu opens above the style panel");
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$(".md-drawing:not([style*='display: none']) .dropdown-menu")), "menu closed");
// Live snapping: drag the box by an odd amount; it lands on the 25px grid.
const gStart = await t((x) => x.toScreen(353, 377));
await page.mouse.move(gStart.x, gStart.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(gStart.x + i * 13.3, gStart.y + i * 7.9, { steps: 2 });
await page.mouse.up();
const gBox = await t((x) => x.api().getSceneElements().find((e) => e.id === "gbox"));
assert.ok(gBox.x !== 333 && gBox.x % 25 === 0 && gBox.y % 25 === 0, `snapped while dragging (${gBox.x}, ${gBox.y})`);
// ⌘' toggles our grid (and Excalidraw's own ⌘' never runs).
await page.keyboard.press(`${MOD}+Quote`);
await waitFor(async () => !(await page.evaluate(() => window.mydraw.getSettings())).grid.enabled, "⌘' hides the grid");
await waitFor(async () => (await t((x) => x.appStateValue("gridModeEnabled"))) === false, "grid mode (snapping) off with the grid hidden");
await page.keyboard.press(`${MOD}+Quote`);
await waitFor(async () => (await page.evaluate(() => window.mydraw.getSettings())).grid.enabled, "⌘' shows it again");
await waitFor(async () => (await t((x) => x.appStateValue("gridModeEnabled"))) === true, "snapping back on");
// Saved files don't carry the app's grid state.
const gridFile = path.join(work, "grid.excalidraw");
await call("save", { path: gridFile });
const gridSaved = JSON.parse(fs.readFileSync(gridFile, "utf8")).appState;
assert.equal(gridSaved.gridModeEnabled, false, "grid mode is not saved into the drawing");
assert.equal(gridSaved.gridSize, 20, "Excalidraw's default grid size is saved, not ours");
// Excalidraw's own "Toggle grid" (context menu) toggles ours instead.
await t((x) => x.api().updateScene({ appState: { gridModeEnabled: false } }));
await waitFor(async () => !(await page.evaluate(() => window.mydraw.getSettings())).grid.enabled, "Excalidraw's toggle hides our grid");
await page.evaluate((g) => window.mydraw.updateSettings({ grid: g }), gridOn);
await waitFor(async () => (await t((x) => x.appStateValue("gridModeEnabled"))) === true, "grid back on");
// Dark mode: the theme is applied inside the canvas and the grid painted unfiltered, so the grid
// shows exactly the chosen colour on screen (vertical line at x=600).
const themedBefore = (await gridStatus()).themedRenders;
await page.evaluate(() => window.mydraw.updateSettings({ theme: "dark" }));
await waitFor(async () => (await gridStatus()).themedRenders > themedBefore, "dark render done in-canvas");
await sleep(300);
const darkGridPx = await screenPixel(600, 612, 2);
assert.ok(darkGridPx.some((p) => near(p, "#ff0000", 6)), `dark mode: grid shows the chosen colour exactly (got ${JSON.stringify(darkGridPx.slice(0, 5))}, status ${JSON.stringify(await gridStatus())}, css ${await page.evaluate(() => document.querySelector('.md-drawing:not([style*="display: none"]) canvas.excalidraw__canvas.static').style.filter)})`);
await page.screenshot({ path: path.join(shots, "grid-dark.png") });
await page.evaluate(() => window.mydraw.updateSettings({ theme: "light" }));
// Fallback: if the hook stops seeing renders (Excalidraw changed), the overlay draws and snapping is off.
await page.evaluate(() => (window.__mydrawNoGridHook = true));
await page.evaluate(() => window.mydraw.updateSettings({ grid: { opacity: 0.9 } }));
await waitFor(async () => (await gridStatus())?.mode === "overlay", "falls back to the overlay grid", 5000);
assert.equal((await gridStatus()).snapOk, false, "no live snapping in the fallback");
await waitFor(async () => (await t((x) => x.appStateValue("gridModeEnabled"))) === false, "grid mode off in the fallback");
const overlayRed = await page.evaluate(() => {
  const c = document.querySelector('.md-drawing:not([style*="display: none"]) .md-grid-canvas');
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 3] > 100) n++;
  return n;
});
assert.ok(overlayRed > 1000, "the overlay grid is drawn");
await t((x) => x.command({ type: "gridSettings" }));
await page.waitForSelector(".md-gridpanel-warn");
await page.screenshot({ path: path.join(shots, "grid-fallback.png") });
await page.evaluate(() => (window.__mydrawNoGridHook = false));
await page.evaluate(() => window.mydraw.updateSettings({ grid: { enabled: false } }));
await page.click('.md-gridpanel-x');

step("Align & distribute: Excalidraw's section sits just above Edges; palette Arrange commands work");
await call("new_drawing", { title: "Arrange" });
await call("add_elements", {
  elements: [
    { type: "rectangle", id: "ar1", x: 300, y: 317, width: 120, height: 60 },
    { type: "rectangle", id: "ar2", x: 520, y: 334, width: 120, height: 60 },
    { type: "rectangle", id: "ar3", x: 980, y: 351, width: 120, height: 60 },
  ],
});
await call("select", { ids: ["ar1", "ar2", "ar3"] });
await page.waitForSelector('.md-drawing:not([style*="display: none"]) .md-arrange');
const arrangePlace = await page.evaluate(() => {
  const root = document.querySelector('.md-drawing:not([style*="display: none"])');
  const align = root.querySelector(".md-arrange").getBoundingClientRect();
  const edges = root.querySelector('fieldset input[name="edges"]').closest("fieldset").getBoundingClientRect();
  const sloppiness = [...root.querySelectorAll(".panelColumn > fieldset")].find((f) => f.querySelector('input[name="sloppiness"]'))?.getBoundingClientRect();
  return { aboveEdges: align.bottom <= edges.top + 1 && edges.top - align.bottom < 40, belowSloppiness: !sloppiness || sloppiness.bottom <= align.top + 1 };
});
assert.ok(arrangePlace.aboveEdges && arrangePlace.belowSloppiness, `Align sits just above Edges (${JSON.stringify(arrangePlace)})`);
const arrangeRun = async (query) => {
  await page.keyboard.press(`${MOD}+Shift+KeyP`);
  await waitFor(() => t((x) => x.paletteOpen()), "palette open");
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await waitFor(async () => !(await t((x) => x.paletteOpen())), "palette closed");
};
const arrangeBoxes = () => t((x) => x.api().getSceneElements().filter((e) => e.id.startsWith("ar")).sort((a, b) => a.x - b.x).map((e) => [Math.round(e.x), Math.round(e.y)]));
await arrangeRun("distribute horizontally");
await waitFor(async () => JSON.stringify((await arrangeBoxes()).map((b) => b[0])) === "[300,640,980]", "equal gaps after distribute");
await arrangeRun("align top");
await waitFor(async () => (await arrangeBoxes()).every((b) => b[1] === 317), "aligned to the top edge");

step("Dark mode: icons keep their exact colours on screen (in-canvas theme), shapes look as before, fallback = Excalidraw's own filter");
// If this step fails after an Excalidraw upgrade, read EXCALIDRAW-UPGRADE.md.
const brandSvg = path.join(work, "BrandRed.svg");
fs.writeFileSync(brandSvg, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#cc092f"/></svg>');
await call("add_stencil_file", { path: brandSvg, collection: "Smoke Colours" });
await call("new_drawing", { title: "Dark icons" });
const brandItem = (await waitFor(async () => (await call("search_stencils", { query: "BrandRed" })).items[0], "BrandRed stencil indexed"));
const brandNode = await call("place_stencil", { id: brandItem.id, x: 400, y: 400, label: false });
await call("add_elements", { elements: [{ type: "rectangle", id: "dkred", x: 600, y: 360, width: 120, height: 80, backgroundColor: "#e03131", fillStyle: "solid" }] });
await call("select", { ids: [] });
const brandIcon = await t((x, id) => x.api().getSceneElements().find((e) => e.id === id), brandNode.icon);
const iconX = brandIcon.x + brandIcon.width / 2;
const iconY = brandIcon.y + brandIcon.height / 2;
assert.ok(near(await screenPixel(iconX, iconY), "#cc092f"), "light mode: exact icon colour");
await page.evaluate(() => window.mydraw.updateSettings({ theme: "dark" }));
await waitFor(async () => (await t((x) => x.canvasStatus()))?.themedRenders > 0, "dark render done in-canvas");
await sleep(300);
const darkIconPx = await screenPixel(iconX, iconY);
assert.ok(near(darkIconPx, "#cc092f"), `dark mode: exact icon colour (got ${darkIconPx})`);
assert.ok(near(await screenPixel(300, 600), "#121212", 3), "dark background as before");
// A filled shape looks exactly as Excalidraw's CSS filter would show it.
const cssRed = await page.evaluate(() => {
  const c = new OffscreenCanvas(2, 2);
  const g = c.getContext("2d");
  g.filter = "invert(93%) hue-rotate(180deg)";
  g.fillStyle = "#e03131";
  g.fillRect(0, 0, 2, 2);
  const d = g.getImageData(0, 0, 1, 1).data;
  return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
});
assert.ok(near(await screenPixel(660, 400), cssRed, 3), `shapes unchanged in dark mode (${cssRed})`);
assert.equal((await t((x) => x.canvasStatus())).themeLost, 0, "the in-canvas theme held for every element");
// Dark exports (Excalidraw's own export path) keep exact image colours too.
const darkExport = path.join(work, "dark-icons.png");
await t((x, p) => x.exportTo(p, { format: "png", darkMode: true, background: true, scale: 1, padding: 10 }), darkExport);
const exportHasBrand = await page.evaluate(async (b64) => {
  const bm = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
  const c = new OffscreenCanvas(bm.width, bm.height);
  const g = c.getContext("2d");
  g.drawImage(bm, 0, 0);
  const d = g.getImageData(0, 0, bm.width, bm.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0xcc) <= 4 && Math.abs(d[i + 1] - 0x09) <= 4 && Math.abs(d[i + 2] - 0x2f) <= 4) n++;
  return n;
}, fs.readFileSync(darkExport).toString("base64"));
assert.ok(exportHasBrand > 500, "dark PNG export has the exact icon colour");
// Back to light: everything back to normal.
await page.evaluate(() => window.mydraw.updateSettings({ theme: "light" }));
await sleep(500);
assert.ok(near(await screenPixel(iconX, iconY), "#cc092f"), "light again: exact icon colour");
assert.ok(near(await screenPixel(660, 400), "#e03131"), "light again: shape colour");
// Fallback: hook gone -> Excalidraw's own CSS filter and its approximate image correction (not inverted).
await page.evaluate(() => (window.__mydrawNoGridHook = true));
await page.evaluate(() => window.mydraw.updateSettings({ theme: "dark" }));
await waitFor(async () => (await t((x) => x.canvasStatus()))?.mode === "overlay", "canvas hook falls back", 5000);
await sleep(300);
const fbPx = await screenPixel(iconX, iconY);
assert.ok(near(fbPx, "#993f69", 8), `fallback: Excalidraw's own dark image correction (got ${fbPx})`);
await page.evaluate(() => (window.__mydrawNoGridHook = false));
await page.evaluate(() => window.mydraw.updateSettings({ theme: "light" }));

await client.close();

app.process().kill("SIGKILL");

// ---------- mydraw CLI (headless; the app is closed now) ----------
step("CLI: export and convert with the app closed");
const cli = (...args) => {
  const r = spawnSync(process.execPath, [path.join(root, "bin", "mydraw.mjs"), ...args], { cwd: work, encoding: "utf8", timeout: 120000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const help = cli("help");
assert.equal(help.code, 0);
assert.ok(help.out.includes("mydraw export"), "CLI help");
assert.equal(cli("export").code, 2, "usage error exit code");

const cliJpg = path.join(work, "cli-prod.jpg");
let r = cli("export", exportsFrozen, "--format", "jpg", "--scale", "2", "--frame", "Prod", "-o", cliJpg);
assert.equal(r.code, 0, r.err);
assert.deepEqual([...fs.readFileSync(cliJpg).subarray(0, 3)], [0xff, 0xd8, 0xff], "CLI JPG magic");
r = cli("export", exportsFrozen, "--frame", "Nope", "-o", path.join(work, "nope.png"));
assert.equal(r.code, 1);
assert.ok(/no frame "Nope"/.test(r.err), r.err);

r = cli("export", exportsFrozen, "--scope", "frames", "--format", "pdf", "--page", "a4", "-o", path.join(work, "cli.pdf"));
assert.equal(r.code, 0, r.err);
assert.ok(r.out.includes("2 pages"));
assert.equal(pdfPages(path.join(work, "cli.pdf")), 2, "CLI PDF, one page per frame");
r = cli("export", exportsFrozen, "--scope", "frames", "-f", "pptx", "-o", path.join(work, "cli.pptx"), "--slides", "4:3", "--dark");
assert.equal(r.code, 0, r.err);
assert.equal(zipSlides(path.join(work, "cli.pptx")), 2, "CLI PPTX slides");
r = cli("export", exportsFrozen, "--scope", "frames", "-o", path.join(work, "cli-frames"), "--format", "webp", "--no-background");
assert.equal(r.code, 0, r.err);
assert.deepEqual(fs.readdirSync(path.join(work, "cli-frames")).sort(), ["Prod.webp", "Staging.webp"]);
r = cli("export", exportsFrozen, "-f", "csv");
assert.equal(r.code, 0, r.err);
assert.ok(fs.readFileSync(path.join(frozenDir, "exports-test.csv"), "utf8").startsWith("name,kind,type,zone"), "CLI default output next to the input");

// draw.io -> excalidraw keeps the node labels (and the properties).
const labelsOf = (file) => {
  const els = JSON.parse(fs.readFileSync(file, "utf8")).elements.filter((e) => !e.isDeleted);
  const byId = new Map(els.map((e) => [e.id, e]));
  return els
    .filter((e) => e.type === "text" && e.containerId && ["rectangle", "ellipse", "diamond"].includes(byId.get(e.containerId)?.type))
    .map((e) => e.text)
    .sort();
};
const converted = path.join(work, "converted.excalidraw");
r = cli("convert", drawioFile, "--to", "excalidraw", "-o", converted);
assert.equal(r.code, 0, r.err);
assert.deepEqual(labelsOf(converted), labelsOf(exportsFrozen), "draw.io round trip keeps the node labels");
assert.ok(labelsOf(converted).includes("Web | 1"));
const convEls = JSON.parse(fs.readFileSync(converted, "utf8")).elements;
assert.ok(convEls.some((e) => e.customData?.ip === "10.0.0.5"), "properties survive the round trip");
assert.ok(convEls.filter((e) => e.customData?.mydrawZone).length === 2, "zones survive the round trip");
assert.ok(convEls.filter((e) => e.type === "arrow" && e.startBinding && e.endBinding).length >= 2, "bound edges survive");
r = cli("convert", drawioFile, "--to", "drawio");
assert.equal(r.code, 1);
assert.ok(/refusing to overwrite/.test(r.err), "never overwrites the input");

assert.deepEqual(errors, [], "no uncaught page errors");
console.log(`\nAll smoke checks passed. Screenshots in ${shots}`);
