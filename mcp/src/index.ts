#!/usr/bin/env node
// mydraw MCP server (stdio). Bridges Claude Code to the running mydraw app's local control server.
// Finds the app through <userData>/control.json (port + key) and launches the app if needed.
//   claude mcp add mydraw -- node ~/Projects/mydraw/mcp/dist/index.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { CONTROL_FILE, type ControlInfo, type RpcResponse } from "../../shared/agent";

const VERSION = "0.2.0";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const userData = process.env.MYDRAW_USER_DATA || path.join(os.homedir(), "Library", "Application Support", "mydraw");
const controlFile = path.join(userData, CONTROL_FILE);
const LAUNCH_TIMEOUT = 45_000;

// ---------- talking to the app ----------

class NotRunning extends Error {}

function readInfo(): ControlInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(controlFile, "utf8")) as ControlInfo;
    return typeof info.port === "number" && typeof info.key === "string" ? info : null;
  } catch {
    return null;
  }
}

function post(info: ControlInfo, method: string, params: Record<string, unknown>, timeout = 180_000): Promise<unknown> {
  const body = JSON.stringify({ method, params });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: info.port,
        path: "/rpc",
        method: "POST",
        headers: {
          Authorization: `Bearer ${info.key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          let parsed: RpcResponse;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            return reject(new Error(`bad response from mydraw (HTTP ${res.statusCode})`));
          }
          if (res.statusCode === 401) return reject(new NotRunning("stale control key"));
          if (parsed.ok) resolve(parsed.result);
          else reject(new Error(parsed.error));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} timed out`)));
    // Only a refused connection proves the command never ran; a reset may come after it ran, so
    // retrying then could apply it twice.
    req.on("error", (e: NodeJS.ErrnoException) => reject(e.code === "ECONNREFUSED" ? new NotRunning(e.message) : e));
    req.end(body);
  });
}

async function alive(info: ControlInfo | null): Promise<boolean> {
  if (!info) return false;
  try {
    const r = (await post(info, "ping", {}, 3000)) as { ready?: boolean };
    return !!r?.ready;
  } catch {
    return false;
  }
}

async function launchApp(): Promise<void> {
  if (process.env.MYDRAW_NO_LAUNCH === "1") throw new Error("mydraw is not running (auto-launch disabled)");
  const cleanEnv = { ...process.env };
  delete cleanEnv.MYDRAW_TEST;
  delete cleanEnv.MYDRAW_DEV_URL;
  delete cleanEnv.ELECTRON_RUN_AS_NODE;

  const appBundle = process.env.MYDRAW_APP || (fs.existsSync("/Applications/mydraw.app") ? "/Applications/mydraw.app" : "");
  if (appBundle) {
    spawn("open", ["-a", appBundle], { detached: true, stdio: "ignore", env: cleanEnv }).unref();
    return;
  }
  // Development checkout: run the built app with the branded Electron binary.
  if (!fs.existsSync(path.join(repoRoot, "app", "dist", "main.cjs")) || !fs.existsSync(path.join(repoRoot, "web", "dist", "index.html"))) {
    throw new Error(`mydraw is not running and is not built (run "npm run build" in ${repoRoot})`);
  }
  const launcher = pathToFileURL(path.join(repoRoot, "scripts", "electron-app.mjs")).href;
  const { electronBinary } = (await import(launcher)) as { electronBinary(): string };
  spawn(electronBinary(), [repoRoot], { detached: true, stdio: "ignore", env: cleanEnv, cwd: repoRoot }).unref();
}

let connecting: Promise<ControlInfo> | null = null;

/** Control info for a running, ready app; launches the app when it isn't running. */
function connect(): Promise<ControlInfo> {
  connecting ??= (async () => {
    const existing = readInfo();
    if (await alive(existing)) return existing!;
    await launchApp();
    const start = Date.now();
    while (Date.now() - start < LAUNCH_TIMEOUT) {
      await new Promise((r) => setTimeout(r, 300));
      const info = readInfo();
      if (await alive(info)) return info!;
    }
    throw new Error("mydraw did not start in time");
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

let cached: ControlInfo | null = null;

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    cached ??= await connect();
    try {
      return await post(cached, method, params);
    } catch (e) {
      if (e instanceof NotRunning && attempt === 0) {
        cached = null; // app restarted or quit: reconnect (and relaunch) once
        continue;
      }
      throw e;
    }
  }
}

// ---------- tools ----------

const server = new McpServer(
  { name: "mydraw", version: VERSION },
  {
    instructions: [
      "mydraw is a local Excalidraw desktop app. These tools edit the open drawings live.",
      "Workflow: list_drawings / new_drawing / open_drawing -> get_scene to see ids -> add_elements, place_stencil, connect -> screenshot to check the result -> save / export.",
      "Coordinates are scene pixels (y grows downward). Each tool call is one undo step for the user.",
      "Icons (AWS, Azure, GCP, Kubernetes, network, logos) come from the stencil library: search_stencils then place_stencil; connect arrows to the returned icon id.",
      "Every tool takes an optional `drawing` (tab id, file path or title); default is the active drawing.",
    ].join("\n"),
  },
);

const drawing = z.string().optional().describe("Tab id, file path or title of an open drawing. Default: the active drawing.");
const ids = z.array(z.string()).describe("Element ids");
const loose = z.record(z.string(), z.any());

function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 1) }] };
}

type Args = Record<string, unknown>;

function tool(
  name: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: Args) => Promise<unknown>,
  annotations: { readOnlyHint?: boolean; destructiveHint?: boolean } = {},
): void {
  server.registerTool(name, { description, inputSchema: shape, annotations }, (async (args: Args) => {
    try {
      const out = await run(args);
      if (out && typeof out === "object" && "content" in (out as object)) return out;
      return ok(out);
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
    }
  }) as never);
}

const call = (method: string) => (args: Args) => rpc(method, args);

// files / drawings
tool("list_drawings", "List open drawings (tabs): id, title, file path, unsaved changes, which is active, element count.", {}, call("list_drawings"), { readOnlyHint: true });
tool("new_drawing", "Open a new empty drawing tab and make it active. Returns its id.", { title: z.string().optional() }, call("new_drawing"));
tool("open_drawing", "Open an .excalidraw file (absolute path) in a tab, or switch to it if already open.", { path: z.string() }, call("open_drawing"));
tool("activate_drawing", "Switch the app to an open drawing's tab.", { drawing: z.string() }, call("activate_drawing"));
tool(
  "save",
  "Save a drawing. Pass an absolute `path` (.excalidraw added if missing) for a new drawing or to save under a new name.",
  { drawing, path: z.string().optional() },
  call("save"),
);
tool(
  "export",
  "Export a drawing to an image or file: png, jpg, svg or excalidraw (format from `format` or the path's extension). Optional ids export only those elements (with their groups and labels).",
  {
    path: z.string().describe("Absolute output path"),
    format: z.enum(["png", "jpg", "svg", "excalidraw"]).optional(),
    drawing,
    ids: ids.optional(),
    scope: z.enum(["all", "selection"]).optional(),
    scale: z.number().int().min(1).max(4).optional().describe("PNG/JPG pixel scale, default 2"),
    padding: z.number().optional(),
    background: z.boolean().optional().describe("Include background (default true; JPG always has one)"),
    darkMode: z.boolean().optional(),
    quality: z.number().min(0.1).max(1).optional().describe("JPG quality"),
    embedScene: z.boolean().optional().describe("Embed the editable scene in PNG/SVG"),
  },
  call("export"),
);
tool(
  "screenshot",
  "Render the drawing (or just some elements) to a PNG and return it as an image, to check layout and looks.",
  { drawing, ids: ids.optional(), maxSize: z.number().optional().describe("Longest side in px, default 1600"), darkMode: z.boolean().optional() },
  async (args) => {
    const r = (await rpc("screenshot", args)) as { png: string };
    return { content: [{ type: "image" as const, data: r.png, mimeType: "image/png" }] };
  },
  { readOnlyHint: true },
);

// reading
tool(
  "get_scene",
  "Describe a drawing's elements compactly: id, type, geometry, label/text, colors, arrow from/to ids, groups, frame, custom data. Labels inside shapes are folded into their shape. `full` returns raw Excalidraw JSON.",
  { drawing, ids: ids.optional(), type: z.string().optional().describe("Only elements of this type"), full: z.boolean().optional() },
  call("get_scene"),
  { readOnlyHint: true },
);
tool("get_selection", "Describe the elements the user has selected.", { drawing }, call("get_selection"), { readOnlyHint: true });
tool(
  "get_element",
  "Full Excalidraw JSON of elements (and their label text elements).",
  { drawing, id: z.string().optional(), ids: ids.optional() },
  call("get_element"),
  { readOnlyHint: true },
);

// building
tool(
  "add_elements",
  [
    "Add elements from Excalidraw element skeletons (all added as one undo step). Each needs type, x, y; id optional (returned).",
    'Shapes: {type:"rectangle"|"ellipse"|"diamond", x, y, width, height, label:"text" or {text, fontSize}, strokeColor, backgroundColor, fillStyle:"solid"|"hachure"|"cross-hatch", strokeWidth, strokeStyle:"solid"|"dashed"|"dotted", roundness:{type:3}|null}.',
    'Text: {type:"text", x, y, text, fontSize, textAlign}. Frames: {type:"frame", x, y, width, height, name, children:[ids]}.',
    'Arrows/lines: {type:"arrow"|"line", from:id, to:id, label} draws a bound connector edge to edge (ids may be earlier in the same call or already in the drawing); or give x, y, points:[[0,0],[dx,dy],...] for a free line.',
    "Colors are hex. Unset style fields use the drawing's current style.",
  ].join("\n"),
  { drawing, elements: z.array(loose) },
  call("add_elements"),
);
tool(
  "connect",
  "Draw an arrow (or line) between two elements, edge to edge, bound so it follows them when moved.",
  {
    drawing,
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
    type: z.enum(["arrow", "line"]).optional(),
    id: z.string().optional(),
    startArrowhead: z.enum(["arrow", "bar", "dot", "circle", "triangle", "diamond"]).nullable().optional(),
    endArrowhead: z.enum(["arrow", "bar", "dot", "circle", "triangle", "diamond"]).nullable().optional(),
    style: z
      .object({
        strokeColor: z.string().optional(),
        strokeWidth: z.number().optional(),
        strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
        roughness: z.number().optional(),
        opacity: z.number().optional(),
      })
      .optional(),
  },
  call("connect"),
);
tool(
  "update_elements",
  [
    "Change elements: [{id, ...fields}]. Fields: x, y, dx, dy, width, height, angle, strokeColor, backgroundColor, fillStyle, strokeWidth, strokeStyle, roughness, opacity, roundness, text, fontSize, fontFamily, textAlign, link, locked, name (frames), startArrowhead, endArrowhead,",
    "label (shape/arrow label text; null removes it), data (merged into custom properties, e.g. {ip, hostname}).",
    "Moved or resized shapes keep their label centred and their arrows attached.",
  ].join(" "),
  { drawing, updates: z.array(loose) },
  call("update_elements"),
);
tool(
  "move",
  "Move elements together with their groups and labels: by dx/dy, or so their top-left corner is at x/y. Bound arrows follow.",
  { drawing, ids, dx: z.number().optional(), dy: z.number().optional(), x: z.number().optional(), y: z.number().optional() },
  call("move"),
);
tool(
  "delete_elements",
  "Delete elements (and their labels). Arrows bound to them stay but come loose.",
  { drawing, ids },
  call("delete_elements"),
  { destructiveHint: true },
);
tool("group", "Group elements (their existing groups and labels come along). Returns the group id.", { drawing, ids }, call("group"));
tool("ungroup", "Remove a group: by groupId, or the outermost group of each of the given elements.", { drawing, ids: ids.optional(), groupId: z.string().optional() }, call("ungroup"));
tool("select", "Select elements in the app (empty list clears the selection).", { drawing, ids }, call("select"));
tool("zoom_to_fit", "Scroll and zoom the view to fit the whole drawing or the given elements.", { drawing, ids: ids.optional() }, call("zoom_to_fit"));
tool("undo", "Undo the last change(s) in a drawing (each tool call is one step).", { drawing, steps: z.number().int().optional() }, call("undo"));
tool("redo", "Redo undone change(s).", { drawing, steps: z.number().int().optional() }, call("redo"));

// stencils
tool(
  "search_stencils",
  'Search the stencil library (vendor icon packs + the user\'s own stencils), e.g. "ec2", "cloud run", "router", "firewall". Empty query lists a collection.',
  { query: z.string().optional(), collection: z.string().optional(), limit: z.number().int().optional() },
  call("search_stencils"),
  { readOnlyHint: true },
);
tool("list_collections", "List stencil collections (AWS, Azure, GCP, Kubernetes, Network, Logos, My Stencils, ...) with item counts.", {}, call("list_collections"), { readOnlyHint: true });
tool(
  "place_stencil",
  [
    "Insert a stencil by id (from search_stencils). Icons get a label under them (item name, custom text, or false for none).",
    "Position: x/y (centre of the icon), or right_of/left_of/above/below an element id (gap default 80, icon centres aligned), or inside a frame id. Default: right of everything.",
    "Optional color (hex, recolors SVG icons) and size (icon's longest side, default 64). Returns the new ids; connect arrows to `icon`.",
  ].join(" "),
  {
    drawing,
    id: z.string(),
    x: z.number().optional(),
    y: z.number().optional(),
    right_of: z.string().optional(),
    left_of: z.string().optional(),
    above: z.string().optional(),
    below: z.string().optional(),
    inside: z.string().optional(),
    gap: z.number().optional(),
    label: z.union([z.string(), z.literal(false)]).optional(),
    color: z.string().optional(),
    size: z.number().optional(),
  },
  call("place_stencil"),
);
tool(
  "save_as_stencil",
  "Save elements (given ids, or the current selection) into the stencil library as a reusable stencil. Collection default: My Stencils.",
  { drawing, name: z.string(), ids: ids.optional(), collection: z.string().optional(), tags: z.array(z.string()).optional() },
  call("save_as_stencil"),
);
tool(
  "add_stencil_file",
  "Copy an SVG/PNG/.excalidrawlib file (or a folder of them) into the stencil library.",
  { path: z.string().describe("Absolute path"), collection: z.string().optional() },
  call("add_stencil_file"),
);
tool("delete_stencil", "Delete a stencil from the library (moved to the Trash; drawings that use it keep their copy).", { id: z.string() }, call("delete_stencil"), {
  destructiveHint: true,
});

// colors
tool(
  "recolor",
  "Recolor elements: SVG icons get the color (null restores their original colors); shapes, text and arrows get it as stroke color (fill:true also sets shape fill).",
  { drawing, ids, color: z.string().nullable(), fill: z.boolean().optional() },
  call("recolor"),
);
tool("get_color", "Read an element's real color (dominant color for icons).", { drawing, id: z.string() }, call("get_color"), { readOnlyHint: true });

// escape hatches
tool(
  "set_scene",
  "Replace all elements of a drawing with raw Excalidraw element JSON (one undo step). files: {fileId: {mimeType, dataURL}} for images.",
  { drawing, elements: z.array(loose), files: z.record(z.string(), loose).optional(), background: z.string().optional() },
  call("set_scene"),
  { destructiveHint: true },
);
tool(
  "raw_update",
  "Patch elements with raw Excalidraw JSON by id (new ids are added as full elements). For fields update_elements doesn't cover.",
  { drawing, elements: z.array(loose), files: z.record(z.string(), loose).optional() },
  call("raw_update"),
);

await server.connect(new StdioServerTransport());
