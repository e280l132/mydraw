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
import { AGENT_EXPORT_FORMATS, CONTROL_FILE, type ControlInfo, type RpcResponse } from "../../shared/agent";
import { buildId } from "../../shared/buildId";

const VERSION = "0.5.0";
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

// ---------- stale code ----------

// The app (and this server) read their code once, at startup. After a rebuild they keep running the
// OLD code, which looks like fixes not working or tools missing. Say so, once per kind of problem.
const ownFile = fileURLToPath(import.meta.url);
const ownStamp = stampOf(ownFile);

function stampOf(file: string): string {
  try {
    const s = fs.statSync(file);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "";
  }
}

/** Reasons to restart the app or reconnect this server, from comparing what runs with what is on disk. */
export function staleNotes(info: ControlInfo | null): string[] {
  const notes: string[] = [];
  if (ownStamp && stampOf(ownFile) !== ownStamp) {
    notes.push("This MCP server was rebuilt after it started: reconnect it (/mcp in Claude Code) to get the new tools and descriptions.");
  }
  if (info?.build && info.appPath === repoRoot) {
    const onDisk = buildId(repoRoot);
    if (onDisk && onDisk !== info.build) {
      notes.push(
        "The running mydraw app started before the latest build, so it does not have the newest fixes. Save any unsaved drawings and restart the app (quit it, then make any tool call: it relaunches).",
      );
    }
  }
  return notes;
}

const shownNotes = new Set<string>();

// ---------- tools ----------

const server = new McpServer(
  { name: "mydraw", version: VERSION },
  {
    instructions: [
      "mydraw is a local Excalidraw desktop app. These tools edit the open drawings live.",
      "Workflow: list_drawings / new_drawing / open_drawing -> get_scene to see ids -> add_elements, place_stencil, connect -> screenshot and lint_diagram to check the result -> save / export.",
      "Coordinates are scene pixels (y grows downward). Each tool call is one undo step for the user.",
      "For a whole diagram use build_diagram (nodes, edges, zones -> automatic ELK layout, icons, elbow arrows, legend) or mermaid_to_scene / apply_template; then refine with the element tools.",
      "Icons (AWS, Azure, GCP, Kubernetes, network, logos) come from the stencil library: search_stencils then place_stencil (or `icon` on a build_diagram node); connect arrows to the returned node id.",
      "Zones (VPC, subnet, VLAN, ...) are locked tinted boxes; moving a zone moves what is inside it.",
      "Draw clean diagrams: about 40 arrows at most, one arrow to a zone instead of many to its nodes, labels only on short arrows, one colour per kind of relationship. After build_diagram read `quality` (and `advice`), run lint_diagram (it finds arrows on top of each other or through nodes, labels in the way; fix:true repairs labels and re-routes) and look at a screenshot before telling the user it is done. Save the drawing to a file when it is finished: an unsaved drawing is lost if the app quits.",
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
      const result = out && typeof out === "object" && "content" in (out as object) ? (out as ReturnType<typeof ok>) : ok(out);
      // A warning about stale code: once per kind of problem, and always by list_drawings.
      const fresh = staleNotes(cached).filter((n) => name === "list_drawings" || !shownNotes.has(n));
      for (const n of fresh) shownNotes.add(n);
      if (fresh.length) result.content.push({ type: "text" as const, text: `WARNING: ${fresh.join(" ")}` });
      return result;
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] };
    }
  }) as never);
}

const call = (method: string) => (args: Args) => rpc(method, args);

// files / drawings
tool("list_drawings", "List open drawings (tabs): id, title, file path, unsaved changes, which is active, element count.", {}, call("list_drawings"), { readOnlyHint: true });
tool("new_drawing", "Open a new empty drawing tab and make it active. Returns its id.", { title: z.string().optional() }, call("new_drawing"));
tool("open_drawing", "Open an .excalidraw file (absolute path) in a tab, or switch to it if already open. A .drawio file is converted into a NEW unsaved drawing (shapes, edges, containers become zones, properties, embedded images; what draw.io has that Excalidraw has not becomes plain rectangles and is reported); save it with `save {path}`.", { path: z.string() }, call("open_drawing"));
tool("activate_drawing", "Switch the app to an open drawing's tab.", { drawing: z.string() }, call("activate_drawing"));
tool(
  "save",
  "Save a drawing. Pass an absolute `path` (.excalidraw added if missing) for a new drawing or to save under a new name.",
  { drawing, path: z.string().optional() },
  call("save"),
);
tool(
  "export",
  [
    "Export a drawing (format from `format` or the path's extension).",
    "Pictures: png, jpg, webp (transparent with background:false), svg, html (one self-contained file: embedded SVG, pan/zoom, clickable links).",
    "Documents: pdf (vector; pageSize fit = page is the drawing's size (default), a4 or letter = scaled to fit the sheet, or actualSize:true = 100% over several sheets), pptx (one picture per slide; slideSize 16:9 or 4:3), drawio (draw.io/diagrams.net file: editable shapes, text, edges, zones as containers, icons as embedded images; approximate, `warnings` lists what was skipped).",
    "Text from the diagram structure: mermaid (flowchart .mmd; zones become subgraphs; re-readable by mermaid_to_scene), csv and markdown (inventory: one row per node with name, kind, type, zone, ip, hostname, notes from customData).",
    "excalidrawlib is an Excalidraw library file (the drawing or selection as one item, to share with Excalidraw users; images/icons are left out and reported in `warnings`). excalidraw writes the whole drawing.",
    "Content: scope all (default), selection, frame (+ `frame` name or id) or frames (every frame: pdf/pptx/drawio write ONE file with a page/slide per frame; other formats take a folder as `path`, one file per frame named after it, `format` required). Optional ids export only those elements (with their groups and labels).",
  ].join(" "),
  {
    path: z.string().describe("Absolute output path (a folder when scope is frames, except for pdf/pptx/drawio)"),
    format: z.enum(AGENT_EXPORT_FORMATS).optional(),
    drawing,
    ids: ids.optional(),
    scope: z.enum(["all", "selection", "frame", "frames"]).optional(),
    frame: z.string().optional().describe("Frame name or id (scope frame)"),
    scale: z.number().int().min(1).max(4).optional().describe("PNG/JPG/WebP/PPTX pixel scale, default 2"),
    padding: z.number().optional().describe("Pixels around the content, default 20 (0-500)"),
    background: z.boolean().optional().describe("Include background (default true; JPG always has one; false = transparent PNG/WebP/SVG)"),
    darkMode: z.boolean().optional().describe("Dark theme for png/jpg/webp/svg/html/pdf/pptx"),
    quality: z.number().min(0.1).max(1).optional().describe("JPG/WebP quality, default 0.92"),
    embedScene: z.boolean().optional().describe("Embed the editable scene in PNG/SVG"),
    pageSize: z.enum(["fit", "a4", "letter"]).optional().describe("PDF page size, default fit (page = drawing)"),
    actualSize: z.boolean().optional().describe("PDF on a4/letter at 100% instead of fitted (may span several sheets)"),
    slideSize: z.enum(["16:9", "4:3"]).optional().describe("PPTX slide size, default 16:9"),
  },
  call("export"),
);
tool(
  "copy_to_clipboard",
  "Put the drawing (or the selection) on the user's system clipboard, ready to paste into a doc or chat: png = a picture, svg / mermaid = text. Replaces whatever they had copied, so use it when they ask for it (or after saying so); to just save a file use export.",
  {
    format: z.enum(["png", "svg", "mermaid"]),
    drawing,
    scope: z.enum(["all", "selection"]).optional().describe("Default all"),
    ids: ids.optional(),
    scale: z.number().int().min(1).max(4).optional().describe("PNG pixel scale, default 2"),
    background: z.boolean().optional(),
    darkMode: z.boolean().optional(),
  },
  call("copy_to_clipboard"),
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
tool(
  "get_inventory",
  "List every node (labelled shape or icon node) as an inventory row: id, name, kind, type, zone, ip, hostname, vlan, role, owner, url, notes, plus `extra` (other custom properties). Use it to document a diagram (e.g. render a Markdown table) or to find nodes with missing properties; change them with set_properties.",
  { drawing },
  call("get_inventory"),
  { readOnlyHint: true },
);
tool(
  "set_properties",
  "Set node properties (stored in the element's custom data, shown in the app's Properties panel and the inventory table/CSV). properties: {hostname, ip, vlan, role, owner, url, notes, or any other key}: text sets, null or \"\" removes. Works on shapes and icon nodes (give the node id; an icon image/caption id maps to its node). Not undoable with ⌘Z (Excalidraw's undo ignores custom data): to revert, set the old value again.",
  { drawing, id: z.string().optional(), ids: ids.optional(), properties: z.record(z.string(), z.string().nullable()) },
  call("set_properties"),
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
    'Text: {type:"text", x, y, text, fontSize, fontFamily (a name from list_fonts, e.g. "Inter Bold" or "Caveat"), textAlign}; labels take fontFamily too. Frames: {type:"frame", x, y, width, height, name, children:[ids]}.',
    'Arrows/lines: {type:"arrow"|"line", from:id, to:id, label, routing:"straight"|"elbow"|"curved"} draws a bound connector edge to edge (ids may be earlier in the same call or already in the drawing); or give x, y, points:[[0,0],[dx,dy],...] for a free line.',
    "Colors are hex. Unset style fields use the drawing's current style.",
  ].join("\n"),
  { drawing, elements: z.array(loose) },
  call("add_elements"),
);
tool(
  "connect",
  "Draw an arrow (or line) between two elements, edge to edge, bound so it follows them when moved. routing: straight (default), elbow (right angles, re-routes itself when shapes move) or curved. avoid: true routes the arrow AROUND the shapes in between (right angles, kept clear of other shapes; the route's middle stays put when the ends move; re-run route_around after big moves).",
  {
    drawing,
    from: z.string(),
    to: z.string(),
    label: z.string().optional(),
    routing: z.enum(["straight", "elbow", "curved"]).optional(),
    avoid: z.boolean().optional().describe("Route the arrow around the shapes in between"),
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
    "label (shape/arrow label text, icon-node caption or zone title; null removes it), data (merged into custom properties, e.g. {ip, hostname}), routing (arrows: straight|elbow|curved).",
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

// diagrams
const lineStyle = z.enum(["solid", "dashed", "dotted"]);
const node = z
  .object({
    id: z.string().describe("Your id for the node (becomes the element id)"),
    label: z.string().optional().describe("Text in the shape, or the icon's caption. Default: the id. \n for line breaks"),
    icon: z.string().optional().describe('Stencil id, name or search ("Amazon EC2", "AWS:Amazon RDS", "Network:router"). Falls back to a shape if not found'),
    iconColor: z.string().optional().describe("Recolor an SVG icon (hex)"),
    shape: z
      .enum(["rectangle", "ellipse", "diamond", "cylinder", "cloud", "document", "queue", "actor", "server", "hexagon", "folder"])
      .optional()
      .describe("For nodes without an icon (default rectangle). cylinder = database, cloud = internet/SaaS, queue = message queue, document = file/report, actor = person (label under it), server = server (label under it), hexagon = service, folder = storage"),
    emphasis: z.enum(["primary", "muted"]).optional().describe("primary: thicker border and bold label (the main components); muted: grey and thin (external or less important)"),
    subtitle: z.string().optional().describe("Second, smaller grey line under the label, e.g. an IP address or a role"),
    zone: z.string().optional().describe("Id of the zone the node sits in"),
    color: z.string().optional().describe("Stroke/text color (hex)"),
    fill: z.string().optional().describe("Fill color (hex), default white"),
    width: z.number().optional(),
    height: z.number().optional(),
    kind: z.string().optional().describe('Category for the legend, e.g. "Server"'),
    data: z.record(z.string(), z.any()).optional().describe("Custom properties, e.g. {ip, hostname}"),
    link: z.string().optional(),
  })
  .describe("A node: a shape with a label, or an icon with a caption");
const zone = z.object({
  id: z.string(),
  label: z.string().optional().describe("Title shown in the zone's top-left corner"),
  parent: z.string().optional().describe("Enclosing zone id (zones nest: cloud > VPC > subnet)"),
  color: z.string().optional().describe("Border/title color (hex); fill defaults to a light tint of it"),
  fill: z.string().optional(),
  style: lineStyle.optional(),
  locked: z.boolean().optional().describe("Default true (users can't drag it by accident)"),
});
const arrowhead = z.enum(["arrow", "triangle", "triangle_outline", "dot", "circle", "circle_outline", "diamond", "diamond_outline", "bar", "crowfoot_one", "crowfoot_many", "crowfoot_one_or_many", "none"]);
const kindStyle = z.object({
  color: z.string().optional(),
  style: lineStyle.optional(),
  weight: z.enum(["primary", "normal", "secondary"]).optional(),
  head: arrowhead.optional(),
  tail: arrowhead.optional(),
});
const edge = z.object({
  id: z.string().optional(),
  from: z.string().describe("Node or zone id"),
  to: z.string().describe("Node or zone id"),
  label: z.string().optional(),
  color: z.string().optional(),
  style: lineStyle.optional(),
  width: z.number().optional().describe("Stroke width in px (overrides weight)"),
  weight: z.enum(["primary", "normal", "secondary"]).optional().describe("primary = thick (main flows), normal (default), secondary = thin and faded (management, optional paths)"),
  arrow: z.enum(["end", "both", "none"]).optional().describe("Arrowheads shortcut, default end"),
  head: arrowhead.optional().describe("Arrowhead at the end (overrides arrow)"),
  tail: arrowhead.optional().describe("Arrowhead at the start"),
  routing: z.enum(["elbow", "straight", "curved"]).optional(),
  kind: z.string().optional().describe('Relationship type, e.g. "Traffic", "Replication": every arrow of a kind is drawn the same (see kinds) and the legend lists it'),
});
const layoutOpts = {
  direction: z.enum(["right", "down", "left", "up"]).optional().describe("Flow direction, default right"),
  algorithm: z.enum(["layered", "tree", "radial", "force", "grid"]).optional().describe("Default layered (best for flows and networks)"),
  spacing: z.number().optional().describe("Space between nodes, default 60"),
  routing: z.enum(["elbow", "straight", "curved"]).optional().describe("Connector style, default elbow"),
};
const placeOpts = {
  x: z.number().optional().describe("Top-left corner; default right of the existing content"),
  y: z.number().optional(),
  title: z.string().optional().describe("Title text above the diagram"),
  subtitle: z.string().optional().describe("A smaller line under the title"),
  look: z.enum(["professional", "sketch"]).optional().describe("professional (default): crisp lines, Inter/Montserrat type with bold titles and labels; sketch: hand-drawn lines and handwriting fonts. Use sketch when the user asks for a sketch, whiteboard or hand-drawn look"),
  kinds: z.record(z.string(), kindStyle).optional().describe('Style per relationship kind, e.g. {"Traffic": {"color": "#1971c2", "weight": "primary"}, "Async": {"style": "dashed", "head": "triangle_outline"}}; kinds without an entry get a distinct colour'),
  legend: z.union([z.boolean(), z.string()]).optional().describe("Add a legend (true or its title)"),
  zoom: z.boolean().optional().describe("Zoom the view to the new diagram (default true)"),
};
tool(
  "build_diagram",
  [
    "Build a whole diagram in one step (one undo step): nodes (shapes or stencil icons with captions), edges (bound arrows) and zones (nested tinted boxes like VPC > subnet),",
    "laid out automatically with ELK (layered by default) and connected with elbow arrows that re-route when nodes move. The main 'draw me X' tool.",
    "Ids you give become element ids. It tries several layouts, keeps the cleanest (arrows moved apart, labels on free stretches) and returns ids, bounds, warnings (e.g. icons not found) and `quality`:",
    "score (lower is better), arrowsOnTopOfEachOther, arrowsThroughNodes, labelsColliding, crossings and `advice` (what to change in the spec if it is crowded). Read `quality`, then check the result with screenshot.",
    "Looks: look professional (default) or sketch (when the user asks for hand-drawn); title + subtitle; node shapes include cylinder (database), cloud, queue, document, actor (person), server, hexagon, folder; node emphasis primary/muted and subtitle (IP, role); arrows have weight primary/normal/secondary, head/tail arrowheads (triangle, dot, diamond, crowfoot_many for ER), and a kind whose style is shared (kinds) and shown in the legend.",
    "Drawing well: keep to about 40 arrows or fewer; mark the main path's arrows primary and management or optional ones secondary; draw one arrow to a ZONE (from/to may be a zone id) instead of one per node; give a label only to short arrows; one colour per kind of relationship (use `kind` and a legend); if `advice` says a node has many arrows or an arrow is very long, change the spec and build again rather than accepting it.",
  ].join(" "),
  {
    drawing,
    nodes: z.array(node),
    edges: z.array(edge).optional(),
    zones: z.array(zone).optional(),
    ...layoutOpts,
    iconSize: z.number().optional().describe("Icon size (longest side), default 64"),
    ...placeOpts,
  },
  call("build_diagram"),
);
tool(
  "mermaid_to_scene",
  "Turn Mermaid text into a diagram. Flowcharts (flowchart/graph: shapes, labelled links, subgraphs -> zones, style/classDef colors) get the same ELK layout and elbow arrows as build_diagram; other Mermaid types (sequence, class, ...) are converted by Mermaid itself.",
  { drawing, mermaid: z.string(), ...layoutOpts, ...placeOpts },
  call("mermaid_to_scene"),
);
tool(
  "import_diagram",
  [
    "Build a diagram from text in a file or inline. format csv | yaml | mermaid (guessed from the path extension .csv/.tsv, .yaml/.yml, .mmd).",
    "CSV host list: columns name (or device/host), type or icon (stencil search text, e.g. Firewall), kind, zone (\"Prod / DMZ\" nests), connects_to (names separated by ; or |), and any other column as a property (ip, hostname, vlan, role, owner, url, notes, ...). CSV connection list: columns from, to, optional label.",
    "YAML: the build_diagram spec written as YAML (nodes list or map, zones, edges, direction) with shortcuts: a node can be just a name; an edge can be a string like `web -> db: SQL`, `a <-> b`, `a -- b`.",
    "Mermaid: same as mermaid_to_scene. Same layout, zones, icons and elbow arrows as build_diagram; returns warnings (icons not found, nodes created from links). One undo step.",
  ].join(" "),
  { drawing, format: z.enum(["csv", "yaml", "mermaid"]).optional(), text: z.string().optional(), path: z.string().optional().describe("Absolute path of a .csv/.yaml/.mmd file"), ...layoutOpts, ...placeOpts },
  call("import_diagram"),
);
tool(
  "route_around",
  "Re-route arrows so they go around the shapes in their way (right angles, a steady distance from other shapes), keeping the sides they leave and arrive on. ids: these arrows (default: every arrow in the drawing). Use after moving things or when arrows cross shapes. One undo step.",
  { drawing, ids: ids.optional() },
  call("route_around"),
);
tool("list_templates", "List starter diagram templates (3-tier web app, AWS VPC, GCP project, home network, k8s cluster, homelab).", {}, call("list_templates"), {
  readOnlyHint: true,
});
tool(
  "apply_template",
  "Insert a starter diagram template (see list_templates). Icons come from the stencil library; missing packs fall back to plain shapes (reported in warnings). Edit the result with the element tools.",
  { drawing, name: z.string(), ...layoutOpts, ...placeOpts },
  call("apply_template"),
);
tool(
  "create_zone",
  "Draw a zone (VPC, subnet, VLAN, rack, ...): a tinted box with a title, around the given elements (ids, with padding) or at x/y/width/height. Placed behind its contents and locked; moving the zone moves its contents. Nested automatically when the members share a zone, or via parent.",
  {
    drawing,
    label: z.string().optional(),
    ids: ids.optional(),
    id: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    parent: z.string().optional(),
    color: z.string().optional().describe("Border/title color (hex), default blue"),
    fill: z.string().optional().describe("Fill (hex), default a light tint of color"),
    style: lineStyle.optional(),
    padding: z.number().optional().describe("Space around the members, default 24"),
    locked: z.boolean().optional(),
  },
  call("create_zone"),
);
tool(
  "add_legend",
  "Add (or replace) a legend: one row per icon type (stencil name or kind) and per shape/arrow kind (set `kind` in build_diagram, or data.mydrawKind). Default position: under the diagram, right-aligned.",
  { drawing, ids: ids.optional().describe("Only these elements (default all)"), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), replace: z.boolean().optional() },
  call("add_legend"),
);
tool(
  "auto_layout",
  "Re-arrange existing shapes, icon nodes, groups and zones with ELK, using their arrows as edges (keeps the top-left corner). Like build_diagram it picks the cleanest of several layouts and returns `quality` (score, arrows on top of each other or through nodes, colliding labels, advice). Optional ids limit it to part of the drawing; routing switches all affected arrows.",
  { drawing, ids: ids.optional(), ...layoutOpts },
  call("auto_layout"),
);

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
    "Insert a stencil by id (from search_stencils). Icons become an icon node: icon + caption (item name, custom text, or false for none); arrows connect to the node so they never cross the caption.",
    "Position: x/y (centre of the icon), or right_of/left_of/above/below an element id (gap default 80, icon centres aligned), or inside a frame/zone id. Default: right of everything.",
    "Optional color (hex, recolors SVG icons) and size (icon's longest side, default 64). A node placed across a zone border gets a canvas-colored backing so the border line doesn't cross it (mask:false to turn off).",
    "Returns `node` (connect arrows to it), `icon` (the image) and `label`.",
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
    mask: z.boolean().optional(),
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
tool("delete_stencil", "Delete a stencil from the library (files go to the Trash; an entry of an imported .excalidrawlib pack is removed from that file for good). Drawings that use it keep their copy.", { id: z.string() }, call("delete_stencil"), {
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

// review
tool(
  "lint_diagram",
  [
    "Check a drawing for common diagram problems. Run it after build_diagram, mermaid_to_scene, apply_template or a batch of edits, and when asked to review a diagram (together with screenshot).",
    "Rules: overlap (warning: two nodes' boxes overlap; containment in zones/frames is fine), unconnected-arrow (warning: an arrow with a free start/end; `ends` says which), unlabeled-node (info: shape without label, icon without caption), missing-ip (info: only when some nodes have an ip in their data, the labelled nodes that lack one), off-palette-color (info: a stroke/fill color outside the app palettes and themes), edge-overlap (warning: two arrows run on top of each other), label-collision (warning: an arrow label sits under a node, zone title, another label or arrow; fix moves it to a free stretch), edge-through-node (warning: an arrow runs through a node it does not connect; fix re-routes it around), crowded-node (info: 7+ arrows meet at one node), long-edge (info: an arrow longer than 60% of the diagram).",
    "Each issue: {rule, severity, id, label, message, other? (overlap partner), ends?, fix?}; summary counts per rule; warnings first, then top-left to bottom-right.",
    "fix:true applies every safe fix as ONE undo step (binds free arrow ends to a node within 40px, snaps off-palette colors to the nearest palette color) and returns the issues left plus `fixed`. Overlaps, labels and IPs are never changed automatically: fix them with move / update_elements.",
  ].join(" "),
  {
    drawing,
    fix: z.boolean().optional().describe("Apply all safe fixes (one undo step)"),
    rules: z
      .array(z.enum(["overlap", "unconnected-arrow", "unlabeled-node", "missing-ip", "off-palette-color", "edge-overlap", "label-collision", "edge-through-node", "crowded-node", "long-edge"]))
      .optional()
      .describe("Only these rules (default all)"),
  },
  call("lint_diagram"),
);

// palettes, themes, style presets
tool(
  "list_fonts",
  "List the fonts you can use as fontFamily (text elements, labels, update_elements, style presets, themes), by name. Categories: excalidraw (built in: Excalifont hand-drawn, Nunito, Comic Shanns, ...), fun (hand-drawn, cartoon, whiteboard: Caveat, Kalam, Permanent Marker, Bangers, ...), professional (Inter, Roboto, Open Sans, Lato, Montserrat, Merriweather, ...), mono (IBM Plex Mono, JetBrains Mono). Weights are separate names: 'Inter Bold', 'Caveat Bold'. Fonts a drawing uses are saved inside the file.",
  {},
  call("list_fonts"),
  { readOnlyHint: true },
);
tool(
  "list_palettes",
  "List color palettes and how to write colors. Everywhere a color is accepted (recolor, add_elements, update_elements, place_stencil, build_diagram) you can use hex (#ff9900), a ramp name (blue-600; plain 'blue' = blue-500; 22 hues x shades 50..900), a basic name (red, navy, mint, charcoal, ...) or 'transparent'. Pass palette:'ramp' to list every ramp name.",
  { palette: z.string().optional().describe("basic | ramp") },
  call("list_palettes"),
  { readOnlyHint: true },
);
tool(
  "list_themes",
  "List themes and style presets, each with its category (built-in and user-saved; they are the same in every drawing).",
  {},
  call("list_themes"),
  { readOnlyHint: true },
);
tool(
  "apply_theme",
  "Restyle a drawing with a theme (one undo step): roughness, corner roundness, font and stroke width of shapes, text and connectors, default-ink strokes re-inked, and (whole drawing only) the canvas background. Custom fills and colors are kept. Also sets defaults for new shapes. ids limits it to those elements (and their groups); background:false keeps the canvas color. Theme names: see list_themes.",
  { drawing, theme: z.string(), ids: ids.optional(), background: z.boolean().optional() },
  call("apply_theme"),
);
tool(
  "apply_style_preset",
  "Apply a named style preset (see list_themes; e.g. 'DMZ', 'Critical') or an inline style to elements. Labels follow. style fields: strokeColor, backgroundColor (names or hex), fillStyle, strokeWidth, strokeStyle (solid|dashed|dotted), roughness, opacity (0-100), roundness (sharp|round), fontFamily (slug like cascadia or a list_fonts name like \"Inter Bold\"), fontSize.",
  {
    drawing,
    ids,
    preset: z.string().optional(),
    style: z.record(z.string(), z.unknown()).optional(),
  },
  call("apply_style_preset"),
);
tool(
  "save_style_preset",
  "Save a style preset (kept across sessions, available in every drawing): either from an element's current look (id) or an inline style. Saving under a built-in's name overrides it.",
  {
    drawing,
    name: z.string(),
    category: z.string().optional().describe("Group in the panel (default 'My presets')"),
    id: z.string().optional().describe("Copy the style of this element"),
    style: z.record(z.string(), z.unknown()).optional(),
    description: z.string().optional(),
  },
  call("save_style_preset"),
);
tool("delete_style_preset", "Delete a user-saved style preset (built-ins can only be overridden).", { drawing, name: z.string() }, call("delete_style_preset"), {
  destructiveHint: true,
});
tool(
  "save_theme",
  "Save a custom theme (kept across sessions, available in every drawing). background and ink are colors; fontFamily one of virgil, helvetica, cascadia, excalifont, nunito, lilita-one, comic-shanns, liberation, or a font name from list_fonts (e.g. Inter, Caveat).",
  {
    drawing,
    name: z.string(),
    category: z.string().optional().describe("Group in the panel (default 'My themes')"),
    background: z.string(),
    ink: z.string(),
    fontFamily: z.string().optional(),
    roughness: z.number().optional().describe("0 none, 1 some, 2 lots"),
    roundness: z.enum(["sharp", "round"]).optional(),
    strokeWidth: z.number().optional(),
    description: z.string().optional(),
  },
  call("save_theme"),
);
tool("delete_theme", "Delete a user-saved theme (built-ins can't be deleted).", { drawing, name: z.string() }, call("delete_theme"), {
  destructiveHint: true,
});

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
