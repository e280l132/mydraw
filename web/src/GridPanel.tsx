// Floating, non-modal grid controls: changes show on the canvas straight away.
import type { GridHealth } from "./useLayoutGrid";
import { GRID_COLORS, GRID_LIMITS, GRID_SIZE_PRESETS, type GridSettings } from "../../shared/grid";

interface Props {
  grid: GridSettings;
  /** Hook health of the active drawing (undefined until checked). */
  health?: GridHealth;
  onChange(patch: Partial<GridSettings>): void;
  onSnap(): void;
  onReset(): void;
  onClose(): void;
}

const MAJORS = [0, 2, 4, 5, 8, 10];

export function GridPanel({ grid, health, onChange, onSnap, onReset, onClose }: Props) {
  return (
    <div className="md-gridpanel" role="dialog" aria-label="Grid" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="md-gridpanel-head">
        <label className="md-gridpanel-switch">
          <input type="checkbox" checked={grid.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
          <b>Grid</b>
        </label>
        <button className="md-gridpanel-x" onClick={onClose} aria-label="Close grid panel">
          ×
        </button>
      </div>

      <div className="md-gridpanel-row">
        <span>Spacing</span>
        <input
          type="number"
          min={GRID_LIMITS.size[0]}
          max={GRID_LIMITS.size[1]}
          value={grid.size}
          onChange={(e) => e.target.value !== "" && onChange({ size: Number(e.target.value) })}
        />
        <span className="md-gridpanel-unit">px</span>
      </div>
      <div className="md-gridpanel-chips">
        {GRID_SIZE_PRESETS.map((s) => (
          <button key={s} className={grid.size === s ? "on" : ""} onClick={() => onChange({ size: s })}>
            {s}
          </button>
        ))}
      </div>

      <div className="md-gridpanel-row">
        <span>Major line every</span>
        <select value={grid.majorEvery} onChange={(e) => onChange({ majorEvery: Number(e.target.value) })}>
          {(MAJORS.includes(grid.majorEvery) ? MAJORS : [...MAJORS, grid.majorEvery].sort((a, b) => a - b)).map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "none" : `${n} cells (${n * grid.size}px)`}
            </option>
          ))}
        </select>
      </div>

      <div className="md-gridpanel-row">
        <span>Style</span>
        <div className="md-seg md-seg-compact" role="radiogroup" aria-label="Grid style">
          {(["lines", "dots"] as const).map((s) => (
            <button key={s} role="radio" aria-checked={grid.style === s} className={grid.style === s ? "on" : ""} onClick={() => onChange({ style: s })}>
              {s === "lines" ? "Lines" : "Dots"}
            </button>
          ))}
        </div>
      </div>

      <div className="md-gridpanel-row">
        <span>Color</span>
        <div className="md-gridpanel-colors">
          {GRID_COLORS.map((c) => (
            <button
              key={c}
              className={grid.color === c ? "on" : ""}
              style={{ background: c }}
              title={c}
              aria-label={`Grid color ${c}`}
              onClick={() => onChange({ color: c })}
            />
          ))}
          <input type="color" value={grid.color} onChange={(e) => onChange({ color: e.target.value })} aria-label="Custom grid color" />
        </div>
      </div>

      <div className="md-gridpanel-row">
        <span>Strength</span>
        <input
          type="range"
          min={GRID_LIMITS.opacity[0]}
          max={GRID_LIMITS.opacity[1]}
          step={0.01}
          value={grid.opacity}
          onChange={(e) => onChange({ opacity: Number(e.target.value) })}
          aria-label="Grid strength"
        />
        <span className="md-gridpanel-unit">{Math.round(grid.opacity * 100)}%</span>
      </div>

      <label className="md-gridpanel-check">
        <input
          type="checkbox"
          checked={grid.snap}
          disabled={health ? !health.snapOk : false}
          onChange={(e) => onChange({ snap: e.target.checked })}
        />
        Snap to grid while moving, drawing and resizing
      </label>
      {health?.snapOk === false && (
        <div className="md-gridpanel-warn">
          Live snapping is not available with this Excalidraw version{health.mode === "overlay" ? " and the grid is drawn over the shapes" : ""}. Use “Snap selection to grid”.
        </div>
      )}

      <div className="md-gridpanel-actions">
        <button onClick={onSnap} title="Move the selected shapes so their top-left corner sits on the grid">
          Snap selection to grid
        </button>
        <button onClick={onReset}>Reset</button>
      </div>
      <div className="md-gridpanel-hint">⌘' toggles the grid. Hold ⌘ while dragging to move freely.</div>
    </div>
  );
}
