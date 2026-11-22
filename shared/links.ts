// Drill-down links: a shape's `link` is either an http(s) URL (opens in the browser) or a path to
// another .excalidraw drawing (opens in a tab). Pure; the main process does the opening.

export type LinkTarget =
  | { kind: "url"; url: string }
  /** Absolute path, or "~/…" (the main process expands it). */
  | { kind: "file"; path: string }
  | { kind: "error"; message: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const WIN_DRIVE = /^[a-z]:[\\/]/i;
const DRAWING = /\.excalidraw$/i;

const UNSUPPORTED = "Links open http(s) addresses or .excalidraw drawings";

/** Resolve "." and ".." in a POSIX path (leading "/" or "~/" kept). */
export function normalizePosix(p: string): string {
  const absolute = p.startsWith("/");
  const home = p.startsWith("~/");
  const out: string[] = [];
  const parts = p.split("/");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // "~" is only special as the first segment of "~/...".
    if (!part || part === "." || (part === "~" && i === 0)) continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push(".."); // kept: a path can't climb above "~" or the base
    } else out.push(part);
  }
  return (absolute ? "/" : home ? "~/" : "") + out.join("/");
}

const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), 0)) || "/";

/** What a link points to. `baseFile` is the saved drawing that holds the link (for relative paths). */
export function resolveLink(link: string, baseFile: string | null): LinkTarget {
  const text = link.trim();
  if (!text) return { kind: "error", message: "The link is empty" };

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
      return { kind: "url", url: u.href };
    } catch {
      return { kind: "error", message: `Not a valid web address: ${text}` };
    }
  }

  let path: string;
  if (/^file:/i.test(text)) {
    try {
      const u = new URL(text);
      if (u.host && u.host !== "localhost") return { kind: "error", message: "Only local file links are supported" };
      path = decodeURIComponent(u.pathname);
    } catch {
      return { kind: "error", message: `Not a valid file link: ${text}` };
    }
  } else if (SCHEME.test(text) && !WIN_DRIVE.test(text)) {
    return { kind: "error", message: `${UNSUPPORTED} (not “${text.split(":")[0]}:”)` };
  } else {
    path = text;
  }

  if (!DRAWING.test(path)) return { kind: "error", message: `${UNSUPPORTED}; “${path}” is neither` };
  if (path.startsWith("/")) return { kind: "file", path: normalizePosix(path) };
  if (path.startsWith("~/")) {
    const home = normalizePosix(path);
    if (home.split("/").includes("..")) return { kind: "error", message: "A link can't climb above the home folder with .." };
    return { kind: "file", path: home };
  }
  if (WIN_DRIVE.test(path)) return { kind: "file", path };
  if (!baseFile) return { kind: "error", message: "Save this drawing first: a relative link is resolved from the drawing's folder" };
  return { kind: "file", path: normalizePosix(`${dirname(baseFile)}/${path}`) };
}

/** Error message if `link` can't work as a drill-down link at all (independent of where the drawing is saved). */
export function linkProblem(link: string): string | null {
  const r = resolveLink(link, "/x/base.excalidraw");
  return r.kind === "error" ? r.message : null;
}

/** The link text to store for a target drawing: relative to the drawing that holds it when possible. */
export function fileLink(baseFile: string | null, target: string): string {
  if (!baseFile || !baseFile.startsWith("/") || !target.startsWith("/")) return target;
  const from = dirname(baseFile).split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const ups = from.length - i;
  // Far away (more than two levels up): the absolute path is clearer than ../../../.
  if (ups > 2) return target;
  const rel = [...Array(ups).fill(".."), ...to.slice(i)].join("/");
  // "Q1: plan.excalidraw" would read as a "Q1:" scheme: make it explicitly relative.
  return SCHEME.test(rel) && !WIN_DRIVE.test(rel) ? `./${rel}` : rel;
}
