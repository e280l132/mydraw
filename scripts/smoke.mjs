// End-to-end smoke test: launches the built app with Playwright and exercises its features,
// including the MCP server driving the app (Phase 2).
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

step("recolor icons from the properties panel: swatch, custom picker (live), Original, undo");
await t((x) => x.selectImages());
const SECTION = ".md-drawing:not([style*='none']) .App-menu__left .md-iconcolor";
await page.waitForSelector(SECTION);
assert.match(await t((x) => x.iconSelection()), /^2:0:original$/, "two SVG icons selected, original colors");
await page.click(`${SECTION} [aria-label="Blue"]`);
await waitFor(async () => (await t((x) => x.imageColors())).every((c) => c === "#1971c2"), "icons recolored blue");
await waitFor(() => {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const imgs = d.elements.filter((e) => e.type === "image");
  return imgs.length && imgs.every((e) => e.customData?.mydrawIconColor === "#1971c2" && d.files[e.fileId]);
}, "recolor autosaved with its file");

// Custom picker: drag across the color square; icons follow live, then the color is committed.
await page.click(`${SECTION} >> text=Custom`);
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
await client.close();

app.process().kill("SIGKILL");

assert.deepEqual(errors, [], "no uncaught page errors");
console.log(`\nAll smoke checks passed. Screenshots in ${shots}`);
