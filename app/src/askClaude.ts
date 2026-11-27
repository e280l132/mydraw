// Ask Claude box (Phase 10), main process: runs `claude -p` with an MCP config that points at this
// app's own MCP server, streams what Claude does to the renderer (`ask:event`) and stops it on
// Cancel. One run at a time. Prompts, arguments and the stream parser: shared/askClaude.ts.
//
// Uses the user's Claude Code login and settings; each run counts against their Claude usage.
// Test override: MYDRAW_CLAUDE (see setup.ts) points at a fake claude.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { app, type WebContents } from "electron";
import { askPrompt, claudeArgs, mcpConfigFor, normalizeAskRequest, parseStreamLine, stderrSummary, type AskEvent } from "../../shared/askClaude";
import { claudeEnv, findClaude } from "./setup";

/** A run that takes longer than this is stopped (a stuck MCP call, a model loop). */
const MAX_RUN_MS = 15 * 60_000;

interface Run {
  id: number;
  child: ChildProcess;
  cancelled: boolean;
  finished: boolean;
  timer: NodeJS.Timeout;
}

let current: Run | null = null;
let nextId = 1;

/** The MCP server script shipped with this build. */
function mcpScript(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "mcp", "index.js") : path.join(app.getAppPath(), "mcp", "dist", "index.js");
}

/** Kills claude and the MCP server it started (its own process group). */
function killRun(r: Run): void {
  try {
    if (r.child.pid) process.kill(-r.child.pid, "SIGTERM");
  } catch {
    r.child.kill("SIGTERM");
  }
}

export function askRunning(): boolean {
  return !!current && !current.finished;
}

/** Starts a run; events go to `target` until the run ends. Returns its id. */
export async function askStart(raw: unknown, target: WebContents): Promise<number> {
  if (askRunning()) throw new Error("Claude is still working on the last request. Wait for it or press Cancel.");
  const req = normalizeAskRequest(raw);
  const id = nextId++;
  const send = (e: AskEvent) => {
    if (!target.isDestroyed()) target.send("ask:event", e);
  };

  const claude = await findClaude();
  if (!claude) {
    send({ type: "error", runId: id, noClaude: true, message: "Claude Code isn't installed (no `claude` command found). Install it, then try again." });
    return id;
  }
  const script = mcpScript();
  if (!fs.existsSync(script)) {
    send({ type: "error", runId: id, message: `The mydraw MCP server is missing (${script}). Run npm run build.` });
    return id;
  }
  const workDir = path.join(app.getPath("userData"), "ask-claude");
  fs.mkdirSync(workDir, { recursive: true });

  const args = claudeArgs(req, mcpConfigFor({ execPath: process.execPath, script, userData: app.getPath("userData") }));
  const child = spawn(claude, args, { cwd: workDir, env: await claudeEnv(), stdio: ["pipe", "pipe", "pipe"], detached: true });
  const run: Run = { id, child, cancelled: false, finished: false, timer: setTimeout(() => killRun(run), MAX_RUN_MS) };
  current = run;
  send({ type: "started", runId: id, mode: req.mode, model: req.model });

  let tools = 0;
  let done: Extract<AskEvent, { type: "done" }> | null = null;
  let buf = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      for (const e of parseStreamLine(line, id)) {
        if (e.type === "tool") tools++;
        if (e.type === "done") done = e; // sent on exit, with the tool count
        else send(e);
      }
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  const finish = (code: number | null, err?: Error) => {
    if (run.finished) return;
    run.finished = true;
    clearTimeout(run.timer);
    if (current === run) current = null;
    const result = done as Extract<AskEvent, { type: "done" }> | null;
    if (run.cancelled) send({ type: "cancelled", runId: id });
    else if (result) send({ ...result, tools });
    else send({ type: "error", runId: id, message: err?.message || stderrSummary(stderr) || `claude stopped (exit code ${code ?? "?"}) without an answer.` });
  };
  child.on("error", (e) => finish(null, e));
  child.on("close", (code) => finish(code));
  child.stdin?.on("error", () => undefined);
  child.stdin?.end(askPrompt(req));
  return id;
}

export function askCancel(): void {
  if (!current || current.finished) return;
  current.cancelled = true;
  killRun(current);
}

/** Stops a run when the app quits. */
export function askShutdown(): void {
  if (current && !current.finished) killRun(current);
}
