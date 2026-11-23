import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  MY_STENCILS,
  libraryFileUrl,
  searchItems,
  type LibraryIndex,
  type LibraryItem,
} from "../../../shared/library";
import { loadStencil } from "./stencilContent";

export const STENCIL_DRAG_TYPE = "application/x-mydraw-stencil";
const bridge = window.mydraw;
/** Above this many items a collection's sub-groups start collapsed. */
const BIG_COLLECTION = 150;

type Filter = "all" | "favorites" | "recent";

interface Props {
  index: LibraryIndex | null;
  addLabels: boolean;
  onAddLabelsChange(v: boolean): void;
  onInsert(item: LibraryItem): void;
  onSaveSelection(): void;
  onOpenPacks(): void;
  onRename(item: LibraryItem): void;
  onToast(text: string, error?: boolean): void;
  onClose(): void;
}

function useStoredSet(key: string, initial: string[]): [Set<string>, (k: string) => void] {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "null") ?? initial);
    } catch {
      return new Set(initial);
    }
  });
  const toggle = (k: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      localStorage.setItem(key, JSON.stringify([...next]));
      return next;
    });
  return [set, toggle];
}

// ---------- previews ----------

const previewCache = new Map<string, Promise<string>>();

function renderedPreview(item: LibraryItem): Promise<string> {
  const key = `${item.id}@${item.mtime}`;
  let p = previewCache.get(key);
  if (!p) {
    p = loadStencil(item, { label: false, fontFamily: 6, strokeColor: "#1e1e1e" }).then(async (c) => {
      const files: BinaryFiles = Object.fromEntries(c.files.map((f) => [f.id, f]));
      const svg = await exportToSvg({
        elements: c.elements.filter((e) => !e.isDeleted) as NonDeleted<ExcalidrawElement>[],
        files,
        appState: { exportBackground: false, viewBackgroundColor: "transparent" },
        exportPadding: 4,
        skipInliningFonts: true,
      });
      return URL.createObjectURL(new Blob([svg.outerHTML], { type: "image/svg+xml" }));
    });
    previewCache.set(key, p);
    p.catch(() => previewCache.delete(key));
  }
  return p;
}

function Preview({ item }: { item: LibraryItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(
    item.kind === "svg" || item.kind === "png" ? `${libraryFileUrl(item.file)}?v=${item.mtime}` : null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (src || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      renderedPreview(item).then(setSrc, () => setFailed(true));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [item, src]);
  return (
    <div className="md-tile-preview" ref={ref}>
      {src ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : null}
      {failed && <span className="md-tile-missing">?</span>}
    </div>
  );
}

// ---------- tiles ----------

interface TileProps {
  item: LibraryItem;
  favorite: boolean;
  onInsert(item: LibraryItem): void;
  onContext(item: LibraryItem, x: number, y: number): void;
  showCollection?: boolean;
}

const Tile = memo(function Tile({ item, favorite, onInsert, onContext, showCollection }: TileProps) {
  const where = [item.collection, ...item.groups].join(" › ");
  return (
    <button
      className="md-tile"
      title={`${item.name}\n${where}${item.tags.length ? `\n${item.tags.join(", ")}` : ""}\nClick to insert, drag onto the canvas`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(STENCIL_DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = "copy";
        const img = e.currentTarget.querySelector("img");
        if (img) e.dataTransfer.setDragImage(img, img.width / 2, img.height / 2);
      }}
      onClick={() => onInsert(item)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContext(item, e.clientX, e.clientY);
      }}
    >
      <Preview item={item} />
      <span className="md-tile-name">{item.name}</span>
      {showCollection && <span className="md-tile-collection">{item.collection}</span>}
      {favorite && <span className="md-tile-star">★</span>}
    </button>
  );
});

function Grid({
  items,
  favorites,
  onInsert,
  onContext,
  showCollection,
}: {
  items: LibraryItem[];
  favorites: Set<string>;
  onInsert(item: LibraryItem): void;
  onContext(item: LibraryItem, x: number, y: number): void;
  showCollection?: boolean;
}) {
  return (
    <div className="md-grid">
      {items.map((item) => (
        <Tile
          key={item.id}
          item={item}
          favorite={favorites.has(item.id)}
          onInsert={onInsert}
          onContext={onContext}
          showCollection={showCollection}
        />
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  open,
  onToggle,
  level,
  extra,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle(): void;
  level: 0 | 1;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`md-section level-${level}`}>
      <button className="md-section-head" onClick={onToggle} aria-expanded={open}>
        <span className={`md-caret${open ? " open" : ""}`}>▸</span>
        <span className="md-section-title">{title}</span>
        <span className="md-section-count">{count}</span>
        {extra}
      </button>
      {open && <div className="md-section-body">{children}</div>}
    </div>
  );
}

// ---------- panel ----------

export function StencilPanel(props: Props) {
  const { index, onInsert, onToast } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openSections, toggleSection] = useStoredSet("mydraw.stencilSections", [MY_STENCILS]);
  const [menu, setMenu] = useState<{ item: LibraryItem; x: number; y: number } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const favorites = useMemo(() => new Set(index?.favorites ?? []), [index]);
  const byId = useMemo(() => new Map((index?.items ?? []).map((i) => [i.id, i])), [index]);
  const results = useMemo(() => (index && query.trim() ? searchItems(index.items, query) : []), [index, query]);
  const byCollection = useMemo(() => {
    const m = new Map<string, Map<string, LibraryItem[]>>();
    for (const item of index?.items ?? []) {
      const groups = m.get(item.collection) ?? new Map<string, LibraryItem[]>();
      const g = item.groups.join(" › ");
      groups.set(g, [...(groups.get(g) ?? []), item]);
      m.set(item.collection, groups);
    }
    return m;
  }, [index]);

  useEffect(() => {
    if (!menu && !moreOpen) return;
    const close = () => {
      setMenu(null);
      setMoreOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, moreOpen]);

  const onContext = (item: LibraryItem, x: number, y: number) => setMenu({ item, x, y });
  const run = (fn: () => Promise<unknown>, done?: string) =>
    fn().then(
      () => done && onToast(done),
      (e: Error) => onToast(e.message, true),
    );

  const list = (ids: string[]) => ids.map((id) => byId.get(id)).filter((x): x is LibraryItem => !!x);

  let body: ReactNode;
  if (!index) {
    body = <div className="md-panel-empty">Loading library…</div>;
  } else if (query.trim()) {
    body = results.length ? (
      <Grid items={results} favorites={favorites} onInsert={onInsert} onContext={onContext} showCollection />
    ) : (
      <div className="md-panel-empty">No stencils match “{query}”.</div>
    );
  } else if (filter === "favorites") {
    const favs = list(index.favorites);
    body = favs.length ? (
      <Grid items={favs} favorites={favorites} onInsert={onInsert} onContext={onContext} showCollection />
    ) : (
      <div className="md-panel-empty">Right-click a stencil and choose “Add to favorites”.</div>
    );
  } else if (filter === "recent") {
    const rec = list(index.recent);
    body = rec.length ? (
      <Grid items={rec} favorites={favorites} onInsert={onInsert} onContext={onContext} showCollection />
    ) : (
      <div className="md-panel-empty">Stencils you insert show up here.</div>
    );
  } else {
    const packsInstalled = index.collections.some((c) => c.managed);
    body = (
      <>
        {!packsInstalled && (
          <div className="md-panel-callout">
            <strong>Get network &amp; cloud icons</strong>
            <span>AWS, Azure, Google Cloud, Kubernetes, network devices and 2,300 product logos.</span>
            <button className="primary" onClick={props.onOpenPacks}>
              Download icon packs…
            </button>
          </div>
        )}
        {index.collections.map((c) => {
          const groups = byCollection.get(c.name) ?? new Map<string, LibraryItem[]>();
          const open = openSections.has(c.name);
          const big = c.count > BIG_COLLECTION;
          return (
            <Section
              key={c.name}
              title={c.name}
              count={c.count}
              level={0}
              open={open}
              onToggle={() => toggleSection(c.name)}
            >
              {c.count === 0 ? (
                <div className="md-panel-empty small">
                  {c.name === MY_STENCILS
                    ? "Select shapes and choose “Save selection as stencil”, or drop SVG/PNG files here."
                    : "Empty"}
                </div>
              ) : (
                [...groups.entries()].map(([g, items]) =>
                  g === "" ? (
                    <Grid key="_" items={items} favorites={favorites} onInsert={onInsert} onContext={onContext} />
                  ) : (
                    <Section
                      key={g}
                      title={g}
                      count={items.length}
                      level={1}
                      open={big ? openSections.has(`${c.name}/${g}`) : !openSections.has(`-${c.name}/${g}`)}
                      onToggle={() => toggleSection(big ? `${c.name}/${g}` : `-${c.name}/${g}`)}
                    >
                      <Grid items={items} favorites={favorites} onInsert={onInsert} onContext={onContext} />
                    </Section>
                  ),
                )
              )}
            </Section>
          );
        })}
      </>
    );
  }

  return (
    <aside
      className={`md-panel${dropActive ? " drop" : ""}`}
      aria-label="Stencils"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropActive(false);
        const paths = [...e.dataTransfer.files].map((f) => bridge.pathForFile(f)).filter(Boolean);
        void bridge.libraryImport(paths).then(
          (n) => onToast(n ? `Added ${n} file(s) to the library` : "No SVG, PNG or .excalidrawlib files found", !n),
          (err: Error) => onToast(err.message, true),
        );
      }}
    >
      <div className="md-panel-head">
        <span className="md-panel-title">Stencils</span>
        <button className="md-packs-btn" title="Download or remove icon packs" onClick={props.onOpenPacks}>
          Icon packs…
        </button>
        <div className="md-panel-actions">
          <button
            className="md-icon-btn"
            title="Library options"
            aria-label="Library options"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setMoreOpen((v) => !v)}
          >
            ⋯
          </button>
          <button className="md-icon-btn" title="Hide stencils (⇧⌘Y)" aria-label="Hide stencils" onClick={props.onClose}>
            ×
          </button>
        </div>
        {moreOpen && (
          <div className="md-popup md-more" onMouseDown={(e) => e.stopPropagation()}>
            <button onClick={() => (setMoreOpen(false), props.onSaveSelection())}>Save selection as stencil…</button>
            <button onClick={() => (setMoreOpen(false), void run(() => bridge.libraryImportDialog().then((n) => n && onToast(`Added ${n} file(s)`))))}>
              Import SVG / PNG / .excalidrawlib…
            </button>
            <button onClick={() => (setMoreOpen(false), props.onOpenPacks())}>Download icon packs…</button>
            <hr />
            <button onClick={() => (setMoreOpen(false), void bridge.libraryOpenFolder())}>Open library folder</button>
            <button
              onClick={() => (
                setMoreOpen(false),
                void run(() => bridge.libraryChooseFolder().then((p) => p && onToast(`Library folder: ${p}`)))
              )}
            >
              Change library folder…
            </button>
            {index && <div className="md-more-path" title={index.root}>{index.root}</div>}
          </div>
        )}
      </div>
      <div className="md-panel-search">
        <input
          ref={searchRef}
          type="search"
          placeholder={index ? `Search ${index.items.length.toLocaleString()} stencils…` : "Search…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && results[0]) onInsert(results[0]);
          }}
        />
      </div>
      <label className="md-panel-labels" title="Put the icon's name under it when you insert it">
        <input type="checkbox" checked={props.addLabels} onChange={(e) => props.onAddLabelsChange(e.target.checked)} />
        Add name under icons
      </label>
      {!query.trim() && (
        <div className="md-seg md-seg-compact md-panel-filter">
          {(["all", "favorites", "recent"] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f === "favorites" ? "★ Favorites" : "Recent"}
            </button>
          ))}
        </div>
      )}
      <div className="md-panel-body">{body}</div>
      {dropActive && <div className="md-drop-hint">Drop SVG, PNG or .excalidrawlib files to add them</div>}

      {menu && (
        <div
          className="md-popup md-context"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 220) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="md-context-title">{menu.item.name}</div>
          <button onClick={() => (setMenu(null), onInsert(menu.item))}>Insert</button>
          <button
            onClick={() => (
              setMenu(null), void run(() => bridge.librarySetFavorite(menu.item.id, !favorites.has(menu.item.id)))
            )}
          >
            {favorites.has(menu.item.id) ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button onClick={() => (setMenu(null), props.onRename(menu.item))}>Rename…</button>
          <button onClick={() => (setMenu(null), void bridge.libraryReveal(menu.item.id))}>Show in Finder</button>
          <hr />
          <button
            className="danger"
            onClick={() => (
              setMenu(null),
              void run(
                () => bridge.libraryRemove(menu.item.id),
                menu.item.kind === "xlib" ? `Removed “${menu.item.name}”` : `Moved “${menu.item.name}” to the Trash`,
              )
            )}
          >
            {menu.item.kind === "xlib" ? "Delete" : "Move to Trash"}
          </button>
        </div>
      )}
    </aside>
  );
}
