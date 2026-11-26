import { describe, expect, it } from "vitest";
import { bundleCommand, canReplaceCommand, claudeCandidates, claudeStateOf, commandStateOf, describeMcp, isBundleCommand, locationOf, mcpAddArgs, mcpEntryOf, onPath } from "../shared/setup";

const APPS = ["/Applications", "/Users/u/Applications"];

describe("setup", () => {
  it("judges where the app runs", () => {
    expect(locationOf("/Applications/mydraw.app", APPS).state).toBe("ok");
    expect(locationOf("/Users/u/Applications/mydraw.app", APPS).state).toBe("ok");
    expect(locationOf("/Users/u/Downloads/mydraw.app", APPS)).toEqual({ state: "move", reason: "mydraw is in /Users/u/Downloads" });
    expect(locationOf("/private/var/folders/x/AppTranslocation/y/d/mydraw.app", APPS).reason).toMatch(/temporary/);
    expect(locationOf("/Volumes/mydraw/mydraw.app", APPS).reason).toMatch(/disk image/);
    expect(locationOf(null, APPS).state).toBe("dev");
  });

  it("reads the command link", () => {
    const want = bundleCommand("/Applications/mydraw.app");
    expect(want).toBe("/Applications/mydraw.app/Contents/Resources/bin/mydraw");
    expect(commandStateOf(null, want)).toBe("missing");
    expect(commandStateOf(want, want)).toBe("installed");
    expect(commandStateOf("/old/mydraw.app/Contents/Resources/bin/mydraw", want)).toBe("other");
    expect(commandStateOf("", want)).toBe("other");
    expect(canReplaceCommand(null)).toBe(true);
    expect(canReplaceCommand("/old/mydraw.app/Contents/Resources/bin/mydraw")).toBe(true);
    expect(canReplaceCommand("/Users/u/Projects/mydraw/bin/mydraw.mjs")).toBe(false);
    expect(canReplaceCommand("")).toBe(false);
    expect(isBundleCommand("/x/mydraw.app/Contents/Resources/bin/mydraw")).toBe(true);
  });

  it("reads Claude Code's registration", () => {
    const cmd = bundleCommand("/Applications/mydraw.app");
    expect(mcpEntryOf(null)).toBeNull();
    expect(mcpEntryOf({ mcpServers: {} })).toBeNull();
    const ours = { type: "stdio", command: cmd, args: ["mcp"] };
    const dev = { type: "stdio", command: "node", args: ["/Users/u/Projects/mydraw/mcp/dist/index.js"] };
    expect(mcpEntryOf({ mcpServers: { mydraw: ours } })).toBe(ours);
    expect(claudeStateOf(null, cmd)).toBe("missing");
    expect(claudeStateOf(ours, cmd)).toBe("connected");
    expect(claudeStateOf(dev, cmd)).toBe("other");
    expect(claudeStateOf({ command: "/old/mydraw.app/Contents/Resources/bin/mydraw", args: ["mcp"] }, cmd)).toBe("other");
    expect(describeMcp(dev)).toBe("node /Users/u/Projects/mydraw/mcp/dist/index.js");
    expect(describeMcp({ url: "https://x" })).toBe("https://x");
  });

  it("builds the claude arguments and finds candidates", () => {
    expect(mcpAddArgs("/A/mydraw")).toEqual(["mcp", "add", "--scope", "user", "mydraw", "--", "/A/mydraw", "mcp"]);
    expect(claudeCandidates("/Users/u")[0]).toBe("/Users/u/.local/bin/claude");
    expect(onPath("/usr/bin:/Users/u/.local/bin/", "/Users/u/.local/bin")).toBe(true);
    expect(onPath("/usr/bin", "/Users/u/.local/bin")).toBe(false);
  });
});
