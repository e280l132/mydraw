import { describe, expect, it } from "vitest";
import {
  actionFor,
  canonicalKeys,
  cycleSide,
  defaultQuickConnect,
  describeBinding,
  describeCombo,
  findConflicts,
  keyName,
  normalizeQuickConnect,
  tokenForCode,
  type QuickConnectSettings,
} from "../shared/quickBindings";
import { DEFAULT_SETTINGS, mergeSettings } from "../shared/settings";

const mac = defaultQuickConnect(true);
const pc = defaultQuickConnect(false);
const held = (...k: string[]) => new Set(k);
const withKeys = (base: QuickConnectSettings, patch: Partial<Record<keyof QuickConnectSettings["bindings"], string[]>>) => {
  const q = structuredClone(base);
  for (const [a, keys] of Object.entries(patch)) q.bindings[a as keyof typeof q.bindings].keys = keys!;
  return q;
};

describe("actionFor: defaults", () => {
  it("maps the default combos on a Mac", () => {
    expect(actionFor(mac, held(), "left", true)).toBe("copy");
    expect(actionFor(mac, held("AltLeft"), "left", true)).toBe("connectedCopy");
    expect(actionFor(mac, held("MetaRight"), "left", true)).toBe("linkTo");
    expect(actionFor(mac, held("Meta"), "left", true)).toBe("linkTo"); // side unknown (flag only)
    expect(actionFor(mac, held("ShiftLeft"), "left", true)).toBe("pickStencil");
    expect(actionFor(mac, held(), "right", true)).toBe("pickStencil");
  });

  it("uses Ctrl for linking off a Mac", () => {
    expect(actionFor(pc, held("ControlLeft"), "left", false)).toBe("linkTo");
    expect(actionFor(pc, held("MetaLeft"), "left", false)).toBeNull();
  });

  it("needs the exact set of keys", () => {
    expect(actionFor(mac, held("AltLeft", "ShiftLeft"), "left", true)).toBeNull();
    expect(actionFor(mac, held("MetaLeft", "F5"), "left", true)).toBeNull();
  });
});

describe("actionFor: sides, Control, F-keys", () => {
  it("tells left from right", () => {
    const q = withKeys(mac, { linkTo: ["MetaLeft"], connectedCopy: ["MetaRight"] });
    expect(actionFor(q, held("MetaLeft"), "left", true)).toBe("linkTo");
    expect(actionFor(q, held("MetaRight"), "left", true)).toBe("connectedCopy");
    expect(actionFor(q, held("MetaLeft", "MetaRight"), "left", true)).toBeNull();
  });

  it("prefers a sided binding over an either-side one", () => {
    const q = withKeys(mac, { linkTo: ["Meta"], connectedCopy: ["MetaRight"] });
    expect(actionFor(q, held("MetaRight"), "left", true)).toBe("connectedCopy");
    expect(actionFor(q, held("MetaLeft"), "left", true)).toBe("linkTo");
  });

  it("supports Control on a Mac, where Control-click arrives as a right-click", () => {
    const q = withKeys(mac, { connectedCopy: ["Control"] });
    expect(actionFor(q, held("ControlLeft"), "left", true)).toBe("connectedCopy");
    expect(actionFor(q, held("ControlLeft"), "right", true)).toBe("connectedCopy");
    expect(actionFor(q, held(), "right", true)).toBe("pickStencil");
    // Off a Mac a right-click is a right-click.
    expect(actionFor(withKeys(pc, { connectedCopy: ["Alt"] }), held("ControlLeft"), "right", false)).toBe("pickStencil");
  });

  it("supports function keys, alone or with modifiers", () => {
    const q = withKeys(mac, { connectedCopy: ["F1"], linkTo: ["F5"], pickStencil: ["ControlRight", "F12"] });
    expect(actionFor(q, held("F1"), "left", true)).toBe("connectedCopy");
    expect(actionFor(q, held("F5"), "left", true)).toBe("linkTo");
    expect(actionFor(q, held("ControlRight", "F12"), "left", true)).toBe("pickStencil");
    expect(actionFor(q, held("ControlLeft", "F12"), "left", true)).toBeNull();
  });
});

describe("keys", () => {
  it("canonicalizes and rejects unknown tokens", () => {
    expect(canonicalKeys(["F5", "Shift", "MetaRight"])).toEqual(["MetaRight", "Shift", "F5"]);
    expect(canonicalKeys(["Meta", "MetaLeft"])).toEqual(["MetaLeft"]);
    expect(canonicalKeys(["F2", "F2"])).toEqual(["F2"]);
    expect(canonicalKeys(["Fn"])).toBeNull(); // not supported
    expect(canonicalKeys(["Hyper"])).toBeNull();
    expect(canonicalKeys(["F25"])).toBeNull();
  });

  it("maps KeyboardEvent.code to tokens", () => {
    expect(tokenForCode("MetaRight")).toBe("MetaRight");
    expect(tokenForCode("OSLeft")).toBe("MetaLeft");
    expect(tokenForCode("ControlLeft")).toBe("ControlLeft");
    expect(tokenForCode("F11")).toBe("F11");
    expect(tokenForCode("Fn")).toBeNull();
    expect(tokenForCode("KeyA")).toBeNull();
  });

  it("cycles either side -> left -> right", () => {
    expect(cycleSide("Alt")).toBe("AltLeft");
    expect(cycleSide("AltLeft")).toBe("AltRight");
    expect(cycleSide("AltRight")).toBe("Alt");
    expect(cycleSide("F3")).toBe("F3");
  });

  it("names keys per platform", () => {
    expect(keyName("MetaRight", true)).toBe("Right ⌘");
    expect(keyName("Control", true)).toBe("Control");
    expect(keyName("AltLeft", false)).toBe("Left Alt");
    expect(describeCombo([], true)).toBe("Click");
    expect(describeCombo(["Alt"], true)).toBe("Option-click");
    expect(describeCombo(["Shift", "MetaRight"], true)).toBe("Right ⌘-Shift-click");
    expect(describeCombo(["F5", "AltLeft"], true)).toBe("Left Option-F5-click");
    expect(describeBinding(mac.bindings.pickStencil, true)).toBe("Shift-click or right-click");
  });
});

describe("normalizeQuickConnect", () => {
  it("returns the defaults for junk", () => {
    for (const raw of [undefined, null, 5, "x", [], {}, { bindings: 3 }]) expect(normalizeQuickConnect(raw, true)).toEqual(mac);
  });

  it("replaces invalid entries only", () => {
    const n = normalizeQuickConnect({ bindings: { linkTo: { keys: ["Hyper"] }, copy: { keys: "Alt" }, connectedCopy: { keys: ["ControlRight"] } }, linkKeys: { routing: "xx", heads: "H" } }, true);
    expect(n.bindings.linkTo).toEqual(mac.bindings.linkTo);
    expect(n.bindings.copy).toEqual(mac.bindings.copy);
    expect(n.bindings.connectedCopy).toEqual({ keys: ["ControlRight"] });
    expect(n.linkKeys).toEqual({ routing: "r", heads: "h", dashed: "d" });
  });

  it("reads the old `mods` format", () => {
    const old = { bindings: { copy: { mods: [] }, connectedCopy: { mods: ["shift"] }, linkTo: { mods: ["meta"] }, pickStencil: { mods: ["alt"], rightClick: true } } };
    const n = normalizeQuickConnect(old, true);
    expect(n.bindings.connectedCopy.keys).toEqual(["Shift"]);
    expect(n.bindings.linkTo.keys).toEqual(["Meta"]);
    expect(n.bindings.pickStencil).toEqual({ keys: ["Alt"], rightClick: true });
    expect(normalizeQuickConnect(old, false).bindings.linkTo.keys).toEqual(["Control"]);
  });

  it("falls back to the defaults when two actions share a combo", () => {
    expect(normalizeQuickConnect({ bindings: { connectedCopy: { keys: ["Meta"] } } }, true)).toEqual(mac);
    expect(normalizeQuickConnect({ bindings: { connectedCopy: { keys: ["Shift", "Shift"] } } }, true)).toEqual(mac); // same as pickStencil after dedupe
    expect(normalizeQuickConnect({ linkKeys: { routing: "a" } }, true)).toEqual(mac);
  });

  it("allows either-side and one-side bindings of the same modifier side by side", () => {
    const n = normalizeQuickConnect({ bindings: { connectedCopy: { keys: ["MetaRight"] } } }, true);
    expect(n.bindings.connectedCopy.keys).toEqual(["MetaRight"]);
    expect(n.bindings.linkTo.keys).toEqual(["Meta"]);
  });
});

describe("findConflicts", () => {
  it("reports shared combos, double right-click and shared link keys", () => {
    const x = defaultQuickConnect(true);
    expect(findConflicts(x)).toEqual([]);
    x.bindings.linkTo.keys = ["Alt"];
    x.bindings.copy.rightClick = true;
    x.linkKeys.dashed = "R";
    expect(findConflicts(x).map((c) => c.kind).sort()).toEqual(["binding", "linkKey", "rightClick"]);
  });
});

describe("settings", () => {
  it("defaults, validates and round-trips quickConnect", () => {
    expect(DEFAULT_SETTINGS.quickConnect).toEqual(defaultQuickConnect());
    const custom = withKeys(DEFAULT_SETTINGS.quickConnect, { copy: ["AltRight"], connectedCopy: ["F9"] });
    const s = mergeSettings(DEFAULT_SETTINGS, { quickConnect: custom });
    expect(s.quickConnect.bindings.copy.keys).toEqual(["AltRight"]);
    expect(mergeSettings(s, { theme: "dark" }).quickConnect).toEqual(s.quickConnect);
    expect(mergeSettings(s, JSON.parse(JSON.stringify(s))).quickConnect).toEqual(s.quickConnect);
    expect(mergeSettings(s, { quickConnect: "nope" }).quickConnect).toEqual(defaultQuickConnect());
  });
});
