// Agent control protocol: the MCP server talks to the app's control server (HTTP on 127.0.0.1),
// which runs some methods in the main process and forwards the rest to the renderer over IPC.

/** File written by the app on startup (chmod 600) so the MCP server can find and authenticate to it. */
export interface ControlInfo {
  port: number;
  key: string;
  pid: number;
  version: string;
}

export const CONTROL_FILE = "control.json";

export interface RpcRequest {
  method: string;
  params?: Record<string, unknown>;
}

export type RpcResponse = { ok: true; result: unknown } | { ok: false; error: string };

/** Command forwarded from the main process to the renderer. */
export interface AgentCommand {
  id: number;
  method: string;
  params: Record<string, unknown>;
  /** Epoch ms after which the main process no longer waits for the result. */
  deadline: number;
}

export type AgentReply = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/** Formats the `export` tool can write, and the file extension each gets by default. */
export const AGENT_EXPORT_FORMATS = ["png", "jpg", "webp", "svg", "html", "pdf", "pptx", "drawio", "mermaid", "csv", "markdown", "excalidraw"] as const;
export type AgentExportFormat = (typeof AGENT_EXPORT_FORMATS)[number];

export const AGENT_EXPORT_EXTENSION: Record<AgentExportFormat, string> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
  svg: "svg",
  html: "html",
  pdf: "pdf",
  pptx: "pptx",
  drawio: "drawio",
  mermaid: "mmd",
  csv: "csv",
  markdown: "md",
  excalidraw: "excalidraw",
};

export const AGENT_EXPORT_SCOPES = ["all", "selection", "frame", "frames"] as const;

/**
 * Formats with pages: with scope "frames" they write ONE file with a page (PDF), slide (PPTX) or
 * diagram page (draw.io) per frame, instead of one file per frame.
 */
export const PAGED_FORMATS = ["pdf", "pptx", "drawio"] as const;
export const isPagedFormat = (f: string): boolean => (PAGED_FORMATS as readonly string[]).includes(f);

/** Format implied by a file name (`.mmd`/`.mermaid` -> mermaid, `.md` -> markdown, `.jpeg` -> jpg). */
export function exportFormatForPath(p: string): AgentExportFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === "jpeg") return "jpg";
  if (ext === "mermaid") return "mermaid";
  if (ext === "htm") return "html";
  if (ext === "markdown") return "markdown";
  if (ext === "dio" || ext === "xml") return "drawio";
  return (Object.keys(AGENT_EXPORT_EXTENSION) as AgentExportFormat[]).find((f) => AGENT_EXPORT_EXTENSION[f] === ext) ?? null;
}
