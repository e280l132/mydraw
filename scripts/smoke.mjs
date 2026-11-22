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
assert.equal(csvLines[0], "name,kind,type,zone,ip,hostname,notes", "CSV header");
assert.ok(csvLines.some((l) => l.startsWith("Web | 1,Server,rectangle,DMZ,") && l.includes("10.0.0.5") && l.includes("web-1") && l.includes("DMZ")), "CSV row for the web node");
assert.ok(csvLines.some((l) => l.startsWith("Database,") && l.includes("Core") && l.includes("10.0.1.9")), "CSV row for the database");
assert.ok(fs.readFileSync(csv, "utf8").includes('"public, ""edge"""'), "CSV quotes notes");
const md = path.join(outDir, "inventory.md");
await call("export", { path: md });
const mdLines = fs.readFileSync(md, "utf8").split("\n");
assert.equal(mdLines[0], "| Name | Kind | Type | Zone | Ip | Hostname | Notes |", "Markdown table header");
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
  await page.evaluate(() => document.querySelector(".md-drawing:not([style*=\"display: none\"]) .excalidraw")?.focus());
  const c = await t((x) => x.toScreen(380, 400));
  await page.mouse.move(c.x - 40, c.y + 5);
  await page.mouse.move(c.x, c.y);
  await waitFor(async () => (await qcHandles()).length === 4, "4 quick connect handles on hover");
};
await hoverQa();
assert.deepEqual(await qcHandles(), ["bottom", "left", "right", "top"]);
const qcCount = await t((x) => x.elementCount());
// Moving from the shape to a handle keeps the handles up; clicking adds copy + label + arrow.
const rightHandle = await page.$eval('.md-qc-handle[data-side="right"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.move(rightHandle.x - 15, rightHandle.y, { steps: 3 });
await page.mouse.move(rightHandle.x, rightHandle.y, { steps: 2 });
await page.mouse.click(rightHandle.x, rightHandle.y);
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
let r = cli("export", exportsFile, "--format", "jpg", "--scale", "2", "--frame", "Prod", "-o", cliJpg);
assert.equal(r.code, 0, r.err);
assert.deepEqual([...fs.readFileSync(cliJpg).subarray(0, 3)], [0xff, 0xd8, 0xff], "CLI JPG magic");
r = cli("export", exportsFile, "--frame", "Nope", "-o", path.join(work, "nope.png"));
assert.equal(r.code, 1);
assert.ok(/no frame "Nope"/.test(r.err), r.err);

r = cli("export", exportsFile, "--scope", "frames", "--format", "pdf", "--page", "a4", "-o", path.join(work, "cli.pdf"));
assert.equal(r.code, 0, r.err);
assert.ok(r.out.includes("2 pages"));
assert.equal(pdfPages(path.join(work, "cli.pdf")), 2, "CLI PDF, one page per frame");
r = cli("export", exportsFile, "--scope", "frames", "-f", "pptx", "-o", path.join(work, "cli.pptx"), "--slides", "4:3", "--dark");
assert.equal(r.code, 0, r.err);
assert.equal(zipSlides(path.join(work, "cli.pptx")), 2, "CLI PPTX slides");
r = cli("export", exportsFile, "--scope", "frames", "-o", path.join(work, "cli-frames"), "--format", "webp", "--no-background");
assert.equal(r.code, 0, r.err);
assert.deepEqual(fs.readdirSync(path.join(work, "cli-frames")).sort(), ["Prod.webp", "Staging.webp"]);
r = cli("export", exportsFile, "-f", "csv");
assert.equal(r.code, 0, r.err);
assert.ok(fs.readFileSync(path.join(work, "exports-test.csv"), "utf8").startsWith("name,kind,type,zone"), "CLI default output next to the input");

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
assert.deepEqual(labelsOf(converted), labelsOf(exportsFile), "draw.io round trip keeps the node labels");
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
