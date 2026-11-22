// Command palette (⌘K / ⇧⌘P): fuzzy search over every action, stencil, theme, style preset,
// template, export format, tab and frame. Excalidraw 0.18.1 doesn't export its CommandPalette (and
// never renders it in our app), so custom items aren't possible there; this one is ours.
import { useEffect, useMemo, useRef, useState } from "react";
import { fuzzyRank } from "../../shared/fuzzy";

export interface PaletteItem {
  id: string;
  title: string;
  /** Group label, shown on the right. */
  category: string;
  /** Extra words to match (not shown). */
  keywords?: string;
  /** Shown dimmed after the title (shortcut, path, …). */
  hint?: string;
  run(): void | Promise<void>;
}

interface Props {
  items: PaletteItem[];
  onClose(): void;
}

const MAX_SHOWN = 40;

export function CommandPalette({ items, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const shown = useMemo(
    () => fuzzyRank(items, query, (i) => `${i.title} ${i.category} ${i.keywords ?? ""}`, MAX_SHOWN),
    [items, query],
  );
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".md-pal-item.on")?.scrollIntoView({ block: "nearest" });
  }, [cursor, shown]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    // After the palette is gone, so dialogs and focus changes the action causes aren't undone by it.
    setTimeout(() => void item.run(), 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(shown.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[cursor]);
    }
  };

  return (
    <div className="md-modal-backdrop md-pal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-pal" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
        <input
          className="md-pal-input"
          autoFocus
          spellCheck={false}
          placeholder="Type a command, stencil, theme, template…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="md-pal-list" ref={listRef} role="listbox">
          {shown.map((item, i) => (
            <div
              key={item.id}
              role="option"
              aria-selected={i === cursor}
              className={`md-pal-item${i === cursor ? " on" : ""}`}
              onMouseMove={() => setCursor(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(item);
              }}
            >
              <span className="md-pal-title">
                {item.title}
                {item.hint && <span className="md-pal-hint">{item.hint}</span>}
              </span>
              <span className="md-pal-cat">{item.category}</span>
            </div>
          ))}
          {!shown.length && <div className="md-pal-empty">Nothing matches “{query}”.</div>}
        </div>
        <div className="md-pal-foot">↑↓ choose · Enter run · Esc close</div>
      </div>
    </div>
  );
}
