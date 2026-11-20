// "Icon color" section rendered inside Excalidraw's properties panel when SVG icons are selected.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { hexToHsv, hsvToHex, normalizeHex, type HSV } from "../../../shared/colorMath";
import type { IconSelection } from "./iconColor";

/** Excalidraw's stroke palette plus a few extras that suit network/cloud diagrams (11 + 1 custom). */
export const ICON_SWATCHES: Array<{ color: string; name: string }> = [
  { color: "#1e1e1e", name: "Black" },
  { color: "#868e96", name: "Gray" },
  { color: "#ffffff", name: "White" },
  { color: "#e03131", name: "Red" },
  { color: "#f08c00", name: "Orange" },
  { color: "#f2b705", name: "Yellow" },
  { color: "#2f9e44", name: "Green" },
  { color: "#0c8599", name: "Teal" },
  { color: "#1971c2", name: "Blue" },
  { color: "#6741d9", name: "Violet" },
  { color: "#c2255c", name: "Pink" },
];

const CUSTOM_KEY = "mydraw.customIconColor";

interface Props {
  selection: IconSelection;
  /** Apply a color; `preview` = live update during a drag (merged into one undo step). */
  onColor(color: string | null, preview?: boolean): void;
}

// ---------- picker ----------

interface PickerProps {
  value: string;
  onPreview(hex: string): void;
  onCommit(hex: string): void;
}

function useDrag(onMove: (x: number, y: number) => void, onEnd: () => void) {
  return (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const at = (cx: number, cy: number) =>
      onMove(Math.min(1, Math.max(0, (cx - rect.left) / rect.width)), Math.min(1, Math.max(0, (cy - rect.top) / rect.height)));
    at(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => at(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
}

function ColorPicker({ value, onPreview, onCommit }: PickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const hsvRef = useRef(hsv);
  const frame = useRef(0);

  const update = (next: HSV) => {
    hsvRef.current = next;
    setHsv(next);
    const hex = hsvToHex(next);
    setHexText(hex);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onPreview(hex));
  };
  const commit = () => {
    cancelAnimationFrame(frame.current);
    onCommit(hsvToHex(hsvRef.current));
  };

  const onSV = useDrag((x, y) => update({ ...hsvRef.current, s: x, v: 1 - y }), commit);
  const onHue = useDrag((x) => update({ ...hsvRef.current, h: Math.min(359.9, x * 360) }), commit);
  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  const applyHex = () => {
    const hex = normalizeHex(hexText);
    if (!hex) return setHexText(hsvToHex(hsvRef.current));
    const next = hexToHsv(hex);
    hsvRef.current = next;
    setHsv(next);
    setHexText(hex);
    onCommit(hex);
  };

  const hasEyeDropper = "EyeDropper" in window;
  const pickFromScreen = async () => {
    try {
      // Chromium EyeDropper API: lets you pick any color on screen.
      const Ctor = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      const { sRGBHex } = await new Ctor().open();
      const hex = normalizeHex(sRGBHex);
      if (hex) {
        const next = hexToHsv(hex);
        hsvRef.current = next;
        setHsv(next);
        setHexText(hex);
        onCommit(hex);
      }
    } catch {
      // cancelled
    }
  };

  return (
    <div className="md-picker">
      <div className="md-picker-sv" style={{ background: hueColor }} onPointerDown={onSV} aria-label="Saturation and brightness">
        <div className="md-picker-sv-white" />
        <div className="md-picker-sv-black" />
        <div className="md-picker-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="md-picker-hue" onPointerDown={onHue} aria-label="Hue">
        <div className="md-picker-thumb hue" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="md-picker-row">
        <span className="md-picker-preview" style={{ background: hsvToHex(hsv) }} />
        <input
          className="md-picker-hex"
          value={hexText}
          spellCheck={false}
          aria-label="Hex color"
          onChange={(e) => setHexText(e.target.value)}
          onBlur={applyHex}
          onKeyDown={(e) => {
            e.stopPropagation(); // keep Excalidraw shortcuts out of the text box
            if (e.key === "Enter") applyHex();
          }}
        />
        {hasEyeDropper && (
          <button className="md-picker-eyedrop" title="Pick a color from the screen" aria-label="Eyedropper" onClick={pickFromScreen}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M14.5 4.5l5 5M17 2l5 5-3 3-5-5zM14 7L5 16l-1 4 4-1 9-9" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- section ----------

export function IconColorSection({ selection, onColor }: Props) {
  const [custom, setCustom] = useState<string | null>(() => normalizeHex(localStorage.getItem(CUSTOM_KEY) ?? ""));
  const [pickerOpen, setPickerOpen] = useState(false);

  // A selected color that isn't a preset becomes the custom (12th) swatch.
  const current = selection.color && selection.color !== "original" ? selection.color : null;
  const isPreset = (c: string | null) => !!c && ICON_SWATCHES.some((s) => s.color === c);
  useEffect(() => {
    if (current && !isPreset(current) && current !== custom) {
      setCustom(current);
      localStorage.setItem(CUSTOM_KEY, current);
    }
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const rememberCustom = (hex: string) => {
    if (isPreset(hex)) return;
    setCustom(hex);
    localStorage.setItem(CUSTOM_KEY, hex);
  };

  if (selection.count === 0) {
    return (
      <fieldset className="md-iconcolor">
        <legend>Icon color</legend>
        <div className="md-iconcolor-note">PNG/JPG images can't be recolored. Use SVG icons.</div>
      </fieldset>
    );
  }

  return (
    <fieldset className="md-iconcolor" onMouseDown={(e) => e.stopPropagation()}>
      <legend>{selection.count === 1 ? "Icon color" : `Icon color (${selection.count})`}</legend>
      <div className="md-iconcolor-grid">
        {ICON_SWATCHES.map((s) => (
          <button
            key={s.color}
            className={`md-swatch${current === s.color ? " on" : ""}`}
            style={{ background: s.color }}
            title={s.name}
            aria-label={s.name}
            onClick={() => onColor(s.color)}
          />
        ))}
        <button
          className={`md-swatch md-swatch-slot${custom ? "" : " empty"}${custom && current === custom ? " on" : ""}`}
          style={custom ? { background: custom } : undefined}
          title={custom ? `Custom ${custom}` : "Custom color: pick one below"}
          aria-label="Custom color swatch"
          disabled={!custom}
          onClick={() => custom && onColor(custom)}
        />
      </div>
      <div className="md-iconcolor-actions">
        <button className={`md-chip${selection.color === "original" ? " on" : ""}`} onClick={() => onColor(null)}>
          Original
        </button>
        <button className={`md-chip md-chip-custom${pickerOpen ? " on" : ""}`} onClick={() => setPickerOpen((v) => !v)}>
          <span className="md-rainbow" /> Custom…
        </button>
      </div>
      {pickerOpen && (
        <ColorPicker
          value={current ?? custom ?? "#1971c2"}
          onPreview={(hex) => onColor(hex, true)}
          onCommit={(hex) => {
            rememberCustom(hex);
            onColor(hex);
          }}
        />
      )}
      {selection.raster > 0 && (
        <div className="md-iconcolor-note">
          {selection.raster} PNG/JPG image{selection.raster > 1 ? "s" : ""} in the selection can't be recolored.
        </div>
      )}
    </fieldset>
  );
}
