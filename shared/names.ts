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

/** `/a/b/net.excalidraw` -> `/a/b/net.png` (the image written by auto-export). */
export function siblingPath(filePath: string, ext: string): string {
  const stripped = filePath.replace(/\.excalidraw(\.json)?$/i, "");
  return `${stripped === filePath ? filePath.replace(/\.[^./\\]*$/, "") : stripped}.${ext}`;
}

/** File names (without extension) for a batch, one per frame: safe, and unique even if frame names repeat. */
export function batchFileStems(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = safeFileName(n);
    const key = base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count > 1 ? `${base} (${count})` : base;
  });
}
