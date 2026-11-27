// Publishes a new version as a GitHub Release, which installed apps offer as an update:
//   npm run release -- minor          0.1 -> 0.2 (the usual)
//   npm run release -- patch          0.1 -> 0.1.1 (bug-fix build)
//   npm run release -- 0.1.0          an explicit version (the first release: the current one)
//   add --no-smoke to skip the smoke test
// Needs: a clean tree on main, `gh` logged in, a "## <version>" section in CHANGELOG.md (its text
// becomes the release notes). Shows the notes and asks FIRST, then runs the checks, builds and
// verifies the DMG and, only if all of that passes, commits, tags, pushes and uploads. The question
// comes before the long build because a child of the build (the app, Electron, shells) can leave
// another process group in the terminal's foreground: a prompt at the end then gets the process
// stopped by SIGTTOU ("zsh: suspended (tty output)") until `fg`.
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { bumpVersion, displayVersion } from "../shared/version.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const bump = args.find((a) => !a.startsWith("--"));
const smoke = !args.includes("--no-smoke");
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd, ...a) => {
  console.log(`\n$ ${cmd} ${a.join(" ")}`);
  const r = spawnSync(cmd, a, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed`);
};

if (!bump) fail("say which version: npm run release -- minor | patch | major | x.y.z");
if (git("status", "--porcelain")) fail("the working tree has uncommitted changes; commit or stash them first");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("release from the main branch");
if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) fail("gh is not logged in (gh auth login)");

const pkgFile = path.join(root, "package.json");
const current = JSON.parse(fs.readFileSync(pkgFile, "utf8")).version;
let next;
try {
  next = bumpVersion(current, bump);
} catch (e) {
  fail(e.message);
}
const tag = `v${next}`;
const label = displayVersion(next);
if (git("tag", "-l", tag)) fail(`tag ${tag} already exists`);

// Release notes: the CHANGELOG.md section "## <label>" (or "## <x.y.z>") up to the next "## ".
const changelog = fs.existsSync(path.join(root, "CHANGELOG.md")) ? fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8") : "";
const heading = new RegExp(`^## (?:${label.replaceAll(".", "\\.")}|${next.replaceAll(".", "\\.")})\\b.*$`, "m");
const m = heading.exec(changelog);
if (!m) fail(`CHANGELOG.md has no "## ${label}" section; write what changed first (and commit it)`);
const rest = changelog.slice(m.index + m[0].length);
const notes = rest.slice(0, rest.search(/^## /m) === -1 ? undefined : rest.search(/^## /m)).trim();
if (!notes) fail(`the "## ${label}" section of CHANGELOG.md is empty`);

console.log(`
Release mydraw ${label} (${current} -> ${next}):
  checks (typecheck, test${smoke ? ", smoke" : ""}), package, verify-package; then, if all pass:
  ${next !== current ? `commit "Release ${next}" (package.json), ` : ""}tag ${tag}, push to origin, GitHub release with the DMG
Release notes:
${notes.replace(/^/gm, "  | ")}
`);
if (!process.stdin.isTTY) fail("not asking without a terminal; nothing was published");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question("Publish if everything passes? This pushes to GitHub and makes the update visible to installed apps. [y/N] ")).trim().toLowerCase();
rl.close();
if (answer !== "y" && answer !== "yes") fail("cancelled; nothing was published");
const restore = () => {
  if (next !== current) spawnSync("git", ["checkout", "--", "package.json", "package-lock.json"], { cwd: root });
};
try {
  if (next !== current) run("npm", "version", next, "--no-git-tag-version");
  run("npm", "run", "typecheck");
  run("npm", "test");
  if (smoke) run("npm", "run", "smoke");
  run("npm", "run", "package");
  run("npm", "run", "verify-package");
} catch (e) {
  restore();
  fail(`${e.message}; nothing was published${next !== current ? " (package.json restored)" : ""}`);
}

const dmg = path.join(root, "release", `mydraw-${next}-arm64.dmg`);
if (!fs.existsSync(dmg)) fail(`${dmg} was not built`);
const sha = crypto.createHash("sha256").update(fs.readFileSync(dmg)).digest("hex");
const shaFile = `${dmg}.sha256`;
fs.writeFileSync(shaFile, `${sha}  ${path.basename(dmg)}\n`);

console.log(`
Publishing mydraw ${label}: ${path.relative(root, dmg)} (${(fs.statSync(dmg).size / 1048576).toFixed(0)} MB, sha256 ${sha.slice(0, 12)}…)
`);

if (next !== current) {
  run("git", "add", "package.json", "package-lock.json");
  run("git", "commit", "-m", `Release ${next}`);
}
run("git", "tag", "-a", tag, "-m", `mydraw ${label}`);
run("git", "push", "origin", "main");
run("git", "push", "origin", tag);
const notesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-release-")), "notes.md");
// Every release page also says how to install (the same steps as the DMG window, packaging/dmg-background.html).
fs.writeFileSync(
  notesFile,
  `${notes}

### Install (Apple Silicon Macs)
1. Download \`${path.basename(dmg)}\` below and open it.
2. Drag mydraw onto Applications.
3. First time only: right-click mydraw in Applications, choose **Open**, then **Open** again (the app is not signed by Apple).
4. In the **Set up mydraw** window, click **Install the command** and **Connect Claude Code** if you want them.

Already installed? mydraw offers this update itself (Help → Check for Updates).
`,
);
run("gh", "release", "create", tag, dmg, shaFile, "--title", `mydraw ${label}`, "--notes-file", notesFile);
console.log(`\nPublished mydraw ${label}. Installed apps will offer it within a day, or now with Help → Check for Updates.`);
