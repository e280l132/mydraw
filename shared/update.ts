// In-app updates from GitHub Releases (pure parts, unit-tested in tests/update.test.ts).
// The app is unsigned, so Apple's Squirrel updater can't be used: app/src/updater.ts downloads the
// release DMG, checks its SHA-256, copies the new app next to the running one and swaps the two
// after the app quits, with the shell script below.
import { compareVersions, tagVersion } from "./version";

export const UPDATE_REPO = "e280l132/mydraw";
export const UPDATE_API = "https://api.github.com";
export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases`;
/** Automatic checks run at most this often (manual checks always run). */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** DMG asset name written by electron-builder (electron-builder.yml `dmg.artifactName`). */
export const dmgName = (version: string) => `mydraw-${version}-arm64.dmg`;
export const shaName = (version: string) => `${dmgName(version)}.sha256`;

export interface ReleaseInfo {
  version: string;
  notes: string;
  page: string;
  dmgUrl: string;
  shaUrl: string;
  size: number;
}

/** What the renderer is told (IPC `update:status`). */
export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking"; manual: boolean }
  | { state: "latest"; version: string }
  | { state: "unavailable"; reason: string }
  | { state: "available"; version: string; notes: string; page: string }
  | { state: "downloading"; version: string; progress: number }
  | { state: "ready"; version: string }
  | { state: "error"; message: string; page: string };

export type UpdateAction = "check" | "install" | "skip" | "restart" | "dismiss" | "openPage";
export const UPDATE_ACTIONS: readonly UpdateAction[] = ["check", "install", "skip", "restart", "dismiss", "openPage"];

/**
 * A GitHub "latest release" response -> the release, when it is a published, non-prerelease
 * version with our DMG and its checksum attached. Throws with a readable reason otherwise.
 */
export function parseRelease(json: unknown): ReleaseInfo {
  if (!json || typeof json !== "object") throw new Error("the release list is not readable");
  const r = json as Record<string, unknown>;
  if (r.draft || r.prerelease) throw new Error("the latest release is not final");
  const version = tagVersion(String(r.tag_name ?? ""));
  if (!version) throw new Error(`the latest release tag "${String(r.tag_name ?? "")}" is not a version`);
  const assets = Array.isArray(r.assets) ? (r.assets as Record<string, unknown>[]) : [];
  const find = (name: string) => assets.find((a) => a && a.name === name);
  const dmg = find(dmgName(version));
  const sha = find(shaName(version));
  if (!dmg || !sha) throw new Error(`release ${version} has no ${dmgName(version)} with its .sha256`);
  const dmgUrl = String(dmg.browser_download_url ?? "");
  const shaUrl = String(sha.browser_download_url ?? "");
  return {
    version,
    notes: typeof r.body === "string" ? r.body.slice(0, 20_000) : "",
    page: typeof r.html_url === "string" && /^https:\/\//.test(r.html_url) ? r.html_url : RELEASES_PAGE,
    dmgUrl,
    shaUrl,
    size: typeof dmg.size === "number" ? dmg.size : 0,
  };
}

/** True when `latest` should be offered to someone running `current` (and hasn't skipped it). */
export function isNewer(latest: string, current: string, skipped: string | null = null): boolean {
  if (skipped && compareVersions(latest, skipped) === 0) return false;
  return compareVersions(latest, current) > 0;
}

/**
 * Downloads may only come from GitHub over HTTPS (the asset URL redirects to a githubusercontent
 * host). `extraOrigins` = a test server (MYDRAW_UPDATE_API).
 */
export function allowedDownloadUrl(url: string, extraOrigins: readonly string[] = []): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (extraOrigins.includes(u.origin)) return true;
  if (u.protocol !== "https:") return false;
  return u.hostname === "github.com" || u.hostname === "api.github.com" || u.hostname.endsWith(".githubusercontent.com");
}

/** The hex digest from a `.sha256` file ("<hex>  <name>" or just "<hex>"). */
export function parseSha256(text: string): string | null {
  const m = /^\s*([0-9a-fA-F]{64})\b/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Where the running app's bundle is: `/x/mydraw.app/Contents/MacOS/mydraw` -> `/x/mydraw.app`. */
export function bundleOfExe(exe: string): string | null {
  const m = /^(.*?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exe);
  return m ? m[1] : null;
}

/** Why the app can't replace itself where it runs (null = it can). */
export function cannotUpdateHere(bundle: string | null): string | null {
  if (!bundle) return "mydraw is not running from an app bundle";
  if (bundle.includes("/AppTranslocation/")) return "macOS is running mydraw from a temporary copy. Move mydraw to the Applications folder, open it from there, then update";
  if (bundle.startsWith("/Volumes/")) return "mydraw is running from the disk image. Drag it to the Applications folder, open it from there, then update";
  return null;
}

/**
 * The detached script that swaps the bundles after the app has quit. Arguments (never spliced into
 * the text): $1 pid to wait for, $2 staged new bundle, $3 bundle to replace, $4 where the old one
 * goes, $5 "open" to start the new app afterwards.
 */
export const SWAP_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; TARGET="$3"; OLD="$4"; RELAUNCH="$5"
i=0
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.2
  i=$((i + 1))
  [ "$i" -gt 900 ] && exit 1
done
[ -d "$NEW" ] || exit 1
rm -rf "$OLD"
mv "$TARGET" "$OLD" || exit 1
if mv "$NEW" "$TARGET"; then
  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  rm -rf "$OLD"
else
  mv "$OLD" "$TARGET"
fi
[ "$RELAUNCH" = "open" ] && open "$TARGET"
exit 0
`;
