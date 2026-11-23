// Identifies the build of a development checkout (Node only: used by the app's main process and the
// MCP server, never by the renderer).
//
// The app reads its web UI and main process once, at startup. If the checkout is rebuilt while it
// runs, it keeps running the OLD code: fixes seem not to work, and new tool features are missing.
// The app writes its build id into control.json; the MCP server compares it with the build on disk
// and tells the user to restart (see mcp/src/index.ts `staleNotes`).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Files that make up a build, relative to the checkout. */
export const BUILD_FILES = ["web/dist/index.html", "app/dist/main.cjs", "app/dist/preload.cjs"] as const;

/** Hash of the build's files (index.html names the hashed web assets), or null when nothing is built there. */
export function buildId(root: string): string | null {
  const hash = crypto.createHash("sha1");
  let found = false;
  for (const rel of BUILD_FILES) {
    try {
      hash.update(rel).update(fs.readFileSync(path.join(root, rel)));
      found = true;
    } catch {
      hash.update(rel).update("missing");
    }
  }
  return found ? hash.digest("hex").slice(0, 16) : null;
}
