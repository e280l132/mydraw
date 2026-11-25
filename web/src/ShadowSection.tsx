// Shadow section of the style panel (own fieldset, draggable in the panel order like the others).
// Presets, the Amount slider, color, and under "More" opacity / blur / distance / angle. Works on
// the selection (shadowOps.shadowTargets); with nothing selected it sets the shadow new shapes get.
// Sliders preview without undo entries and commit one undo step on release (ShadowSession).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  DEFAULT_SHADOW,
  SHADOW_AMOUNT_MAX,
  SHADOW_BLUR_MAX,
  SHADOW_DISTANCE_MAX,
  SHADOW_PRESET_IDS,
  SHADOW_PRESETS,
  commonShadow,
  normalizeShadow,
  presetOf,
  shadowAmount,
  shadowHex,
  shadowOffset,
  shadowKind,
  shadowLayers,
  shadowRgba,
  SHADOW_KIND_LABELS,
  SHADOW_KINDS,
  withAmount,
  type Shadow,
  type ShadowKind,
} from "../../shared/shadow";
import { ColorPicker } from "./library/IconColorSection";
import { AngleDial } from "./AngleDial";
import { MorePopover } from "./MorePopover";
import { SlidersIcon } from "./FineTune";
import { applyShadow, newShapeShadow, setNewShapeShadow, shadowTargets, ShadowSession, type ShadowChange } from "./shadowOps";
import type { El } from "./agent/sceneOps";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** App's tuneTick: bumped when the selection or a selected element changes. */
  tick: number;
  /** Custom colors of the active drawing (newest first). */
  palette: string[];
  onToast(msg: string, isError?: boolean): void;
}

const LABELS_KEY = "mydraw.shadowLabels";
/** Presets in the section's own row (with None); every preset is in the popover. */
const ROW_PRESETS = ["soft", "drop"] as const;
const BASE_COLORS = ["#000000", "#343a40", "#1971c2", "#2f9e44", "#e03131", "#f08c00"];

type Field = "opacity" | "blur" | "distance" | "angle";

const KIND_HINTS: Record<ShadowKind, string> = {
  drop: "One shadow behind the shape",
  inner: "Inset: inside the outline",
  layered: "Two layers, tight and wide",
  extrude: "Solid block along the angle (3D)",
  contact: "Ellipse on the ground below",
};

/** CSS box-shadow previewing a shadow on a 1.1rem square (sizes scaled down to fit a chip). */
function cssShadow(s: Shadow, scale = 0.35): string {
  const kind = shadowKind(s);
  if (kind === "inner") {
    const { dx, dy } = shadowOffset(s, scale);
    return `inset ${dx}px ${dy}px ${s.blur * scale}px ${shadowRgba(s.color, s.opacity)}`;
  }
  if (kind === "contact") return `0 ${Math.max(3, s.distance * scale)}px ${Math.max(2, s.blur * scale)}px -2px ${shadowRgba(s.color, s.opacity)}`;
  const layers = shadowLayers(s);
  // Extrude: a few of its steps are enough at chip size.
  const shown = kind === "extrude" ? layers.filter((_, i) => i % Math.max(1, Math.floor(layers.length / 6)) === 0) : layers;
  return shown
    .reverse()
    .map((l) => `${l.dx * scale}px ${l.dy * scale}px ${l.blur * scale}px ${shadowRgba(s.color, l.opacity)}`)
    .join(", ");
}

const persisted = (key: string) => localStorage.getItem(key) === "1";

export function ShadowSection({ api, tick, palette, onToast }: Props) {
  const [open, setOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [labels, setLabels] = useState(() => persisted(LABELS_KEY));
  const [picker, setPicker] = useState(false);
  const [newShadow, setNewShadowState] = useState(newShapeShadow);
  const [drag, setDrag] = useState<{ field: string; value: number } | null>(null);
  const session = useRef<{ s: ShadowSession | null; change: ShadowChange } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const on = () => setNewShadowState(newShapeShadow());
    window.addEventListener("mydraw-new-shadow", on);
    return () => window.removeEventListener("mydraw-new-shadow", on);
  }, []);

  if (!api) return null;
  void tick; // re-render trigger: targets are read fresh each render
  const st = api.getAppState();
  const anySelected = Object.values(st.selectedElementIds).some(Boolean) || !!st.editingTextElement;
  const targets = shadowTargets(api, labels);
  // Something selected but nothing that can carry a shadow (a frame, locked items): no section.
  if (anySelected && !targets.els.length) return null;
  const forNew = !anySelected;
  const current: Shadow | null | "mixed" = forNew ? newShadow : commonShadow(targets.els);
  const one = current === "mixed" ? null : current;
  // Representative values for the sliders when mixed: the first element's shadow.
  const shown: Shadow | null = current === "mixed" ? (normalizeShadow(targets.els[0].customData?.mydrawShadow) ?? null) : current;
  const preset = presetOf(one);

  const fail = (e: unknown) => onToast(e instanceof Error ? e.message : String(e), true);
  const run = (change: ShadowChange) => {
    try {
      if (forNew) {
        const next = change(newShadow, { strokeColor: st.currentItemStrokeColor } as unknown as El);
        setNewShapeShadow(next ? normalizeShadow(next) : null);
      } else {
        applyShadow(api, targets.els, change);
      }
    } catch (e) {
      fail(e);
    }
    force((n) => n + 1);
  };

  // Slider drags: preview from a snapshot, one commit on release.
  const slide = (field: string, value: number, change: ShadowChange) => {
    setDrag({ field, value });
    if (forNew) {
      session.current = { s: null, change };
      return;
    }
    try {
      session.current ??= { s: new ShadowSession(api, targets.els), change };
      session.current.change = change;
      session.current.s!.preview(change);
    } catch (e) {
      fail(e);
    }
  };
  const finish = () => {
    const cur = session.current;
    session.current = null;
    setDrag(null);
    if (!cur) return;
    try {
      if (cur.s) cur.s.commit(cur.change);
      else run(cur.change);
    } catch (e) {
      fail(e);
    }
  };

  const base = (cur: Shadow | null) => cur ?? DEFAULT_SHADOW;
  const amountChange = (n: number): ShadowChange => (cur) => withAmount(base(cur), n);
  const fieldChange = (f: Field, v: number): ShadowChange => (cur) => ({ ...base(cur), [f]: f === "opacity" ? v / 100 : v });
  const colorChange = (c: string): ShadowChange => (cur) => ({ ...base(cur), color: c });
  const kindChange = (k: ShadowKind): ShadowChange => (cur) => {
    const { kind: _old, ...rest } = base(cur);
    void _old;
    return k === "drop" ? rest : { ...rest, kind: k };
  };
  const matchChange: ShadowChange = (cur, el) => ({ ...base(cur), color: shadowHex((el as El & { strokeColor?: string }).strokeColor) ?? "#000000" });

  const status = current === "mixed" ? "Mixed" : current ? (preset ? SHADOW_PRESETS[preset].label : "Custom") : "None";

  const value = (f: Field | "amount") => {
    if (drag?.field === f) return drag.value;
    const s = shown ?? DEFAULT_SHADOW;
    if (f === "amount") return shown ? shadowAmount(s) : 0;
    if (f === "opacity") return Math.round(s.opacity * 100);
    return s[f];
  };

  const slider = (f: Field | "amount", label: string, max: number, unit: string, change: (v: number) => ShadowChange, extra?: ReactNode) => (
    <div className={`md-shadow-slider md-shadow-${f}`} key={f}>
      <div className="md-shadow-slider-row">
        <span className="md-shadow-slider-label">{label}</span>
        {extra}
        <input
          key={`${f}-${value(f)}`}
          className="md-ft-num md-shadow-num"
          data-field={f}
          type="number"
          min={0}
          max={max}
          step={1}
          defaultValue={value(f)}
          aria-label={`Shadow ${label.toLowerCase()} (${unit})`}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (!e.target.value.trim() || !Number.isFinite(v) || v === value(f)) return;
            run(change(Math.min(max, Math.max(0, v))));
          }}
        />
        <span className="md-shadow-unit">{unit}</span>
      </div>
      <input
        type="range"
        className="md-ft-range md-shadow-range"
        data-field={f}
        min={0}
        max={max}
        step={1}
        value={value(f)}
        aria-label={`Shadow ${label.toLowerCase()}`}
        onChange={(e) => slide(f, Number(e.target.value), change(Number(e.target.value)))}
        onPointerUp={finish}
        onKeyUp={finish}
        onBlur={() => session.current && finish()}
      />
    </div>
  );

  const pickedColor = one?.color ?? shown?.color ?? DEFAULT_SHADOW.color;
  const colors = [...new Set([...BASE_COLORS, ...palette.map((c) => shadowHex(c)).filter((c): c is string => !!c)])].slice(0, 12);

  return (
    <fieldset
      className="md-style md-shadow"
      data-md-section="shadow"
      data-mode={forNew ? "new" : "selection"}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <legend>
        <span className="md-legend-text">Shadow</span>
        {forNew && <span className="md-head-badge" title="Nothing selected: shapes, text and lines you draw next get this shadow">New shapes</span>}
      </legend>
      {/* Same shape as Excalidraw's rows: None + three presets, then the "more" button (all presets,
          kinds, amount, color and the fine controls in a popover, like Fill and Stroke style). */}
      <div className="buttonList md-shadow-presets" role="group" aria-label="Shadow presets">
        <button
          type="button"
          className={`md-shadow-preset${current === null ? " on" : ""}`}
          data-preset="none"
          title="No shadow"
          aria-label="No shadow"
          onClick={() => run(() => null)}
        >
          <span className="md-shadow-sample none" />
        </button>
        {ROW_PRESETS.map((id) => (
          <button
            type="button"
            key={id}
            className={`md-shadow-preset${preset === id ? " on" : ""}`}
            data-preset={id}
            title={`${SHADOW_PRESETS[id].label}: ${SHADOW_PRESETS[id].hint}`}
            aria-label={`${SHADOW_PRESETS[id].label} shadow`}
            onClick={() => run(() => ({ ...SHADOW_PRESETS[id].shadow }))}
          >
            <span className="md-shadow-sample" style={{ boxShadow: cssShadow(SHADOW_PRESETS[id].shadow) } as CSSProperties} />
          </button>
        ))}
        <button
          type="button"
          ref={moreBtn}
          className={`md-ft-btn md-more-btn md-shadow-open${current !== null && !(ROW_PRESETS as readonly string[]).includes(preset ?? "") ? " active" : ""}${open ? " open" : ""}`}
          data-more-kind="shadow"
          title={`Shadow: ${status}. All shadows and settings…`}
          aria-label="All shadows and settings"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersIcon />
        </button>
      </div>
      {open && (
        <MorePopover
          title="Shadow"
          kind="shadow"
          anchor={moreBtn.current}
          onClose={() => setOpen(false)}
          newShapes={
            forNew
              ? {
                  text: current ? "Nothing selected: every shape, text and line you draw next gets this shadow." : "Nothing selected: a pick here becomes the shadow of every shape you draw next.",
                  clearLabel: "No default",
                  onClear: current ? () => run(() => null) : undefined,
                }
              : null
          }
        >
          <div className="md-more-grid md-shadow-all" role="group" aria-label="All shadow presets">
            {SHADOW_PRESET_IDS.map((id) => (
              <button
                type="button"
                key={id}
                className={`md-more-tile md-shadow-tile${preset === id ? " on" : ""}`}
                data-preset={id}
                title={SHADOW_PRESETS[id].hint}
                onClick={() => run(() => ({ ...SHADOW_PRESETS[id].shadow }))}
              >
                <span className="md-shadow-sample" style={{ boxShadow: cssShadow(SHADOW_PRESETS[id].shadow) } as CSSProperties} />
                <span>{SHADOW_PRESETS[id].label}</span>
              </button>
            ))}
          </div>
          <div className="md-seg md-shadow-kinds" role="group" aria-label="Shadow kind">
            {SHADOW_KINDS.map((k) => (
              <button
                type="button"
                key={k}
                className={`md-shadow-kind${shown && current !== null && shadowKind(shown) === k ? " on" : ""}`}
                data-kind={k}
                title={KIND_HINTS[k]}
                onClick={() => run(kindChange(k))}
              >
                {SHADOW_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          {slider("amount", "Amount", SHADOW_AMOUNT_MAX, "", amountChange)}
          <div className="md-shadow-colors" role="group" aria-label="Shadow color">
            {colors.map((c) => (
              <button
                type="button"
                key={c}
                className={`md-swatch md-shadow-color${one?.color === c ? " on" : ""}`}
                data-color={c}
                style={{ background: c }}
                title={c}
                aria-label={`Shadow color ${c}`}
                onClick={() => run(colorChange(c))}
              />
            ))}
          </div>
          <div className="md-shadow-actions">
            <button type="button" className="md-chip md-shadow-match" title="Each shadow takes its own element's stroke color" onClick={() => run(matchChange)}>
              Match stroke
            </button>
            <button type="button" className={`md-chip md-shadow-custom${picker ? " on" : ""}`} title="Any color" onClick={() => setPicker((v) => !v)}>
              <span className="md-rainbow" /> Custom
            </button>
          </div>
          {picker && (
            <ColorPicker
              value={pickedColor}
              onPreview={(hex) => slide("color", 0, colorChange(hex))}
              onCommit={(hex) => {
                if (session.current) {
                  session.current.change = colorChange(hex);
                  finish();
                } else run(colorChange(hex));
              }}
            />
          )}
          <div className="md-shadow-more">
            {slider("opacity", "Opacity", 100, "%", (v) => fieldChange("opacity", v))}
            {slider("blur", "Blur", SHADOW_BLUR_MAX, "px", (v) => fieldChange("blur", v))}
            {slider("distance", "Distance", SHADOW_DISTANCE_MAX, "px", (v) => fieldChange("distance", v))}
            {slider("angle", "Angle", 359, "°", (v) => fieldChange("angle", v), (
              <AngleDial label="Shadow direction" angle={value("angle")} onDrag={(a) => slide("angle", a, fieldChange("angle", a))} onEnd={finish} />
            ))}
          </div>
          {targets.hasLabels && (
            <label className="md-shadow-labels">
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => {
                  localStorage.setItem(LABELS_KEY, e.target.checked ? "1" : "0");
                  setLabels(e.target.checked);
                }}
              />
              Labels and captions too
            </label>
          )}
        </MorePopover>
      )}
    </fieldset>
  );
}

/** A small dial: the dot shows where the shadow falls; drag it around to set the angle. */
