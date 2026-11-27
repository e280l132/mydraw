import { describe, expect, it } from "vitest";
import { askPrompt, askSystemPrompt, claudeArgs, mcpConfigFor, normalizeAskRequest, normalizeAskSettings, parseStreamLine, stderrSummary, toolLabel, type AskRequest } from "../shared/askClaude";
import { mergeSettings, DEFAULT_SETTINGS } from "../shared/settings";

const req = (over: Partial<AskRequest> = {}): AskRequest => ({ mode: "ask", prompt: "put the web servers in a row", drawing: { id: "tab-1", title: "Homelab" }, selection: [], keep: false, model: "sonnet", ...over });

describe("normalizeAskRequest", () => {
  it("keeps a valid request", () => {
    expect(normalizeAskRequest(req())).toEqual(req());
  });
  it("needs a prompt to ask, not to tidy", () => {
    expect(() => normalizeAskRequest(req({ prompt: "  " }))).toThrow(/Type what/);
    expect(normalizeAskRequest(req({ mode: "tidy", prompt: "" })).mode).toBe("tidy");
  });
  it("refuses junk and fills defaults", () => {
    expect(() => normalizeAskRequest(null)).toThrow();
    expect(() => normalizeAskRequest({ ...req(), mode: "rm" })).toThrow();
    expect(() => normalizeAskRequest({ ...req(), drawing: {} })).toThrow(/No drawing/);
    const r = normalizeAskRequest({ ...req(), model: "gpt", selection: ["a", 3, "", "b"], keep: "yes" });
    expect(r.model).toBe("sonnet");
    expect(r.selection).toEqual(["a", "b"]);
    expect(r.keep).toBe(false);
  });
  it("caps the prompt", () => {
    expect(normalizeAskRequest(req({ prompt: "x".repeat(20000) })).prompt.length).toBe(8000);
  });
});

describe("prompts", () => {
  it("asks as typed and names the drawing and scope in the system prompt", () => {
    expect(askPrompt(req())).toBe("put the web servers in a row");
    const sys = askSystemPrompt(req());
    expect(sys).toContain('drawing: "tab-1"');
    expect(sys).toContain("Homelab");
    expect(sys).toContain("whole drawing");
    expect(askSystemPrompt(req({ selection: ["a", "b"] }))).toContain("Selected ids: a, b");
  });
  it("tidy runs the recipe; a selection keeps the arrangement", () => {
    const whole = askPrompt(req({ mode: "tidy", prompt: "" }));
    expect(whole).toContain('Tidy the mydraw drawing "tab-1"');
    expect(whole).toContain("run auto_layout");
    const sel = askPrompt(req({ mode: "tidy", prompt: "the request path", selection: ["n1"] }));
    expect(sel).toContain("with the focus on: the request path");
    expect(sel).toContain("ids n1");
    expect(sel).toContain("do NOT run auto_layout");
  });
});

describe("polish and the design guide", () => {
  it("polish runs the polish recipe with the guide; never moves things", () => {
    const p = askPrompt(req({ mode: "polish", prompt: "make the request path stand out", selection: ["n1", "n2"] }));
    expect(p).toContain('Polish the look of the mydraw drawing "tab-1"');
    expect(p).toContain("with the focus on: make the request path stand out");
    expect(p).toContain("ids n1, n2");
    expect(p).toContain("Design guide");
    expect(p).toContain("Do NOT move");
    expect(normalizeAskRequest(req({ mode: "polish", prompt: "" })).mode).toBe("polish");
  });
  it("every Ask carries the design guide", () => {
    expect(askSystemPrompt(req())).toContain("Design guide for mydraw diagrams");
  });
});

describe("claude arguments", () => {
  const cfg = mcpConfigFor({ execPath: "/A/mydraw.app/Contents/MacOS/mydraw", script: "/A/mydraw.app/Contents/Resources/mcp/index.js", userData: "/U" });
  it("points the mydraw server at this app, run in Node mode, never launching another", () => {
    const s = JSON.parse(cfg).mcpServers.mydraw;
    expect(s.command).toBe("/A/mydraw.app/Contents/MacOS/mydraw");
    expect(s.args).toEqual(["/A/mydraw.app/Contents/Resources/mcp/index.js"]);
    expect(s.env).toEqual({ ELECTRON_RUN_AS_NODE: "1", MYDRAW_USER_DATA: "/U", MYDRAW_NO_LAUNCH: "1" });
  });
  it("uses only the mydraw tools and keeps the prompt off the command line", () => {
    const args = claudeArgs(req({ model: "opus" }), cfg);
    expect(args[0]).toBe("-p");
    expect(args).toContain("--model=opus");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--tools=");
    expect(args).toContain("--allowedTools=mcp__mydraw");
    expect(args.find((a) => a.startsWith("--disallowedTools="))).toContain("mcp__mydraw__delete_stencil");
    expect(args).not.toContain("put the web servers in a row");
    // Every option carries its value with "=", so none can swallow another argument.
    expect(args.filter((a) => !a.startsWith("-"))).toEqual([]);
  });
});

describe("parseStreamLine", () => {
  const line = (o: unknown) => JSON.stringify(o);
  it("reads init, text, tool calls, tool errors and the result", () => {
    expect(parseStreamLine(line({ type: "system", subtype: "init", model: "claude-sonnet-5-5", mcp_servers: [{ name: "mydraw", status: "connected" }] }), 1)).toEqual([{ type: "init", runId: 1, model: "claude-sonnet-5-5", mcp: "connected" }]);
    expect(parseStreamLine(line({ type: "system", subtype: "init", mcp_servers: [{ name: "mydraw", status: "failed" }] }), 1)[0]).toMatchObject({ mcp: "failed" });
    expect(parseStreamLine(line({ type: "system", subtype: "init", mcp_servers: [] }), 1)[0]).toMatchObject({ mcp: "missing" });
    expect(
      parseStreamLine(
        line({ type: "assistant", message: { content: [{ type: "text", text: " Looking. " }, { type: "tool_use", id: "t1", name: "mcp__mydraw__get_scene", input: {} }] } }),
        2,
      ),
    ).toEqual([
      { type: "text", runId: 2, text: "Looking." },
      { type: "tool", runId: 2, id: "t1", name: "mcp__mydraw__get_scene", label: "Reading the drawing" },
    ]);
    expect(parseStreamLine(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: [{ type: "text", text: "no such id" }] }] } }), 2)).toEqual([
      { type: "toolError", runId: 2, id: "t1", message: "no such id" },
    ]);
    expect(parseStreamLine(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }), 2)).toEqual([]);
    expect(parseStreamLine(line({ type: "result", subtype: "success", is_error: false, result: "Lined up 3 servers.", total_cost_usd: 0.02, duration_ms: 12400 }), 3)).toEqual([
      { type: "done", runId: 3, ok: true, text: "Lined up 3 servers.", tools: 0, costUsd: 0.02, seconds: 12 },
    ]);
    expect(parseStreamLine(line({ type: "result", subtype: "error_max_turns", is_error: true }), 3)[0]).toMatchObject({ ok: false, text: "error max turns" });
  });
  it("ignores noise", () => {
    expect(parseStreamLine("not json", 1)).toEqual([]);
    expect(parseStreamLine(line({ type: "rate_limit_event" }), 1)).toEqual([]);
    expect(parseStreamLine(line({ type: "system", subtype: "hook_started" }), 1)).toEqual([]);
  });
});

describe("helpers", () => {
  it("labels tools", () => {
    expect(toolLabel("mcp__mydraw__align")).toBe("Aligning");
    expect(toolLabel("mcp__mydraw__set_properties")).toBe("Set properties");
  });
  it("summarises stderr", () => {
    expect(stderrSummary("a\n\nb\nc\nd\n")).toBe("b c d");
  });
  it("settings: model validated and merged", () => {
    expect(normalizeAskSettings({ model: "opus" })).toEqual({ model: "opus" });
    expect(normalizeAskSettings({ model: "x" })).toEqual({ model: "sonnet" });
    expect(mergeSettings(DEFAULT_SETTINGS, { askClaude: { model: "haiku" } }).askClaude.model).toBe("haiku");
    expect(mergeSettings(DEFAULT_SETTINGS, { askClaude: 5 }).askClaude.model).toBe("sonnet");
    expect(DEFAULT_SETTINGS.askClaude.model).toBe("sonnet");
  });
});

describe("follow-ups, outlines and conventions", () => {
  const sid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("keeps a valid session id and plan flag, drops junk", () => {
    expect(normalizeAskRequest({ ...req(), resume: sid, plan: true })).toMatchObject({ resume: sid, plan: true });
    expect(normalizeAskRequest({ ...req(), resume: "--dangerous" }).resume).toBeUndefined();
    expect(normalizeAskRequest({ ...req({ mode: "tidy", prompt: "" }), plan: true }).plan).toBeUndefined();
  });
  it("resumes the session and keeps sessions", () => {
    const args = claudeArgs(req({ resume: sid }), "{}");
    expect(args).toContain(`--resume=${sid}`);
    expect(args).not.toContain("--no-session-persistence");
    expect(claudeArgs(req(), "{}").some((a) => a.startsWith("--resume"))).toBe(false);
  });
  it("tells Claude about the follow-up and the outline", () => {
    expect(askSystemPrompt(req({ resume: sid }))).toMatch(/continues the conversation/);
    expect(askSystemPrompt(req({ plan: true }))).toMatch(/PLAN FIRST/);
    expect(askSystemPrompt(req())).not.toMatch(/PLAN FIRST/);
  });
  it("adds the conventions of the domain asked about", () => {
    const aws = askSystemPrompt(req({ prompt: "3-tier web app on AWS with RDS Multi-AZ" }));
    expect(aws).toMatch(/Conventions for AWS architecture/);
    expect(aws).toMatch(/grid/);
    expect(askSystemPrompt(req({ prompt: "draw my homelab VLANs" }))).toMatch(/Networks and homelabs/);
    expect(askSystemPrompt(req({ prompt: "make it blue" }))).toMatch(/get_conventions/);
  });
  it("reads the session id from init and result lines", () => {
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: sid, mcp_servers: [{ name: "mydraw", status: "connected" }] }), 1)[0]).toMatchObject({ type: "init", sessionId: sid });
    expect(parseStreamLine(JSON.stringify({ type: "result", subtype: "success", result: "ok", session_id: sid }), 1)[0]).toMatchObject({ type: "done", sessionId: sid });
  });
});

describe("recipe runs can't edit raw elements", () => {
  it("disallows raw_update and set_scene for Tidy and Polish, not for Ask", () => {
    const dis = (mode: AskRequest["mode"]) => claudeArgs(req({ mode, prompt: "" }), "{}").find((a) => a.startsWith("--disallowedTools="))!;
    expect(dis("tidy")).toMatch(/raw_update/);
    expect(dis("polish")).toMatch(/set_scene/);
    expect(dis("ask")).not.toMatch(/raw_update/);
  });
});
