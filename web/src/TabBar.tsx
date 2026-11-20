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
}

export function TabBar({ tabs, activeId, onSelect, onClose, onNew }: Props) {
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
    </div>
  );
}
