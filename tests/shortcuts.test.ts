import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatShortcut, SHORTCUTS, sc } from "../shared/shortcuts";

describe("formatShortcut", () => {
  it("keeps the Mac symbols on a Mac", () => {
    expect(formatShortcut("⌥⌘P", true)).toBe("⌥⌘P");
    expect(sc("export", true)).toBe("⇧⌘E");
  });

  it("writes Ctrl+Alt+Shift names elsewhere, in a fixed order", () => {
    expect(formatShortcut("⌘N", false)).toBe("Ctrl+N");
    expect(formatShortcut("⌥⌘P", false)).toBe("Ctrl+Alt+P");
    expect(formatShortcut("⇧⌘S", false)).toBe("Ctrl+Shift+S");
    expect(formatShortcut("⌥⌘↵", false)).toBe("Ctrl+Alt+Enter");
    expect(formatShortcut("⌘'", false)).toBe("Ctrl+'");
    expect(formatShortcut("⌘1–9", false)).toBe("Ctrl+1–9");
  });

  it("leaves text without modifier symbols alone", () => {
    expect(formatShortcut("F7", false)).toBe("F7");
  });

  it("has no two actions on the same keys", () => {
    const keys = Object.values(SHORTCUTS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("README shortcut table", () => {
  it("lists the same keys as SHORTCUTS", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const table = readme.split("## Keyboard shortcuts")[1]?.split("\n## ")[0] ?? "";
    // Not in the README table: shown by the menu or Excalidraw, listed elsewhere in the README.
    const skip = new Set(["newDrawing", "openFile", "save", "saveAs", "closeTab", "switchTab", "palette", "quickSaveStencil", "align"]);
    for (const [id, keys] of Object.entries(SHORTCUTS)) {
      if (skip.has(id)) continue;
      expect(table, `README table is missing ${id} (${keys})`).toContain(keys);
    }
  });
});
