import type { AgentCommand, AgentReply } from "./agent";
import type { LibraryIndex } from "./library";

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
}

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

export interface ExportFileRequest {
  defaultName: string;
  extension: "png" | "jpg" | "svg";
  data: ArrayBuffer | string;
}

/** Commands sent from native menus to the renderer. */
export type MenuCommand =
  | { type: "new" }
  | { type: "open" }
  | { type: "save" }
  | { type: "saveAs" }
  | { type: "export" }
  | { type: "closeTab" }
  | { type: "nextTab" }
  | { type: "prevTab" }
  | { type: "selectTab"; index: number }
  // In-app menu only:
  | { type: "openRecent"; path: string }
  | { type: "clearRecent" }
  | { type: "toggleStencils" }
  | { type: "saveStencil" };

export interface MydrawBridge {
  platform: string;
  isTest: boolean;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  openDialog(): Promise<OpenedFile[]>;
  /** Files passed on the command line or via Finder before the UI was ready. */
  takePendingFiles(): Promise<OpenedFile[]>;
  /** Open a file from the recent list; missing files are dropped from the list. */
  openRecent(path: string): Promise<OpenedFile[]>;
  clearRecent(): Promise<void>;
  saveFile(path: string, content: string): Promise<void>;
  saveFileAs(defaultName: string, content: string): Promise<string | null>;
  exportFile(req: ExportFileRequest): Promise<string | null>;
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
  /** Contents of the Excalidraw Library panel file (shared by all tabs); "" when empty. */
  excalidrawLibraryGet(): Promise<string>;
  excalidrawLibrarySave(content: string): Promise<void>;
  /** Absolute path of a dropped File (Finder drag). */
  pathForFile(file: File): string;
  onLibraryChanged(cb: (index: LibraryIndex) => void): () => void;
  onExcalidrawLibraryChanged(cb: (content: string) => void): () => void;
  onPackProgress(cb: (message: string) => void): () => void;

  // ----- agent control (MCP) -----
  onAgentCommand(cb: (cmd: AgentCommand) => void): () => void;
  agentReply(reply: AgentReply): void;
}
