// `mydraw` command line: argument parsing (pure, unit-tested). Rendering happens in a hidden
// Electron window (app/src/cli.ts + web/src/headless.tsx).
import { AGENT_EXPORT_FORMATS, exportFormatForPath, type AgentExportFormat } from "./agent";
import { siblingPath } from "./names";
import { PDF_PAGE_SIZES, SLIDE_SIZES, type PdfPageSize, type SlideSize } from "./pdfLayout";

export const CLI_USAGE = `mydraw: export and convert drawings without opening the app

Usage:
  mydraw export <drawing> [options]          render a .excalidraw (or .drawio) file
  mydraw convert <drawing> --to <format>     same, the format named explicitly
  mydraw mcp                                  run the MCP server for Claude Code (stdio)
  mydraw --version                           print the version
  mydraw help

Formats: ${AGENT_EXPORT_FORMATS.join(", ")}

Options:
  -o, --output <path>     output file (default: next to the input, new extension);
                          a folder for --scope frames with one-file-per-frame formats
  -f, --format <format>   output format (default: from --output, else png); --to is the same
  --frame <name|id>       export one frame (implies --scope frame)
  --scope <all|frame|frames>
                          frames: every frame; pdf/pptx/drawio get one page/slide each in one
                          file, other formats one file per frame
  --padding <px>          space around the content (default 20)
  --scale <1-4>           pixel scale for png/jpg/webp/pptx (default 2)
  --dark                  dark mode
  --no-background         transparent background (png/webp/svg)
  --background <color>    canvas color, e.g. #ffffff
  --quality <0.1-1>       jpg/webp quality (default 0.92)
  --embed-scene           embed the editable drawing in png/svg
  --page <fit|a4|letter>  pdf page size (default fit: page = drawing size)
  --actual-size           pdf on a4/letter at 100%, over several sheets if needed
  --slides <16:9|4:3>     pptx slide size (default 16:9)
  -q, --quiet             print nothing but errors

Inputs: .excalidraw (also .json) and .drawio/.xml (draw.io; best effort, skipped parts are
reported). Runs headless: no window, the mydraw app does not need to be running.`;

export interface CliExport {
  command: "export";
  input: string;
  output: string | null;
  format: AgentExportFormat;
  scope: "all" | "frame" | "frames";
  frame?: string;
  padding?: number;
  scale?: 1 | 2 | 3 | 4;
  darkMode: boolean;
  background: boolean;
  backgroundColor?: string;
  quality?: number;
  embedScene: boolean;
  pageSize?: PdfPageSize;
  actualSize: boolean;
  slideSize?: SlideSize;
  quiet: boolean;
}

export type CliCommand = { command: "help" } | { command: "version" } | CliExport;

export class CliUsageError extends Error {}

const VALUE_OPTS = new Set(["-o", "--output", "-f", "--format", "--to", "--frame", "--scope", "--padding", "--scale", "--background", "--quality", "--page", "--slides"]);

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const args = [...argv];
  const cmd = args.shift();
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return { command: "help" };
  if (cmd === "version" || cmd === "--version" || cmd === "-v") return { command: "version" };
  if (cmd !== "export" && cmd !== "convert") throw new CliUsageError(`unknown command "${cmd}" (use export, convert or mcp)`);

  const pos: string[] = [];
  const opt: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    if (a === "--help" || a === "-h") return { command: "help" };
    if (!a.startsWith("-") || a === "-") {
      pos.push(a);
      continue;
    }
    let value: string | undefined;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      value = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (VALUE_OPTS.has(a)) {
      if (value === undefined) {
        value = args[++i];
        if (value === undefined) throw new CliUsageError(`${a} needs a value`);
      }
      const key = a === "-o" ? "--output" : a === "-f" || a === "--to" ? "--format" : a;
      if (key in opt && opt[key] !== value) throw new CliUsageError(`${a} given twice`);
      opt[key] = value;
    } else if (["--dark", "--no-background", "--embed-scene", "--actual-size", "-q", "--quiet"].includes(a)) {
      if (value !== undefined) throw new CliUsageError(`${a} takes no value`);
      flags.add(a === "-q" ? "--quiet" : a);
    } else {
      throw new CliUsageError(`unknown option ${a}`);
    }
  }
  if (pos.length !== 1) throw new CliUsageError(pos.length ? `one input file expected, got ${pos.length}` : "no input file");
  if (cmd === "convert" && !opt["--format"]) throw new CliUsageError("convert needs --to <format>");

  const output = opt["--output"] ?? null;
  let format: AgentExportFormat | null = null;
  if (opt["--format"]) {
    const f = opt["--format"].toLowerCase();
    format = (AGENT_EXPORT_FORMATS as readonly string[]).includes(f) ? (f as AgentExportFormat) : exportFormatForPath(`x.${f}`);
    if (!format) throw new CliUsageError(`unknown format "${opt["--format"]}" (formats: ${AGENT_EXPORT_FORMATS.join(", ")})`);
  } else if (output) {
    format = exportFormatForPath(output);
  }

  let scope = (opt["--scope"] ?? (opt["--frame"] ? "frame" : "all")) as CliExport["scope"];
  if (!["all", "frame", "frames"].includes(scope)) throw new CliUsageError("--scope must be all, frame or frames");
  // An output file name with an extension we can't write is a mistake, not a request for PNG.
  // (With --scope frames the output may be a folder, whose name can contain a dot.)
  const outExt = output ? /\.([^./\\]+)$/.exec(output)?.[1] : undefined;
  if (!format && outExt && scope !== "frames") {
    throw new CliUsageError(`can't tell the format from ".${outExt}" (give --format; formats: ${AGENT_EXPORT_FORMATS.join(", ")})`);
  }
  format ??= "png";
  if (scope === "frame" && !opt["--frame"]) throw new CliUsageError("--scope frame needs --frame <name>");
  if (opt["--frame"] && scope !== "frame") throw new CliUsageError("--frame only goes with --scope frame");
  if (format === "excalidraw" && scope !== "all") throw new CliUsageError("excalidraw output is always the whole drawing");

  const number = (name: string, min: number, max: number): number | undefined => {
    const v = opt[name];
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new CliUsageError(`${name} must be a number from ${min} to ${max}`);
    return n;
  };
  const scale = number("--scale", 1, 4);
  if (scale !== undefined && !Number.isInteger(scale)) throw new CliUsageError("--scale must be 1, 2, 3 or 4");
  const page = opt["--page"];
  if (page !== undefined && !(PDF_PAGE_SIZES as readonly string[]).includes(page)) throw new CliUsageError("--page must be fit, a4 or letter");
  if (flags.has("--actual-size") && (page ?? "fit") === "fit") throw new CliUsageError("--actual-size needs --page a4 or letter");
  const slides = opt["--slides"];
  if (slides !== undefined && !Object.hasOwn(SLIDE_SIZES, slides)) throw new CliUsageError("--slides must be 16:9 or 4:3");
  const bg = opt["--background"];
  if (bg !== undefined && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(bg)) throw new CliUsageError("--background must be a hex color like #ffffff");
  if (bg !== undefined && flags.has("--no-background")) throw new CliUsageError("--background and --no-background conflict");

  return {
    command: "export",
    input: pos[0],
    output,
    format,
    scope,
    frame: opt["--frame"],
    padding: number("--padding", 0, 500),
    scale: scale as CliExport["scale"],
    darkMode: flags.has("--dark"),
    background: !flags.has("--no-background"),
    backgroundColor: bg,
    quality: number("--quality", 0.1, 1),
    embedScene: flags.has("--embed-scene"),
    pageSize: page as PdfPageSize | undefined,
    actualSize: flags.has("--actual-size"),
    slideSize: slides as SlideSize | undefined,
    quiet: flags.has("--quiet"),
  };
}

/**
 * Where to write: `output` if given, else next to the input with the format's extension; for a
 * one-file-per-frame batch, a folder named after the input.
 */
export function defaultOutput(input: string, ext: string, batch: boolean): string {
  return batch ? siblingPath(input, "frames").replace(/\.frames$/, "-frames") : siblingPath(input, ext);
}

/** Input kind from the file name. */
export function inputKind(p: string): "excalidraw" | "drawio" | null {
  if (/\.(excalidraw|json)$/i.test(p)) return "excalidraw";
  if (/\.(drawio|xml|dio)$/i.test(p)) return "drawio";
  return null;
}
