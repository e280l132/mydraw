import { exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeleted } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ICON_STYLE_PRESET_IDS,
  ICON_STYLE_PRESETS,
  iconSketchPreset,
  lookOfSetting,
  presetSketch,
  sketchKey,
  type IconSketch,
  type IconSketchLook,
  type IconStylePreset,
  type IconStyleSetting,
  type CaptionFontMode,
  captionFontName,
  insertSketchOf,
} from "../../../shared/iconSketch";
import { fontCss, handFonts } from "./captionFont";
import { SAMPLE_ICON, useIconPreviews } from "./iconPreview";
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
  /** Insert default for icons (Settings.iconStyle). */
  iconStyle: IconStyleSetting;
  onIconStyleChange(v: IconStyleSetting): void;
  /** What new stencils get under the current settings (previews show it); null = original. */
  insertSketch: IconSketch | null;
  /** The hand-drawn look inserts get (Settings.iconSketch). */
  insertLook: IconSketchLook;
  onInsertLookChange(look: IconSketchLook): void;
  /** Font of names under inserted icons (Settings.captionFont / captionHandFont). */
  captionFont: CaptionFontMode;
  captionHandFont: string;
  onCaptionChange(patch: { captionFont?: CaptionFontMode; captionHandFont?: string }): void;
  /** The drawing style (Auto resolves against it). */
  drawingStyle: "clean" | "sketch";
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
const PREVIEW_CACHE_MAX = 1500;

/** The sketch tiles are drawn with (the insert default), so the panel shows what a click inserts. */
const PreviewSketch = createContext<IconSketch | null>(null);

function renderedPreview(item: LibraryItem, sketch: IconSketch | null): Promise<string> {
  const key = `${item.id}@${item.mtime}:${sketchKey(sketch)}`;
  let p = previewCache.get(key);
  if (!p) {
    p = loadStencil(item, { label: false, fontFamily: 6, strokeColor: "#1e1e1e", sketch }).then(async (c) => {
      // A single icon: show its (hand-drawn) file as is.
      const image = c.elements.length === 1 && c.elements[0].type === "image" ? c.elements[0] : null;
      const file = image ? c.files.find((f) => f.id === image.fileId) : undefined;
      if (file) return file.dataURL;
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
    if (previewCache.size > PREVIEW_CACHE_MAX) {
      const [oldKey, old] = previewCache.entries().next().value!;
      previewCache.delete(oldKey);
      void old.then((u) => u.startsWith("blob:") && URL.revokeObjectURL(u), () => undefined);
    }
  }
  return p;
}

function Preview({ item }: { item: LibraryItem }) {
  const sketch = useContext(PreviewSketch);
  return <PreviewImage key={sketchKey(sketch)} item={item} sketch={sketch} />;
}

function PreviewImage({ item, sketch }: { item: LibraryItem; sketch: IconSketch | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string | null>(
    !sketch && (item.kind === "svg" || item.kind === "png") ? `${libraryFileUrl(item.file)}?v=${item.mtime}` : null,
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (src || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      renderedPreview(item, sketch).then(setSrc, () => setFailed(true));
    });
    io.observe(el);
    return () => io.disconnect();
  }, [item, src, sketch]);
  return (
    <div className="md-tile-preview" ref={ref}>
      {src ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} /> : null}
      {failed && <span className="md-tile-missing">?</span>}
    </div>
  );
}

// ---------- insert options ----------

const PRESET_SKETCHES = Object.fromEntries(ICON_STYLE_PRESET_IDS.map((id) => [id, presetSketch(id)])) as Record<string, IconSketch>;

type Menu = "look" | "font" | null;

/** Close a popup menu on an outside press or Escape. */
function useMenuClose(menu: Menu, box: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [menu, box, close]);
}

/**
 * How inserted stencils come out, in one button beside the search box. The button shows a sample
 * icon exactly as a click would insert it (look + name font); its popover holds everything:
 * a live preview, the looks (Original + 8 hand-drawn ones, with previews), "Follow drawing style"
 * (Settings.iconStyle auto), and the names (Off · Match · Hand · Plain + the handwriting font).
 */
function InsertStyle(p: {
  addLabels: boolean;
  onAddLabelsChange(v: boolean): void;
  iconStyle: IconStyleSetting;
  onIconStyleChange(v: IconStyleSetting): void;
  look: IconSketchLook;
  onLookChange(look: IconSketchLook): void;
  captionFont: CaptionFontMode;
  captionHandFont: string;
  onCaptionChange(patch: { captionFont?: CaptionFontMode; captionHandFont?: string }): void;
  drawingStyle: "clean" | "sketch";
}) {
  const [open, setOpen] = useState(false);
  const [fontMenu, setFontMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setFontMenu(false);
  }, []);
  useMenuClose(open ? "look" : null, box, close);

  const preset = iconSketchPreset({ ...p.look, seed: 1 });
  const lookLabel = preset ? ICON_STYLE_PRESETS[preset].label : "Custom";
  // What a click inserts right now (Auto resolved against the drawing style).
  const now = insertSketchOf({ iconStyle: p.iconStyle, drawingStyle: p.drawingStyle, iconSketch: p.look });
  const drawingFont = p.drawingStyle === "sketch" ? "Excalifont" : "Inter";
  const nameFont = captionFontName(p.captionFont, !!now, p.captionHandFont) ?? drawingFont;
  const styles = useMemo(() => ({ now, ...PRESET_SKETCHES, original: null }), [sketchKey(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  const previews = useIconPreviews(SAMPLE_ICON, open ? styles : { now });
  const fonts = fontMenu ? handFonts() : [];

  const tileOn = (id: IconStylePreset | "original") => (id === "original" ? p.iconStyle === "original" : p.iconStyle !== "original" && preset === id);
  const chooseLook = (id: IconStylePreset | "original") => {
    if (id === "original") return p.onIconStyleChange("original");
    p.onLookChange(lookOfSetting(presetSketch(id)));
    if (p.iconStyle === "original") p.onIconStyleChange("hand-drawn");
  };
  const follow = p.iconStyle === "auto";
  const names = (mode: CaptionFontMode | "off") => {
    if (mode === "off") return p.onAddLabelsChange(false);
    if (!p.addLabels) p.onAddLabelsChange(true);
    p.onCaptionChange({ captionFont: mode });
  };
  const nameOn = (m: CaptionFontMode | "off") => (m === "off" ? !p.addLabels : p.addLabels && p.captionFont === m);
  const chooseFont = (f: string) => {
    if (!p.addLabels) p.onAddLabelsChange(true);
    p.onCaptionChange({ captionHandFont: f, ...(p.captionFont === "drawing" ? { captionFont: "hand" as const } : {}) });
    setFontMenu(false);
  };

  const iconWord = p.iconStyle === "original" ? "Original" : follow ? (now ? `${lookLabel} (Sketch style)` : `Original (Clean style)`) : lookLabel;
  const summary = `Inserts: ${iconWord} icons, ${p.addLabels ? `names in ${nameFont}` : "no names"}. Click to change.`;
  const lookTile = (id: IconStylePreset | "original") => {
    const label = id === "original" ? "Original" : ICON_STYLE_PRESETS[id].label;
    return (
      <button
        type="button"
        key={id}
        data-look={id}
        className={`md-is-tile${tileOn(id) ? " on" : ""}`}
        title={id === "original" ? "The icon as designed" : ICON_STYLE_PRESETS[id].hint}
        onClick={() => chooseLook(id)}
      >
        <span className="md-is-tile-img">{previews[id] ? <img src={previews[id]} alt="" draggable={false} /> : <span className="md-is-tile-wait" />}</span>
        <span className="md-is-tile-label">{label}</span>
      </button>
    );
  };

  return (
    <div className="md-ins" ref={box}>
      <button
        type="button"
        className={`md-ins-btn${open ? " open" : ""}`}
        aria-label="How inserted stencils look"
        aria-expanded={open}
        title={summary}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="md-ins-thumb">{previews.now ? <img src={previews.now} alt="" draggable={false} /> : null}</span>
        <span className="md-ins-aa" style={{ fontFamily: fontCss(nameFont), opacity: p.addLabels ? 1 : 0.35 }}>
          Aa
        </span>
        <span className="md-ins-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="md-ins-pop" role="dialog" aria-label="Insert stencils as">
          <div className="md-ins-preview">
            <span className="md-ins-preview-img">{previews.now ? <img src={previews.now} alt="" draggable={false} /> : null}</span>
            {p.addLabels && (
              <span className="md-ins-preview-name" style={{ fontFamily: fontCss(nameFont) }}>
                Amazon EC2
              </span>
            )}
            <span className="md-ins-preview-note">{iconWord}</span>
          </div>

          <div className="md-ins-head">Icons</div>
          <div className="md-ins-tiles" role="group" aria-label="Icon look">
            {lookTile("original")}
            {ICON_STYLE_PRESET_IDS.map(lookTile)}
          </div>
          <label className={`md-ins-follow${p.iconStyle === "original" ? " dim" : ""}`} title="Original icons while the drawing style is Clean, this look while it is Sketch">
            <input
              type="checkbox"
              data-icon-style="auto"
              checked={follow}
              onChange={(e) => p.onIconStyleChange(e.target.checked ? "auto" : "hand-drawn")}
            />
            Follow drawing style <span>(Clean → original)</span>
          </label>

          <div className="md-ins-head">Names</div>
          <div className="md-seg md-seg-compact md-panel-names" role="group" aria-label="Names under inserted icons">
            <button type="button" data-names="off" className={nameOn("off") ? "on" : ""} title="No name under icons" onClick={() => names("off")}>
              Off
            </button>
            <button type="button" data-names="match" className={nameOn("match") ? "on" : ""} title="Handwritten under hand-drawn icons, the drawing's font under original ones" onClick={() => names("match")}>
              Match
            </button>
            <button type="button" data-names="hand" className={nameOn("hand") ? "on" : ""} title={`Always handwritten (${p.captionHandFont})`} onClick={() => names("hand")}>
              ✎ Hand
            </button>
            <button type="button" data-names="drawing" className={nameOn("drawing") ? "on" : ""} title={`Always the drawing's font (${drawingFont})`} onClick={() => names("drawing")}>
              Aa Plain
            </button>
          </div>
          <div className="md-ins-font">
            <span>Hand font</span>
            <button type="button" className={`md-ins-fontbtn${fontMenu ? " on" : ""}`} aria-expanded={fontMenu} aria-label="Choose the handwriting font" onClick={() => setFontMenu((v) => !v)}>
              <span className="md-names-hand" style={{ fontFamily: fontCss(p.captionHandFont) }}>
                {p.captionHandFont}
              </span>
              <span aria-hidden="true">▾</span>
            </button>
          </div>
          {fontMenu && (
            <div className="md-font-menu" role="menu" aria-label="Handwriting fonts">
              {fonts.map((f) => (
                <button type="button" role="menuitemradio" aria-checked={p.captionHandFont === f} key={f} data-hand-font={f} className={p.captionHandFont === f ? "on" : ""} onClick={() => chooseFont(f)}>
                  <span style={{ fontFamily: fontCss(f) }}>Amazon EC2</span>
                  <small>{f}</small>
                </button>
              ))}
            </div>
          )}
          <p className="md-look-hint">Change placed icons in the style panel → Icon style.</p>
        </div>
      )}
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
    <PreviewSketch.Provider value={props.insertSketch}>
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
        <InsertStyle
          addLabels={props.addLabels}
          onAddLabelsChange={props.onAddLabelsChange}
          iconStyle={props.iconStyle}
          onIconStyleChange={props.onIconStyleChange}
          look={props.insertLook}
          onLookChange={props.onInsertLookChange}
          captionFont={props.captionFont}
          captionHandFont={props.captionHandFont}
          onCaptionChange={props.onCaptionChange}
          drawingStyle={props.drawingStyle}
        />
      </div>

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
    </PreviewSketch.Provider>
  );
}
