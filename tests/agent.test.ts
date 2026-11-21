import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeControlFile, startControlServer, writeControlFile, type ControlServer } from "../app/src/control";
import { exportFormatForPath } from "../shared/agent";
import { connectorEndpoints, outlinePoint, placeBeside } from "../shared/geometry";

function request(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method ?? "POST", path: opts.path ?? "/rpc", headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString() || "null") }));
      },
    );
    req.on("error", reject);
    req.end(opts.body);
  });
}

describe("control server", () => {
  let server: ControlServer;
  const calls: [string, unknown][] = [];
  beforeAll(async () => {
    server = await startControlServer(async (method, params) => {
      calls.push([method, params]);
      if (method === "boom") throw new Error("kaput");
      return { echo: params };
    });
  });
  afterAll(() => server.close());

  const auth = () => ({ Authorization: `Bearer ${server.key}`, "Content-Type": "application/json" });

  it("runs a method with the right key", async () => {
    const r = await request(server.port, { headers: auth(), body: JSON.stringify({ method: "ping", params: { a: 1 } }) });
    expect(r).toEqual({ status: 200, body: { ok: true, result: { echo: { a: 1 } } } });
  });

  it("reports handler errors", async () => {
    const r = await request(server.port, { headers: auth(), body: JSON.stringify({ method: "boom" }) });
    expect(r.body).toEqual({ ok: false, error: "kaput" });
  });

  it("refuses a missing or wrong key", async () => {
    const before = calls.length;
    expect((await request(server.port, { body: JSON.stringify({ method: "ping" }) })).status).toBe(401);
    const wrong = { Authorization: `Bearer ${"0".repeat(server.key.length)}` };
    expect((await request(server.port, { headers: wrong, body: JSON.stringify({ method: "ping" }) })).status).toBe(401);
    expect(calls.length).toBe(before);
  });

  it("refuses browser requests (Origin header, foreign Host)", async () => {
    const before = calls.length;
    const fromPage = { ...auth(), Origin: "https://evil.example" };
    expect((await request(server.port, { headers: fromPage, body: "{}" })).status).toBe(403);
    const rebound = { ...auth(), Host: `evil.example:${server.port}` };
    expect((await request(server.port, { headers: rebound, body: "{}" })).status).toBe(403);
    expect(calls.length).toBe(before);
  });

  it("rejects other paths and bad JSON", async () => {
    expect((await request(server.port, { path: "/x", headers: auth(), body: "{}" })).status).toBe(404);
    expect((await request(server.port, { method: "GET", headers: auth() })).status).toBe(404);
    expect((await request(server.port, { headers: auth(), body: "{not json" })).status).toBe(400);
  });

  it("writes control.json private to the user and removes only its own", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mydraw-ctl-"));
    const file = path.join(dir, "control.json");
    writeControlFile(file, { port: 1, key: "k1", pid: 1, version: "0" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    removeControlFile(file, "other");
    expect(fs.existsSync(file)).toBe(true);
    removeControlFile(file, "k1");
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe("exportFormatForPath", () => {
  it("maps extensions", () => {
    expect(exportFormatForPath("/a/b.PNG")).toBe("png");
    expect(exportFormatForPath("/a/b.jpeg")).toBe("jpg");
    expect(exportFormatForPath("/a/b.excalidraw")).toBe("excalidraw");
    expect(exportFormatForPath("/a/b.pdf")).toBe("pdf");
    expect(exportFormatForPath("/a/b.gif")).toBeNull();
    expect(exportFormatForPath("/a/b")).toBeNull();
  });
});

describe("geometry", () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };
  it("finds the outline of a rectangle, ellipse and diamond", () => {
    expect(outlinePoint(box, "rectangle", { x: 500, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(outlinePoint(box, "rectangle", { x: 50, y: -500 })).toEqual({ x: 50, y: 0 });
    const e = outlinePoint(box, "ellipse", { x: 100, y: 50 });
    expect(((e.x - 50) / 50) ** 2 + ((e.y - 25) / 25) ** 2).toBeCloseTo(1);
    const d = outlinePoint(box, "diamond", { x: 100, y: 50 });
    expect(Math.abs(d.x - 50) / 50 + Math.abs(d.y - 25) / 25).toBeCloseTo(1);
    expect(outlinePoint(box, "rectangle", { x: 500, y: 25 }, 4)).toEqual({ x: 104, y: 25 });
    expect(outlinePoint(box, "rectangle", { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });

  it("connects two boxes edge to edge", () => {
    const { start, end } = connectorEndpoints(
      { box, shape: "rectangle" },
      { box: { x: 300, y: 0, width: 100, height: 50 }, shape: "rectangle" },
      4,
    );
    expect(start).toEqual({ x: 104, y: 25 });
    expect(end).toEqual({ x: 296, y: 25 });
  });

  it("places content beside a reference with anchors aligned", () => {
    const content = { x: 0, y: 0, width: 64, height: 90 }; // icon + label
    const anchor = { x: 0, y: 0, width: 64, height: 64 }; // icon
    const ref = { x: 200, y: 100, width: 100, height: 60 };
    expect(placeBeside(content, anchor, ref, ref, "right_of", 80)).toEqual({ dx: 380, dy: 98 });
    expect(placeBeside(content, anchor, ref, ref, "left_of", 80)).toEqual({ dx: 56, dy: 98 });
    expect(placeBeside(content, anchor, ref, ref, "below", 40)).toEqual({ dx: 218, dy: 200 });
    expect(placeBeside(content, anchor, ref, ref, "above", 40)).toEqual({ dx: 218, dy: -30 });
  });
});
