import { useEffect, useRef } from "react";
import type { IconSelection } from "./iconColor";

/** Excalidraw's stroke palette plus a few extras that suit network/cloud diagrams. */
export const ICON_SWATCHES: Array<{ color: string; name: string }> = [
  { color: "#1e1e1e", name: "Black" },
  { color: "#868e96", name: "Gray" },
  { color: "#e03131", name: "Red" },
  { color: "#f08c00", name: "Orange" },
  { color: "#f2b705", name: "Yellow" },
  { color: "#2f9e44", name: "Green" },
  { color: "#0c8599", name: "Teal" },
  { color: "#1971c2", name: "Blue" },
  { color: "#6741d9", name: "Violet" },
  { color: "#c2255c", name: "Pink" },
  { color: "#ffffff", name: "White" },
];

interface Props {
  selection: IconSelection;
  onColor(color: string | null): void;
}

export function IconColorBar({ selection, onColor }: Props) {
  const customRef = useRef<HTMLInputElement>(null);
  const onColorRef = useRef(onColor);
  onColorRef.current = onColor;
  // Apply a custom color once it is picked ("change"), not on every drag step ("input").
  useEffect(() => {
    const input = customRef.current;
    if (!input) return;
    const onChange = () => onColorRef.current(input.value);
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);
  const label = selection.count === 1 ? "Icon color" : `Color of ${selection.count} icons`;
  const isCustom =
    selection.color && selection.color !== "original" && !ICON_SWATCHES.some((s) => s.color === selection.color);
  return (
    <div className="md-iconbar" role="toolbar" aria-label={label} onMouseDown={(e) => e.preventDefault()}>
      {selection.count > 0 && (
        <>
      <span className="md-iconbar-label">{label}</span>
      <button
        className={`md-iconbar-original${selection.color === "original" ? " on" : ""}`}
        title="Original colors"
        onClick={() => onColor(null)}
      >
        Original
      </button>
      {ICON_SWATCHES.map((s) => (
        <button
          key={s.color}
          className={`md-swatch${selection.color === s.color ? " on" : ""}`}
          style={{ background: s.color }}
          title={s.name}
          aria-label={s.name}
          onClick={() => onColor(s.color)}
        />
      ))}
      <button
        className={`md-swatch md-swatch-custom${isCustom ? " on" : ""}`}
        style={isCustom ? { background: selection.color as string } : undefined}
        title="Custom color…"
        aria-label="Custom color"
        onClick={() => customRef.current?.click()}
      >
        {isCustom ? "" : "+"}
      </button>
      <input
        ref={customRef}
        type="color"
        className="md-hidden-input"
        defaultValue="#1971c2"
      />
        </>
      )}
      {selection.raster > 0 && (
        <span className="md-iconbar-note">
          {selection.raster} PNG/JPG image{selection.raster > 1 ? "s" : ""} can't be recolored
        </span>
      )}
    </div>
  );
}
