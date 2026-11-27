// Ask Claude box (⌥⌘J or the tab bar's Ask Claude button, Phase 10): type what should change and
// Claude Code does it with the mydraw MCP tools (`claude -p`, app/src/askClaude.ts); "Tidy with
// Claude" runs the tidy recipe and "Polish" the design recipe (shared/recipes.ts) on the drawing or
// the selection. Drops down under the tab-bar button. Shows each step live; Cancel stops the run. Every tool call is one undo
// step, so the user can step back through Claude's changes.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ASK_MODEL_LABELS, ASK_MODELS, type AskModel, type AskRequest } from "../../shared/askClaude";
import { askBusy, cancelAsk, clearAsk, startAsk, useAskState } from "./askRun";
import { selectedIds } from "./uiActions";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  drawing: { id: string; title: string } | null;
  model: AskModel;
  onModel(model: AskModel): void;
  onSetup(): void;
  onClose(): void;
}

const KEEP_STORE = "mydraw.askKeep";

/** Builds a request for the active drawing and its current selection. */
export function askRequest(api: ExcalidrawImperativeAPI, drawing: { id: string; title: string }, mode: AskRequest["mode"], prompt: string, model: AskModel, keep = localStorage.getItem(KEEP_STORE) === "1"): AskRequest {
  return { mode, prompt: prompt.trim(), drawing, selection: selectedIds(api), keep, model };
}

export function AskClaude({ api, drawing, model, onModel, onSetup, onClose }: Props) {
  const s = useAskState();
  const [text, setText] = useState("");
  const [keep, setKeep] = useState(() => localStorage.getItem(KEEP_STORE) === "1");
  const [selCount, setSelCount] = useState(() => (api ? selectedIds(api).length : 0));
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const busy = s.status === "starting" || s.status === "running";
  const [pos, setPos] = useState<CSSProperties | undefined>();

  // Hang under the tab bar's Ask Claude button (bottom centre, from the CSS, when it isn't there).
  useLayoutEffect(() => {
    const place = () => {
      const r = document.querySelector(".md-ask-btn")?.getBoundingClientRect();
      setPos(r ? { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), bottom: "auto", left: "auto", transform: "none" } : undefined);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (!api) return;
    setSelCount(selectedIds(api).length);
    return api.onChange(() => setSelCount(selectedIds(api).length));
  }, [api]);
  useEffect(() => localStorage.setItem(KEEP_STORE, keep ? "1" : "0"), [keep]);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [s.steps.length]);

  const run = (mode: AskRequest["mode"]) => {
    if (!api || !drawing || askBusy()) return;
    if (mode === "ask" && !text.trim()) return input.current?.focus();
    void startAsk(askRequest(api, drawing, mode, text, model, keep));
    if (mode === "ask") setText("");
  };

  const scope = selCount ? `${selCount} selected` : "whole drawing";
  return (
    <div className={`md-ask${pos ? " md-ask-drop" : ""}`} style={pos} data-ask-state={s.status} role="dialog" aria-label="Ask Claude">
      <div className="md-ask-head">
        <span className="md-ask-title">Ask Claude</span>
        <span className="md-ask-scope" title="What Claude works on: the selection, or the whole drawing when nothing is selected">
          {scope}
        </span>
        <span className="md-find-spacer" />
        <select className="md-ask-model" value={model} disabled={busy} onChange={(e) => onModel(e.target.value as AskModel)} title="Model (also in Preferences)">
          {ASK_MODELS.map((m) => (
            <option key={m} value={m}>
              {ASK_MODEL_LABELS[m]}
            </option>
          ))}
        </select>
        <button className="md-find-close" onClick={onClose} aria-label="Close" title="Close (a running request carries on)">
          ×
        </button>
      </div>
      <textarea
        ref={input}
        className="md-find-input md-ask-input"
        rows={3}
        value={text}
        placeholder={'e.g. "put the web servers in a row" or "add a Redis cache between app and db". For Tidy / Polish: what matters most (optional).'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            run("ask");
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        disabled={!drawing}
      />
      <div className="md-find-row md-find-opts">
        <button className="md-find-btn primary md-ask-send" disabled={busy || !drawing || !text.trim()} onClick={() => run("ask")} title="⌘↵">
          Ask
        </button>
        <button className="md-find-btn md-ask-tidy" disabled={busy || !drawing} onClick={() => run("tidy")} title="Claude tidies the diagram by meaning: roles, flow, peers in rows, clean arrows; checks with lint and a screenshot">
          Tidy with Claude
        </button>
        <button className="md-find-btn md-ask-polish" disabled={busy || !drawing} onClick={() => run("polish")} title="Claude restyles the diagram: colour by role, fills, stroke weights, shadows, arrow kinds, legend. Doesn't move anything">
          Polish
        </button>
        <label title="Tidy: small moves only, no fresh layout (always so for a selection)">
          <input type="checkbox" checked={keep || selCount > 0} disabled={busy || selCount > 0} onChange={(e) => setKeep(e.target.checked)} /> Keep arrangement
        </label>
        <span className="md-find-spacer" />
        {busy && (
          <button className="md-find-btn md-ask-cancel" onClick={cancelAsk}>
            Cancel
          </button>
        )}
      </div>
      {s.status !== "idle" && (
        <div className="md-ask-run">
          {s.asked && <div className="md-ask-asked">{s.asked}</div>}
          {!!s.steps.length && (
            <ol className="md-ask-steps" ref={log}>
              {s.steps.map((step, i) => (
                <li key={`${step.id}-${i}`} className={step.failed ? "failed" : ""} title={step.failed}>
                  {step.label}
                  {step.failed ? " (failed)" : ""}
                </li>
              ))}
            </ol>
          )}
          {busy && (
            <div className="md-ask-working">
              <span className="md-ask-spinner" aria-hidden /> {s.note ? s.note.slice(0, 240) : s.status === "starting" ? "Starting Claude Code…" : "Working…"}
            </div>
          )}
          {s.mcpFailed && busy && <div className="md-ask-warn">Claude couldn't connect to mydraw's tools; it may stop without changes.</div>}
          {!busy && (
            <div className={`md-ask-result ${s.status === "failed" ? "error" : ""}`}>
              <p>{s.result}</p>
              <div className="md-find-row md-ask-foot">
                {s.status === "done" && <span className="md-ask-meta">{[`${s.tools} step${s.tools === 1 ? "" : "s"}`, s.seconds !== undefined ? `${s.seconds} s` : "", "⌘Z undoes one step"].filter(Boolean).join(" · ")}</span>}
                {s.noClaude && (
                  <button className="md-find-btn" onClick={onSetup}>
                    Set up…
                  </button>
                )}
                <span className="md-find-spacer" />
                <button className="md-find-btn md-ask-clear" onClick={clearAsk}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {s.status === "idle" && <div className="md-ask-hint">Runs Claude Code on this computer with your Claude account; each request uses your Claude usage.</div>}
    </div>
  );
}
