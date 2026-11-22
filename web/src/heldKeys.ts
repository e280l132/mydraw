// Which physical keys are held right now: sided modifiers ("MetaRight") and F1-F24. Mouse events
// only carry "some ⌘ is down", so quick connect asks this tracker which ⌘ it is. Installed once on the
// window (capture phase, never swallows anything). Each read is reconciled with the event's own
// modifier flags, so a key released while the window was unfocused can't stay "held".
import { MOD_FAMILIES, tokenForCode, familyOf, type KeyToken, type ModFamily } from "../../shared/quickBindings";

interface Flags {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const FLAG: Record<ModFamily, keyof Flags> = { Meta: "metaKey", Control: "ctrlKey", Alt: "altKey", Shift: "shiftKey" };

const held = new Set<KeyToken>();
const listeners = new Set<() => void>();
let installed = false;

function changed() {
  for (const l of listeners) l();
}

/** Drop sided modifiers the event says are up. */
function reconcile(e: Flags) {
  for (const f of MOD_FAMILIES) {
    if (e[FLAG[f]]) continue;
    held.delete(`${f}Left`);
    held.delete(`${f}Right`);
  }
}

function install() {
  if (installed) return;
  installed = true;
  const onDown = (e: KeyboardEvent) => {
    const t = tokenForCode(e.code);
    reconcile(e);
    if (t) held.add(t);
    changed();
  };
  const onUp = (e: KeyboardEvent) => {
    const t = tokenForCode(e.code);
    if (t) held.delete(t);
    // On a Mac, keys released while ⌘ is down send no keyup: forget F-keys with ⌘ (a held one repeats and comes back).
    if (t && familyOf(t) === "Meta") for (const h of [...held]) if (!familyOf(h)) held.delete(h);
    reconcile(e);
    changed();
  };
  const clear = () => {
    held.clear();
    changed();
  };
  window.addEventListener("keydown", onDown, true);
  window.addEventListener("keyup", onUp, true);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
}

/**
 * The keys held, as of `e` (a pointer or key event) when given: sided modifiers when we saw them go
 * down, the bare family ("Meta") when only the event's flag says one is down (pressed before the
 * window had focus, or a synthetic event), plus F-keys.
 */
export function heldKeys(e?: Flags): Set<KeyToken> {
  install();
  if (e) reconcile(e);
  const out = new Set(held);
  if (e) {
    for (const f of MOD_FAMILIES) if (e[FLAG[f]] && !out.has(`${f}Left`) && !out.has(`${f}Right`)) out.add(f);
  }
  return out;
}

/** Called whenever the held set may have changed. Returns an unsubscribe function. */
export function onHeldKeys(cb: () => void): () => void {
  install();
  listeners.add(cb);
  return () => listeners.delete(cb);
}
