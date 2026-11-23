// mydraw's own keyboard shortcuts, written once. The main menu, the command palette and the help
// dialog all read from here (and tests/shortcuts.test.ts checks the README table against it), so a
// key never has to be changed in four places.
//
// Written the Mac way: ⌃ Control, ⌥ Option, ⇧ Shift, ⌘ Command, then the key. `formatShortcut`
// turns them into "Ctrl+Alt+P" style on other platforms.
import { IS_MAC_PLATFORM } from "./quickBindings";

export const SHORTCUTS = {
  newDrawing: "⌘N",
  openFile: "⌘O",
  save: "⌘S",
  saveAs: "⇧⌘S",
  closeTab: "⌘W",
  export: "⇧⌘E",
  switchTab: "⌘1–9",
  palette: "⌘K",
  paletteAlways: "⇧⌘P",
  pages: "⌥⌘P",
  lint: "⌥⌘L",
  grid: "⌘'",
  present: "⌥⌘↵",
  versionHistory: "⌥⌘V",
  importText: "⌥⌘U",
  inventory: "⌥⌘T",
  findReplace: "⌥⌘F",
  stencils: "⇧⌘Y",
  quickSaveStencil: "⌥⌘S",
  align: "⇧⌘←/→/↑/↓",
} as const;

export type ShortcutId = keyof typeof SHORTCUTS;

const NON_MAC_MODIFIER: Record<string, string> = { "⌃": "Ctrl", "⌘": "Ctrl", "⌥": "Alt", "⇧": "Shift" };
const NON_MAC_KEY: Record<string, string> = { "↵": "Enter" };
// Shown in this order on other platforms.
const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift"];

/** "⌥⌘P" as shown on this platform: unchanged on a Mac, "Ctrl+Alt+P" elsewhere. */
export function formatShortcut(shortcut: string, mac: boolean = IS_MAC_PLATFORM): string {
  if (mac) return shortcut;
  const mods = new Set<string>();
  let i = 0;
  while (i < shortcut.length && NON_MAC_MODIFIER[shortcut[i]]) mods.add(NON_MAC_MODIFIER[shortcut[i++]]);
  if (!mods.size) return shortcut;
  const key = shortcut.slice(i);
  const ordered = MODIFIER_ORDER.filter((m) => mods.has(m));
  return [...ordered, NON_MAC_KEY[key] ?? key].join("+");
}

/** The label of one of mydraw's shortcuts for this platform. */
export const sc = (id: ShortcutId, mac: boolean = IS_MAC_PLATFORM): string => formatShortcut(SHORTCUTS[id], mac);

/** Names of the keys the quick connect text uses ("⌘-click" on a Mac, "Ctrl-click" elsewhere). */
export const keyNames = (mac: boolean = IS_MAC_PLATFORM) => ({ cmd: mac ? "⌘" : "Ctrl", option: mac ? "Option" : "Alt" });
