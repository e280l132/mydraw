// mydraw version numbers (pure, unit-tested in tests/version.test.ts).
//
// package.json holds the one version (semver "major.minor.patch"). Releases bump the minor number
// (0.1, 0.2, ...); bug-fix builds the patch (0.1.1). People see the short form: "0.1" when the
// patch is 0, else all three parts. The build injects package.json's version as the constant
// __MYDRAW_VERSION__ (vite.config.ts, scripts/build-app.mjs, scripts/build-mcp.mjs).

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** Text after "-" (e.g. "beta.1"); empty for a release. */
  pre: string;
}

const VERSION_RE = /^v?(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:-([0-9A-Za-z.-]+))?$/;

/** "0.1.0", "v0.2.0", "0.2" (patch 0), "1.0.0-beta.1"; null when it is not a version. */
export function parseVersion(text: string): Version | null {
  const m = VERSION_RE.exec(String(text ?? "").trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0), pre: m[4] ?? "" };
}

/** Negative when a < b, 0 when equal, positive when a > b. A prerelease sorts before its release. Unparseable = lowest. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** What people see: "0.1.0" -> "0.1", "0.1.1" -> "0.1.1", "1.0.0-beta.1" -> "1.0-beta.1". */
export function displayVersion(text: string): string {
  const v = parseVersion(text);
  if (!v) return String(text ?? "");
  const base = v.patch ? `${v.major}.${v.minor}.${v.patch}` : `${v.major}.${v.minor}`;
  return v.pre ? `${base}-${v.pre}` : base;
}

/** Normalised "x.y.z" of a release tag ("v0.2.0" -> "0.2.0"); null for prereleases and non-versions. */
export function tagVersion(tag: string): string | null {
  const v = parseVersion(tag);
  if (!v || v.pre) return null;
  return `${v.major}.${v.minor}.${v.patch}`;
}

/** The next version for `npm run release -- <bump>`: "minor", "patch", "major" or an explicit "x.y.z". */
export function bumpVersion(current: string, bump: string): string {
  const v = parseVersion(current);
  if (!v) throw new Error(`current version "${current}" is not a version`);
  if (bump === "major") return `${v.major + 1}.0.0`;
  if (bump === "minor") return `${v.major}.${v.minor + 1}.0`;
  if (bump === "patch") return `${v.major}.${v.minor}.${v.patch + 1}`;
  const explicit = tagVersion(bump);
  if (!explicit) throw new Error(`"${bump}" is not minor, patch, major or a version like 0.2.0`);
  return explicit;
}
