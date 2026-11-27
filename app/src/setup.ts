// "Set up mydraw" (main process): move the app to Applications, install the `mydraw` command,
// connect Claude Code. Pure parts and the overview: shared/setup.ts. Nothing here runs without a
// click in web/src/SetupDialog.tsx.
//
// Test overrides (scripts/verify-package.mjs): MYDRAW_SETUP_HOME (home folder for ~/.local/bin and
// ~/.claude.json, and ~/Applications), MYDRAW_CLAUDE (the claude program), MYDRAW_APPLICATIONS_DIR
// (stands in for /Applications: counts as Applications and is the "system" target),
// MYDRAW_APPLICATIONS_READONLY=1 (treat the system target as not writable, like a standard user).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app } from "electron";
import {
  bundleCommand,
  canReplaceCommand,
  claudeCandidates,
  claudeStateOf,
  commandStateOf,
  describeMcp,
  locationOf,
  mcpAddArgs,
  mcpEntryOf,
  mcpRemoveArgs,
  onPath,
  pickTarget,
  targetOf,
  type InstallTarget,
  type LocationStatus,
  type SetupAction,
  type SetupStatus,
} from "../../shared/setup";
import { bundleOfExe } from "../../shared/update";

const run = promisify(execFile);
const BUNDLE_ID = "dev.mydraw.app";

const home = () => process.env.MYDRAW_SETUP_HOME || os.homedir();
const binDir = () => path.join(home(), ".local", "bin");
const linkPath = () => path.join(binDir(), "mydraw");
const systemApps = () => process.env.MYDRAW_APPLICATIONS_DIR || "/Applications";
const userApps = () => path.join(home(), "Applications");
const applicationsDirs = () => [...new Set([systemApps(), "/Applications", userApps(), path.join(os.homedir(), "Applications")])];

function writable(dir: string): boolean {
  if (dir === systemApps() && process.env.MYDRAW_APPLICATIONS_READONLY === "1") return false;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    // ~/Applications may not exist yet: it is created in the home folder, which is writable.
    return !fs.existsSync(dir) && dir === userApps();
  }
}

function locationStatus(bundle: string | null): LocationStatus {
  const targets = {
    system: { dir: systemApps(), writable: writable(systemApps()) },
    user: { dir: userApps(), writable: writable(userApps()) },
  };
  const loc: LocationStatus = { bundle, ...locationOf(bundle, applicationsDirs()), targets, suggested: pickTarget(targets.system.writable) };
  const here = targetOf(bundle, targets);
  if (here && loc.state === "ok") loc.installedIn = here;
  // A copy in the other folder (an older install): macOS may open drawings with that one.
  const other = (["system", "user"] as const).find((t) => t !== here && fs.existsSync(path.join(targets[t].dir, "mydraw.app")) && path.join(targets[t].dir, "mydraw.app") !== bundle);
  if (other) loc.otherCopy = path.join(targets[other].dir, "mydraw.app");
  return loc;
}
const shell = () => process.env.SHELL || "/bin/zsh";

export interface SetupDeps {
  /** Start the normal quit flow (unsaved-changes prompt included). */
  quit(): void;
}
let deps: SetupDeps;
export function setupSetup(d: SetupDeps): void {
  deps = d;
}

/** The running app bundle when packaged; null for a development build. */
function ownBundle(): string | null {
  return app.isPackaged ? bundleOfExe(app.getPath("exe")) : null;
}

function readLink(p: string): string | null {
  try {
    const st = fs.lstatSync(p);
    return st.isSymbolicLink() ? fs.readlinkSync(p) : "";
  } catch {
    return null;
  }
}

/** The login shell's PATH (apps started from the Dock get a minimal one). Cached. */
let shellPath: string | null = null;
async function loginPath(): Promise<string> {
  if (shellPath !== null) return shellPath;
  try {
    const { stdout } = await run(shell(), ["-ilc", 'printf "\\n__MYDRAW_PATH__%s\\n" "$PATH"'], { timeout: 10_000 });
    shellPath = /__MYDRAW_PATH__(.*)/.exec(stdout)?.[1] ?? "";
  } catch {
    shellPath = process.env.PATH ?? "";
  }
  return shellPath;
}

/** Path of Claude Code's `claude`, or null when it isn't installed. Also used by the Ask Claude box. */
export async function findClaude(): Promise<string | null> {
  if (process.env.MYDRAW_CLAUDE) return fs.existsSync(process.env.MYDRAW_CLAUDE) ? process.env.MYDRAW_CLAUDE : null;
  for (const dir of (await loginPath()).split(":")) {
    if (!dir) continue;
    const p = path.join(dir, "claude");
    if (isExecutable(p)) return p;
  }
  return claudeCandidates(home()).find(isExecutable) ?? null;
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Environment for running claude: the login shell's PATH (an npm-installed claude needs `node` on it), none of mydraw's own switches. */
export async function claudeEnv(): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: (await loginPath()) || process.env.PATH };
  for (const k of ["ELECTRON_RUN_AS_NODE", "MYDRAW_TEST", "MYDRAW_DEV_URL"]) delete env[k];
  return env;
}

/** Runs claude with claudeEnv(). */
async function runClaude(claude: string, args: string[]): Promise<void> {
  const env = await claudeEnv();
  try {
    await run(claude, args, { timeout: 60_000, env });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error((err.stderr || err.message).trim().split("\n").slice(-3).join(" "));
  }
}

function claudeEntry() {
  try {
    return mcpEntryOf(JSON.parse(fs.readFileSync(path.join(home(), ".claude.json"), "utf8")));
  } catch {
    return null;
  }
}

export async function setupStatus(): Promise<SetupStatus> {
  const bundle = ownBundle();
  const location = locationStatus(bundle);
  const link = linkPath();
  const ready = location.state === "ok" && !!bundle;
  const expected = bundle ? bundleCommand(bundle) : "";
  const target = readLink(link);
  const status: SetupStatus = {
    packaged: app.isPackaged,
    location,
    command: { state: ready ? commandStateOf(target, expected) : "unavailable", link, onPath: onPath(await loginPath(), binDir()) },
    claude: { state: "unavailable" },
  };
  if (target) status.command.target = target;
  if (!ready) return status;
  const claude = await findClaude();
  const entry = claudeEntry();
  status.claude = claude ? { state: claudeStateOf(entry, expected), claudePath: claude } : { state: "noClaude" };
  if (entry && status.claude.state === "other") status.claude.existing = describeMcp(entry);
  return status;
}

export async function setupAction(action: SetupAction, target?: InstallTarget): Promise<SetupStatus> {
  const bundle = ownBundle();
  switch (action) {
    case "move":
      await moveToApplications(bundle, target ?? locationStatus(bundle).suggested);
      break;
    case "installCommand": {
      const s = await setupStatus();
      if (s.command.state === "unavailable" || !bundle) throw new Error("Move mydraw to Applications first.");
      const current = readLink(linkPath());
      if (!canReplaceCommand(current)) throw new Error(`${linkPath()} already exists and is not a link to mydraw. Remove it first.`);
      fs.mkdirSync(binDir(), { recursive: true });
      fs.rmSync(linkPath(), { force: true });
      fs.symlinkSync(bundleCommand(bundle), linkPath());
      break;
    }
    case "removeCommand": {
      const current = readLink(linkPath());
      if (current && canReplaceCommand(current)) fs.rmSync(linkPath(), { force: true });
      break;
    }
    case "connectClaude": {
      const s = await setupStatus();
      if (!bundle || s.claude.state === "unavailable") throw new Error("Move mydraw to Applications first.");
      if (!s.claude.claudePath) throw new Error("Claude Code is not installed.");
      // The window asked before replacing another "mydraw" registration.
      if (s.claude.state !== "missing") await runClaude(s.claude.claudePath, mcpRemoveArgs());
      await runClaude(s.claude.claudePath, mcpAddArgs(bundleCommand(bundle)));
      break;
    }
    case "disconnectClaude": {
      const s = await setupStatus();
      if (s.claude.state === "connected" && s.claude.claudePath) await runClaude(s.claude.claudePath, mcpRemoveArgs());
      break;
    }
  }
  return setupStatus();
}

/**
 * Copies the app into /Applications ("system") or ~/Applications ("user", no admin rights needed)
 * and restarts from there (after the normal quit flow).
 */
async function moveToApplications(bundle: string | null, target: InstallTarget): Promise<void> {
  if (!bundle) throw new Error("This is a development build.");
  const destDir = target === "user" ? userApps() : systemApps();
  const dest = path.join(destDir, "mydraw.app");
  if (dest === bundle) return;
  if (!writable(destDir)) {
    throw new Error(
      target === "system"
        ? `You don't have permission to add apps to ${destDir} (it needs an administrator). Choose "Just for me" to install in your own Applications folder.`
        : `mydraw can't write to ${destDir}.`,
    );
  }
  fs.mkdirSync(destDir, { recursive: true });
  if (fs.existsSync(dest)) {
    // Replace only another copy of mydraw (e.g. an older version), never some other app.
    const id = await run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", path.join(dest, "Contents", "Info.plist")])
      .then((r) => r.stdout.trim())
      .catch(() => "");
    if (id !== BUNDLE_ID) throw new Error(`${dest} exists and is not mydraw.`);
  }
  const staging = path.join(destDir, ".mydraw-move.app");
  fs.rmSync(staging, { recursive: true, force: true });
  await run("ditto", [bundle, staging]);
  await run("xattr", ["-dr", "com.apple.quarantine", staging]).catch(() => undefined);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
  app.relaunch({ execPath: path.join(dest, "Contents", "MacOS", "mydraw"), args: [] });
  deps.quit();
}
