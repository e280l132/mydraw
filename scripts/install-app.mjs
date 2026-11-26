// Installs the packaged app (after `npm run package`): npm run install-app
//  - copies release/mac-arm64/mydraw.app to /Applications (replacing an older copy)
//  - links ~/.local/bin/mydraw to the app's `mydraw` command (never overwrites another file)
//  - prints the command that registers the app's MCP server with Claude Code (it does not run it)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "release", "mac-arm64", "mydraw.app");
const dest = process.env.MYDRAW_INSTALL_DIR ? path.join(process.env.MYDRAW_INSTALL_DIR, "mydraw.app") : "/Applications/mydraw.app";
const binDir = path.join(os.homedir(), ".local", "bin");
const link = path.join(binDir, "mydraw");
const wrapper = path.join(dest, "Contents", "Resources", "bin", "mydraw");
const fail = (msg) => {
  console.error(`install-app: ${msg}`);
  process.exit(1);
};

if (!fs.existsSync(src)) fail(`${path.relative(root, src)} not found: run npm run package first`);

// Refuse while mydraw runs (a running app would keep the old code, and macOS may hold its files).
const control = path.join(process.env.MYDRAW_USER_DATA || path.join(os.homedir(), "Library", "Application Support", "mydraw"), "control.json");
try {
  const { pid } = JSON.parse(fs.readFileSync(control, "utf8"));
  process.kill(pid, 0);
  fail(`mydraw is running (pid ${pid}). Quit it (⌘Q), then run this again.`);
} catch (e) {
  if (e?.code === "EPERM") fail("mydraw is running. Quit it (⌘Q), then run this again.");
  // no control file, or the process is gone: fine
}

const version = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", path.join(src, "Contents", "Info.plist")], { encoding: "utf8" }).trim();
console.log(`Installing mydraw ${version} to ${dest}`);
fs.rmSync(dest, { recursive: true, force: true });
execFileSync("ditto", [src, dest]);
execFileSync("xattr", ["-dr", "com.apple.quarantine", dest], { stdio: "ignore" });

// The `mydraw` command: a symlink into the app, so updates of the app update it too.
fs.mkdirSync(binDir, { recursive: true });
let existing = null;
try {
  existing = fs.lstatSync(link);
} catch {
  // nothing there
}
if (existing && !existing.isSymbolicLink()) {
  console.warn(`\nNot touching ${link}: it is a file, not a link to mydraw. Remove it and run this again to install the command.`);
} else if (existing && !/\.app\/Contents\/Resources\/bin\/mydraw$/.test(fs.readlinkSync(link))) {
  console.warn(`\nNot touching ${link}: it links to ${fs.readlinkSync(link)}, not to a mydraw app. Remove it and run this again to install the command.`);
} else {
  fs.rmSync(link, { force: true });
  fs.symlinkSync(wrapper, link);
  console.log(`Linked ${link} -> ${wrapper}`);
}

let onPath = (process.env.PATH ?? "").split(":").includes(binDir);
try {
  const shell = process.env.SHELL || "/bin/zsh";
  onPath = execFileSync(shell, ["-lic", "echo $PATH"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] }).split(":").map((s) => s.trim()).includes(binDir);
} catch {
  // keep the guess from this process
}
if (!onPath) console.warn(`\n${binDir} is not on your PATH. Add it (e.g. in ~/.zshrc: export PATH="$HOME/.local/bin:$PATH").`);

console.log(`
Done. Open mydraw from Applications.
Try the command:  mydraw --version

Claude Code: open mydraw, Preferences → Command line & Claude Code… → Connect Claude Code.
(By hand: claude mcp add --scope user mydraw -- ${wrapper} mcp)`);
