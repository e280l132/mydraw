// In-app updates from GitHub Releases (main process). Pure parts: shared/update.ts.
//
// The app is unsigned, so Apple's updater (Squirrel.Mac) can't be used. Instead:
//   check   GET <api>/repos/<repo>/releases/latest -> newer version? tell the renderer (banner)
//   install download the DMG + .sha256 (GitHub hosts only), verify the hash, mount the DMG, copy
//           the app next to the running one (.mydraw-update.app), check bundle id / version /
//           signature, unmount
//   quit    a detached shell script (SWAP_SCRIPT) waits for this process to exit, swaps the
//           bundles and (after "Restart") opens the new app. Quitting without restarting also
//           installs the staged update; the next start is the new version.
// Files written by Node carry no quarantine flag, so Gatekeeper does not block the new copy.
// MYDRAW_UPDATE_API points the check at a test server (smoke test, verify-package).
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, shell, type BrowserWindow } from "electron";
import { APP_VERSION } from "../../shared/appVersion";
import {
  CHECK_INTERVAL_MS,
  RELEASES_PAGE,
  SWAP_SCRIPT,
  UPDATE_API,
  UPDATE_REPO,
  allowedDownloadUrl,
  bundleOfExe,
  cannotUpdateHere,
  isNewer,
  parseRelease,
  parseSha256,
  type ReleaseInfo,
  type UpdateAction,
  type UpdateStatus,
} from "../../shared/update";
import type { Settings } from "../../shared/types";

const run = promisify(execFile);
const BUNDLE_ID = "dev.mydraw.app";
const MAX_DMG_BYTES = 1_000_000_000;
const testApi = process.env.MYDRAW_UPDATE_API?.replace(/\/+$/, "") || null;

export interface UpdaterDeps {
  getWin(): BrowserWindow | null;
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
  /** Start the normal quit flow (unsaved-changes prompt included). */
  quit(): void;
}

let deps: UpdaterDeps;
let status: UpdateStatus = { state: "idle" };
let release: ReleaseInfo | null = null;
let staged: { version: string; path: string; target: string } | null = null;
let relaunch = false;
let busy = false;

/** Updates are possible in the installed app, and anywhere when a test server is set. */
const enabled = () => app.isPackaged || !!testApi;

function setStatus(s: UpdateStatus): void {
  status = s;
  deps.getWin()?.webContents.send("update:status", s);
}

export function updateStatus(): UpdateStatus {
  return status;
}

export function setupUpdater(d: UpdaterDeps): void {
  deps = d;
  app.on("will-quit", applyStagedUpdate);
  // A quiet check a little after start, at most once a day (installed app only: test runs check by hand).
  setTimeout(() => {
    const u = deps.getSettings().updates;
    if (!app.isPackaged || !u.check || Date.now() - u.lastCheck < CHECK_INTERVAL_MS) return;
    void check(false);
  }, 10_000).unref();
}

export async function updateAction(action: UpdateAction): Promise<UpdateStatus> {
  switch (action) {
    case "check":
      await check(true);
      break;
    case "install":
      await install();
      break;
    case "skip":
      if (release) deps.updateSettings({ updates: { ...deps.getSettings().updates, skipped: release.version } });
      setStatus({ state: "idle" });
      break;
    case "dismiss":
      // Hides the banner. A staged update still installs when the app quits.
      if (status.state !== "downloading") setStatus({ state: "idle" });
      break;
    case "restart":
      if (staged) {
        relaunch = true;
        deps.quit();
      }
      break;
    case "openPage":
      void shell.openExternal(release?.page ?? RELEASES_PAGE);
      break;
  }
  return status;
}

/** The quit was cancelled (unsaved-changes prompt): don't reopen the app at the next normal quit. */
export function quitCancelled(): void {
  relaunch = false;
}

// ---------- check ----------

async function check(manual: boolean): Promise<void> {
  if (busy) return;
  if (!enabled()) {
    if (manual) setStatus({ state: "unavailable", reason: "Updates work in the installed app (this is a development build)." });
    return;
  }
  if (staged) {
    setStatus({ state: "ready", version: staged.version });
    return;
  }
  busy = true;
  setStatus({ state: "checking", manual });
  try {
    const res = await fetchChecked(`${testApi ?? UPDATE_API}/repos/${UPDATE_REPO}/releases/latest`, "application/vnd.github+json");
    if (res.status === 404) throw new Error("no release has been published yet");
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const r = parseRelease(await res.json());
    const settings = deps.getSettings();
    deps.updateSettings({ updates: { ...settings.updates, lastCheck: Date.now() } });
    // A manual check offers a skipped version again.
    if (isNewer(r.version, APP_VERSION, manual ? null : settings.updates.skipped)) {
      release = r;
      setStatus({ state: "available", version: r.version, notes: r.notes, page: r.page });
    } else {
      setStatus(manual ? { state: "latest", version: APP_VERSION } : { state: "idle" });
    }
  } catch (e) {
    setStatus(manual ? { state: "error", message: `Could not check for updates: ${(e as Error).message}`, page: RELEASES_PAGE } : { state: "idle" });
  } finally {
    busy = false;
  }
}

// ---------- download + stage ----------

async function install(): Promise<void> {
  if (busy || !release) return;
  const r = release;
  const target = bundleOfExe(app.getPath("exe"));
  const why = cannotUpdateHere(target);
  if (why || !target) return setStatus({ state: "error", message: `${why}.`, page: r.page });
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK);
  } catch {
    return setStatus({ state: "error", message: `mydraw can't write to ${path.dirname(target)}. Download the new version from the release page instead.`, page: r.page });
  }

  busy = true;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-update-"));
  const mount = path.join(tmp, "mnt");
  let mounted = false;
  try {
    setStatus({ state: "downloading", version: r.version, progress: 0 });
    const shaRes = await fetchChecked(r.shaUrl);
    if (!shaRes.ok) throw new Error(`checksum download failed (${shaRes.status})`);
    const expected = parseSha256(await shaRes.text());
    if (!expected) throw new Error("the release checksum file is not readable");

    const dmg = path.join(tmp, "mydraw.dmg");
    const actual = await download(r.dmgUrl, dmg, r.size, (p) => setStatus({ state: "downloading", version: r.version, progress: p }));
    if (actual !== expected) throw new Error("the download is damaged (checksum mismatch); try again");

    fs.mkdirSync(mount);
    await run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg]);
    mounted = true;
    const src = path.join(mount, "mydraw.app");
    if (!fs.existsSync(src)) throw new Error("the disk image holds no mydraw.app");

    const dest = path.join(path.dirname(target), ".mydraw-update.app");
    fs.rmSync(dest, { recursive: true, force: true });
    await run("ditto", [src, dest]);
    const plist = path.join(dest, "Contents", "Info.plist");
    const read = async (key: string) => (await run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist])).stdout.trim();
    if ((await read("CFBundleIdentifier")) !== BUNDLE_ID) throw new Error("the downloaded app is not mydraw");
    const got = await read("CFBundleShortVersionString");
    if (got !== r.version) throw new Error(`the downloaded app is version ${got}, expected ${r.version}`);
    await run("codesign", ["--verify", "--deep", "--strict", dest]);

    staged = { version: r.version, path: dest, target };
    setStatus({ state: "ready", version: r.version });
  } catch (e) {
    setStatus({ state: "error", message: `Update failed: ${(e as Error).message}`, page: r.page });
  } finally {
    if (mounted) await run("hdiutil", ["detach", "-force", mount]).catch(() => undefined);
    fs.rmSync(tmp, { recursive: true, force: true });
    busy = false;
  }
}

/** Downloads to `file` while hashing; returns the SHA-256 hex. */
async function download(url: string, file: string, size: number, progress: (p: number) => void): Promise<string> {
  const res = await fetchChecked(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || size || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(file);
  let got = 0;
  let last = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (got > MAX_DMG_BYTES) throw new Error("the download is too large");
      hash.update(value);
      if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      const p = total ? Math.min(1, got / total) : 0;
      if (p - last >= 0.02) {
        last = p;
        progress(p);
      }
    }
  } finally {
    await new Promise<void>((r) => out.end(() => r()));
  }
  return hash.digest("hex");
}

/** fetch that follows redirects by hand, refusing any hop that isn't GitHub over HTTPS. */
async function fetchChecked(url: string, accept = "*/*"): Promise<Response> {
  const extra = testApi ? [new URL(testApi).origin] : [];
  for (let hop = 0; hop < 6; hop++) {
    if (!allowedDownloadUrl(url, extra)) throw new Error(`refusing to download from ${new URL(url).host}`);
    const res = await fetch(url, {
      redirect: "manual",
      headers: { Accept: accept, "User-Agent": `mydraw-updater/${APP_VERSION}` },
      signal: AbortSignal.timeout(hop === 0 && accept !== "*/*" ? 10_000 : 600_000),
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).href;
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

// ---------- swap on quit ----------

function applyStagedUpdate(): void {
  if (!staged || !fs.existsSync(staged.path)) return;
  try {
    const script = path.join(os.tmpdir(), `mydraw-swap-${process.pid}.sh`);
    fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o700 });
    const old = path.join(path.dirname(staged.target), ".mydraw-old.app");
    spawn("/bin/sh", [script, String(process.pid), staged.path, staged.target, old, relaunch ? "open" : ""], {
      detached: true,
      stdio: "ignore",
    }).unref();
    staged = null;
  } catch (e) {
    console.error("[mydraw] could not start the update:", e);
  }
}
