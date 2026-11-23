import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildId } from "../shared/buildId";

function checkout(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-build-"));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe("build id", () => {
  it("is null where nothing is built", () => {
    expect(buildId(checkout({}))).toBeNull();
  });

  it("is stable for the same build and changes with any file of it", () => {
    const files = { "web/dist/index.html": "<script src=a1.js>", "app/dist/main.cjs": "main v1", "app/dist/preload.cjs": "preload v1" };
    const a = checkout(files);
    const b = checkout(files);
    expect(buildId(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(buildId(a)).toBe(buildId(b));
    fs.writeFileSync(path.join(b, "web/dist/index.html"), "<script src=a2.js>");
    expect(buildId(b)).not.toBe(buildId(a));
    fs.writeFileSync(path.join(b, "web/dist/index.html"), files["web/dist/index.html"]);
    fs.writeFileSync(path.join(b, "app/dist/main.cjs"), "main v2");
    expect(buildId(b)).not.toBe(buildId(a));
  });
});
