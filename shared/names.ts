/** Display title for a drawing: file name without the `.excalidraw` extension. */
export function titleFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return base.replace(/\.excalidraw(\.json)?$/i, "") || base;
}

/** Make a title safe to use as a default file name. */
export function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim();
  return cleaned || "drawing";
}

export function ensureExtension(filePath: string, ext: string): string {
  return filePath.toLowerCase().endsWith(`.${ext}`) ? filePath : `${filePath}.${ext}`;
}
