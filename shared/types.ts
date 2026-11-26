import type { AgentCommand, AgentReply } from "./agent";
import type { EmbeddedFonts, FontCategory, FontEntry } from "./fonts";
import type { LibraryIndex } from "./library";
import type { GridSettings } from "./grid";
import type { QuickConnectSettings } from "./quickBindings";
import type { CaptionFontMode, IconSketchLook, IconStyleSetting } from "./iconSketch";
import type { UpdateAction, UpdateStatus } from "./update";
import type { SetupAction, SetupStatus } from "./setup";

// Types shared by the Electron main process, the preload bridge and the renderer.

export type ThemeSetting = "system" | "light" | "dark";
export type DrawingStyle = "clean" | "sketch";

export interface Settings {
  theme: ThemeSetting;
  /** Default element style (roughness, font, edges) applied to every drawing. */
  drawingStyle: DrawingStyle;
  /** Save file-backed drawings to disk automatically after edits. */
  autosave: boolean;
  /** Most recent first, absolute paths. */
  recentFiles: string[];
  /** Stencil library folder; null means the default (~/Documents/mydraw/Library). */
  libraryPath: string | null;
  /** Per file (absolute path): also write a PNG or SVG next to the .excalidraw file on every save. */
  autoExport: Record<string, "png" | "svg">;
  /** Quick connect: which modifier + click does what, and the link-mode keys (see shared/quickBindings.ts). */
  quickConnect: QuickConnectSettings;
  /** Layout grid overlay (see shared/grid.ts). Global, not per drawing. */
  grid: GridSettings;
  /** Order of the properties panel sections, top first (see shared/panelOrder.ts). Empty = native order. */
  panelOrder: string[];
  /** New stencils/icons: hand-drawn in Sketch ("auto"), always original, or always hand-drawn. */
  iconStyle: IconStyleSetting;
  /** How new hand-drawn icons are drawn (seed fixed at 1, so an icon looks the same every time). */
  iconSketch: IconSketchLook;
  /** Font of the name under inserted icons (see shared/iconSketch.ts captionFontName). */
  captionFont: CaptionFontMode;
  /** The hand font captions use ("Excalifont", "Caveat", ...). */
  captionHandFont: string;
  /** In-app updates (app/src/updater.ts): automatic daily check, last check time, a version the user skipped. */
  updates: UpdateSettings;
  /** The "Set up mydraw" window was shown once (installed app, first launch). */
  setupShown: boolean;
}

export interface UpdateSettings {
  check: boolean;
  /** ms since epoch; 0 = never. */
  lastCheck: number;
  skipped: string | null;
}

/** What an import built (see shared/importers.ts). */
export interface ImportSummary {
  nodes?: number;
  edges?: number;
  warnings: string[];
}

/** Outcome of following a drill-down link (see shared/links.ts). */
export type LinkResult = { type: "opened"; files: OpenedFile[] } | { type: "external" } | { type: "error"; message: string };

export interface OpenedFile {
  path: string;
  content: string;
}

export interface RecoveryEntry {
  tabId: string;
  /** Path of the file the tab was backed by, or null for an untitled drawing. */
  filePath: string | null;
  title: string;
  content: string;
  savedAt: number;
}

/** A font of the download catalog (Google Fonts via Fontsource; see app/src/fonts.ts). */
export interface CatalogFont {
  id: string;
  family: string;
  category: FontCategory;
  /** The catalog's own category: sans-serif, serif, display, handwriting, monospace. */
  style: string;
  weights: number[];
  license: string;
}

export interface PackStatus {
  id: string;
  title: string;
  description: string;
  approxMB: number;
  license: string;
  installed: boolean;
}

export interface SaveStencilPayload {
  collection: string;
  name: string;
  tags: string[];
  elements: unknown[];
  files: Record<string, unknown>;
}

export type UnsavedChoice = "save" | "discard" | "cancel";

export type ExportExtension = "png" | "jpg" | "webp" | "svg" | "html" | "pdf" | "pptx" | "drawio" | "mmd" | "csv" | "md" | "excalidrawlib";

export interface ExportFileRequest {
  defaultName: string;
  extension: ExportExtension;
  data: ArrayBuffer | string;
}

/** One file per frame: the user picks a folder, files are named after the frames. */
export interface ExportFilesRequest {
  files: { name: string; extension: ExportExtension; data: ArrayBuffer | string }[];
}

export interface AutoExportRequest {
  /** The .excalidraw file the image belongs to (must have been opened or saved by the user). */
  path: string;
  extension: "png" | "svg";
  data: ArrayBuffer | string;
}

export interface ClipboardRequest {
  text?: string;
  png?: ArrayBuffer;
}

/** Commands sent from native menus to the renderer. */
export type MenuCommand =
  | { type: "new" }
  | { type: "open" }
  | { type: "save" }
  | { type: "saveAs" }
  | { type: "export" }
  | { type: "copyAs"; format: "png" | "svg" | "mermaid" }
  | { type: "closeTab" }
  | { type: "nextTab" }
  | { type: "prevTab" }
  | { type: "selectTab"; index: number }
  // In-app menu only:
  | { type: "openRecent"; path: string }
  | { type: "clearRecent" }
  | { type: "toggleStencils" }
  | { type: "saveStencil" }
  | { type: "quickSaveStencil" }
  | { type: "copyLook" }
  | { type: "pasteLook" }
  | { type: "commandPalette" }
  | { type: "findReplace" }
  | { type: "togglePages" }
  | { type: "toggleLint" }
  | { type: "togglePinPanel" }
  | { type: "inventory" }
  | { type: "help" }
  | { type: "importText" }
  | { type: "quickConnectSettings" }
  | { type: "fonts" }
  | { type: "toggleBold" }
  | { type: "toggleItalic" }
  | { type: "toggleGrid" }
  | { type: "gridSettings" }
  | { type: "snapToGrid" }
  | { type: "tidyLayout" }
  | { type: "relayout" }
  | { type: "versionHistory" }
  | { type: "present" }
  | { type: "checkUpdates" }
  | { type: "setup" };

export interface MydrawBridge {
  platform: string;
  isTest: boolean;
  /** In-app updates (app/src/updater.ts): the current state, changes, and the banner's buttons. */
  getUpdateStatus(): Promise<UpdateStatus>;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
  updateAction(action: UpdateAction): Promise<UpdateStatus>;
  /** The close flow stopped (unsaved changes kept): an update restart is called off. */
  closeCancelled(): void;
  /** "Set up mydraw" (app/src/setup.ts): where the app runs, the `mydraw` command, Claude Code. */
  setupStatus(): Promise<SetupStatus>;
  setupAction(action: SetupAction): Promise<SetupStatus>;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  /** The user's saved style presets and themes (global, shared by every drawing). */
  getStyleLibrary(): Promise<import("./styles").StyleLibrary>;
  saveStyleLibrary(lib: import("./styles").StyleLibrary): Promise<import("./styles").StyleLibrary>;
  openDialog(): Promise<OpenedFile[]>;
  /** Files passed on the command line or via Finder before the UI was ready. */
  takePendingFiles(): Promise<OpenedFile[]>;
  /** Follow a shape's `link`: opens a web address in the browser or a .excalidraw drawing as a tab. `baseFile` = the drawing holding the link. */
  openLink(link: string, baseFile: string | null): Promise<LinkResult>;
  /** Enter or leave the window's full-screen mode (presentation mode). */
  setFullScreen(on: boolean): void;
  /** The window left full screen by itself (the user did it): end the presentation. */
  onPresentationEnded(cb: () => void): () => void;
  /** Ask for a drawing to link to; returns its absolute path (nothing is opened). */
  pickDrawingForLink(): Promise<string | null>;
  /** Build a diagram from CSV / YAML / Mermaid text in the active drawing (same as the MCP `import_diagram`). */
  importDiagram(req: { format: "csv" | "yaml" | "mermaid"; text: string }): Promise<ImportSummary>;
  /** Ask for a CSV / YAML / Mermaid file; returns its text, or null if cancelled. */
  pickImportFile(): Promise<{ name: string; format: "csv" | "yaml" | "mermaid" | null; text: string } | null>;
  /** Open a file from the recent list; missing files are dropped from the list. */
  openRecent(path: string): Promise<OpenedFile[]>;
  clearRecent(): Promise<void>;
  /** `auto` = an autosave (snapshots are throttled for those). */
  saveFile(path: string, content: string, auto?: boolean): Promise<void>;
  /** Version history of a saved drawing, newest first. */
  listSnapshots(path: string): Promise<import("./snapshots").SnapshotInfo[]>;
  readSnapshot(path: string, id: string): Promise<string>;
  /** Snapshot `content` now (e.g. before restoring an older version). Returns false if it matches the newest snapshot. */
  addSnapshot(path: string, content: string): Promise<boolean>;
  saveFileAs(defaultName: string, content: string): Promise<string | null>;
  exportFile(req: ExportFileRequest): Promise<string | null>;
  /** Batch export (every frame): asks for a folder, returns the written paths or null if cancelled. */
  exportFiles(req: ExportFilesRequest): Promise<string[] | null>;
  /** Write the image next to the saved drawing (auto-export on save). Returns the path written. */
  autoExportFile(req: AutoExportRequest): Promise<string>;
  copyToClipboard(req: ClipboardRequest): Promise<void>;
  /** Print an HTML document (built by shared/pdfLayout.ts) to PDF in a hidden window; returns the PDF. */
  printPdf(html: string): Promise<Uint8Array>;
  writeFileForTest(path: string, data: ArrayBuffer | string): Promise<void>;
  writeRecovery(entry: RecoveryEntry): Promise<void>;
  deleteRecovery(tabId: string): Promise<void>;
  listRecovery(): Promise<RecoveryEntry[]>;
  watchFile(path: string): Promise<void>;
  unwatchFile(path: string): Promise<void>;
  askUnsaved(titles: string[]): Promise<UnsavedChoice>;
  setWindowState(state: { title: string; edited: boolean }): void;
  readyToClose(): void;
  onMenu(cb: (cmd: MenuCommand) => void): () => void;
  onOpenFiles(cb: (files: OpenedFile[]) => void): () => void;
  onFileChangedOnDisk(cb: (file: OpenedFile) => void): () => void;
  onSettingsChanged(cb: (s: Settings) => void): () => void;
  onBeforeClose(cb: () => void): () => void;

  // ----- stencil library -----
  libraryIndex(): Promise<LibraryIndex>;
  librarySetFavorite(id: string, favorite: boolean): Promise<void>;
  libraryMarkUsed(id: string): Promise<void>;
  librarySaveStencil(payload: SaveStencilPayload): Promise<string>;
  libraryImport(paths: string[], collection?: string): Promise<number>;
  libraryImportDialog(): Promise<number>;
  libraryRename(id: string, name: string): Promise<void>;
  libraryRemove(id: string): Promise<void>;
  libraryReveal(id: string): Promise<void>;
  libraryOpenFolder(): Promise<void>;
  libraryChooseFolder(): Promise<string | null>;
  libraryPacks(): Promise<PackStatus[]>;
  libraryInstallPacks(ids: string[]): Promise<Array<{ pack: string; ok: boolean; count?: number; error?: string }>>;
  /** Delete an installed icon pack (only folders the downloader created). */
  libraryUninstallPack(id: string): Promise<void>;
  /** Absolute path of a dropped File (Finder drag). */
  pathForFile(file: File): string;
  onLibraryChanged(cb: (index: LibraryIndex) => void): () => void;
  onPackProgress(cb: (message: string) => void): () => void;

  // ----- fonts (app/src/fonts.ts) -----
  /** Fonts downloaded from the catalog or installed from a drawing. */
  fontsInstalled(): Promise<FontEntry[]>;
  fontCatalog(refresh?: boolean): Promise<CatalogFont[]>;
  /** Download weights (normal style) of a catalog font; returns the new entries. */
  fontInstall(id: string, weights: number[]): Promise<FontEntry[]>;
  /** Install fonts a drawing carries (EmbeddedFonts), so other drawings can use them. */
  fontInstallEmbedded(fonts: EmbeddedFonts): Promise<FontEntry[]>;
  /** Remove every installed weight of a typeface; returns the removed family names. */
  fontRemove(typeface: string): Promise<string[]>;

  // ----- agent control (MCP) -----
  onAgentCommand(cb: (cmd: AgentCommand) => void): () => void;
  agentReply(reply: AgentReply): void;
  /** Build a starter template (shared/templates.ts) in the active drawing; icons come from the library. */
  applyTemplate(name: string): Promise<void>;
}
