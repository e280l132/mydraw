// Icon style section of the style panel and its window (floats like the other style windows).
// Row: Original · Pen · Pencil · settings, each showing the selected icon drawn that way. Window: every
// look as a tile (the selected icon drawn in it), then Fill, Outline, Sketchiness, Pen weight, Fill
// offset, Hatch gap / angle, Texture, Double lines, Redraw. With nothing selected it edits what
// inserted stencils look like (Settings.iconStyle / iconSketch). One undo step per change; slider drags
// preview without history (IconRecolorSession).
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImageElement } from "@excalidraw/excalidraw/element/types";
import {
  DEFAULT_ICON_SKETCH,
  HATCH_FILLS,
  ICON_SKETCH_LIMITS,
  ICON_STYLE_PRESET_IDS,
  ICON_STYLE_PRESETS,
  iconSketchPreset,
  lookOfSetting,
  newSketchSeed,
  normalizeIconSketch,
  presetSketch,
  sketchKey,
  type IconSketch,
  type IconSketchFill,
  type IconSketchOutline,
  type IconSketchTexture,
  type IconStylePreset,
  type IconStyleSetting,
} from "../../shared/iconSketch";
import type { Settings } from "../../shared/types";
import { IconRecolorSession, iconSketchOf, isSketchableIcon, type IconPatchFor } from "./library/iconColor";
import { SAMPLE_ICON, iconSource, useIconPreviews } from "./library/iconPreview";
import { captionStateOf, fontCss, handFonts, restyleCaptions } from "./library/captionFont";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { CaptionFontMode } from "../../shared/iconSketch";
import { MorePopover } from "./MorePopover";
import { SlidersIcon } from "./FineTune";
import { fillPreviewPaths } from "./StyleMore";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** Bumped when the selection or a selected element changes. */
  tick: number;
  settings: Settings | null;
  onSettings(patch: Partial<Settings>): void;
  onToast(msg: string, isError?: boolean): void;
}

/** The looks in the panel row (the window has all of them). */
const ROW: IconStylePreset[] = ["pen", "pencil"];

const FILLS: [IconSketchFill, string][] = [
  ["solid", "Solid colour"],
  ["hachure", "Hatched"],
  ["cross-hatch", "Cross-hatched"],
  ["zigzag", "Scribbled"],
  ["dashed", "Dashed hatching"],
  ["none", "No fill (outlines only)"],
];
const OUTLINES: [IconSketchOutline, string, string][] = [
  ["shade", "Shade", "A darker shade of each colour"],
  ["ink", "Ink", "Near-black pen"],
  ["same", "Same", "Each shape's own colour"],
  ["none", "None", "No outline"],
];
const TEXTURES: [IconSketchTexture, string, string][] = [
  ["none", "Clean", "No grain"],
  ["pencil", "Pencil", "Graphite grain on every line"],
  ["paper", "Paper", "Grainy paper under the colours"],
];

type Num = "roughness" | "weight" | "offset" | "hatchGap" | "hatchAngle";

/** One fill swatch, drawn by roughjs like the Fill row's tiles. */
function FillSample({ fill }: { fill: IconSketchFill }) {
  const paths = useMemo(() => (fill === "none" ? [] : fillPreviewPaths(fill)), [fill]);
  return (
    <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
      {fill === "none" ? (
        <rect x="4" y="4" width="24" height="24" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      ) : (
        paths.map((p, i) => (
          <path key={i} d={p.d} stroke={p.stroke === "none" ? "none" : "currentColor"} strokeWidth={p.strokeWidth} fill={p.fill && p.fill !== "none" ? "currentColor" : "none"} />
        ))
      )}
    </svg>
  );
}

function OutlineDot({ kind }: { kind: IconSketchOutline }) {
  return <span className={`md-is-dot ${kind}`} aria-hidden="true" />;
}

export function IconStyleSection({ api, tick, settings, onSettings, onToast }: Props) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<{ field: Num; value: number } | null>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const session = useRef<IconRecolorSession | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  // Targets and the source picture are worked out before the hooks below, which need them.
  const st = api?.getAppState();
  const files = api?.getFiles() ?? {};
  void tick;
  const anySelected = !!st && Object.values(st.selectedElementIds).some(Boolean);
  const targets =
    api && anySelected
      ? (api.getSceneElements().filter((e) => st!.selectedElementIds[e.id] && isSketchableIcon(e, files)) as ExcalidrawImageElement[])
      : [];
  const forNew = !anySelected;
  const source = forNew ? SAMPLE_ICON : (targets.map((t) => iconSource(t, files)).find(Boolean) ?? null);
  const look = settings ? lookOfSetting(settings.iconSketch) : { ...DEFAULT_ICON_SKETCH };
  const base: IconSketch = { ...look, seed: DEFAULT_ICON_SKETCH.seed };
  const seed = forNew ? 1 : (iconSketchOf(targets[0] ?? ({} as never))?.seed ?? 1);

  // Previews: the row and the tiles show the real icon in each look.
  const styles = useMemo(() => {
    const out: Record<string, IconSketch | null> = { original: null };
    for (const id of ICON_STYLE_PRESET_IDS) out[id] = presetSketch(id, seed);
    return out;
  }, [seed]);
  const previews = useIconPreviews(source, styles);

  if (!api || !settings || !st) return null;
  if (anySelected && !targets.length) return null;

  session.current ??= new IconRecolorSession(
    () => apiRef.current,
    (e) => onToast(e.message, true),
  );

  const sketches = targets.map(iconSketchOf);
  const same = sketches.every((s) => sketchKey(s) === sketchKey(sketches[0]));
  // What the controls show: new icons' look, or the selection's (first sketched one when mixed).
  const current: IconSketch | null = forNew ? (settings.iconStyle === "original" ? null : base) : same ? sketches[0] : (sketches.find(Boolean) ?? null);
  const shown = current ?? base;
  const presetNow: IconStylePreset | "original" | null = forNew
    ? iconSketchPreset(base)
    : same
      ? sketches[0]
        ? iconSketchPreset(sketches[0])
        : "original"
      : sketches.every((s) => s && iconSketchPreset(s) && iconSketchPreset(s) === iconSketchPreset(sketches[0]!))
        ? iconSketchPreset(sketches[0]!)
        : null;
  const sketched = forNew ? true : sketches.some(Boolean);

  // Captions follow the icons' look (hand font under hand-drawn icons) when the setting says "match".
  const followCaptions = settings.captionFont === "match" ? (a: ExcalidrawImperativeAPI) => void restyleCaptions(a, targets.map((t) => t.id), settings) : undefined;
  const apply = (patch: IconPatchFor, preview = false) => {
    try {
      session.current!.applyPatch(patch, preview, preview ? undefined : followCaptions);
    } catch (e) {
      onToast(e instanceof Error ? e.message : String(e), true);
    }
  };
  /** Change the look: new icons' setting, or every target (an original icon starts from the new-icon look). */
  const change = (f: (s: IconSketch) => IconSketch, preview = false) => {
    if (forNew) {
      if (preview) return;
      const next = normalizeIconSketch(f(base))!;
      const { seed: _s, ...nextLook } = next;
      void _s;
      onSettings({ iconSketch: nextLook });
      return;
    }
    apply((el) => ({ sketch: normalizeIconSketch(f(iconSketchOf(el) ?? base)) }), preview);
  };
  const pickPreset = (id: IconStylePreset | "original") => {
    if (forNew) {
      if (id === "original") onSettings({ iconStyle: "original" });
      else onSettings({ iconSketch: lookOfSetting(presetSketch(id)), ...(settings.iconStyle === "original" ? { iconStyle: "hand-drawn" as const } : {}) });
      return;
    }
    if (id === "original") apply({ sketch: null });
    else apply((el) => ({ sketch: presetSketch(id, iconSketchOf(el)?.seed ?? 1) }));
  };

  const status = !sketched ? "Original" : presetNow === "original" ? "Original" : presetNow ? ICON_STYLE_PRESETS[presetNow].label : same ? "Custom" : "Mixed";
  const count = targets.length;

  const value = (f: Num) => (drag?.field === f ? drag.value : shown[f]);
  const slider = (f: Num, label: string, step: number, format: (v: number) => string, extra?: ReactNode) => {
    const [min, max] = ICON_SKETCH_LIMITS[f];
    const end = () => {
      if (drag?.field === f) change((s) => ({ ...s, [f]: drag.value }));
      setDrag(null);
    };
    return (
      <div className="md-is-field md-is-slider" data-field={f} key={f}>
        <span className="md-is-label">{label}</span>
        <input
          type="range"
          className="md-is-range"
          data-field={f}
          min={min}
          max={max}
          step={step}
          value={value(f)}
          disabled={!sketched}
          aria-label={label}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDrag({ field: f, value: v });
            change((s) => ({ ...s, [f]: v }), true);
          }}
          onPointerUp={end}
          onKeyUp={end}
        />
        <span className="md-is-value">{format(value(f))}</span>
        {extra}
      </div>
    );
  };

  // ----- names under the icons -----
  const capState = forNew ? null : captionStateOf(targets.map((t) => t.id), api.getSceneElements(), settings, st.currentItemFontFamily as number);
  const capOn = (m: CaptionFontMode) => (forNew ? settings.captionFont === m : capState === (m === "drawing" ? "plain" : m));
  const setCaptions = (mode: CaptionFontMode, hand = settings.captionHandFont) => {
    if (forNew) {
      onSettings({ captionFont: mode, captionHandFont: hand });
      return;
    }
    const n = restyleCaptions(api, targets.map((t) => t.id), { captionFont: mode, captionHandFont: hand }, CaptureUpdateAction.IMMEDIATELY);
    if (hand !== settings.captionHandFont) onSettings({ captionHandFont: hand });
    if (!n && capState === null) onToast("These icons have no name under them.", true);
  };
  const fonts = handFonts();
  const namesRow = () => (
    <div className="md-is-namebox">
    <div className={`md-is-field md-is-names${!forNew && capState === null ? " off" : ""}`} data-caption-state={forNew ? settings.captionFont : (capState ?? "none")}>
      <span className="md-is-label" title="The font of the name under each icon">
        Names
      </span>
      <div className="md-seg md-seg-compact md-is-seg" role="group" aria-label="Font of the names under icons">
        <button type="button" data-caption="match" className={capOn("match") ? "on" : ""} title="Hand font under hand-drawn icons, the drawing's font under original ones" onClick={() => setCaptions("match")}>
          Match
        </button>
        <button type="button" data-caption="hand" className={capOn("hand") ? "on" : ""} title={`Always handwritten (${settings.captionHandFont})`} onClick={() => setCaptions("hand")}>
          ✎ Hand
        </button>
        <button type="button" data-caption="drawing" className={capOn("drawing") ? "on" : ""} title="Always the drawing's normal font" onClick={() => setCaptions("drawing")}>
          Aa Plain
        </button>
      </div>
    </div>
    <div className="md-is-field md-is-fontrow">
      <span className="md-is-label">Hand font</span>
      <select
        className="md-is-font"
        aria-label="Hand font for names"
        title="Which handwriting font names use"
        value={fonts.includes(settings.captionHandFont) ? settings.captionHandFont : fonts[0]}
        style={{ fontFamily: fontCss(settings.captionHandFont) }}
        onChange={(e) => setCaptions(forNew ? (settings.captionFont === "drawing" ? "hand" : settings.captionFont) : capState === "plain" ? "hand" : capState === "match" ? "match" : "hand", e.target.value)}
      >
        {fonts.map((f) => (
          <option key={f} value={f} style={{ fontFamily: fontCss(f) }}>
            {f}
          </option>
        ))}
      </select>
    </div>
    </div>
  );

  const tile = (id: IconStylePreset | "original") => {
    const label = id === "original" ? "Original" : ICON_STYLE_PRESETS[id].label;
    const hint = id === "original" ? "The icon as designed" : ICON_STYLE_PRESETS[id].hint;
    const url = previews[id];
    return (
      <button
        type="button"
        key={id}
        className={`md-is-tile${presetNow === id || (id === "original" && !sketched) ? " on" : ""}`}
        data-style-tile={id}
        title={`${label}: ${hint}`}
        onClick={() => pickPreset(id)}
      >
        <span className="md-is-tile-img">{url ? <img src={url} alt="" draggable={false} /> : <span className="md-is-tile-wait" />}</span>
        <span className="md-is-tile-label">{label}</span>
      </button>
    );
  };

  return (
    <fieldset className="md-style md-iconstyle" data-md-section="iconStyle" data-mode={forNew ? "new" : "selection"} onMouseDown={(e) => e.stopPropagation()}>
      <legend>
        <span className="md-legend-text">Icon style</span>
        {forNew ? (
          <span className="md-head-badge" title="Nothing selected: stencils and icons you insert next look like this">
            New icons
          </span>
        ) : (
          <span className="md-head-badge md-is-status" data-status={status}>
            {status}
          </span>
        )}
      </legend>
      <div className="buttonList md-iconstyle-row" role="group" aria-label="Icon style">
        {(["original", ...ROW] as const).map((id) => {
          const label = id === "original" ? "Original" : ICON_STYLE_PRESETS[id].label;
          const on = presetNow === id || (id === "original" && !sketched) || (forNew && id === "original" && settings.iconStyle === "original");
          return (
            <button
              type="button"
              key={id}
              className={`md-iconstyle-pick${on ? " on" : ""}`}
              data-icon-style={id}
              title={id === "original" ? "Original: the icon as designed" : `${label}: ${ICON_STYLE_PRESETS[id].hint}`}
              aria-label={label}
              onClick={() => pickPreset(id)}
            >
              {previews[id] ? <img className="md-iconstyle-thumb" src={previews[id]} alt="" draggable={false} /> : <span className="md-iconstyle-thumb" />}
            </button>
          );
        })}
        <button
          type="button"
          ref={moreBtn}
          className={`md-ft-btn md-more-btn md-iconstyle-open${sketched && presetNow !== null && !(ROW as string[]).includes(presetNow) && presetNow !== "original" ? " active" : ""}${open ? " open" : ""}`}
          data-more-kind="iconStyle"
          title={`Icon style: ${status}. All looks and settings…`}
          aria-label="All icon looks and settings"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <SlidersIcon />
        </button>
      </div>
      {open && (
        <MorePopover
          title={forNew ? "Icon style" : `Icon style · ${count} icon${count === 1 ? "" : "s"}`}
          kind="iconStyle"
          anchor={moreBtn.current}
          onClose={() => setOpen(false)}
          newShapes={forNew ? { text: "Nothing selected: this is how stencils and icons you insert next are drawn.", titleSuffix: "new icons" } : null}
        >
          {forNew && (
            <div className="md-is-field md-is-insert">
              <span className="md-is-label">Insert</span>
              <div className="md-seg md-seg-compact md-is-seg" role="group" aria-label="Insert icons as">
                {(["auto", "original", "hand-drawn"] as IconStyleSetting[]).map((v) => (
                  <button
                    type="button"
                    key={v}
                    className={settings.iconStyle === v ? "on" : ""}
                    data-insert-style={v}
                    title={v === "auto" ? "Hand-drawn in Sketch style, original in Clean" : v === "original" ? "Always as designed" : "Always hand-drawn"}
                    onClick={() => onSettings({ iconStyle: v })}
                  >
                    {v === "auto" ? "Auto" : v === "original" ? "Original" : "Drawn"}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={`md-is-tiles${forNew ? " new" : ""}`} role="group" aria-label="Icon looks">
            {!forNew && tile("original")}
            {ICON_STYLE_PRESET_IDS.map(tile)}
          </div>
          {namesRow()}

          <div className={`md-is-adjust${sketched ? "" : " off"}`} aria-disabled={!sketched}>
            <div className="md-is-heading">
              Adjust{presetNow && presetNow !== "original" ? <span> · {ICON_STYLE_PRESETS[presetNow].label}</span> : sketched ? <span> · custom</span> : null}
            </div>
            <div className="md-is-field">
              <span className="md-is-label">Fill</span>
              <div className="md-is-icons" role="group" aria-label="Fill">
                {FILLS.map(([f, hint]) => (
                  <button
                    type="button"
                    key={f}
                    className={`md-is-icon${sketched && shown.fill === f ? " on" : ""}`}
                    data-fill={f}
                    title={hint}
                    aria-label={hint}
                    disabled={!sketched}
                    onClick={() => change((s) => ({ ...s, fill: f, mode: "rough" }))}
                  >
                    <FillSample fill={f} />
                  </button>
                ))}
              </div>
            </div>
            <div className="md-is-field">
              <span className="md-is-label">Outline</span>
              <div className="md-is-chips" role="group" aria-label="Outline">
                {OUTLINES.map(([o, label, hint]) => (
                  <button
                    type="button"
                    key={o}
                    className={`md-is-chip${sketched && shown.outline === o ? " on" : ""}`}
                    data-outline={o}
                    title={hint}
                    disabled={!sketched}
                    onClick={() => change((s) => ({ ...s, outline: o, mode: "rough" }))}
                  >
                    <OutlineDot kind={o} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {slider("roughness", "Sketchy", 0.1, (v) => v.toFixed(1))}
            {slider("weight", "Pen", 0.1, (v) => `${v.toFixed(1)}×`)}
            {slider("offset", "Offset", 0.5, (v) => (v ? `${v} px` : "off"))}
            {HATCH_FILLS.has(shown.fill) && (
              <>
                {slider("hatchGap", "Spacing", 0.5, (v) => `${v} px`)}
                {slider("hatchAngle", "Angle", 1, (v) => `${Math.round(v)}°`)}
              </>
            )}
            <div className="md-is-field">
              <span className="md-is-label">Texture</span>
              <div className="md-seg md-seg-compact md-is-seg" role="group" aria-label="Texture">
                {TEXTURES.map(([t, label, hint]) => (
                  <button type="button" key={t} data-texture={t} title={hint} disabled={!sketched} className={sketched && shown.texture === t ? "on" : ""} onClick={() => change((s) => ({ ...s, texture: t, mode: "rough" }))}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="md-is-field">
              <span className="md-is-label">Lines</span>
              <div className="md-seg md-seg-compact md-is-seg" role="group" aria-label="Lines">
                <button type="button" data-double="false" title="Each line drawn once" disabled={!sketched} className={sketched && !shown.doubleStroke ? "on" : ""} onClick={() => change((s) => ({ ...s, doubleStroke: false }))}>
                  Single
                </button>
                <button type="button" data-double="true" title="Each line drawn twice, slightly apart" disabled={!sketched} className={sketched && shown.doubleStroke ? "on" : ""} onClick={() => change((s) => ({ ...s, doubleStroke: true }))}>
                  Double
                </button>
                <button type="button" data-mode-pick="wobble" title="Shake the original picture instead of redrawing it (detailed and PNG icons)" disabled={!sketched} className={sketched && shown.mode === "wobble" ? "on" : ""} onClick={() => change((s) => ({ ...s, mode: s.mode === "wobble" ? "rough" : "wobble" }))}>
                  Wobble
                </button>
              </div>
            </div>
          </div>

          {!forNew && (
            <div className="md-is-actions">
              <button type="button" className="md-chip md-iconstyle-redraw" title="Draw again with fresh strokes (each icon differently)" disabled={!sketched} onClick={() => change((s) => ({ ...s, seed: newSketchSeed() }))}>
                <span aria-hidden="true">🎲</span> Redraw
              </button>
              {sketched && (
                <button type="button" className="md-chip md-iconstyle-original" onClick={() => pickPreset("original")}>
                  Back to original
                </button>
              )}
            </div>
          )}
        </MorePopover>
      )}
    </fieldset>
  );
}
