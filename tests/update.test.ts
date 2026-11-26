import { describe, expect, it } from "vitest";
import { allowedDownloadUrl, bundleOfExe, cannotUpdateHere, dmgName, isNewer, parseRelease, parseSha256, shaName } from "../shared/update";

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: "v0.2.0",
  draft: false,
  prerelease: false,
  body: "## 0.2\n- things",
  html_url: "https://github.com/e280l132/mydraw/releases/tag/v0.2.0",
  assets: [
    { name: dmgName("0.2.0"), browser_download_url: "https://github.com/e280l132/mydraw/releases/download/v0.2.0/mydraw-0.2.0-arm64.dmg", size: 123 },
    { name: shaName("0.2.0"), browser_download_url: "https://github.com/e280l132/mydraw/releases/download/v0.2.0/mydraw-0.2.0-arm64.dmg.sha256", size: 90 },
  ],
  ...over,
});

describe("update", () => {
  it("reads a release", () => {
    const r = parseRelease(release());
    expect(r.version).toBe("0.2.0");
    expect(r.size).toBe(123);
    expect(r.dmgUrl).toMatch(/arm64\.dmg$/);
    expect(r.shaUrl).toMatch(/\.sha256$/);
    expect(r.notes).toContain("things");
  });

  it("refuses drafts, prereleases, odd tags and missing assets", () => {
    expect(() => parseRelease(release({ draft: true }))).toThrow();
    expect(() => parseRelease(release({ prerelease: true }))).toThrow();
    expect(() => parseRelease(release({ tag_name: "latest" }))).toThrow();
    expect(() => parseRelease(release({ assets: [] }))).toThrow(/no mydraw-0.2.0-arm64.dmg/);
    expect(() => parseRelease(null)).toThrow();
  });

  it("offers only newer, unskipped versions", () => {
    expect(isNewer("0.2.0", "0.1.0")).toBe(true);
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
    expect(isNewer("0.2.0", "0.1.0", "0.2.0")).toBe(false);
    expect(isNewer("0.3.0", "0.1.0", "0.2.0")).toBe(true);
  });

  it("downloads only from GitHub over https (or the test server)", () => {
    expect(allowedDownloadUrl("https://github.com/x/y")).toBe(true);
    expect(allowedDownloadUrl("https://objects.githubusercontent.com/a")).toBe(true);
    expect(allowedDownloadUrl("https://release-assets.githubusercontent.com/a")).toBe(true);
    expect(allowedDownloadUrl("http://github.com/x")).toBe(false);
    expect(allowedDownloadUrl("https://evil.com/github.com")).toBe(false);
    expect(allowedDownloadUrl("https://githubusercontent.com.evil.com/a")).toBe(false);
    expect(allowedDownloadUrl("http://127.0.0.1:9/x", ["http://127.0.0.1:9"])).toBe(true);
    expect(allowedDownloadUrl("nonsense")).toBe(false);
  });

  it("reads checksums", () => {
    const hex = "a".repeat(64);
    expect(parseSha256(`${hex}  mydraw.dmg\n`)).toBe(hex);
    expect(parseSha256(hex.toUpperCase())).toBe(hex);
    expect(parseSha256("abc")).toBeNull();
  });

  it("finds the bundle and refuses temporary locations", () => {
    expect(bundleOfExe("/Applications/mydraw.app/Contents/MacOS/mydraw")).toBe("/Applications/mydraw.app");
    expect(bundleOfExe("/usr/bin/node")).toBeNull();
    expect(cannotUpdateHere("/Applications/mydraw.app")).toBeNull();
    expect(cannotUpdateHere("/private/var/folders/x/AppTranslocation/y/d/mydraw.app")).toMatch(/Applications/);
    expect(cannotUpdateHere("/Volumes/mydraw 0.1.0/mydraw.app")).toMatch(/disk image/);
    expect(cannotUpdateHere(null)).not.toBeNull();
  });
});

describe("update settings", () => {
  it("keeps only valid values", async () => {
    const { DEFAULT_SETTINGS, mergeSettings } = await import("../shared/settings");
    expect(DEFAULT_SETTINGS.updates).toEqual({ check: true, lastCheck: 0, skipped: null });
    const s = mergeSettings(DEFAULT_SETTINGS, { updates: { check: false, lastCheck: 5, skipped: "v0.2.0" } });
    expect(s.updates).toEqual({ check: false, lastCheck: 5, skipped: "0.2.0" });
    const bad = mergeSettings(s, { updates: { check: "no", lastCheck: -1, skipped: "soon" } });
    expect(bad.updates).toEqual(s.updates);
    expect(mergeSettings(s, { updates: { skipped: null } }).updates.skipped).toBeNull();
  });
});
