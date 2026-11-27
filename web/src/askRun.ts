// Ask Claude box: state of the current / last run, kept outside React so a run carries on (and its
// log stays) when the panel is closed. Fed by `ask:event` from app/src/askClaude.ts.
import { useSyncExternalStore } from "react";
import type { AskEvent, AskRequest } from "../../shared/askClaude";

export interface AskStep {
  id: string;
  label: string;
  failed?: string;
}

export interface AskState {
  status: "idle" | "starting" | "running" | "done" | "failed" | "cancelled";
  runId: number | null;
  mode: AskRequest["mode"] | null;
  /** What the user asked (shown above the log). */
  asked: string;
  steps: AskStep[];
  /** Claude's latest words while it works. */
  note: string;
  /** Final answer or error message. */
  result: string;
  noClaude: boolean;
  mcpFailed: boolean;
  costUsd?: number;
  seconds?: number;
  tools: number;
}

const IDLE: AskState = { status: "idle", runId: null, mode: null, asked: "", steps: [], note: "", result: "", noClaude: false, mcpFailed: false, tools: 0 };

let state: AskState = IDLE;
const listeners = new Set<() => void>();
const doneListeners = new Set<(s: AskState) => void>();

function set(next: AskState) {
  state = next;
  for (const l of listeners) l();
  if (next.status === "done" || next.status === "failed" || next.status === "cancelled") for (const l of doneListeners) l(next);
}

export const askState = () => state;
export const askBusy = () => state.status === "starting" || state.status === "running";

export function useAskState(): AskState {
  return useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, askState);
}

/** Called once a run finished, failed or was cancelled. */
export function onAskFinished(cb: (s: AskState) => void): () => void {
  doneListeners.add(cb);
  return () => doneListeners.delete(cb);
}

let subscribed = false;
function subscribe() {
  if (subscribed || !window.mydraw?.onAskEvent) return;
  subscribed = true;
  window.mydraw.onAskEvent(handle);
}

function handle(e: AskEvent) {
  if (state.runId !== null && e.runId !== state.runId) return;
  switch (e.type) {
    case "started":
      return set({ ...state, runId: e.runId, status: "running" });
    case "init":
      if (e.mcp !== "connected") return set({ ...state, mcpFailed: true });
      return;
    case "tool":
      return set({ ...state, steps: [...state.steps, { id: e.id, label: e.label }] });
    case "toolError":
      return set({ ...state, steps: state.steps.map((s) => (s.id === e.id ? { ...s, failed: e.message || "failed" } : s)) });
    case "text":
      return set({ ...state, note: e.text });
    case "done":
      return set({ ...state, status: e.ok ? "done" : "failed", result: e.text || (e.ok ? "Done." : "Claude stopped with an error."), costUsd: e.costUsd, seconds: e.seconds, tools: e.tools, note: "" });
    case "error":
      return set({ ...state, runId: e.runId, status: "failed", result: e.message, noClaude: !!e.noClaude, note: "" });
    case "cancelled":
      return set({ ...state, status: "cancelled", result: "Cancelled. Changes Claude already made stay; undo steps back through them.", note: "" });
  }
}

/** Starts a run (one at a time). */
export async function startAsk(req: AskRequest): Promise<void> {
  subscribe();
  if (askBusy()) return;
  set({ ...IDLE, status: "starting", mode: req.mode, asked: req.mode === "ask" ? req.prompt : `${req.mode === "tidy" ? "Tidy" : "Polish"}${req.selection.length ? " the selection" : ""}${req.prompt ? `: ${req.prompt}` : ""}` });
  try {
    const runId = await window.mydraw.askStart(req);
    // Events may already have arrived for this run (an early error is sent before the id returns).
    if (state.runId === null) set({ ...state, runId });
  } catch (e) {
    set({ ...state, status: "failed", result: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e) });
  }
}

export function cancelAsk(): void {
  if (askBusy()) void window.mydraw.askCancel();
}

export function clearAsk(): void {
  if (!askBusy()) set(IDLE);
}

subscribe();
