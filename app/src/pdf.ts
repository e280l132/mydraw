// PDF rendering: the renderer builds an HTML page of SVGs with CSS page sizes (shared/pdfLayout.ts);
// here it is loaded into a hidden, offscreen-style window with JavaScript off and every network
// request blocked, and printed with printToPDF (vector output). Used by the app and the CLI.
import { BrowserWindow, ipcMain, session } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_HTML = 256 * 1024 * 1024;
const PARTITION = "mydraw-pdf";
let sessionReady = false;

function pdfSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION);
  if (!sessionReady) {
    // Only the temp HTML file itself and data: URLs (embedded fonts/images) may load.
    ses.webRequest.onBeforeRequest((details, cb) => {
      const ok = details.url.startsWith("data:") || (details.url.startsWith("file://") && details.url.includes("/mydraw-pdf-"));
      cb({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    sessionReady = true;
  }
  return ses;
}

export async function printHtmlToPdf(html: string): Promise<Buffer> {
  if (typeof html !== "string" || !html.startsWith("<!doctype html>")) throw new Error("invalid PDF document");
  if (html.length > MAX_HTML) throw new Error("drawing too large for PDF export");
  // A file, not a data: URL: data URLs are capped at 2 MB and drawings with images are bigger.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-pdf-"));
  const file = path.join(dir, "page.html");
  fs.writeFileSync(file, html);
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, session: pdfSession(), spellcheck: false },
  });
  try {
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    await win.loadURL(pathToFileURL(file).toString());
    return await win.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
  } finally {
    win.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** IPC `pdf:print` (bridge `printPdf`): HTML in, PDF bytes out. Nothing is written to user paths. */
export function registerPdfIpc(): void {
  ipcMain.handle("pdf:print", async (_e, html: unknown) => {
    if (typeof html !== "string") throw new Error("html must be a string");
    return new Uint8Array(await printHtmlToPdf(html));
  });
}
