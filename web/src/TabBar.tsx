import type { JSX } from "react";
import type { DrawingStyle } from "../../shared/types";
export interface TabInfo {
  id: string;
  title: string;
  filePath: string | null;
  dirty: boolean;
}

interface Props {
  tabs: TabInfo[];
  activeId: string;
  onSelect(id: string): void;
  onClose(id: string): void;
  onNew(): void;
  panelOpen: boolean;
  onTogglePanel(): void;
  /** The drawing style (Clean / Sketch): shown and switched here. */
  drawingStyle: DrawingStyle;
  onDrawingStyle(style: DrawingStyle): void;
  /** Ask Claude box (web/src/AskClaude.tsx): open, a run in progress, toggle. */
  askOpen: boolean;
  askBusy: boolean;
  onAsk(): void;
}

/** Clean = a straight line, Sketch = a wobbly pencil line. */
const STYLE_ICONS: Record<DrawingStyle, JSX.Element> = {
  clean: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  ),
  sketch: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 6.6c3.2-.9 9.6-.4 15.2-.5M19.4 5.4c.4 3.8.6 8.2.3 12.6M20 17.6c-5 .6-10.4.9-15.6.3M4.8 18.4C4.1 14.4 4 10.2 4.4 6" />
    </svg>
  ),
};

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, panelOpen, onTogglePanel, drawingStyle, onDrawingStyle, askOpen, askBusy, onAsk }: Props) {
  return (
    <div className="md-tabbar">
      {/* Tabs scroll on their own, so the buttons on the right always stay visible. */}
      <div className="md-tabs" role="tablist">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            className={`md-tab${t.id === activeId ? " active" : ""}${t.dirty ? " dirty" : ""}`}
            title={t.filePath ?? "Not saved yet"}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                onClose(t.id);
              } else if (e.button === 0) onSelect(t.id);
            }}
          >
            <span className="md-tab-title">{t.title}</span>
            <button
              className="md-tab-close"
              aria-label={`Close ${t.title}`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onClose(t.id)}
            >
              <span className="dot">●</span>
              <span className="x">×</span>
            </button>
          </div>
        ))}
        <button className="md-tab-new" aria-label="New drawing" title="New drawing (⌘N)" onClick={onNew}>
          +
        </button>
      </div>
      <div className="md-tabbar-spacer" />
      <button
        className={`md-tabbar-btn md-ask-btn${askOpen ? " on" : ""}${askBusy ? " busy" : ""}`}
        title={askBusy ? "Claude is working… (⌥⌘J)" : "Ask Claude to change the drawing (⌥⌘J)"}
        aria-pressed={askOpen}
        onClick={onAsk}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 3l1.6 4.6L16 9.2l-4.4 1.6L10 15.4 8.4 10.8 4 9.2l4.4-1.6z" />
          <path d="M17.5 13.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
        </svg>
        Ask Claude
        {askBusy && <span className="md-ask-btn-dot" aria-hidden />}
      </button>
      <div className={`md-style-switch ${drawingStyle}`} role="radiogroup" aria-label="Drawing style">
        {(["clean", "sketch"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={drawingStyle === s}
            data-drawing-style={s}
            className={drawingStyle === s ? "on" : ""}
            title={
              s === "clean"
                ? "Clean style: straight lines, Inter text, original icons (Auto). New shapes only; existing ones keep their look."
                : "Sketch style: hand-drawn lines, Excalifont text, hand-drawn icons (Auto). New shapes only; existing ones keep their look."
            }
            onClick={() => onDrawingStyle(s)}
          >
            {STYLE_ICONS[s]}
            {s === "clean" ? "Clean" : "Sketch"}
          </button>
        ))}
      </div>
      <button
        className={`md-tabbar-btn${panelOpen ? " on" : ""}`}
        title={panelOpen ? "Hide stencils (⇧⌘Y)" : "Show stencils (⇧⌘Y)"}
        aria-pressed={panelOpen}
        onClick={onTogglePanel}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <circle cx="17.5" cy="6.5" r="3.5" />
          <path d="M6.5 13.5l3.5 3.5-3.5 3.5L3 17z" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        Stencils
      </button>
    </div>
  );
}
