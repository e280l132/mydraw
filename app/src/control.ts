// Local control server for agents (the mydraw MCP server). Loopback only, random port, random key.
//   POST /rpc   Authorization: Bearer <key>   {"method": "...", "params": {...}}
// The port and key are written to <userData>/control.json with mode 600, so only this user's
// processes can read them. Requests from browsers are refused (any Origin header, or a Host that
// isn't the loopback address), which blocks CSRF and DNS-rebinding attacks from web pages.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { ControlInfo, RpcRequest, RpcResponse } from "../../shared/agent";

export const MAX_BODY = 64 * 1024 * 1024;

export type RpcHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export interface ControlServer {
  port: number;
  key: string;
  close(): Promise<void>;
}

function keysEqual(given: string, key: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

export function startControlServer(handler: RpcHandler, key = crypto.randomBytes(32).toString("hex")): Promise<ControlServer> {
  let port = 0;
  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? "";
    if (req.headers.origin !== undefined || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
      return send(res, 403, { ok: false, error: "forbidden" });
    }
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!given || !keysEqual(given, key)) return send(res, 401, { ok: false, error: "bad or missing key" });
    if (req.method !== "POST" || req.url !== "/rpc") return send(res, 404, { ok: false, error: "not found" });

    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        tooBig = true;
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("error", () => undefined);
    req.on("end", () => {
      if (tooBig) return;
      let rpc: RpcRequest;
      try {
        rpc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!rpc || typeof rpc.method !== "string") throw new Error("method missing");
      } catch (e) {
        return send(res, 400, { ok: false, error: `bad request: ${(e as Error).message}` });
      }
      const params = rpc.params && typeof rpc.params === "object" && !Array.isArray(rpc.params) ? rpc.params : {};
      handler(rpc.method, params).then(
        (result) => send(res, 200, { ok: true, result: result ?? null } satisfies RpcResponse),
        (err: unknown) =>
          send(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) } satisfies RpcResponse),
      );
    });
    req.on("close", () => {
      if (tooBig && !res.headersSent) res.destroy();
    });
  });
  server.requestTimeout = 0; // long commands (exports) are bounded by the dispatcher's own timeout

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        port,
        key,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Write control.json readable only by this user. */
export function writeControlFile(file: string, info: ControlInfo): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(info), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/** Remove control.json if it still belongs to this app instance. */
export function removeControlFile(file: string, key: string): void {
  try {
    const info = JSON.parse(fs.readFileSync(file, "utf8")) as ControlInfo;
    if (info.key === key) fs.unlinkSync(file);
  } catch {
    // already gone or unreadable
  }
}
