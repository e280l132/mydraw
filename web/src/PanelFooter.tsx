// Bottom of the properties panel: the "Rearrange sections" toggle. While it is on, every section
// title shows a grip and can be dragged (web/src/panelOrder.ts); "Reset order" goes back to the
// default order. Portaled into `.md-panel-foot-host`, which App keeps as the last flex item.
interface Props {
  arranging: boolean;
  canReset: boolean;
  onToggle(): void;
  onReset(): void;
}

const ArrangeIcon = () => (
  <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3v14M3 6l3-3 3 3M14 17V3M11 14l3 3 3-3" />
  </svg>
);

export function PanelFooter({ arranging, canReset, onToggle, onReset }: Props) {
  return (
    <div className={`md-panel-foot${arranging ? " on" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
      {arranging && <p className="md-panel-foot-hint">Drag a section by its title to move it.</p>}
      <div className="md-panel-foot-row">
        <button
          type="button"
          className="md-arrange-toggle"
          aria-pressed={arranging}
          title={arranging ? "Stop rearranging the panel" : "Move the sections of this panel around"}
          onClick={onToggle}
        >
          <ArrangeIcon />
          <span>{arranging ? "Done" : "Rearrange sections"}</span>
        </button>
        {arranging && (
          <button type="button" className="md-arrange-reset" disabled={!canReset} onClick={onReset} title="Put the sections back in their default order">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
