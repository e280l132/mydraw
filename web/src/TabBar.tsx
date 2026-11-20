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
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew, panelOpen, onTogglePanel }: Props) {
  return (
    <div className="md-tabbar" role="tablist">
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
      <div className="md-tabbar-spacer" />
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
