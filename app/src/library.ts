// The stencil library: a plain folder (default ~/Documents/mydraw/Library) shared by every drawing.
// Each top-level folder is a collection. Items are .svg/.png icons, .stencil.json shape groups,
// and the items inside .excalidrawlib files. The folder is the source of truth, so files added in
// Finder (or by Claude) appear automatically.
import { shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  EXCALIDRAW_LIBRARY_COLLECTION,
  EXCALIDRAW_LIBRARY_FILE,
  MY_STENCILS,
  humanize,
  itemKindForFile,
  pushRecent,
  safeSegment,
  type CollectionInfo,
  type CollectionMeta,
  type LibraryIndex,
  type LibraryItem,
  type StencilFile,
} from "../../shared/library";
import { hashContent, writeFileAtomic } from "./fs-utils";

const STATE_FILE = "library.json";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMPORT_EXTENSIONS = new Set([".svg", ".png", ".excalidrawlib"]);

interface LibraryState {
  favorites: string[];
  recent: string[];
}

export interface SaveStencilRequest {
  collection: string;
  name: string;
  tags: string[];
  elements: unknown[];
  files: Record<string, unknown>;
}

export class LibraryStore {
  private index: LibraryIndex | null = null;
  private watcher: fs.FSWatcher | null = null;
  private rescanTimer: NodeJS.Timeout | null = null;
  private excalidrawLibHash: string | null = null;

  constructor(
    private root: string,
    private onChange: (index: LibraryIndex) => void,
    private onExcalidrawLibraryChange: (content: string) => void,
  ) {}

  get rootPath(): string {
    return this.root;
  }

  start(): void {
    this.ensureRoot();
    this.index = this.scan();
    this.excalidrawLibHash = this.hashOf(EXCALIDRAW_LIBRARY_FILE);
    this.watch();
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
  }

  setRoot(root: string): void {
    this.stop();
    this.root = root;
    this.start();
    this.onChange(this.getIndex());
    this.onExcalidrawLibraryChange(this.readExcalidrawLibrary());
  }

  getIndex(): LibraryIndex {
    if (!this.index) this.index = this.scan();
    return this.index;
  }

  // ---------- paths ----------

  /** Resolve a library-relative path, refusing anything outside the root. */
  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel.split("#")[0]);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error("path outside library");
    return abs;
  }

  private rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }

  private ensureRoot(): void {
    fs.mkdirSync(path.join(this.root, MY_STENCILS), { recursive: true });
    fs.mkdirSync(path.join(this.root, EXCALIDRAW_LIBRARY_COLLECTION), { recursive: true });
    const readme = path.join(this.root, "README.txt");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        [
          "mydraw stencil library",
          "",
          "Every top-level folder is a collection. Drop .svg, .png or .excalidrawlib files into any",
          "folder and they appear in mydraw's Stencils panel. Sub-folders become groups.",
          "",
          `"${MY_STENCILS}" holds shapes you save from mydraw (.stencil.json).`,
          `"${EXCALIDRAW_LIBRARY_COLLECTION}" is the Excalidraw Library panel, shared by all drawings.`,
          "library.json stores favorites and recently used stencils.",
          "",
        ].join("\n"),
      );
    }
  }

  // ---------- scanning ----------

  private readState(): LibraryState {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.root, STATE_FILE), "utf8"));
      return {
        favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x: unknown) => typeof x === "string") : [],
        recent: Array.isArray(raw.recent) ? raw.recent.filter((x: unknown) => typeof x === "string") : [],
      };
    } catch {
      return { favorites: [], recent: [] };
    }
  }

  private writeState(state: LibraryState): void {
    writeFileAtomic(path.join(this.root, STATE_FILE), JSON.stringify(state, null, 2));
  }

  private readMeta(collectionDir: string): CollectionMeta {
    try {
      return JSON.parse(fs.readFileSync(path.join(collectionDir, "collection.json"), "utf8")) as CollectionMeta;
    } catch {
      return {};
    }
  }

  scan(): LibraryIndex {
    const items: LibraryItem[] = [];
    const collections: CollectionInfo[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.root, { withFileTypes: true });
    } catch {
      // root missing; ensureRoot will create it
    }
    for (const dir of entries) {
      if (!dir.isDirectory() || dir.name.startsWith(".")) continue;
      const collectionDir = path.join(this.root, dir.name);
      const meta = this.readMeta(collectionDir);
      const before = items.length;
      this.scanDir(collectionDir, dir.name, [], meta, items);
      collections.push({
        name: dir.name,
        count: items.length - before,
        license: meta.license,
        source: meta.source,
        managed: meta.managedBy === "mydraw-packs",
      });
    }
    collections.sort((a, b) => collectionOrder(a.name) - collectionOrder(b.name) || a.name.localeCompare(b.name));
    const state = this.readState();
    const ids = new Set(items.map((i) => i.id));
    return {
      root: this.root,
      collections,
      items,
      favorites: state.favorites.filter((id) => ids.has(id)),
      recent: state.recent.filter((id) => ids.has(id)),
    };
  }

  private scanDir(dir: string, collection: string, groups: string[], meta: CollectionMeta, out: LibraryItem[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "collection.json") continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        this.scanDir(abs, collection, [...groups, e.name], meta, out);
        continue;
      }
      const kind = itemKindForFile(e.name);
      if (!kind) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      const file = this.rel(abs);
      const inCollection = [...groups, e.name].join("/");
      const m = meta.items?.[inCollection];
      const base: Omit<LibraryItem, "id" | "name" | "tags" | "kind"> = {
        collection,
        groups,
        file,
        mtime: Math.round(stat.mtimeMs),
      };
      const groupTags = groups.map((g) => g.toLowerCase());

      if (kind === "xlib") {
        for (const [i, name] of readExcalidrawLibNames(abs).entries()) {
          out.push({
            ...base,
            id: `${file}#${i}`,
            kind,
            index: i,
            name: name || `${humanize(e.name)} ${i + 1}`,
            tags: groupTags,
          });
        }
      } else if (kind === "stencil") {
        const s = readStencilMeta(abs);
        out.push({ ...base, id: file, kind, name: s.name || humanize(e.name), tags: [...s.tags, ...groupTags] });
      } else {
        out.push({
          ...base,
          id: file,
          kind,
          name: m?.name ?? humanize(e.name),
          tags: [...(m?.tags ?? []), ...groupTags],
        });
      }
    }
  }

  // ---------- watching ----------

  private watch(): void {
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_event, filename) => {
        if (filename && path.basename(filename.toString()) === STATE_FILE) return;
        this.scheduleRescan();
      });
    } catch {
      this.watcher = null;
    }
  }

  private scheduleRescan(): void {
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => this.rescan(), 300);
  }

  rescan(): void {
    this.index = this.scan();
    this.onChange(this.index);
    const h = this.hashOf(EXCALIDRAW_LIBRARY_FILE);
    if (h !== this.excalidrawLibHash) {
      this.excalidrawLibHash = h;
      this.onExcalidrawLibraryChange(this.readExcalidrawLibrary());
    }
  }

  private hashOf(rel: string): string | null {
    try {
      return hashContent(fs.readFileSync(this.resolve(rel)));
    } catch {
      return null;
    }
  }

  // ---------- favorites / recent ----------

  setFavorite(id: string, favorite: boolean): LibraryIndex {
    const state = this.readState();
    state.favorites = favorite ? [id, ...state.favorites.filter((f) => f !== id)] : state.favorites.filter((f) => f !== id);
    this.writeState(state);
    return this.refreshState();
  }

  markUsed(id: string): LibraryIndex {
    const state = this.readState();
    state.recent = pushRecent(state.recent, id);
    this.writeState(state);
    return this.refreshState();
  }

  private refreshState(): LibraryIndex {
    const idx = this.getIndex();
    const ids = new Set(idx.items.map((i) => i.id));
    const state = this.readState();
    this.index = {
      ...idx,
      favorites: state.favorites.filter((id) => ids.has(id)),
      recent: state.recent.filter((id) => ids.has(id)),
    };
    this.onChange(this.index);
    return this.index;
  }

  // ---------- Excalidraw Library panel ----------

  readExcalidrawLibrary(): string {
    try {
      return fs.readFileSync(this.resolve(EXCALIDRAW_LIBRARY_FILE), "utf8");
    } catch {
      return "";
    }
  }

  writeExcalidrawLibrary(content: string): void {
    JSON.parse(content); // must be valid JSON
    this.excalidrawLibHash = hashContent(content);
    writeFileAtomic(this.resolve(EXCALIDRAW_LIBRARY_FILE), content);
  }

  // ---------- editing ----------

  private uniquePath(dir: string, base: string, ext: string): string {
    let candidate = path.join(dir, `${base}${ext}`);
    for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(dir, `${base} ${n}${ext}`);
    return candidate;
  }

  saveStencil(req: SaveStencilRequest): string {
    const dir = this.resolve(safeSegment(req.collection || MY_STENCILS));
    fs.mkdirSync(dir, { recursive: true });
    const name = req.name.trim() || "Stencil";
    const file = this.uniquePath(dir, safeSegment(name), ".stencil.json");
    const content: StencilFile = {
      type: "mydraw-stencil",
      version: 1,
      name,
      tags: req.tags.map((t) => t.trim()).filter(Boolean),
      elements: req.elements,
      files: req.files,
    };
    writeFileAtomic(file, JSON.stringify(content));
    this.rescan();
    return this.rel(file);
  }

  /** Copy SVG/PNG/.excalidrawlib files or whole folders into the library. Returns the number of files added. */
  importPaths(paths: string[], collection?: string): number {
    let added = 0;
    for (const p of paths) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(p);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const target = this.resolve(safeSegment(collection ?? path.basename(p)));
        added += this.copyTree(p, target, 0);
      } else {
        const ext = path.extname(p).toLowerCase();
        if (!IMPORT_EXTENSIONS.has(ext) || stat.size > MAX_FILE_BYTES) continue;
        // An .excalidrawlib becomes its own collection unless a target collection was given.
        const dirName = collection ?? (ext === ".excalidrawlib" ? humanize(path.basename(p)) : MY_STENCILS);
        const dir = this.resolve(safeSegment(dirName));
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(p, this.uniquePath(dir, safeSegment(path.basename(p, ext)), ext));
        added++;
      }
    }
    if (added) this.rescan();
    return added;
  }

  private copyTree(src: string, dest: string, depth: number): number {
    if (depth > 6) return 0;
    let added = 0;
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const s = path.join(src, e.name);
      if (e.isDirectory()) {
        added += this.copyTree(s, path.join(dest, safeSegment(e.name)), depth + 1);
      } else if (e.isFile() && IMPORT_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        if (fs.statSync(s).size > MAX_FILE_BYTES) continue;
        fs.mkdirSync(dest, { recursive: true });
        const ext = path.extname(e.name);
        fs.copyFileSync(s, this.uniquePath(dest, safeSegment(path.basename(e.name, ext)), ext));
        added++;
      }
    }
    return added;
  }

  private findItem(id: string): LibraryItem {
    const item = this.getIndex().items.find((i) => i.id === id);
    if (!item) throw new Error(`stencil not found: ${id}`);
    return item;
  }

  rename(id: string, newName: string): void {
    const item = this.findItem(id);
    const name = newName.trim();
    if (!name) throw new Error("name is empty");
    const abs = this.resolve(item.file);
    if (item.kind === "stencil") {
      const data = JSON.parse(fs.readFileSync(abs, "utf8")) as StencilFile;
      data.name = name;
      writeFileAtomic(abs, JSON.stringify(data));
    } else if (item.kind === "xlib") {
      this.editExcalidrawLib(abs, (items) => {
        if (items[item.index!]) items[item.index!].name = name;
      });
    } else {
      const ext = path.extname(abs);
      fs.renameSync(abs, this.uniquePath(path.dirname(abs), safeSegment(name), ext));
    }
    this.rescan();
  }

  async remove(id: string): Promise<void> {
    const item = this.findItem(id);
    const abs = this.resolve(item.file);
    if (item.kind === "xlib") {
      this.editExcalidrawLib(abs, (items) => {
        items.splice(item.index!, 1);
      });
    } else {
      await shell.trashItem(abs);
    }
    this.rescan();
  }

  reveal(id: string): void {
    shell.showItemInFolder(this.resolve(this.findItem(id).file));
  }

  private editExcalidrawLib(abs: string, edit: (items: Array<{ name?: string }>) => void): void {
    const data = JSON.parse(fs.readFileSync(abs, "utf8"));
    const key = Array.isArray(data.libraryItems) ? "libraryItems" : "library";
    const items = data[key];
    if (!Array.isArray(items)) throw new Error("not an Excalidraw library file");
    edit(items);
    const content = JSON.stringify(data, null, 2);
    if (this.rel(abs) === EXCALIDRAW_LIBRARY_FILE) this.excalidrawLibHash = null; // let rescan push it to tabs
    writeFileAtomic(abs, content);
  }
}

function collectionOrder(name: string): number {
  if (name === MY_STENCILS) return 0;
  if (name === EXCALIDRAW_LIBRARY_COLLECTION) return 1;
  return 2;
}

function readStencilMeta(abs: string): { name: string; tags: string[] } {
  try {
    const d = JSON.parse(fs.readFileSync(abs, "utf8"));
    return {
      name: typeof d.name === "string" ? d.name : "",
      tags: Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === "string") : [],
    };
  } catch {
    return { name: "", tags: [] };
  }
}

/** Names of the items in an .excalidrawlib (v2 `libraryItems`, or v1 `library` arrays of elements). */
function readExcalidrawLibNames(abs: string): string[] {
  try {
    const d = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (Array.isArray(d.libraryItems)) return d.libraryItems.map((i: { name?: unknown }) => (typeof i?.name === "string" ? i.name : ""));
    if (Array.isArray(d.library)) return d.library.map(() => "");
  } catch {
    // ignore unreadable files
  }
  return [];
}
