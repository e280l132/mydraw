// Colors / Presets / Themes section rendered inside Excalidraw's properties panel (via portal, like
// the icon color section). Acts on the active drawing's API; each click is one undo step. Presets and
// themes come from the global style library (styleStore), so every drawing sees the same ones.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ColorPicker, EyedropperIcon } from "./library/IconColorSection";
import { paletteById, resolveColor, shadesOf } from "../../shared/palettes";
import { FONTS, type StylePreset, type StyleSpec, type Theme } from "../../shared/styles";
import type { IconSelection } from "./library/iconColor";
import { applyThemeToScene, styleElements, type StyleResult } from "./agent/styles";
import { isIconNode, withGroupsAndLabels } from "./agent/sceneOps";
import {
  allPresets,
  allThemes,
  deletePreset,
  deleteTheme,
  presetCategories,
  savePreset,
  saveTheme,
  stylesReady,
  subscribeStyles,
  themeCategories,
} from "./styleStore";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** Bumped when the selection changes, so the section re-reads it. */
  tick: number;
  /** Bumped by App when the selection or a selected element changes (any edit). */
  changeTick: number;
  onToast(msg: string, isError?: boolean): void;
  /** The "last picked color" swatch (shared with the icon color section). */
  custom: string | null;
  onCustomChange(hex: string): void;
  /** Start / stop the canvas eyedropper (copies an item's color into the custom swatch). */
  onPick(): void;
  picking: boolean;
  /** SVG icons in the selection: the Icon target recolors them (they have no stroke or fill). */
  icons: IconSelection;
  /** Recolor the selected icons; null restores their original colors. `preview` = live drag update. */
  onIconColor(color: string | null, preview?: boolean): void;
}

type Tab = "colors" | "presets" | "themes";
type Target = "stroke" | "fill" | "icon";

function commit(api: ExcalidrawImperativeAPI, r: StyleResult, appState?: Partial<AppState>) {
  const byId = new Map(r.changed.map((e) => [e.id, e]));
  const current = api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e);
  api.updateScene({
    elements: [...current, ...r.added],
    ...(appState ? { appState: appState as AppState } : {}),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

const OPEN_KEY = "mydraw.styleOpen";
const loadOpen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
};

/** Re-render when the style library changes (saved in another tab, edited here, loaded at startup). */
function useStyleLibrary() {
  const [, setN] = useState(0);
  useEffect(() => {
    void stylesReady.then(() => setN((n) => n + 1));
    return subscribeStyles(() => setN((n) => n + 1));
  }, []);
}

/** Native color well + text box that accepts hex or a palette name. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const hex = resolveColor(value);
  return (
    <label className="md-field">
      <span>{label}</span>
      <span className="md-field-color">
        <input
          type="color"
          value={hex && hex !== "transparent" ? hex : "#ffffff"}
          aria-label={`${label} color picker`}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          value={value}
          spellCheck={false}
          placeholder="#hex or name"
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </span>
    </label>
  );
}

function Group({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <div className="md-group">
      <button className="md-group-head" onClick={onToggle} aria-expanded={open}>
        <span className="md-caret">{open ? "▾" : "▸"}</span>
        {title}
        <span className="md-badge">{count}</span>
      </button>
      {open && <div className="md-style-list">{children}</div>}
    </div>
  );
}

// ---------- editors ----------

interface PresetDraft {
  id?: string;
  title: string;
  category: string;
  description: string;
  strokeColor: string;
  backgroundColor: string;
  strokeStyle: string;
  strokeWidth: string;
  opacity: string;
  fontSize: string;
}

const blankPreset = (category: string): PresetDraft => ({
  title: "",
  category,
  description: "",
  strokeColor: "",
  backgroundColor: "",
  strokeStyle: "",
  strokeWidth: "",
  opacity: "",
  fontSize: "",
});

function draftFromStyle(style: StyleSpec, base: Partial<PresetDraft>): PresetDraft {
  return {
    ...blankPreset(base.category ?? "My presets"),
    ...base,
    strokeColor: style.strokeColor ?? "",
    backgroundColor: style.backgroundColor ?? "",
    strokeStyle: style.strokeStyle ?? "",
    strokeWidth: style.strokeWidth !== undefined ? String(style.strokeWidth) : "",
    opacity: style.opacity !== undefined ? String(style.opacity) : "",
    fontSize: style.fontSize !== undefined ? String(style.fontSize) : "",
  };
}

interface StyledEl {
  type: string;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  opacity: number;
}

function styleOf(el: StyledEl): StyleSpec {
  const shape = el.type !== "text" && el.type !== "arrow" && el.type !== "line";
  return {
    strokeColor: el.strokeColor,
    ...(shape ? { backgroundColor: el.backgroundColor, fillStyle: el.fillStyle as StyleSpec["fillStyle"] } : {}),
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle as StyleSpec["strokeStyle"],
    opacity: el.opacity,
  };
}

function draftToStyle(d: PresetDraft): StyleSpec {
  const s: Record<string, unknown> = {};
  if (d.strokeColor.trim()) s.strokeColor = d.strokeColor.trim();
  if (d.backgroundColor.trim()) s.backgroundColor = d.backgroundColor.trim();
  if (d.strokeStyle) s.strokeStyle = d.strokeStyle;
  if (d.strokeWidth.trim()) s.strokeWidth = Number(d.strokeWidth);
  if (d.opacity.trim()) s.opacity = Number(d.opacity);
  if (d.fontSize.trim()) s.fontSize = Number(d.fontSize);
  return s as StyleSpec;
}

function PresetEditor({
  draft,
  setDraft,
  onUseSelection,
  onSave,
  onCancel,
}: {
  draft: PresetDraft;
  setDraft(d: PresetDraft): void;
  onUseSelection: (() => void) | null;
  onSave(): void;
  onCancel(): void;
}) {
  const set = (k: keyof PresetDraft) => (v: string) => setDraft({ ...draft, [k]: v });
  const text = (k: keyof PresetDraft, label: string, ph = "") => (
    <label className="md-field">
      <span>{label}</span>
      <input value={draft[k] ?? ""} placeholder={ph} onChange={(e) => set(k)(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  );
  return (
    <div className="md-editor">
      {text("title", "Name")}
      <label className="md-field">
        <span>Group</span>
        <input list="md-preset-cats" value={draft.category} onChange={(e) => set("category")(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <datalist id="md-preset-cats">
          {presetCategories().map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <ColorField label="Stroke" value={draft.strokeColor} onChange={set("strokeColor")} />
      <ColorField label="Fill" value={draft.backgroundColor} onChange={set("backgroundColor")} />
      <label className="md-field">
        <span>Line</span>
        <select value={draft.strokeStyle} onChange={(e) => set("strokeStyle")(e.target.value)}>
          <option value="">(unchanged)</option>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
      {text("strokeWidth", "Width", "1–12")}
      {text("opacity", "Opacity", "0–100")}
      {text("fontSize", "Font size", "text only")}
      {text("description", "Note")}
      <div className="md-iconcolor-actions">
        {onUseSelection && (
          <button className="md-chip" onClick={onUseSelection} title="Copy the look of the selected element into these fields">
            From selection
          </button>
        )}
        <button className="md-chip on" onClick={onSave} disabled={!draft.title.trim()}>
          Save
        </button>
        <button className="md-chip" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

interface ThemeDraft {
  id?: string;
  title: string;
  category: string;
  description: string;
  background: string;
  ink: string;
  fontFamily: string;
  roughness: string;
  roundness: string;
  strokeWidth: string;
}

const blankTheme = (): ThemeDraft => ({
  title: "",
  category: "My themes",
  description: "",
  background: "#ffffff",
  ink: "#1e1e1e",
  fontFamily: "nunito",
  roughness: "0",
  roundness: "sharp",
  strokeWidth: "2",
});

const themeDraftOf = (t: Theme): ThemeDraft => ({
  id: t.id,
  title: t.title,
  category: t.category,
  description: t.description,
  background: t.background,
  ink: t.ink,
  fontFamily: t.fontFamily,
  roughness: String(t.roughness),
  roundness: t.roundness,
  strokeWidth: String(t.strokeWidth),
});

/** Canvas color and tool defaults of a drawing, as theme fields. */
function currentLook(st: AppState, fallbackFont: string): Partial<ThemeDraft> {
  return {
    background: st.viewBackgroundColor,
    ink: st.currentItemStrokeColor,
    roughness: String(st.currentItemRoughness),
    roundness: st.currentItemRoundness === "round" ? "round" : "sharp",
    strokeWidth: String(st.currentItemStrokeWidth),
    fontFamily: Object.entries(FONTS).find(([, v]) => v === st.currentItemFontFamily)?.[0] ?? fallbackFont,
  };
}

function ThemeEditor({
  draft,
  setDraft,
  onUseCurrent,
  onSave,
  onCancel,
}: {
  draft: ThemeDraft;
  setDraft(d: ThemeDraft): void;
  onUseCurrent(): void;
  onSave(): void;
  onCancel(): void;
}) {
  const set = (k: keyof ThemeDraft) => (v: string) => setDraft({ ...draft, [k]: v });
  return (
    <div className="md-editor">
      <label className="md-field">
        <span>Name</span>
        <input value={draft.title} onChange={(e) => set("title")(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <label className="md-field">
        <span>Group</span>
        <input list="md-theme-cats" value={draft.category} onChange={(e) => set("category")(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <datalist id="md-theme-cats">
          {themeCategories().map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <ColorField label="Canvas" value={draft.background} onChange={set("background")} />
      <ColorField label="Ink" value={draft.ink} onChange={set("ink")} />
      <label className="md-field">
        <span>Font</span>
        <select value={draft.fontFamily} onChange={(e) => set("fontFamily")(e.target.value)}>
          {Object.keys(FONTS).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label className="md-field">
        <span>Corners</span>
        <select value={draft.roundness} onChange={(e) => set("roundness")(e.target.value)}>
          <option value="sharp">Sharp</option>
          <option value="round">Round</option>
        </select>
      </label>
      <label className="md-field">
        <span>Sketchy</span>
        <select value={draft.roughness} onChange={(e) => set("roughness")(e.target.value)}>
          <option value="0">None</option>
          <option value="1">Some</option>
          <option value="2">Lots</option>
        </select>
      </label>
      <label className="md-field">
        <span>Line width</span>
        <input value={draft.strokeWidth} onChange={(e) => set("strokeWidth")(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      <div className="md-iconcolor-actions">
        <button className="md-chip" onClick={onUseCurrent} title="Copy the canvas color and drawing defaults of this drawing">
          From drawing
        </button>
        <button className="md-chip on" onClick={onSave} disabled={!draft.title.trim()}>
          Save
        </button>
        <button className="md-chip" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- section ----------

const TARGET_KEY = "mydraw.colorTarget";
const FILL_TYPES = new Set(["rectangle", "ellipse", "diamond", "freedraw"]);

/** One color for a set of elements: the shared value, "mixed", or null (none). */
function wellColor(colors: string[]): string | null {
  if (!colors.length) return null;
  return colors.every((c) => c === colors[0]) ? colors[0] : "mixed";
}

/** Small color chip inside a Stroke / Fill / Icon button. */
function Well({ color }: { color: string | null }) {
  const kind = color === "mixed" ? "mixed" : !color || color === "transparent" ? "none" : "color";
  return (
    <span
      className={`md-well md-well-${kind}`}
      style={kind === "color" ? { background: color! } : undefined}
      title={kind === "mixed" ? "Mixed" : kind === "none" ? "None" : color!}
      aria-hidden="true"
    />
  );
}

export function StyleSection({ api, tick, changeTick, onToast, custom: customColor, onCustomChange, onPick, picking, icons, onIconColor }: Props) {
  useStyleLibrary();
  const [tab, setTab] = useState<Tab>("colors");
  // Stroke/Fill: one app-wide choice that sticks from item to item and across restarts.
  const [sticky, setSticky] = useState<"stroke" | "fill">(() => (localStorage.getItem(TARGET_KEY) === "fill" ? "fill" : "stroke"));
  // A pick made for the current selection (Icon is only ever this); cleared when the selection changes.
  const [pick, setPick] = useState<Target | null>(null);
  const setTarget = (t: Target) => {
    if (t !== "icon") {
      setSticky(t);
      localStorage.setItem(TARGET_KEY, t);
    }
    setPick(t);
  };
  const [base, setBase] = useState<string | null>(null); // the basic color the shades ramp from
  const [custom, setCustom] = useState(false);
  const [wholeDrawing, setWholeDrawing] = useState(true);
  const [manage, setManage] = useState(false);
  const [open, setOpen] = useState<Set<string>>(loadOpen);
  const [presetDraft, setPresetDraft] = useState<PresetDraft | null>(null);
  const [themeDraft, setThemeDraft] = useState<ThemeDraft | null>(null);
  const [filter, setFilter] = useState("");
  const [, rerender] = useState(0); // tool defaults (no selection) live in app state: re-read after a change

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = useMemo(() => (api ? api.getSceneElements().filter((e) => api.getAppState().selectedElementIds[e.id]) : []), [api, tick, changeTick]);
  const styleable = selected.filter((e) => e.type !== "image");
  const first = styleable[0];
  // Icons are recolored, not stroked: with only icons selected the Icon target is the only one that
  // does anything; with none selected it can't be used.
  const hasIcons = icons.count > 0;
  // Fill only exists on shapes: not on text, arrows, lines, or icon nodes (their container is a
  // borderless frame; stroke colors their caption). With nothing selected the tool defaults apply.
  const iconOnly = hasIcons && styleable.every((e) => isIconNode(e) || (e.type === "text" && !!(e as { containerId?: string | null }).containerId));
  const noSelection = !styleable.length && !hasIcons;
  const canFill = noSelection || styleable.some((e) => !isIconNode(e) && (e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond" || e.type === "freedraw"));
  const canStroke = noSelection || styleable.length > 0;
  // Which property the swatches (palette, shades, custom swatch, Any color…) set. Only icons selected ->
  // Icon unless picked otherwise for this selection; else the sticky Stroke/Fill choice. Where that
  // can't apply (Fill on arrows, lines, text) the other one is used without changing the choice.
  const auto: Target = iconOnly || (hasIcons && !canStroke) ? "icon" : sticky;
  const asked = pick ?? auto;
  const target: Target = (() => {
    let t = asked;
    if (t === "icon" && !hasIcons) t = sticky;
    if (t === "fill" && !canFill) t = canStroke ? "stroke" : "icon";
    if (t === "stroke" && !canStroke) t = hasIcons ? "icon" : "stroke";
    return t;
  })();

  useEffect(() => setPick(null), [tick]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
      return next;
    });
  const openGroup = (key: string) => setOpen((o) => new Set(o).add(key));

  const fail = (e: unknown) => onToast(e instanceof Error ? e.message : String(e), true);
  const run = (fn: (a: ExcalidrawImperativeAPI) => void) => {
    if (!api) return;
    try {
      fn(api);
    } catch (e) {
      fail(e);
    }
  };

  const applyStyle = (style: StyleSpec) =>
    run((a) => {
      if (!styleable.length) {
        // Nothing selected: set the defaults for the next shapes.
        const st: Record<string, unknown> = {};
        if (style.strokeColor) st.currentItemStrokeColor = resolveColor(style.strokeColor);
        if (style.backgroundColor) st.currentItemBackgroundColor = resolveColor(style.backgroundColor);
        a.updateScene({ appState: st as Partial<AppState> as AppState, captureUpdate: CaptureUpdateAction.NEVER });
        rerender((n) => n + 1);
        return;
      }
      const scene = a.getSceneElements();
      const r = styleElements(withGroupsAndLabels(styleable.map((e) => e.id), scene, { contents: false }), style, scene, a.getAppState(), { inks: allThemes() });
      commit(a, r);
    });

  /** The other of Stroke/Fill, for ⌥-click on a swatch (null when it can't apply). */
  const other: Target | null = target === "stroke" ? (canFill ? "fill" : null) : target === "fill" ? (canStroke ? "stroke" : null) : null;
  const applyColor = (color: string, preview = false, toOther = false) => {
    const c = resolveColor(color);
    if (!c) return onToast(`"${color}" isn't a color`, true);
    const to = toOther && other ? other : target;
    if (to === "icon") return onIconColor(c, preview);
    applyStyle(to === "stroke" ? { strokeColor: c } : { backgroundColor: c });
  };
  /** Swatch click: ⌥-click sets the other of Stroke/Fill without switching. */
  const swatchClick = (color: string, e: React.MouseEvent) => applyColor(color, false, e.altKey);

  const applyTheme = (t: Theme) =>
    run((a) => {
      const scene = a.getSceneElements();
      const only = !wholeDrawing && styleable.length ? withGroupsAndLabels(styleable.map((e) => e.id), scene, { contents: false }) : undefined;
      const r = applyThemeToScene(t, scene, a.getAppState(), only, allThemes());
      commit(a, r, {
        ...(only ? {} : { viewBackgroundColor: t.background }),
        currentItemRoughness: t.roughness,
        currentItemRoundness: t.roundness,
        currentItemFontFamily: FONTS[t.fontFamily],
        currentItemStrokeWidth: t.strokeWidth,
      } as Partial<AppState>);
    });

  // ----- colors tab -----
  const basics = useMemo(() => Object.entries(paletteById("basic")!.colors).map(([name, color]) => ({ name, color })), []);
  const current =
    target === "icon"
      ? icons.color && icons.color !== "original"
        ? icons.color
        : null
      : first
        ? target === "stroke"
          ? first.strokeColor
          : first.backgroundColor
        : null;
  // Color previews in the Stroke / Fill / Icon buttons (selection, or the defaults for new shapes).
  const appState = api?.getAppState();
  const fillable = styleable.filter((e) => !isIconNode(e) && FILL_TYPES.has(e.type));
  const strokeWell = noSelection ? appState?.currentItemStrokeColor ?? null : wellColor(styleable.map((e) => e.strokeColor));
  const fillWell = noSelection ? appState?.currentItemBackgroundColor ?? null : wellColor(fillable.map((e) => e.backgroundColor));
  const iconWell = icons.color && icons.color !== "original" ? icons.color : null;
  const pickerValue = current && current !== "transparent" && resolveColor(current) ? current : "#1971c2";
  // Shades ramp off the chosen basic color; before one is chosen, off the selection's current color.
  const shadeBase = base ?? (current && current !== "transparent" ? resolveColor(current) : null) ?? customColor;
  const shades = shadeBase ? shadesOf(shadeBase) : [];
  const baseName = shadeBase ? basics.find((b) => b.color === shadeBase)?.name ?? shadeBase : null;

  const colorsTab = (
    <>
      <div className="md-iconcolor-actions md-seg">
        <button
          className={`md-chip md-target${target === "stroke" ? " on" : ""}`}
          data-target="stroke"
          disabled={!canStroke}
          title={canFill ? "Swatches set the outline. ⌥-click a swatch to set the fill instead." : "Swatches set the outline."}
          onClick={() => setTarget("stroke")}
        >
          <Well color={strokeWell} /> Stroke
        </button>
        <button
          className={`md-chip md-target${target === "fill" ? " on" : ""}`}
          data-target="fill"
          disabled={!canFill}
          title={canFill ? "Swatches set the fill. ⌥-click a swatch to set the outline instead." : "The selection has no fill (text, lines, arrows and icons don't)"}
          onClick={() => setTarget("fill")}
        >
          <Well color={canFill ? fillWell : null} /> Fill
        </button>
        {hasIcons && (
          <button className={`md-chip md-target${target === "icon" ? " on" : ""}`} data-target="icon" onClick={() => setTarget("icon")} title="Recolor the selected SVG icons">
            <Well color={iconWell} /> Icon
          </button>
        )}
      </div>
      <div className="md-iconcolor-grid">
        {basics.map((s) => (
          <button
            key={s.name}
            className={`md-swatch${current === s.color ? " on" : ""}${shadeBase === s.color ? " base" : ""}`}
            style={{ background: s.color }}
            title={s.name}
            aria-label={s.name}
            onClick={(e) => {
              setBase(s.color);
              swatchClick(s.color, e);
            }}
          />
        ))}
        {target === "fill" && (
          <button className={`md-swatch md-swatch-none${current === "transparent" ? " on" : ""}`} title="Transparent" aria-label="Transparent" onClick={(e) => swatchClick("transparent", e)} />
        )}
        <button
          className={`md-swatch md-swatch-slot${customColor ? "" : " empty"}${customColor && current === customColor ? " on" : ""}`}
          style={customColor ? { background: customColor } : undefined}
          title={customColor ? `Last custom color ${customColor}` : "Last custom color: use Any color… or the eyedropper"}
          aria-label="Last custom color"
          disabled={!customColor}
          onClick={(e) => {
            if (!customColor) return;
            setBase(customColor);
            swatchClick(customColor, e);
          }}
        />
      </div>
      {shades.length > 0 && (
        <>
          <div className="md-iconcolor-note md-shades-label">Shades of {baseName}</div>
          <div className="md-shades" role="group" aria-label={`Shades of ${baseName}`}>
            {shades.map((sh) => (
              <button
                key={sh.shade}
                className={`md-swatch md-shade${current === sh.color ? " on" : ""}`}
                style={{ background: sh.color }}
                title={`${baseName} ${sh.shade}`}
                aria-label={`${baseName} ${sh.shade}`}
                onClick={(e) => swatchClick(sh.color, e)}
              />
            ))}
          </div>
        </>
      )}
      <div className="md-iconcolor-actions md-seg">
        <button className={`md-chip md-chip-custom${custom ? " on" : ""}`} onClick={() => setCustom((v) => !v)}>
          <span className="md-rainbow" /> Any color…
        </button>
        <button
          className={`md-chip md-chip-pick${picking ? " on" : ""}`}
          style={{ flex: "0 0 2.2rem" }}
          title="Pick a color from an icon or shape on the canvas; it goes into the last-color swatch"
          aria-label="Pick color from canvas"
          onClick={onPick}
        >
          <EyedropperIcon />
        </button>
      </div>
      {target === "icon" && (
        <div className="md-iconcolor-actions md-seg">
          <button className={`md-chip${icons.color === "original" ? " on" : ""}`} onClick={() => onIconColor(null)} title="Put the icons back to their real colors">
            Original colors
          </button>
        </div>
      )}
      {!styleable.length && !hasIcons && (
        <div className="md-iconcolor-note">
          {icons.raster > 0 ? "PNG/JPG images can't be recolored. Use SVG icons." : "Select shapes or SVG icons to color them."}
        </div>
      )}
      {target === "icon" && icons.raster > 0 && (
        <div className="md-iconcolor-note">
          {icons.raster} PNG/JPG image{icons.raster > 1 ? "s" : ""} in the selection can't be recolored.
        </div>
      )}
      {picking && <div className="md-iconcolor-note">Click an icon or shape to copy its color · Esc to cancel</div>}
      {custom && (
        <ColorPicker
          value={customColor ?? pickerValue}
          onPreview={(hex) => target === "icon" && applyColor(hex, true)}
          onCommit={(hex) => {
            onCustomChange(hex);
            setBase(hex);
            applyColor(hex);
          }}
          onPick={onPick}
          picking={picking}
        />
      )}
    </>
  );

  // ----- presets tab -----
  const presets = allPresets();
  const q = filter.trim().toLowerCase();
  const presetMatch = (p: StylePreset) => !q || `${p.title} ${p.category} ${p.description}`.toLowerCase().includes(q);

  const savePresetDraft = async () => {
    if (!presetDraft) return;
    try {
      const p = await savePreset({
        id: presetDraft.id,
        title: presetDraft.title,
        category: presetDraft.category,
        description: presetDraft.description,
        style: draftToStyle(presetDraft),
      });
      onToast(`Saved preset "${p.title}"`);
      openGroup(`p:${p.category}`);
      setPresetDraft(null);
    } catch (e) {
      fail(e);
    }
  };

  const presetsTab = (
    <>
      <input className="md-style-select" value={filter} placeholder="Search presets…" aria-label="Search presets" onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className="md-iconcolor-actions md-seg">
        <button className="md-chip" onClick={() => setPresetDraft(first ? draftFromStyle(styleOf(first as unknown as StyledEl), { category: "My presets" }) : blankPreset("My presets"))}>
          + New
        </button>
        <button className={`md-chip${manage ? " on" : ""}`} onClick={() => setManage((v) => !v)}>
          {manage ? "Done" : "Manage"}
        </button>
      </div>
      {presetDraft && (
        <PresetEditor
          draft={presetDraft}
          setDraft={setPresetDraft}
          onUseSelection={first ? () => setPresetDraft({ ...presetDraft, ...draftFromStyle(styleOf(first as unknown as StyledEl), presetDraft) }) : null}
          onSave={() => void savePresetDraft()}
          onCancel={() => setPresetDraft(null)}
        />
      )}
      {presetCategories().map((cat) => {
        const items = presets.filter((p) => p.category === cat && presetMatch(p));
        if (!items.length) return null;
        const key = `p:${cat}`;
        return (
          <Group key={cat} title={cat} count={items.length} open={open.has(key) || !!q} onToggle={() => toggle(key)}>
            {items.map((p) => (
              <span key={p.id} className="md-style-item">
                <button className="md-chip" title={p.description || p.title} onClick={() => applyStyle(p.style)}>
                  <i
                    className="md-style-dot"
                    style={{
                      background: p.style.backgroundColor ? resolveColor(p.style.backgroundColor) ?? "transparent" : "transparent",
                      borderColor: p.style.strokeColor ? resolveColor(p.style.strokeColor) ?? "#888" : "#888",
                      borderStyle: p.style.strokeStyle === "dashed" ? "dashed" : p.style.strokeStyle === "dotted" ? "dotted" : "solid",
                    }}
                  />
                  {p.title}
                </button>
                {manage && (
                  <>
                    <button
                      className="md-chip md-chip-x"
                      title={p.builtin ? "Edit (saves your own version)" : "Edit"}
                      aria-label={`Edit ${p.title}`}
                      onClick={() => setPresetDraft(draftFromStyle(p.style, { id: p.id, title: p.title, category: p.category, description: p.description }))}
                    >
                      ✎
                    </button>
                    {!p.builtin && (
                      <button
                        className="md-chip md-chip-x"
                        title={(p as { overridden?: boolean }).overridden ? "Reset to the built-in" : "Delete"}
                        aria-label={`Delete ${p.title}`}
                        onClick={() => void deletePreset(p.id)}
                      >
                        ×
                      </button>
                    )}
                  </>
                )}
              </span>
            ))}
          </Group>
        );
      })}
      {!styleable.length && <div className="md-iconcolor-note">Select shapes to apply a preset.</div>}
    </>
  );

  // ----- themes tab -----
  const themes = allThemes();
  const saveThemeDraft = async () => {
    if (!themeDraft) return;
    try {
      const t = await saveTheme({ ...themeDraft, name: themeDraft.title });
      onToast(`Saved theme "${t.title}"`);
      openGroup(`t:${t.category}`);
      setThemeDraft(null);
    } catch (e) {
      fail(e);
    }
  };

  const themesTab = (
    <>
      <div className="md-iconcolor-actions md-seg">
        <button className={`md-chip${wholeDrawing ? " on" : ""}`} onClick={() => setWholeDrawing(true)}>
          Whole drawing
        </button>
        <button className={`md-chip${!wholeDrawing ? " on" : ""}`} disabled={!styleable.length} onClick={() => setWholeDrawing(false)}>
          Selection
        </button>
      </div>
      <div className="md-iconcolor-actions md-seg">
        <button className="md-chip" onClick={() => setThemeDraft({ ...blankTheme(), ...(api ? currentLook(api.getAppState(), "nunito") : {}) })}>
          + New
        </button>
        <button className={`md-chip${manage ? " on" : ""}`} onClick={() => setManage((v) => !v)}>
          {manage ? "Done" : "Manage"}
        </button>
      </div>
      {themeDraft && (
        <ThemeEditor
          draft={themeDraft}
          setDraft={setThemeDraft}
          onUseCurrent={() => api && setThemeDraft({ ...themeDraft, ...currentLook(api.getAppState(), themeDraft.fontFamily) })}
          onSave={() => void saveThemeDraft()}
          onCancel={() => setThemeDraft(null)}
        />
      )}
      {themeCategories().map((cat) => {
        const items = themes.filter((t) => t.category === cat);
        const key = `t:${cat}`;
        return (
          <Group key={cat} title={cat} count={items.length} open={open.has(key)} onToggle={() => toggle(key)}>
            {items.map((t) => (
              <span key={t.id} className="md-style-item">
                <button className="md-chip" title={`${t.description} Restyles ${wholeDrawing || !styleable.length ? "the whole drawing" : "the selection"}.`} onClick={() => applyTheme(t)}>
                  <i className="md-style-dot" style={{ background: t.background, borderColor: t.ink }} />
                  {t.title}
                </button>
                {manage && (
                  <>
                    <button className="md-chip md-chip-x" title={t.builtin ? "Edit (saves your own version)" : "Edit"} aria-label={`Edit ${t.title}`} onClick={() => setThemeDraft(themeDraftOf(t))}>
                      ✎
                    </button>
                    {!t.builtin && (
                      <button
                        className="md-chip md-chip-x"
                        title={(t as { overridden?: boolean }).overridden ? "Reset to the built-in" : "Delete"}
                        aria-label={`Delete ${t.title}`}
                        onClick={() => void deleteTheme(t.id)}
                      >
                        ×
                      </button>
                    )}
                  </>
                )}
              </span>
            ))}
          </Group>
        );
      })}
    </>
  );

  return (
    <fieldset className="md-style" data-md-section="colors" onMouseDown={(e) => e.stopPropagation()}>
      <legend>Colors &amp; styles</legend>
      <div className="md-iconcolor-actions md-seg md-tabs" role="tablist">
        {(["colors", "presets", "themes"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`md-chip${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
            {t === "colors" ? "Colors" : t === "presets" ? "Presets" : "Themes"}
          </button>
        ))}
      </div>
      {tab === "colors" ? colorsTab : tab === "presets" ? presetsTab : themesTab}
    </fieldset>
  );
}
