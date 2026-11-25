// "More…" buttons at the end of Excalidraw's Fill and Stroke style rows: each opens a
// popover with the styles Excalidraw's own buttons don't offer. Same host mechanism as the fine-tune
// buttons (web/src/FineTune.tsx): App's panel observer appends a host span to each row
// (`attachStyleMoreHosts`) and this component portals into it.
//
// Fill: roughjs fillers Excalidraw passes through untouched (shared/fills.ts). A pick is one undo
// step for the selection; with nothing selected it sets the fill for the next shape
// (`currentItemFillStyle`, not an undo step).
// Stroke style: dash patterns from customData.mydrawDash (shared/dash.ts, web/src/dashOps.ts). Excalidraw
// highlights the fallback (dashed / dotted) button for those, so the row gets `data-md-custom` and CSS
// mutes that highlight; a click on one of Excalidraw's own buttons drops our dash style.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FillStyle } from "@excalidraw/excalidraw/element/types";
import { RoughGenerator } from "roughjs/bin/generator";
import { EXTRA_FILLS, FILL_STYLES, isExtraFill, type FillStyleId } from "../../shared/fills";
import { DASH_IDS, DASH_STYLES, type DashId } from "../../shared/dash";
import { applyDash, clearDashAfterNative, currentDash, dashTargets } from "./dashOps";
import {
  cssGradient,
  GRADIENT_PRESET_IDS,
  GRADIENT_PRESETS,
  gradientPatch,
  gradientPresetOf,
  storedGradient,
  type Gradient,
} from "../../shared/gradient";
import { applyGradient, clearGradientAfterNative, currentGradient, GradientSession, gradientTargets, type GradientChange } from "./gradientOps";
import { ColorPicker } from "./library/IconColorSection";
import { AngleDial } from "./AngleDial";
import { MorePopover } from "./MorePopover";
import type { El } from "./agent/sceneOps";
import { commitElements } from "./uiActions";

export type StyleMoreKind = "fill" | "stroke";
export type StyleMoreHosts = Partial<Record<StyleMoreKind, HTMLElement>>;

const KINDS: StyleMoreKind[] = ["fill", "stroke"];

/** The row a kind lives in: found by one of Excalidraw's own controls in it. */
const ROW_PROBE: Record<StyleMoreKind, string> = {
  fill: '[data-testid="fill-hachure"]',
  stroke: 'input[type=radio][name="strokeStyle"]',
};

/** Make sure each shown row ends with our host span (re-appended whenever Excalidraw re-renders it). */
export function attachStyleMoreHosts(column: HTMLElement): StyleMoreHosts {
  const out: StyleMoreHosts = {};
  for (const kind of KINDS) {
    const list = column.querySelector(ROW_PROBE[kind])?.closest(".buttonList");
    if (!list) continue;
    let host = list.querySelector<HTMLElement>(":scope > .md-more-host");
    if (!host) {
      host = document.createElement("span");
      host.className = "md-more-host";
      host.dataset.more = kind;
    }
    if (list.lastElementChild !== host) list.append(host);
    out[kind] = host;
  }
  return out;
}

export const sameMoreHosts = (a: StyleMoreHosts, b: StyleMoreHosts) => KINDS.every((k) => a[k] === b[k]);

const NATIVE_STROKES = ["solid", "dashed", "dotted"] as const;

const FILLABLE = new Set(["rectangle", "diamond", "ellipse", "line", "freedraw", "iframe", "embeddable"]);

/** Selected elements a fill applies to (icon-node containers stay borderless boxes). */
function fillTargets(api: ExcalidrawImperativeAPI): El[] {
  const sel = api.getAppState().selectedElementIds;
  return api
    .getSceneElements()
    .filter((e) => sel[e.id] && !e.locked && FILLABLE.has(e.type) && !(e.customData as Record<string, unknown> | undefined)?.mydrawNode) as unknown as El[];
}

/** The selection's common fill, null when mixed; nothing selected = the next shape's fill. */
function currentFill(api: ExcalidrawImperativeAPI, els: El[]): string | null {
  if (!els.length) return api.getAppState().currentItemFillStyle;
  const first = els[0].fillStyle as string;
  return els.every((e) => e.fillStyle === first) ? first : null;
}

export function applyFill(api: ExcalidrawImperativeAPI, fill: FillStyleId): void {
  const els = fillTargets(api);
  const appState = { currentItemFillStyle: fill as FillStyle } as Partial<AppState>;
  if (!els.length) {
    api.updateScene({ appState: appState as AppState, captureUpdate: CaptureUpdateAction.NEVER });
    return;
  }
  // A pattern replaces a gradient (otherwise it would come back with the next Solid).
  const changed = els
    .filter((e) => e.fillStyle !== fill || storedGradient(e as never))
    .map((e) =>
      newElementWith(e as unknown as ExcalidrawElement, {
        fillStyle: fill as FillStyle,
        ...(storedGradient(e as never) ? { customData: gradientPatch(e.customData as Record<string, unknown> | undefined, null).customData } : {}),
      } as never),
    );
  commitElements(api, changed, [], appState);
}

// ---------- previews ----------

/** SVG paths of a small square filled with `fill`, drawn by roughjs itself (what the canvas draws). */
function fillPreviewPaths(fill: FillStyleId): { d: string; stroke: string; strokeWidth: number; fill?: string }[] {
  const g = new RoughGenerator();
  const shape = g.rectangle(3, 3, 26, 26, {
    seed: 7,
    roughness: 0.6,
    fill: "currentColor",
    fillStyle: fill,
    fillWeight: 1,
    hachureGap: 4.5,
    stroke: "currentColor",
    strokeWidth: 1.25,
    preserveVertices: true,
  });
  return g.toPaths(shape);
}

function FillPreview({ fill }: { fill: FillStyleId }) {
  const paths = useMemo(() => fillPreviewPaths(fill), [fill]);
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p.d} stroke={p.stroke === "none" ? "none" : "currentColor"} strokeWidth={p.strokeWidth} fill={p.fill && p.fill !== "none" ? "currentColor" : "none"} />
      ))}
    </svg>
  );
}

/** A line drawn with a dash array (scaled from a 2px stroke). */
function DashPreview({ id }: { id: DashId }) {
  const arr = DASH_STYLES[id].pattern(2);
  return (
    <svg viewBox="0 0 40 12" width="40" height="12" aria-hidden="true">
      <line x1="1" y1="6" x2="39" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray={arr.map((v) => v * 0.6).join(" ")} strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

// ---------- component ----------

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** Changes with the selection and selected elements' versions. */
  tick: number;
  hosts: StyleMoreHosts;
}

export function StyleMore({ api, tick, hosts }: Props) {
  const [open, setOpen] = useState<StyleMoreKind | null>(null);
  // Nothing-selected picks change no element, so `tick` doesn't move: re-read the default ourselves.
  const [localTick, setTickLocal] = useState(0);
  const anchors = useRef<Partial<Record<StyleMoreKind, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (open && !hosts[open]) setOpen(null);
  }, [open, hosts]);
  useEffect(() => setOpen(null), [api]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fill = useMemo(() => (api ? currentFill(api, fillTargets(api)) : null), [api, tick, localTick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dash = useMemo(() => (api ? currentDash(api, dashTargets(api)) : ""), [api, tick, open, localTick]);

  // Stroke style row: mute Excalidraw's fallback highlight while one of our dashes is shown, and drop
  // ours when one of Excalidraw's own buttons is clicked (after Excalidraw has applied its change).
  const strokeList = hosts.stroke?.parentElement ?? null;
  useEffect(() => {
    if (!strokeList) return;
    strokeList.toggleAttribute("data-md-custom", !!dash);
  });
  // Fill row: Excalidraw's own buttons turn a gradient back into a plain fill.
  const fillList = hosts.fill?.parentElement ?? null;
  useEffect(() => {
    if (!fillList || !api) return;
    const onClick = (e: Event) => {
      if (!(e.target as HTMLElement).closest('button[data-testid^="fill-"]')) return;
      setTimeout(() => clearGradientAfterNative(api), 0);
    };
    fillList.addEventListener("click", onClick, true);
    return () => fillList.removeEventListener("click", onClick, true);
  }, [fillList, api]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const grad = useMemo(() => (api ? currentGradient(gradientTargets(api)) : null), [api, tick, localTick]);
  useEffect(() => {
    if (!fillList) return;
    fillList.toggleAttribute("data-md-custom", !!grad);
  });

  useEffect(() => {
    if (!strokeList || !api) return;
    const onClick = (e: Event) => {
      // Excalidraw's radios carry no value: its options are solid, dashed, dotted in that order.
      const label = (e.target as HTMLElement).closest("label");
      if (!label?.querySelector('input[name="strokeStyle"]')) return;
      const style = NATIVE_STROKES[[...strokeList.querySelectorAll(":scope > label")].indexOf(label)];
      if (!style) return;
      setTimeout(() => clearDashAfterNative(api, style), 0);
    };
    strokeList.addEventListener("click", onClick, true);
    return () => strokeList.removeEventListener("click", onClick, true);
  }, [strokeList, api]);

  if (!api) return null;
  return (
    <>
      {hosts.fill &&
        createPortal(
          <button
            type="button"
            ref={(b) => {
              anchors.current.fill = b;
            }}
            className={`md-ft-btn md-more-btn${isExtraFill(fill) || grad ? " active" : ""}${open === "fill" ? " open" : ""}`}
            data-more-kind="fill"
            title={grad ? "Fill: gradient. More fills…" : isExtraFill(fill) ? `Fill: ${FILL_STYLES.find((f) => f.id === fill)?.label}. More fills…` : "More fills…"}
            aria-label="More fills"
            aria-expanded={open === "fill"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setOpen((o) => (o === "fill" ? null : "fill"))}
          >
            {grad && grad !== "mixed" ? (
              <span className="md-grad-dot" style={{ background: cssGradient(grad) }} />
            ) : isExtraFill(fill) ? (
              <FillPreview fill={fill as FillStyleId} />
            ) : (
              <MoreIcon />
            )}
          </button>,
          hosts.fill,
          "fill",
        )}
      {hosts.stroke &&
        createPortal(
          <button
            type="button"
            ref={(b) => {
              anchors.current.stroke = b;
            }}
            className={`md-ft-btn md-more-btn${dash ? " active" : ""}${open === "stroke" ? " open" : ""}`}
            data-more-kind="stroke"
            title={dash ? `Stroke: ${DASH_STYLES[dash].label}. More styles…` : "More stroke styles…"}
            aria-label="More stroke styles"
            aria-expanded={open === "stroke"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setOpen((o) => (o === "stroke" ? null : "stroke"))}
          >
            {dash ? <DashPreview id={dash} /> : <MoreIcon />}
          </button>,
          hosts.stroke,
          "stroke",
        )}
      {open === "stroke" && hosts.stroke && (
        <MorePopover title="Stroke style" anchor={anchors.current.stroke ?? null} onClose={() => setOpen(null)} kind="stroke">
          <div className="md-more-grid md-more-grid-2" role="group" aria-label="More stroke styles">
            {DASH_IDS.map((id) => (
              <button
                type="button"
                key={id}
                className={`md-more-tile md-more-tile-row${dash === id ? " on" : ""}`}
                data-dash={id}
                title={DASH_STYLES[id].hint}
                aria-pressed={dash === id}
                onClick={() => {
                  applyDash(api, id);
                  setTickLocal((n) => n + 1);
                }}
              >
                <DashPreview id={id} />
                <span>{DASH_STYLES[id].label}</span>
              </button>
            ))}
          </div>
          {!dashTargets(api).length && <p className="md-ft-note">Nothing selected: sets the stroke for what you draw next.</p>}
        </MorePopover>
      )}
      {open === "fill" && hosts.fill && (
        <MorePopover title="Fill" anchor={anchors.current.fill ?? null} onClose={() => setOpen(null)} kind="fill">
          <div className="md-more-grid" role="group" aria-label="More fills">
            {EXTRA_FILLS.map((f) => (
              <button
                type="button"
                key={f.id}
                className={`md-more-tile${fill === f.id ? " on" : ""}`}
                data-fill={f.id}
                title={f.hint}
                aria-pressed={fill === f.id}
                onClick={() => {
                  applyFill(api, f.id);
                  setTickLocal((n) => n + 1);
                }}
              >
                <FillPreview fill={f.id} />
                <span>{f.label}</span>
              </button>
            ))}
          </div>
          {!fillTargets(api).length && <p className="md-ft-note">Nothing selected: sets the fill for what you draw next.</p>}
          <p className="md-ft-note">Patterns use the fill color; a transparent fill shows nothing.</p>
          <GradientEditor api={api} tick={tick + localTick} onChange={() => setTickLocal((n) => n + 1)} />
        </MorePopover>
      )}
    </>
  );
}

// ---------- gradient editor (inside the Fill popover) ----------

type Edit = "from" | "to" | null;

function GradientEditor({ api, tick, onChange }: { api: ExcalidrawImperativeAPI; tick: number; onChange(): void }) {
  const [edit, setEdit] = useState<Edit>(null);
  const session = useRef<GradientSession | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const els = useMemo(() => gradientTargets(api), [api, tick]);
  const cur = currentGradient(els);
  const one = cur === "mixed" ? null : cur;
  useEffect(() => () => session.current?.restore(), []);
  if (!els.length) return <p className="md-ft-note md-grad-none">Gradients: select rectangles, diamonds or ellipses.</p>;

  const run = (change: GradientChange) => {
    session.current = null;
    applyGradient(api, els, change);
    onChange();
  };
  const preview = (change: GradientChange) => {
    session.current ??= new GradientSession(api, els);
    session.current.preview(change);
  };
  const commit = (change: GradientChange) => {
    const s = session.current;
    session.current = null;
    if (s) s.commit(change);
    else applyGradient(api, els, change);
    onChange();
  };
  const set = (patch: Partial<Gradient>): GradientChange => (g) => ({ ...(g ?? GRADIENT_PRESETS.sky.gradient), ...patch });
  const preset = gradientPresetOf(one);

  return (
    <div className="md-grad" data-gradient={one ? "on" : cur === "mixed" ? "mixed" : "off"}>
      <div className="md-ft-head md-grad-head">
        <span>Gradient</span>
        {cur && (
          <button type="button" className="md-chip md-grad-remove" title="Back to a flat fill (the start color)" onClick={() => run(() => null)}>
            Flat
          </button>
        )}
      </div>
      <div className="md-grad-presets" role="group" aria-label="Gradient presets">
        {GRADIENT_PRESET_IDS.map((id) => (
          <button
            type="button"
            key={id}
            className={`md-swatch md-grad-preset${preset === id ? " on" : ""}`}
            data-gradient-preset={id}
            title={GRADIENT_PRESETS[id].label}
            aria-label={`Gradient ${GRADIENT_PRESETS[id].label}`}
            style={{ background: cssGradient(GRADIENT_PRESETS[id].gradient) }}
            onClick={() => run(() => ({ ...GRADIENT_PRESETS[id].gradient }))}
          />
        ))}
      </div>
      {one && (
        <>
          <div className="md-grad-row">
            {(["from", "to"] as const).map((k) => (
              <button
                type="button"
                key={k}
                className={`md-chip md-grad-color${edit === k ? " on" : ""}`}
                data-gradient-color={k}
                title={k === "from" ? "Start color (also the fill other apps show)" : "End color"}
                onClick={() => setEdit((e) => (e === k ? null : k))}
              >
                <span className="md-grad-well" style={{ background: one[k] }} />
                {k === "from" ? "Start" : "End"}
              </button>
            ))}
            <button type="button" className="md-chip md-grad-swap" title="Swap the colors" aria-label="Swap gradient colors" onClick={() => run((g) => (g ? { ...g, from: g.to, to: g.from } : g))}>
              ⇄
            </button>
          </div>
          <div className="md-grad-row">
            <div className="md-seg md-grad-kind" role="group" aria-label="Gradient kind">
              {(["linear", "radial"] as const).map((k) => (
                <button type="button" key={k} className={`md-chip${one.kind === k ? " on" : ""}`} data-gradient-kind={k} onClick={() => run(set({ kind: k }))}>
                  {k === "linear" ? "Linear" : "Radial"}
                </button>
              ))}
            </div>
            {one.kind === "linear" && (
              <AngleDial
                angle={one.angle}
                onDrag={(a) => preview(set({ angle: a }))}
                onEnd={() => {
                  const s = session.current;
                  if (!s) return;
                  // The last previewed angle is on the canvas: read it back from the first element.
                  const g = currentGradient(gradientTargets(api));
                  commit(set({ angle: g && g !== "mixed" ? g.angle : one.angle }));
                }}
              />
            )}
          </div>
          {edit && (
            <ColorPicker
              key={edit}
              value={one[edit]}
              onPreview={(hex) => preview(set({ [edit]: hex }))}
              onCommit={(hex) => commit(set({ [edit]: hex }))}
            />
          )}
        </>
      )}
    </div>
  );
}
