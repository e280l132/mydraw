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

/** Formats the `export` tool can write in Phase 2 (more in Phase 6). */
export const AGENT_EXPORT_FORMATS = ["png", "jpg", "svg", "excalidraw"] as const;
export type AgentExportFormat = (typeof AGENT_EXPORT_FORMATS)[number];

export function exportFormatForPath(p: string): AgentExportFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === "jpeg") return "jpg";
  return (AGENT_EXPORT_FORMATS as readonly string[]).includes(ext) ? (ext as AgentExportFormat) : null;
}
