// Ask Claude box (Phase 10), pure parts: the request the renderer sends, the prompts, the
// `claude -p` arguments, the MCP config that points Claude at THIS app, and the parser for
// `--output-format stream-json` lines. The process itself runs in app/src/askClaude.ts, the panel is
// web/src/AskClaude.tsx. Tested in tests/askClaude.test.ts.
import { conventionsFor } from "./conventions";
import { DESIGN_GUIDE, POLISH_RECIPE, TIDY_RECIPE } from "./recipes";

/** Model aliases `claude --model` accepts. Default Sonnet: fast and cheap for drawing edits. */
export const ASK_MODELS = ["sonnet", "opus", "haiku"] as const;
export type AskModel = (typeof ASK_MODELS)[number];
export const DEFAULT_ASK_MODEL: AskModel = "sonnet";
export const ASK_MODEL_LABELS: Record<AskModel, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku" };

export interface AskSettings {
  model: AskModel;
}

export function normalizeAskSettings(raw: unknown, base: AskSettings = { model: DEFAULT_ASK_MODEL }): AskSettings {
  const out = { ...base };
  if (raw && typeof raw === "object" && ASK_MODELS.includes((raw as { model?: unknown }).model as AskModel)) out.model = (raw as { model: AskModel }).model;
  return out;
}

export const MAX_PROMPT = 8000;
export const MAX_SELECTION = 500;

/** What the panel asks for. `prompt` is the question (ask) or what matters most (tidy / polish, optional). */
export interface AskRequest {
  /** ask = the typed request; tidy = TIDY_RECIPE; polish = POLISH_RECIPE (restyle, no moves). */
  mode: "ask" | "tidy" | "polish";
  prompt: string;
  /** The drawing: tab id (the MCP `drawing` parameter) and its title. */
  drawing: { id: string; title: string };
  /** Selected element ids; empty = the whole drawing. */
  selection: string[];
  /** Tidy only: keep the current arrangement (no whole-drawing auto_layout). */
  keep: boolean;
  model: AskModel;
  /** Session id of the previous run in this box: the request continues that conversation (`claude --resume`). */
  resume?: string;
  /** Ask only: reply with an outline first and change nothing (the user answers "build it" in a follow-up). */
  plan?: boolean;
}

/** Session ids as claude prints them (uuids); anything else is ignored. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Validates a request from the renderer; throws on anything unusable. */
export function normalizeAskRequest(raw: unknown): AskRequest {
  if (!raw || typeof raw !== "object") throw new Error("invalid request");
  const r = raw as Record<string, unknown>;
  const mode = r.mode === "tidy" || r.mode === "ask" || r.mode === "polish" ? r.mode : null;
  if (!mode) throw new Error("invalid request");
  const prompt = str(r.prompt, MAX_PROMPT).trim();
  if (mode === "ask" && !prompt) throw new Error("Type what you want Claude to do first.");
  const d = (r.drawing ?? {}) as Record<string, unknown>;
  const id = str(d.id, 200);
  if (!id) throw new Error("No drawing is open.");
  const selection = Array.isArray(r.selection) ? r.selection.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 200).slice(0, MAX_SELECTION) : [];
  const resume = typeof r.resume === "string" && SESSION_ID.test(r.resume) ? r.resume : undefined;
  return {
    mode,
    prompt,
    drawing: { id, title: str(d.title, 200) },
    selection,
    keep: r.keep === true,
    model: normalizeAskSettings({ model: r.model }).model,
    ...(resume ? { resume } : {}),
    ...(mode === "ask" && r.plan === true ? { plan: true } : {}),
  };
}

const quote = (s: string) => JSON.stringify(s);

function scopeLine(req: AskRequest): string {
  if (!req.selection.length) return "The user has nothing selected: the request is about the whole drawing.";
  return `The user has ${req.selection.length} element${req.selection.length === 1 ? "" : "s"} selected; work on those (and what belongs to them: labels, groups, zone contents) unless the request says otherwise. Selected ids: ${req.selection.join(", ")}.`;
}

/** Appended to Claude Code's system prompt: where it runs and the rules for working in the app. */
export function askSystemPrompt(req: AskRequest): string {
  return [
    "You are running inside the mydraw app (a local Excalidraw editor), started from its Ask Claude box. The user watches the drawing change live and cannot answer follow-up questions during this run.",
    `Work only with the mydraw MCP tools, on the drawing ${quote(req.drawing.id)}${req.drawing.title ? ` (titled ${quote(req.drawing.title)})` : ""}: pass drawing: ${quote(req.drawing.id)} on every call. Do not touch other drawings.`,
    scopeLine(req),
    "Look before you change: get_scene (and screenshot when the layout matters). Each tool call is one undo step for the user, so prefer a few well-aimed calls over many tiny ones.",
    "Do not save, export, copy to the clipboard, open or create drawings, or change the stencil library, themes or presets unless the user asked for exactly that.",
    "If the request is unclear, make the smallest reasonable change and say what you assumed. Finish with 1-3 short plain sentences for the user (no headings, no lists): what you changed, or why you changed nothing.",
    "When you build or add to a diagram, make it look good: build_diagram's default look (polished) colours nodes by role, give nodes a `role` when the guess from label/icon would be wrong, set arrow `kind`s and `weight` primary on the main path, give zones a `kind`, and follow this guide:",
    DESIGN_GUIDE,
    ...domainLines(req),
    ...(req.resume ? ["This continues the conversation in the Ask box: the user's new message refers to what you did or proposed before. Look at the drawing again (get_scene) before changing it: the user may have edited it meanwhile."] : []),
    ...(req.plan
      ? [
          "PLAN FIRST: do not change the drawing in this turn (reading it is fine). Reply with a short outline the user can check: the zones and how they nest, the nodes per zone, the main flow(s) and arrow kinds, and the look, in at most about 12 short lines (plain lines, no headings). End by asking whether to build it or what to change. The user's next message in this box continues from your outline.",
        ]
      : []),
  ].join("\n");
}

/** Conventions of the domains the request (or the drawing's title) is about: AWS, Kubernetes, networks, ... */
function domainLines(req: AskRequest): string[] {
  if (req.mode !== "ask") return [];
  const text = conventionsFor(`${req.prompt}\n${req.drawing.title}`);
  return text ? ["", text, "(More domains: the get_conventions tool.)"] : ["", "Domain conventions (AWS, Azure, GCP, Kubernetes, networks, flows) are available from the get_conventions tool when the drawing is about one of them."];
}

/** The user message for `claude -p`. */
export function askPrompt(req: AskRequest): string {
  if (req.mode === "ask") return req.prompt;
  if (req.mode === "polish") {
    const focus = [req.prompt ? `, with the focus on: ${req.prompt}` : "", req.selection.length ? ` (only the selected elements: ids ${req.selection.join(", ")}; leave the rest as it is)` : ""].join("");
    return POLISH_RECIPE(quote(req.drawing.id), focus);
  }
  const focus = [req.prompt ? `, with the focus on: ${req.prompt}` : "", req.selection.length ? ` (only the selected part: ids ${req.selection.join(", ")}; leave the rest where it is)` : ""].join("");
  return TIDY_RECIPE(quote(req.drawing.id), focus, req.keep || req.selection.length > 0);
}

/** MCP tools Claude may not call from the box: they change app-wide data, not the drawing. */
export const ASK_DISALLOWED_TOOLS = ["delete_stencil", "delete_style_preset", "delete_theme", "add_stencil_file"].map((t) => `mcp__mydraw__${t}`);
/** Tidy and Polish also may not edit raw elements or replace the scene: those leave arrows unbound and badges behind. */
export const ASK_RECIPE_DISALLOWED_TOOLS = ["raw_update", "set_scene"].map((t) => `mcp__mydraw__${t}`);

export interface McpLaunch {
  /** The Electron binary (run in Node mode). */
  execPath: string;
  /** The MCP server script: Resources/mcp/index.js (packaged) or <checkout>/mcp/dist/index.js. */
  script: string;
  /** The app's userData folder, so the server finds THIS app's control.json. */
  userData: string;
}

/** `--mcp-config` JSON: one server named mydraw, run by the app's own binary in Node mode, never launching another app. */
export function mcpConfigFor(l: McpLaunch): string {
  return JSON.stringify({
    mcpServers: {
      mydraw: { type: "stdio", command: l.execPath, args: [l.script], env: { ELECTRON_RUN_AS_NODE: "1", MYDRAW_USER_DATA: l.userData, MYDRAW_NO_LAUNCH: "1" } },
    },
  });
}

/**
 * Arguments for `claude`. The prompt goes in on stdin: several of these options take a list of
 * values and would swallow a trailing positional prompt.
 */
export function claudeArgs(req: AskRequest, mcpConfig: string): string[] {
  return [
    "-p",
    "--output-format=stream-json",
    "--verbose",
    `--model=${req.model}`,
    `--mcp-config=${mcpConfig}`,
    "--strict-mcp-config",
    // No built-in tools (files, shell, web): the box only edits the drawing.
    "--tools=",
    "--allowedTools=mcp__mydraw",
    `--disallowedTools=${[...ASK_DISALLOWED_TOOLS, ...(req.mode === "ask" ? [] : ASK_RECIPE_DISALLOWED_TOOLS)].join(",")}`,
    `--append-system-prompt=${askSystemPrompt(req)}`,
    // Sessions are kept (in Claude Code's own store, under the box's working folder) so a follow-up
    // in the box can continue the conversation.
    ...(req.resume ? [`--resume=${req.resume}`] : []),
  ];
}

// ---------- the stream ----------

/** What the panel shows while Claude works. */
export type AskEvent =
  | { type: "started"; runId: number; mode: AskRequest["mode"]; model: AskModel }
  | { type: "init"; runId: number; model: string; mcp: "connected" | "failed" | "missing"; sessionId?: string }
  | { type: "tool"; runId: number; id: string; name: string; label: string }
  | { type: "toolError"; runId: number; id: string; message: string }
  | { type: "text"; runId: number; text: string }
  | { type: "done"; runId: number; ok: boolean; text: string; tools: number; costUsd?: number; seconds?: number; sessionId?: string }
  | { type: "error"; runId: number; message: string; noClaude?: boolean }
  | { type: "cancelled"; runId: number };

/** One tool call as the user should read it. */
const TOOL_LABELS: Record<string, string> = {
  list_drawings: "Finding the drawing",
  get_scene: "Reading the drawing",
  get_selection: "Reading the selection",
  get_element: "Reading an element",
  screenshot: "Looking at the drawing",
  add_elements: "Adding shapes",
  update_elements: "Changing elements",
  delete_elements: "Deleting elements",
  move: "Moving",
  connect: "Connecting",
  place_stencil: "Placing an icon",
  search_stencils: "Searching icons",
  build_diagram: "Building a diagram",
  auto_layout: "Laying out",
  tidy: "Tidying",
  align: "Aligning",
  distribute: "Spacing evenly",
  route_around: "Re-routing arrows",
  lint_diagram: "Checking the diagram",
  zoom_to_fit: "Zooming to fit",
  create_zone: "Making a zone",
  add_legend: "Adding a legend",
  recolor: "Recoloring",
  apply_theme: "Applying a theme",
  apply_style_preset: "Applying a style",
  group: "Grouping",
  ungroup: "Ungrouping",
  select: "Selecting",
  undo: "Undoing",
  redo: "Redoing",
};

export function toolLabel(name: string): string {
  const short = name.replace(/^mcp__mydraw__/, "");
  return TOOL_LABELS[short] ?? short.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (isObj(c) && typeof c.text === "string" ? c.text : "")).join(" ");
  return "";
}

/** Events in one stream-json line (none for lines the panel doesn't need, or non-JSON noise). */
export function parseStreamLine(line: string, runId: number): AskEvent[] {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(msg)) return [];
  const out: AskEvent[] = [];
  if (msg.type === "system" && msg.subtype === "init") {
    const servers = Array.isArray(msg.mcp_servers) ? msg.mcp_servers.filter(isObj) : [];
    const mine = servers.find((s) => s.name === "mydraw");
    out.push({
      type: "init",
      runId,
      model: typeof msg.model === "string" ? msg.model : "",
      mcp: !mine ? "missing" : mine.status === "connected" ? "connected" : "failed",
      ...(typeof msg.session_id === "string" && SESSION_ID.test(msg.session_id) ? { sessionId: msg.session_id } : {}),
    });
  } else if (msg.type === "assistant" && isObj(msg.message) && Array.isArray(msg.message.content)) {
    for (const c of msg.message.content) {
      if (!isObj(c)) continue;
      if (c.type === "text" && typeof c.text === "string" && c.text.trim()) out.push({ type: "text", runId, text: c.text.trim() });
      else if (c.type === "tool_use" && typeof c.name === "string") out.push({ type: "tool", runId, id: String(c.id ?? ""), name: c.name, label: toolLabel(c.name) });
    }
  } else if (msg.type === "user" && isObj(msg.message) && Array.isArray(msg.message.content)) {
    for (const c of msg.message.content) {
      if (isObj(c) && c.type === "tool_result" && c.is_error === true) out.push({ type: "toolError", runId, id: String(c.tool_use_id ?? ""), message: resultText(c.content).trim().slice(0, 300) });
    }
  } else if (msg.type === "result") {
    const ok = msg.is_error !== true && (msg.subtype === undefined || msg.subtype === "success");
    const text = typeof msg.result === "string" ? msg.result.trim() : ok ? "" : String(msg.subtype ?? "error").replace(/_/g, " ");
    out.push({
      type: "done",
      runId,
      ok,
      text,
      tools: 0,
      ...(typeof msg.total_cost_usd === "number" ? { costUsd: msg.total_cost_usd } : {}),
      ...(typeof msg.duration_ms === "number" ? { seconds: Math.round(msg.duration_ms / 1000) } : {}),
      ...(typeof msg.session_id === "string" && SESSION_ID.test(msg.session_id) ? { sessionId: msg.session_id } : {}),
    });
  }
  return out;
}

/** The last lines of stderr, for an error message when claude exits without a result. */
export function stderrSummary(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.slice(-3).join(" ").slice(0, 400);
}
