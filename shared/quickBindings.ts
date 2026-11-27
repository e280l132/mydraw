// Quick connect shortcuts: which held keys (plus a click) trigger which handle action, and which
// keys switch the link-mode options. Pure; the settings file stores `QuickConnectSettings`, and
// everything read from it goes through `normalizeQuickConnect` (untrusted input).
// Unit-tested in tests/quickBindings.test.ts.
//
// A binding is a set of key tokens held while clicking a handle:
//   - a modifier on either side: "Meta" (⌘ / Windows key), "Control", "Alt" (Option), "Shift";
//   - a modifier on one side: "MetaLeft", "MetaRight", "ControlLeft", ... (KeyboardEvent.code);
//   - the function keys "F1".."F24".
// (Fn is not supported: Chromium reports no event or modifier state for it on a Mac.)
// Mouse events only say "some ⌘ is down", so the renderer tracks which physical keys are held
// (web/src/heldKeys.ts) and passes that set to `actionFor`.

export type ModFamily = "Meta" | "Control" | "Alt" | "Shift";
export const MOD_FAMILIES: readonly ModFamily[] = ["Meta", "Control", "Alt", "Shift"];
/** A key token (see the header). */
export type KeyToken = string;

const SIDED = MOD_FAMILIES.flatMap((f) => [`${f}Left`, `${f}Right`]);
const FKEYS = Array.from({ length: 24 }, (_, i) => `F${i + 1}`);
/** Every token a binding may hold, in display order. */
export const KEY_TOKENS: readonly KeyToken[] = [...MOD_FAMILIES.flatMap((f) => [f, `${f}Left`, `${f}Right`]), ...FKEYS];
const ORDER = new Map(KEY_TOKENS.map((t, i) => [t, i]));

export const isKeyToken = (t: unknown): t is KeyToken => typeof t === "string" && ORDER.has(t);
/** The modifier family of a token ("MetaLeft" -> "Meta"), or null for F-keys. */
export function familyOf(t: KeyToken): ModFamily | null {
  return MOD_FAMILIES.find((f) => t === f || t === `${f}Left` || t === `${f}Right`) ?? null;
}
const isSided = (t: KeyToken) => SIDED.includes(t);

export type QuickAction = "copy" | "connectedCopy" | "linkTo" | "pickStencil" | "menu";
export const QUICK_ACTIONS: readonly QuickAction[] = ["copy", "connectedCopy", "linkTo", "pickStencil", "menu"];

export const ACTION_LABEL: Record<QuickAction, string> = {
  copy: "Add a copy",
  connectedCopy: "Add a copy joined by an arrow",
  linkTo: "Draw an arrow to another shape",
  pickStencil: "Pick a shape or stencil",
  menu: "Open the quick connect menu",
};

export interface QuickBinding {
  /** Keys held while left-clicking (empty = plain click). */
  keys: KeyToken[];
  /** A right-click also triggers the action (at most one action may have this). */
  rightClick?: boolean;
}

export interface LinkKeys {
  routing: string;
  heads: string;
  dashed: string;
}
export type LinkKeyName = keyof LinkKeys;
export const LINK_KEY_NAMES: readonly LinkKeyName[] = ["routing", "heads", "dashed"];
export const LINK_KEY_LABEL: Record<LinkKeyName, string> = {
  routing: "Cycle routing (around / elbow / straight / curved)",
  heads: "Cycle arrow heads",
  dashed: "Toggle dashed",
};

export interface QuickConnectSettings {
  bindings: Record<QuickAction, QuickBinding>;
  linkKeys: LinkKeys;
  /** Open the new shape's label for typing right after quick connect adds it. */
  editLabel: boolean;
}

/** Mac or not, wherever this runs (renderer, main, tests). */
export const IS_MAC_PLATFORM: boolean =
  typeof navigator !== "undefined" && navigator.platform ? /Mac|darwin/i.test(navigator.platform) : (globalThis as { process?: { platform?: string } }).process?.platform === "darwin";

/** Key combos tried, in order, for the menu when settings saved before it existed have no binding for it. */
const MENU_KEYS = (mac: boolean): KeyToken[][] =>
  mac ? [["Control"], ["Control", "Shift"], ["Control", "Alt"], ["Alt", "Shift"]] : [["Control", "Shift"], ["Control", "Alt"], ["Alt", "Shift"]];

/** The defaults: click, Option-click, ⌘-click (Ctrl-click off a Mac), Shift-click, right-click (menu); R, A, D. */
export function defaultQuickConnect(mac = IS_MAC_PLATFORM): QuickConnectSettings {
  return {
    bindings: {
      copy: { keys: [] },
      connectedCopy: { keys: ["Alt"] },
      linkTo: { keys: [mac ? "Meta" : "Control"] },
      pickStencil: { keys: ["Shift"] },
      menu: { keys: MENU_KEYS(mac)[0], rightClick: true },
    },
    linkKeys: { routing: "r", heads: "a", dashed: "d" },
    editLabel: false,
  };
}

export const DEFAULT_QUICK_CONNECT: QuickConnectSettings = defaultQuickConnect();

export function cloneQuickConnect(q: QuickConnectSettings): QuickConnectSettings {
  const bindings = {} as Record<QuickAction, QuickBinding>;
  for (const a of QUICK_ACTIONS) {
    bindings[a] = { keys: [...q.bindings[a].keys], ...(q.bindings[a].rightClick ? { rightClick: true } : {}) };
  }
  return { bindings, linkKeys: { ...q.linkKeys }, editLabel: q.editLabel };
}

/**
 * Valid tokens, de-duplicated, in display order. A family given both as "either side" and as a side
 * keeps the sides (the more specific). Unknown tokens make the whole list invalid (null).
 */
export function canonicalKeys(keys: readonly unknown[]): KeyToken[] | null {
  if (!keys.every(isKeyToken)) return null;
  const set = new Set(keys as KeyToken[]);
  for (const f of MOD_FAMILIES) if (set.has(f) && (set.has(`${f}Left`) || set.has(`${f}Right`))) set.delete(f);
  return [...set].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
}

const keysId = (keys: readonly KeyToken[]) => (canonicalKeys(keys) ?? []).join("+");

/** A link key is one letter or digit (case-insensitive). Space, Enter, Escape, Backspace keep their jobs. */
export function validLinkKey(k: unknown): k is string {
  return typeof k === "string" && /^[a-z0-9]$/i.test(k);
}

/** What went wrong with a set of settings: two actions on one combo, two right-click actions, two link keys the same. */
export interface QuickConflict {
  kind: "binding" | "rightClick" | "linkKey";
  /** The things that clash (actions or link key names). */
  items: string[];
}

export function findConflicts(q: QuickConnectSettings): QuickConflict[] {
  const out: QuickConflict[] = [];
  const byCombo = new Map<string, QuickAction[]>();
  for (const a of QUICK_ACTIONS) {
    const k = keysId(q.bindings[a].keys);
    byCombo.set(k, [...(byCombo.get(k) ?? []), a]);
  }
  for (const items of byCombo.values()) if (items.length > 1) out.push({ kind: "binding", items });
  const rc = QUICK_ACTIONS.filter((a) => q.bindings[a].rightClick);
  if (rc.length > 1) out.push({ kind: "rightClick", items: rc });
  const byKey = new Map<string, LinkKeyName[]>();
  for (const n of LINK_KEY_NAMES) {
    const k = q.linkKeys[n].toLowerCase();
    byKey.set(k, [...(byKey.get(k) ?? []), n]);
  }
  for (const items of byKey.values()) if (items.length > 1) out.push({ kind: "linkKey", items });
  return out;
}

/** Settings written before key tokens: `mods: ["meta" | "alt" | "shift" | "ctrl"]`. */
const OLD_MOD: Record<string, (mac: boolean) => KeyToken> = { meta: (mac) => (mac ? "Meta" : "Control"), alt: () => "Alt", shift: () => "Shift", ctrl: () => "Control" };

function readBinding(raw: unknown, fallback: QuickBinding, mac: boolean): QuickBinding {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  let keys: KeyToken[] | null = null;
  if (Array.isArray(r.keys)) keys = canonicalKeys(r.keys);
  else if (Array.isArray(r.mods) && r.mods.every((m) => typeof m === "string" && m in OLD_MOD)) keys = canonicalKeys(r.mods.map((m) => OLD_MOD[m as string](mac)));
  if (!keys) return fallback;
  return { keys, ...(r.rightClick === true ? { rightClick: true } : {}) };
}

/**
 * Settings from untrusted JSON. Anything missing or invalid takes its default; if the result still
 * has clashes (two actions on one combo, ...) the whole set falls back to the defaults, so a hand-edited
 * file can never leave a handle action unreachable.
 */
export function normalizeQuickConnect(raw: unknown, mac = IS_MAC_PLATFORM): QuickConnectSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const b = r.bindings && typeof r.bindings === "object" ? (r.bindings as Record<string, unknown>) : {};
  const k = r.linkKeys && typeof r.linkKeys === "object" ? (r.linkKeys as Record<string, unknown>) : {};
  const out = defaultQuickConnect(mac);
  for (const a of QUICK_ACTIONS) out.bindings[a] = readBinding(b[a], out.bindings[a], mac);
  for (const n of LINK_KEY_NAMES) if (validLinkKey(k[n])) out.linkKeys[n] = (k[n] as string).toLowerCase();
  out.editLabel = r.editLabel === true;
  if (!b.menu) {
    // Saved before the menu existed: right-click now opens the menu, and the menu takes the first
    // key combo nothing else uses (so old custom keys never clash with it and reset everything).
    for (const a of QUICK_ACTIONS) if (a !== "menu") delete out.bindings[a].rightClick;
    const used = new Set(QUICK_ACTIONS.filter((a) => a !== "menu").map((a) => keysId(out.bindings[a].keys)));
    const free = MENU_KEYS(mac).find((keys) => !used.has(keysId(keys)));
    if (free) out.bindings.menu = { keys: free, rightClick: true };
  }
  if (!findConflicts(out).length) return out;
  return { ...defaultQuickConnect(mac), editLabel: out.editLabel };
}

/**
 * Does `binding` match the held keys exactly? `held` holds sided modifiers ("MetaLeft") when the side
 * is known and the bare family ("Meta") when only the event flag says it is down; F-keys as is.
 * Returns the match's specificity (sided tokens count more), or -1.
 */
function matchScore(binding: readonly KeyToken[], held: ReadonlySet<KeyToken>): number {
  const has = (t: KeyToken) => {
    if (held.has(t)) return true;
    const f = familyOf(t);
    if (!f) return false;
    if (t === f) return held.has(`${f}Left`) || held.has(`${f}Right`);
    return held.has(f); // side unknown: give it the benefit of the doubt
  };
  if (!binding.every(has)) return -1;
  for (const h of held) {
    const f = familyOf(h);
    const covered = binding.includes(h) || (f !== null && (binding.includes(f) || (h === f && (binding.includes(`${f}Left`) || binding.includes(`${f}Right`)))));
    if (!covered) return -1;
  }
  return 1 + binding.filter(isSided).length;
}

/**
 * The action a click on a handle triggers. Left click: the action whose keys equal the held ones
 * (so Option does not fire for Option+Shift); when an "either side" and a "this side" binding both
 * match, the sided one wins. Right click: the right-click action, except that a Mac turns
 * Control-click into a right-click, so with Control held it counts as a left click.
 */
export function actionFor(q: QuickConnectSettings, held: ReadonlySet<KeyToken>, button: "left" | "right", mac = IS_MAC_PLATFORM): QuickAction | null {
  const controlHeld = [...held].some((h) => familyOf(h) === "Control");
  if (button === "right" && !(mac && controlHeld)) return QUICK_ACTIONS.find((a) => q.bindings[a].rightClick) ?? null;
  let best: QuickAction | null = null;
  let bestScore = -1;
  for (const a of QUICK_ACTIONS) {
    const s = matchScore(q.bindings[a].keys, held);
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  return best;
}

const MAC_NAME: Record<ModFamily, string> = { Meta: "⌘", Control: "Control", Alt: "Option", Shift: "Shift" };
const PC_NAME: Record<ModFamily, string> = { Meta: "Win", Control: "Ctrl", Alt: "Alt", Shift: "Shift" };

/** "⌘", "Right ⌘", "Left Option", "F5". */
export function keyName(t: KeyToken, mac = IS_MAC_PLATFORM): string {
  const f = familyOf(t);
  if (!f) return t;
  const name = (mac ? MAC_NAME : PC_NAME)[f];
  return t.endsWith("Left") ? `Left ${name}` : t.endsWith("Right") ? `Right ${name}` : name;
}

/** "Option-click", "Right ⌘-Shift-click", "Click". */
export function describeCombo(keys: readonly KeyToken[], mac = IS_MAC_PLATFORM): string {
  const names = (canonicalKeys(keys) ?? []).map((k) => keyName(k, mac));
  return names.length ? `${names.join("-")}-click` : "Click";
}

/** Combo plus right-click, e.g. "Shift-click or right-click". */
export function describeBinding(b: QuickBinding, mac = IS_MAC_PLATFORM): string {
  const s = describeCombo(b.keys, mac);
  return b.rightClick ? `${s} or right-click` : s;
}

/** The key token for a KeyboardEvent.code we track ("MetaLeft", "F5"), or null. "OS*" is older Chromium's name for Meta. */
export function tokenForCode(code: string): KeyToken | null {
  const c = code.replace(/^OS(Left|Right)$/, "Meta$1");
  return SIDED.includes(c) || FKEYS.includes(c) ? c : null;
}

/** "Either side" <-> "left" <-> "right" for a modifier chip in the settings dialog. */
export function cycleSide(t: KeyToken): KeyToken {
  const f = familyOf(t);
  if (!f) return t;
  return t === f ? `${f}Left` : t === `${f}Left` ? `${f}Right` : f;
}
