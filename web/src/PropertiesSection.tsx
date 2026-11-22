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
  /** Bumped by App on every selection change. */
  tick: number;
}

const NODE_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

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
  useEffect(() => setDraft(stored), [stored, target?.id]);

  if (!api || !target) return null;

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
    <fieldset className="md-style md-props" onMouseDown={(e) => e.stopPropagation()}>
      <legend>Properties</legend>
      {PROPERTY_FIELDS.map((f) => {
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
