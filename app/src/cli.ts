// `mydraw` CLI, Electron main process (bundled to app/dist/cli.cjs; started by bin/mydraw.mjs).
// Headless: a hidden window loads the normal web bundle with #headless (web/src/headless.tsx), which
// mounts one off-screen Excalidraw and runs the app's own export code. Uses a throw-away userData
// folder and no single-instance lock, so it never touches a running mydraw app or its settings.
// Arguments come in MYDRAW_CLI_ARGS (JSON array), so Chromium never parses them as switches.
import { BrowserWindow, app, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_EXPORT_EXTENSION, isPagedFormat } from "../../shared/agent";
import { CLI_USAGE, CliUsageError, defaultOutput, inputKind, parseCliArgs, type CliExport } from "../../shared/cli";
import { batchFileStems } from "../../shared/names";
import { APP_ORIGIN, registerSchemes, serveApp } from "./appProtocol";
import { registerPdfIpc } from "./pdf";
import { getStyleLibrary } from "./styles-store";

const TIMEOUT = 120_000;

app.dock?.hide();
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-cli-"));
app.setPath("userData", tmpUserData);
app.disableHardwareAcceleration();
registerSchemes();

const webRoot = path.resolve(__dirname, "..", "..", "web", "dist");
const cwd = process.env.MYDRAW_CLI_CWD || process.cwd();

/** Writes to a pipe are asynchronous on macOS: flush stdout and stderr before exiting. */
const flushed = (s: NodeJS.WriteStream) => new Promise<void>((r) => s.write("", () => r()));

async function finish(code: number): Promise<never> {
  try {
    fs.rmSync(tmpUserData, { recursive: true, force: true });
  } catch {
    // best effort
  }
  await Promise.race([Promise.all([flushed(process.stdout), flushed(process.stderr)]), new Promise((r) => setTimeout(r, 5000))]);
  app.exit(code);
  process.exit(code);
}

function argv(): string[] {
  try {
    const v = JSON.parse(process.env.MYDRAW_CLI_ARGS ?? "[]");
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  } catch {
    // fall through
  }
  throw new CliUsageError("bad MYDRAW_CLI_ARGS (run through bin/mydraw.mjs)");
}

async function loadRunner(): Promise<BrowserWindow> {
  if (!fs.existsSync(path.join(webRoot, "index.html"))) throw new Error(`web bundle not found in ${webRoot}: run npm run build`);
  serveApp(webRoot);
  registerPdfIpc();
  // The renderer's style store asks for user presets on load (none here: temp userData).
  ipcMain.handle("styles:get", () => getStyleLibrary());
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  if (process.env.MYDRAW_CLI_DEBUG) {
    win.webContents.on("console-message", (e) => process.stderr.write(`[renderer] ${e.message}\n`));
  }
  await win.loadURL(`${APP_ORIGIN}/index.html#headless`);
  const start = Date.now();
  while (!(await win.webContents.executeJavaScript("!!window.__mydrawHeadless?.ready"))) {
    if (Date.now() - start > 30_000) throw new Error("the headless renderer did not start");
    await new Promise((r) => setTimeout(r, 50));
  }
  return win;
}

/** True if `a` names the existing file `b` (case-insensitive volumes, symlinks, hard links). */
function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false; // target does not exist yet
  }
}

async function exportCommand(cmd: CliExport): Promise<void> {
  const input = path.resolve(cwd, cmd.input);
  const kind = inputKind(input);
  if (!kind) throw new CliUsageError(`unsupported input "${cmd.input}" (use .excalidraw or .drawio)`);
  if (!fs.existsSync(input)) throw new Error(`no such file: ${input}`);
  const content = fs.readFileSync(input, "utf8");

  const ext = AGENT_EXPORT_EXTENSION[cmd.format];
  const batch = cmd.scope === "frames" && !isPagedFormat(cmd.format) && cmd.format !== "excalidraw";
  const target = path.resolve(cwd, cmd.output ?? defaultOutput(input, ext, batch));
  if (sameFile(target, input)) throw new Error(`refusing to overwrite the input file ${input} (give -o)`);

  const win = await loadRunner();
  const job = { ...cmd, inputKind: kind, content };
  const result = (await Promise.race([
    win.webContents.executeJavaScript(`window.__mydrawHeadless.run(${JSON.stringify(job)})`),
    new Promise((_, rej) => setTimeout(() => rej(new Error("export timed out")), TIMEOUT)),
  ])) as { files: { name: string | null; extension: string; base64?: string; text?: string }[]; warnings: string[]; pages?: number };

  const bytes = (f: (typeof result.files)[number]) => (f.text !== undefined ? Buffer.from(f.text, "utf8") : Buffer.from(f.base64 ?? "", "base64"));
  const written: string[] = [];
  if (batch) {
    fs.mkdirSync(target, { recursive: true });
    const stems = batchFileStems(result.files.map((f) => f.name ?? "frame"));
    result.files.forEach((f, i) => {
      const file = path.join(target, `${stems[i]}.${f.extension}`);
      fs.writeFileSync(file, bytes(f));
      written.push(file);
    });
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes(result.files[0]));
    written.push(target);
  }
  for (const w of result.warnings) process.stderr.write(`mydraw: warning: ${w}\n`);
  if (!cmd.quiet) {
    const pages = result.pages !== undefined && isPagedFormat(cmd.format) ? ` (${result.pages} ${cmd.format === "pptx" ? "slide" : "page"}${result.pages === 1 ? "" : "s"})` : "";
    for (const w of written) process.stdout.write(`${path.relative(cwd, w) || w}${pages}\n`);
  }
}

async function main(): Promise<void> {
  let cmd;
  try {
    cmd = parseCliArgs(argv());
  } catch (e) {
    process.stderr.write(`mydraw: ${(e as Error).message}\n\n${CLI_USAGE}\n`);
    return finish(2);
  }
  if (cmd.command === "help") {
    process.stdout.write(`${CLI_USAGE}\n`);
    return finish(0);
  }
  await app.whenReady();
  let code = 0;
  try {
    await exportCommand(cmd);
  } catch (e) {
    process.stderr.write(`mydraw: ${(e as Error).message}\n`);
    code = e instanceof CliUsageError ? 2 : 1;
  }
  return finish(code);
}

app.on("window-all-closed", () => {
  // keep running until main() finishes
});
void main();
