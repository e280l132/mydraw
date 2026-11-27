// "Set up mydraw" window (pure parts, unit-tested in tests/setup.test.ts). The main-process side is
// app/src/setup.ts, the window web/src/SetupDialog.tsx.
//
// Three steps, each with a state and a button:
//   location  the app should live in /Applications, or ~/Applications for a user without admin
//             rights (from a DMG or Downloads macOS runs a hidden temporary copy: updates fail
//             there and links into it break)
//   command   ~/.local/bin/mydraw -> <app>/Contents/Resources/bin/mydraw
//   claude    Claude Code's user-scope MCP server "mydraw" -> <app>/Contents/Resources/bin/mydraw mcp

export const MCP_NAME = "mydraw";

export type LocationState = "ok" | "move" | "dev";
export type CommandState = "installed" | "missing" | "other" | "unavailable";
export type ClaudeState = "connected" | "missing" | "other" | "noClaude" | "unavailable";

/** Where "move" copies the app: /Applications (all users, needs admin rights) or ~/Applications. */
export type InstallTarget = "system" | "user";
export const INSTALL_TARGETS: readonly InstallTarget[] = ["system", "user"];

export interface LocationStatus {
  state: LocationState;
  bundle: string | null;
  reason?: string;
  /** The two folders "move" can copy to; `writable` = this user may write there. */
  targets: Record<InstallTarget, { dir: string; writable: boolean }>;
  /** The target to offer first. */
  suggested: InstallTarget;
  /** Which target the app is in (state ok), if either. */
  installedIn?: InstallTarget;
  /** Another copy of mydraw in the other target folder (may be opened instead of this one). */
  otherCopy?: string;
}

export interface SetupStatus {
  packaged: boolean;
  location: LocationStatus;
  command: { state: CommandState; link: string; target?: string; onPath: boolean };
  claude: { state: ClaudeState; claudePath?: string; existing?: string };
}

export type SetupAction = "move" | "installCommand" | "removeCommand" | "connectClaude" | "disconnectClaude";
export const SETUP_ACTIONS: readonly SetupAction[] = ["move", "installCommand", "removeCommand", "connectClaude", "disconnectClaude"];

/**
 * The target to offer: /Applications when this user may write there (admins can), else
 * ~/Applications, which needs no password (a standard user can't drag into /Applications).
 */
export const pickTarget = (systemWritable: boolean): InstallTarget => (systemWritable ? "system" : "user");

/** Which target folder holds the bundle, if any. */
export function targetOf(bundle: string | null, targets: Record<InstallTarget, { dir: string }>): InstallTarget | undefined {
  if (!bundle) return undefined;
  const parent = bundle.slice(0, bundle.lastIndexOf("/"));
  return INSTALL_TARGETS.find((t) => targets[t].dir === parent);
}

/** The command inside an app bundle. */
export const bundleCommand = (bundle: string) => `${bundle}/Contents/Resources/bin/mydraw`;
/** A path that is some mydraw app's command (any install location). */
export const isBundleCommand = (p: string) => /\.app\/Contents\/Resources\/bin\/mydraw$/.test(p);

/** Where the app runs from: fine, should be moved (with the reason), or a development build. */
export function locationOf(bundle: string | null, applicationsDirs: readonly string[]): { state: LocationState; reason?: string } {
  if (!bundle) return { state: "dev" };
  if (bundle.includes("/AppTranslocation/")) return { state: "move", reason: "macOS is running mydraw from a temporary copy" };
  if (bundle.startsWith("/Volumes/")) return { state: "move", reason: "mydraw is running from the disk image" };
  const parent = bundle.slice(0, bundle.lastIndexOf("/"));
  if (!applicationsDirs.includes(parent)) return { state: "move", reason: `mydraw is in ${parent}` };
  return { state: "ok" };
}

/** State of the ~/.local/bin/mydraw link. `linkTarget` = readlink, null = no link, "" = a plain file. */
export function commandStateOf(linkTarget: string | null, expected: string): CommandState {
  if (linkTarget === null) return "missing";
  if (linkTarget === expected) return "installed";
  return "other";
}

/** May the command link be replaced? Only a missing link or a link into some mydraw app. */
export const canReplaceCommand = (linkTarget: string | null) => linkTarget === null || isBundleCommand(linkTarget);

export interface McpEntry {
  command?: unknown;
  args?: unknown;
  url?: unknown;
}

/** Text describing a registered server, for "registered elsewhere: …". */
export function describeMcp(entry: McpEntry): string {
  if (typeof entry.url === "string") return entry.url;
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  return [String(entry.command ?? "?"), ...args].join(" ");
}

/** The user-scope "mydraw" entry of ~/.claude.json, or null. */
export function mcpEntryOf(claudeJson: unknown): McpEntry | null {
  if (!claudeJson || typeof claudeJson !== "object") return null;
  const servers = (claudeJson as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object") return null;
  const entry = (servers as Record<string, unknown>)[MCP_NAME];
  return entry && typeof entry === "object" ? (entry as McpEntry) : null;
}

/** Is the entry this app's server (`<this app>/…/bin/mydraw mcp`)? */
export function claudeStateOf(entry: McpEntry | null, expectedCommand: string): ClaudeState {
  if (!entry) return "missing";
  const args = Array.isArray(entry.args) ? entry.args : [];
  return entry.command === expectedCommand && args.length === 1 && args[0] === "mcp" ? "connected" : "other";
}

/** `claude mcp add` arguments that register this app. */
export const mcpAddArgs = (command: string) => ["mcp", "add", "--scope", "user", MCP_NAME, "--", command, "mcp"];
export const mcpRemoveArgs = () => ["mcp", "remove", "--scope", "user", MCP_NAME];

/** Where Claude Code's `claude` usually is, besides the login shell's PATH. */
export function claudeCandidates(home: string): string[] {
  return [`${home}/.local/bin/claude`, `${home}/.claude/local/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude", `${home}/.npm-global/bin/claude`, `${home}/.bun/bin/claude`];
}

/** Is `dir` on a PATH string? */
export const onPath = (pathVar: string, dir: string) => pathVar.split(":").some((p) => p.replace(/\/+$/, "") === dir.replace(/\/+$/, ""));
