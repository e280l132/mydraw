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
  | { type: "selectTab"; index: number };

export interface MydrawBridge {
  platform: string;
  isTest: boolean;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  openDialog(): Promise<OpenedFile[]>;
  /** Files passed on the command line or via Finder before the UI was ready. */
  takePendingFiles(): Promise<OpenedFile[]>;
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
}
