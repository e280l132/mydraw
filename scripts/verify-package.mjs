// End-to-end check of the packaged app (after `npm run package`): npm run verify-package
//  1. signature, Info.plist (bundle id, version, document types)
//  2. app.asar holds the built app and nothing else (no node_modules, no source maps)
//  3. a COPY of the app (release/ is never touched) starts with a temp userData and library
//  4. the bundled MCP server, started through the bundled `mydraw mcp` wrapper, drives it
//  5. "Set up mydraw": install the command and connect Claude Code, in a fake home with a fake
//     `claude` (the real ~/.local/bin and ~/.claude.json are never touched)
//  6. in-app update: a fake GitHub release (local server, MYDRAW_UPDATE_API) of version x.y.(z+1)
//     is found, downloaded, checked and staged; after quit the copy has been swapped to it
//  7. the bundled CLI, through a symlink to the wrapper, exports and converts with the app closed
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const built = path.join(root, "release", "mac-arm64", "mydraw.app");
const dmg = path.join(root, "release", `mydraw-${version}-arm64.dmg`);
const step = (s) => console.log(`\n▸ ${s}`);
const plist = (app, key) => execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, fn, timeout = 45_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

if (!fs.existsSync(built)) throw new Error(`${path.relative(root, built)} not found: run npm run package`);
// Real path: the app sees its own location without the /var -> /private/var symlink.
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-verify-")));
let appProc = null;
let server = null;
try {
  // ---------------------------------------------------------------------------------------------
  step("signature and Info.plist");
  execFileSync("codesign", ["--verify", "--deep", "--strict", built]);
  assert.equal(plist(built, "CFBundleIdentifier"), "dev.mydraw.app");
  assert.equal(plist(built, "CFBundleShortVersionString"), version);
  const docTypes = plist(built, "CFBundleDocumentTypes");
  assert.match(docTypes, /excalidraw/, "registers .excalidraw");
  assert.match(docTypes, /drawio/, "registers .drawio");
  assert.match(plist(built, "NSDocumentsFolderUsageDescription"), /Documents/);

  // ---------------------------------------------------------------------------------------------
  step("app.asar contents");
  const asar = require("@electron/asar");
  const files = asar.listPackage(path.join(built, "Contents", "Resources", "app.asar"), {}).map((f) => f.replaceAll("\\", "/"));
  for (const f of ["/package.json", "/app/dist/boot.cjs", "/app/dist/main.cjs", "/app/dist/cli.cjs", "/app/dist/preload.cjs", "/web/dist/index.html", "/web/dist/fonts/extra/manifest.json", "/assets/icon.png"]) {
    assert.ok(files.includes(f), `app.asar has ${f}`);
  }
  assert.ok(!files.some((f) => f.includes("/node_modules/")), "no node_modules packed");
  assert.ok(!files.some((f) => f.endsWith(".map")), "no source maps packed");
  for (const f of ["bin/mydraw", "bin/mydraw.mjs", "mcp/index.js"]) assert.ok(fs.existsSync(path.join(built, "Contents", "Resources", f)), `Resources/${f}`);
  if (fs.existsSync(dmg)) {
    const mnt = path.join(work, "dmg");
    fs.mkdirSync(mnt);
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mnt, dmg], { stdio: "ignore" });
    try {
      for (const f of ["mydraw.app", "Applications", ".background.tiff"]) assert.ok(fs.existsSync(path.join(mnt, f)), `DMG has ${f}`);
    } finally {
      execFileSync("hdiutil", ["detach", "-force", mnt], { stdio: "ignore" });
    }
  }
  const mb = (p) => `${(Number(execFileSync("du", ["-sk", p], { encoding: "utf8" }).split("\t")[0]) / 1024).toFixed(0)} MB`;
  console.log(`  app ${mb(built)}${fs.existsSync(dmg) ? `, dmg ${(fs.statSync(dmg).size / 1048576).toFixed(0)} MB` : ""}, ${files.length} files in app.asar`);

  // ---------------------------------------------------------------------------------------------
  step("fake release of the next patch version");
  const next = version.replace(/(\d+)$/, (n) => String(Number(n) + 1));
  const newerDir = path.join(work, "newer");
  fs.mkdirSync(newerDir);
  const newer = path.join(newerDir, "mydraw.app");
  execFileSync("ditto", [built, newer]);
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleShortVersionString ${next}`, path.join(newer, "Contents", "Info.plist")]);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", newer], { stdio: "ignore" });
  const dmgName = `mydraw-${next}-arm64.dmg`;
  const fakeDmg = path.join(work, dmgName);
  execFileSync("hdiutil", ["create", "-quiet", "-volname", "mydraw", "-srcfolder", newerDir, "-ov", "-format", "UDZO", fakeDmg]);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(fakeDmg)).digest("hex");
  server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/repos/e280l132/mydraw/releases/latest") {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          tag_name: `v${next}`,
          draft: false,
          prerelease: false,
          body: `## ${next}\n- test release`,
          html_url: `${base}/release`,
          assets: [
            { name: dmgName, browser_download_url: `${base}/dl/${dmgName}`, size: fs.statSync(fakeDmg).size },
            { name: `${dmgName}.sha256`, browser_download_url: `${base}/dl/${dmgName}.sha256`, size: 90 },
          ],
        }),
      );
    } else if (req.url === `/dl/${dmgName}`) {
      // Redirect once, like GitHub does to its asset host.
      res.writeHead(302, { location: `/files/${dmgName}` }).end();
    } else if (req.url === `/files/${dmgName}`) {
      res.setHeader("content-length", String(fs.statSync(fakeDmg).size));
      fs.createReadStream(fakeDmg).pipe(res);
    } else if (req.url === `/dl/${dmgName}.sha256`) {
      res.end(`${sha}  ${dmgName}\n`);
    } else res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const api = `http://127.0.0.1:${server.address().port}`;

  // ---------------------------------------------------------------------------------------------
  step("start a copy of the app");
  const installDir = path.join(work, "Applications");
  fs.mkdirSync(installDir);
  const copy = path.join(installDir, "mydraw.app");
  execFileSync("ditto", [built, copy]);
  const userData = path.join(work, "userData");
  const library = path.join(work, "Library");
  fs.mkdirSync(library);
  // Fake home + claude for the setup steps; the temp "Applications" counts as Applications.
  const fakeHome = path.join(work, "home");
  fs.mkdirSync(fakeHome);
  const devEntry = { type: "stdio", command: "node", args: ["/somewhere/mydraw/mcp/dist/index.js"] };
  fs.writeFileSync(path.join(fakeHome, ".claude.json"), JSON.stringify({ mcpServers: { mydraw: devEntry } }));
  const claudeLog = path.join(work, "claude.log");
  const fakeClaude = path.join(work, "fake-claude");
  fs.writeFileSync(
    fakeClaude,
    `#!/bin/sh
echo "$*" >> '${claudeLog}'
case "$2" in
  add) printf '{"mcpServers":{"mydraw":{"type":"stdio","command":"%s","args":["mcp"]}}}' "$7" > '${fakeHome}/.claude.json' ;;
  remove) printf '{"mcpServers":{}}' > '${fakeHome}/.claude.json' ;;
esac
`,
    { mode: 0o755 },
  );
  const env = { ...process.env, MYDRAW_USER_DATA: userData, MYDRAW_LIBRARY: library, MYDRAW_UPDATE_API: api, MYDRAW_SETUP_HOME: fakeHome, MYDRAW_CLAUDE: fakeClaude, MYDRAW_APPLICATIONS_DIR: installDir };
  for (const k of ["MYDRAW_TEST", "MYDRAW_DEV_URL", "ELECTRON_RUN_AS_NODE"]) delete env[k];
  appProc = spawn(path.join(copy, "Contents", "MacOS", "mydraw"), [], { env, stdio: "ignore" });
  const exited = new Promise((r) => appProc.once("exit", r));
  const controlFile = path.join(userData, "control.json");
  const info = await waitFor("control.json", () => (fs.existsSync(controlFile) ? JSON.parse(fs.readFileSync(controlFile, "utf8")) : null));
  assert.equal(info.version, version);
  assert.equal(info.appPath, path.join(fs.realpathSync(copy), "Contents", "Resources", "app.asar"));
  const rpc = async (method, params = {}) => {
    const res = await fetch(`http://127.0.0.1:${info.port}/rpc`, { method: "POST", headers: { authorization: `Bearer ${info.key}`, "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${body.error}`);
    return body.result;
  };
  await waitFor("renderer ready", async () => (await rpc("ping")).ready);

  // ---------------------------------------------------------------------------------------------
  step("bundled MCP server through `mydraw mcp`");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const wrapper = path.join(copy, "Contents", "Resources", "bin", "mydraw");
  const client = new Client({ name: "mydraw-verify", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: wrapper, args: ["mcp"], env: { ...env, MYDRAW_NO_LAUNCH: "1" }, stderr: "inherit" }));
  assert.equal(client.getServerVersion()?.version, version, "MCP reports the app version");
  const tools = (await client.listTools()).tools.length;
  assert.ok(tools >= 50, `MCP lists its tools (${tools})`);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(`${name}: ${r.content[0].text}`);
    return r.content.find((c) => c.type === "text")?.text;
  };
  const listed = await call("list_drawings");
  assert.ok(!/WARNING/.test(listed), "no stale/mismatch warning for its own app");
  await call("new_drawing", { title: "verify" });
  await call("add_elements", {
    elements: [
      { type: "rectangle", id: "a", x: 0, y: 0, width: 180, height: 80, label: "Web" },
      { type: "ellipse", id: "b", x: 320, y: 0, width: 160, height: 90, label: "DB" },
      { type: "arrow", id: "c", from: "a", to: "b", label: "SQL" },
      { type: "text", id: "t", x: 0, y: 160, text: "Inter text", fontFamily: "Inter" },
    ],
  });
  const png = path.join(work, "out.png");
  const pdf = path.join(work, "out.pdf");
  await call("export", { path: png });
  await call("export", { path: pdf });
  assert.equal(fs.readFileSync(png).subarray(1, 4).toString(), "PNG", "PNG export");
  assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), "%PDF-", "PDF export");
  const saved = path.join(work, "verify.excalidraw");
  await call("save", { path: saved });
  const doc = JSON.parse(fs.readFileSync(saved, "utf8"));
  assert.equal(doc.type, "excalidraw");
  assert.ok(doc.mydraw?.id, "saved file carries the mydraw meta block");
  assert.ok(doc.elements.some((e) => e.id === "a"), "saved file has the shapes");
  await client.close();

  // ---------------------------------------------------------------------------------------------
  step("Set up mydraw: the command and Claude Code (fake home, fake claude)");
  const wrapperPath = path.join(copy, "Contents", "Resources", "bin", "mydraw");
  let setup = await rpc("setup_status");
  assert.equal(setup.packaged, true);
  assert.equal(setup.location.state, "ok", JSON.stringify(setup.location));
  assert.equal(setup.command.state, "missing");
  assert.equal(setup.claude.state, "other", "an existing dev registration is noticed");
  assert.match(setup.claude.existing, /mcp\/dist\/index\.js/);
  setup = await rpc("setup_action", { action: "installCommand" });
  assert.equal(setup.command.state, "installed");
  const fakeLink = path.join(fakeHome, ".local", "bin", "mydraw");
  assert.equal(fs.readlinkSync(fakeLink), wrapperPath);
  const viaLink = spawnSync(fakeLink, ["--version"], { encoding: "utf8" });
  assert.equal(viaLink.stdout.trim(), `mydraw ${version.replace(/^(\d+\.\d+)\.0$/, "$1")}`, "the installed command runs");
  setup = await rpc("setup_action", { action: "connectClaude" });
  assert.equal(setup.claude.state, "connected");
  assert.deepEqual(fs.readFileSync(claudeLog, "utf8").trim().split("\n"), ["mcp remove --scope user mydraw", `mcp add --scope user mydraw -- ${wrapperPath} mcp`]);
  setup = await rpc("setup_action", { action: "disconnectClaude" });
  assert.equal(setup.claude.state, "missing");
  setup = await rpc("setup_action", { action: "removeCommand" });
  assert.equal(setup.command.state, "missing");
  assert.ok(!fs.existsSync(fakeLink), "command link removed");
  // A file that isn't ours is never replaced.
  fs.writeFileSync(fakeLink, "not mydraw");
  await assert.rejects(rpc("setup_action", { action: "installCommand" }), /not a link to mydraw/);
  assert.equal(fs.readFileSync(fakeLink, "utf8"), "not mydraw");

  // ---------------------------------------------------------------------------------------------
  step(`in-app update ${version} -> ${next}`);
  const found = await rpc("update_action", { action: "check" });
  assert.equal(found.state, "available", `update found (${JSON.stringify(found)})`);
  assert.equal(found.version, next);
  const staged = await rpc("update_action", { action: "install" });
  assert.equal(staged.state, "ready", `update staged (${JSON.stringify(staged)})`);
  assert.ok(fs.existsSync(path.join(installDir, ".mydraw-update.app")), "staged next to the app");
  await rpc("app_quit");
  await Promise.race([exited, sleep(20_000).then(() => Promise.reject(new Error("the app did not quit")))]);
  appProc = null;
  await waitFor("the swap", () => {
    try {
      return plist(copy, "CFBundleShortVersionString") === next && !fs.existsSync(path.join(installDir, ".mydraw-update.app"));
    } catch {
      return false;
    }
  }, 30_000);
  assert.ok(!fs.existsSync(path.join(installDir, ".mydraw-old.app")), "old copy removed");
  execFileSync("codesign", ["--verify", "--deep", "--strict", copy]);
  assert.ok(!fs.existsSync(controlFile), "control.json removed on quit");

  // ---------------------------------------------------------------------------------------------
  step("bundled CLI through a symlink, app closed");
  const binDir = path.join(work, "bin");
  fs.mkdirSync(binDir);
  const link = path.join(binDir, "mydraw");
  fs.symlinkSync(wrapper, link);
  const cli = (...args) => spawnSync(link, args, { cwd: work, encoding: "utf8", timeout: 120_000 });
  let r = cli("--version");
  assert.equal(r.status, 0);
  // The fake update only changed Info.plist; the code (and package.json) is the original build's.
  assert.equal(r.stdout.trim(), `mydraw ${version.replace(/^(\d+\.\d+)\.0$/, "$1")}`);
  r = cli("export", saved, "--format", "pdf", "-o", path.join(work, "cli.pdf"));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr.trim(), "", "no noise on stderr");
  assert.equal(fs.readFileSync(path.join(work, "cli.pdf")).subarray(0, 5).toString(), "%PDF-");
  const drawio = path.join(work, "x.drawio");
  fs.writeFileSync(
    drawio,
    `<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Router" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="120" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`,
  );
  r = cli("convert", drawio, "--to", "excalidraw");
  assert.equal(r.status, 0, r.stderr);
  const converted = JSON.parse(fs.readFileSync(path.join(work, "x.excalidraw"), "utf8"));
  assert.ok(converted.elements.some((e) => e.type === "text" && /Router/.test(e.text)), "draw.io label kept");
  r = cli("export");
  assert.equal(r.status, 2, "usage errors exit 2");

  // ---------------------------------------------------------------------------------------------
  step("Set up mydraw: without admin rights, Move copies the app to ~/Applications and restarts it from there");
  {
    const downloads = path.join(work, "Downloads");
    const apps2 = path.join(work, "Applications2");
    fs.mkdirSync(downloads);
    fs.mkdirSync(apps2);
    const loose = path.join(downloads, "mydraw.app");
    execFileSync("ditto", [built, loose]);
    const ud2 = path.join(work, "userData2");
    const home2 = path.join(work, "home2");
    fs.mkdirSync(home2);
    // A standard user: the system Applications folder is not writable.
    const env2 = { ...env, MYDRAW_USER_DATA: ud2, MYDRAW_APPLICATIONS_DIR: apps2, MYDRAW_SETUP_HOME: home2, MYDRAW_APPLICATIONS_READONLY: "1" };
    const p2 = spawn(path.join(loose, "Contents", "MacOS", "mydraw"), [], { env: env2, stdio: "ignore" });
    const cf2 = path.join(ud2, "control.json");
    const readCf2 = () => (fs.existsSync(cf2) ? JSON.parse(fs.readFileSync(cf2, "utf8")) : null);
    const rpc2 = async (method, params = {}) => {
      const i = readCf2();
      const res = await fetch(`http://127.0.0.1:${i.port}/rpc`, { method: "POST", headers: { authorization: `Bearer ${i.key}`, "content-type": "application/json" }, body: JSON.stringify({ method, params }) });
      const body = await res.json();
      if (!body.ok) throw new Error(`${method}: ${body.error}`);
      return body.result;
    };
    await waitFor("control.json (Downloads copy)", readCf2);
    await waitFor("renderer ready", async () => (await rpc2("ping")).ready);
    const st = await rpc2("setup_status");
    assert.equal(st.location.state, "move", "a copy in Downloads should be moved");
    assert.equal(st.command.state, "unavailable");
    assert.equal(st.location.targets.system.writable, false, "system Applications reported read-only");
    assert.equal(st.location.suggested, "user", "~/Applications offered first");
    await assert.rejects(rpc2("setup_action", { action: "move", target: "system" }), /administrator/);
    await rpc2("setup_action", { action: "move", target: "user" }).catch(() => undefined);
    await new Promise((r) => (p2.exitCode !== null ? r() : p2.once("exit", r)));
    const moved = path.join(home2, "Applications", "mydraw.app");
    assert.ok(fs.existsSync(moved), "copied to ~/Applications");
    assert.ok(!fs.existsSync(path.join(apps2, "mydraw.app")), "nothing written to the system folder");
    // The relaunched app writes a new control.json that names its new location.
    const relaunched = await waitFor("relaunch from Applications", () => {
      const i = readCf2();
      return i && i.appPath === path.join(moved, "Contents", "Resources", "app.asar") ? i : null;
    });
    await waitFor("renderer ready", async () => (await rpc2("ping")).ready);
    const st2 = await rpc2("setup_status");
    assert.equal(st2.location.state, "ok");
    assert.equal(st2.location.installedIn, "user");
    await rpc2("app_quit");
    await waitFor("relaunched app quits", () => {
      try {
        process.kill(relaunched.pid, 0);
        return false;
      } catch {
        return true;
      }
    }, 20_000);
  }

  console.log("\n✓ packaged app verified");
} finally {
  if (appProc) appProc.kill();
  server?.close();
  fs.rmSync(work, { recursive: true, force: true });
}
