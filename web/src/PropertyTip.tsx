// Properties on hover: rest the pointer on a shape or icon that has properties (hostname, IP, VLAN,
// role, owner, URL, notes, other keys) and a small tip lists them, without selecting anything. A DOM
// overlay over the active tab's canvas, never part of the scene. Shown only for the plain pointer
// tool and not for the shape the Properties section already shows (the selected one).
import { useEffect, useRef, useState } from "react";
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { PROPERTY_FIELDS, extraProperties, readProperties } from "../../shared/properties";
import { isIconNode } from "./agent/sceneOps";
import { elementAt } from "./library/pickColor";

/** The pointer must rest this long (ms) before the tip appears. */
export const TIP_DELAY_MS = 800;
/** Pointer travel (screen px) that counts as moving rather than resting. */
const REST_JITTER = 5;
const NOTES_MAX = 160;

interface Props {
  tabId: string;
  getApi(): ExcalidrawImperativeAPI | undefined;
  /** A dialog, palette, find bar or pick mode is open. */
  blocked: boolean;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  rows: { label: string; value: string }[];
}

/** The shape that owns the properties of what is under the pointer (an icon node for its image or caption). */
function ownerOf(api: ExcalidrawImperativeAPI, hit: ExcalidrawElement): ExcalidrawElement {
  if (hit.type !== "image") return hit;
  const node = (api.getSceneElements() as ExcalidrawElement[]).find((n) => isIconNode(n) && n.groupIds.some((g) => hit.groupIds.includes(g)));
  return node ?? hit;
}

/** Plain pointer tool, nothing being dragged or edited, no menu or dialog. */
function idle(api: ExcalidrawImperativeAPI): boolean {
  const st = api.getAppState() as AppState & { contextMenu?: unknown };
  return !(
    st.activeTool.type !== "selection" ||
    st.viewModeEnabled ||
    st.editingTextElement ||
    st.editingLinearElement ||
    st.newElement ||
    st.multiElement ||
    st.resizingElement ||
    st.selectionElement ||
    st.selectedElementsAreBeingDragged ||
    st.isResizing ||
    st.isRotating ||
    st.openDialog ||
    st.contextMenu ||
    st.cursorButton === "down"
  );
}

function labelOf(api: ExcalidrawImperativeAPI, el: ExcalidrawElement): string {
  const scene = api.getSceneElements() as (ExcalidrawElement & { containerId?: string | null; originalText?: string; text?: string })[];
  const text = scene.find((t) => t.type === "text" && !t.isDeleted && t.containerId === el.id);
  return (text?.originalText ?? text?.text ?? (el.type === "text" ? (el as { text?: string }).text : "") ?? "").replace(/\s*\n\s*/g, " ").trim();
}

export function tipFor(api: ExcalidrawImperativeAPI, clientX: number, clientY: number): Tip | null {
  const st = api.getAppState();
  const p = viewportCoordsToSceneCoords({ clientX, clientY }, st);
  const hit = elementAt(api, p.x, p.y);
  if (!hit) return null;
  const owner = ownerOf(api, hit);
  if (st.selectedElementIds[owner.id]) return null; // the Properties section shows the selected one
  const props = readProperties(owner.customData);
  const rows: Tip["rows"] = PROPERTY_FIELDS.filter((f) => props[f.key]).map((f) => ({
    label: f.label,
    value: f.key === "notes" && props[f.key].length > NOTES_MAX ? `${props[f.key].slice(0, NOTES_MAX)}…` : props[f.key],
  }));
  for (const [k, v] of Object.entries(extraProperties(owner.customData))) rows.push({ label: k, value: v.length > NOTES_MAX ? `${v.slice(0, NOTES_MAX)}…` : v });
  if (!rows.length) return null;
  return { x: clientX, y: clientY, title: labelOf(api, owner), rows };
}

export function PropertyTip({ tabId, getApi, blocked }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(`[data-md-tab="${tabId}"]`);
    if (!root) return;
    let timer: number | undefined;
    let rest = { x: 0, y: 0 };
    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setTip(null);
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - rest.x, e.clientY - rest.y) < REST_JITTER && (timer !== undefined)) return;
      rest = { x: e.clientX, y: e.clientY };
      hide();
      // Only over the bare canvas: toolbars, panels and menus have their own tooltips.
      if (e.pointerType !== "mouse" || !(e.target instanceof HTMLCanvasElement)) return;
      timer = window.setTimeout(() => {
        const api = getApi();
        if (!api || blockedRef.current || !idle(api)) return;
        setTip(tipFor(api, rest.x, rest.y));
      }, TIP_DELAY_MS);
    };
    root.addEventListener("pointermove", onMove, { capture: true, passive: true });
    root.addEventListener("pointerdown", hide, { capture: true, passive: true });
    root.addEventListener("pointerleave", hide, { passive: true });
    root.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("keydown", hide, { capture: true, passive: true });
    return () => {
      hide();
      root.removeEventListener("pointermove", onMove, { capture: true });
      root.removeEventListener("pointerdown", hide, { capture: true });
      root.removeEventListener("pointerleave", hide);
      root.removeEventListener("wheel", hide, { capture: true });
      window.removeEventListener("keydown", hide, { capture: true });
    };
  }, [tabId, getApi]);

  if (!tip) return null;
  // Keep the tip on screen: flip to the other side of the pointer near the right and bottom edges.
  const w = 260;
  const left = tip.x + 16 + w > window.innerWidth ? Math.max(8, tip.x - 16 - w) : tip.x + 16;
  const estHeight = 28 + tip.rows.length * 20;
  const top = tip.y + 20 + estHeight > window.innerHeight ? Math.max(8, tip.y - 12 - estHeight) : tip.y + 20;
  return (
    <div className="md-proptip" role="tooltip" style={{ left, top, width: w }}>
      {tip.title && <div className="md-proptip-title">{tip.title}</div>}
      {tip.rows.map((r) => (
        <div key={r.label} className="md-proptip-row">
          <span className="md-proptip-label">{r.label}</span>
          <span className="md-proptip-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
