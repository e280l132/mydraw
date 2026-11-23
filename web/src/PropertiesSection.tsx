// Properties section (hostname, IP, VLAN, role, owner, URL, notes) shown in Excalidraw's properties
// panel next to the Colors & styles section, for one selected shape or icon node. Values live in the
// element's customData (shared/properties.ts) and feed the inventory table, CSV and `get_inventory`.
// Note: Excalidraw's undo does not track customData, so property edits are not undoable.
import { useEffect, useMemo, useRef, useState } from "react";
import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { applyProperties, PROPERTY_FIELDS, readProperties, type PropertyKey } from "../../shared/properties";
import type { El } from "./agent/sceneOps";
import { commitElements, linkOwners } from "./uiActions";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** Bumped by App when the selection or a selected element changes (any edit, also from MCP). */
  tick: number;
}

const NODE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const COLLAPSED_KEY = "mydraw.propertiesCollapsed";

/** The one element whose properties the panel shows: a single selected shape or icon node. */
export function propertyTarget(api: ExcalidrawImperativeAPI): El | null {
  const owners = linkOwners(api);
  const only = owners.length === 1 ? owners[0] : null;
  if (!only || only.customData?.mydrawZone || only.customData?.mydrawLegend) return null;
  return NODE_TYPES.has(only.type) ? only : null;
}

export function PropertiesSection({ api, tick }: Props) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const target = useMemo(() => (api ? propertyTarget(api) : null), [api, tick]);
  const stored = useMemo(() => readProperties(target?.customData), [target]);
  const [draft, setDraft] = useState<Record<PropertyKey, string>>(stored);
  const cancelled = useRef(false);
  // A new shape resets every field. The same shape changed elsewhere (MCP, inventory table, undo)
  // updates only the fields whose stored value changed, so text being typed in another field stays.
  const shown = useRef<{ id: string | undefined; stored: Record<PropertyKey, string> }>({ id: target?.id, stored });
  useEffect(() => {
    const prev = shown.current;
    shown.current = { id: target?.id, stored };
    if (prev.id !== target?.id) return setDraft(stored);
    const changed = PROPERTY_FIELDS.filter((f) => stored[f.key] !== prev.stored[f.key]).map((f) => f.key);
    if (changed.length) setDraft((d) => ({ ...d, ...Object.fromEntries(changed.map((k) => [k, stored[k]])) }));
  }, [stored, target?.id]);
  // Collapsed state is a UI preference: kept across restarts.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const toggle = () =>
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      return !c;
    });

  if (!api || !target) return null;
  const setCount = PROPERTY_FIELDS.filter((f) => stored[f.key]).length;

  const commit = (key: PropertyKey) => {
    // Escape blurs the field, which lands here with the typed text still in `draft`: skip it then.
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const text = draft[key].trim();
    if (text === stored[key]) return;
    // Re-read the element: it may have changed since the panel rendered.
    const live = api.getSceneElements().find((e) => e.id === target.id);
    if (!live) return;
    commitElements(api, [newElementWith(live, { customData: applyProperties(live.customData, { [key]: text }) } as never)]);
  };

  return (
    <fieldset className={`md-style md-props${collapsed ? " md-collapsed" : ""}`} data-md-section="properties" onMouseDown={(e) => e.stopPropagation()}>
      <legend onClick={toggle}>
        <span className="md-legend-text">Properties</span>
        {collapsed && setCount > 0 && <span className="md-props-count">{setCount} set</span>}
        <button
          type="button"
          className="md-collapse-btn"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Show properties" : "Hide properties"}
          title={collapsed ? "Show properties" : "Hide properties"}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </legend>
      {!collapsed && PROPERTY_FIELDS.map((f) => {
        const multiline = "multiline" in f && f.multiline;
        const common = {
          className: "md-props-input",
          "data-prop": f.key,
          value: draft[f.key] ?? "",
          "aria-label": f.label,
          placeholder: f.label,
          onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [f.key]: e.target.value })),
          onBlur: () => commit(f.key),
          onKeyDown: (e: React.KeyboardEvent) => {
            e.stopPropagation(); // typing must not trigger Excalidraw shortcuts
            if (e.key === "Enter" && !(multiline && e.shiftKey)) {
              e.preventDefault();
              (e.target as HTMLElement).blur();
            } else if (e.key === "Escape") {
              cancelled.current = true;
              setDraft((d) => ({ ...d, [f.key]: stored[f.key] }));
              (e.target as HTMLElement).blur();
            }
          },
        };
        return multiline ? <textarea key={f.key} rows={2} {...common} /> : <input key={f.key} type="text" spellCheck={false} {...common} />;
      })}
    </fieldset>
  );
}
