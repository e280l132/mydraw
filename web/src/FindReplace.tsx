// Find & replace bar (⌥⌘F). Excalidraw's own search (⌘F) finds text; this one also replaces, over
// the selection or the whole drawing, as one undo step.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { findMatches, replaceAll, selectMatches, type FindScope } from "./textSearch";
import { selectedIds } from "./uiActions";

interface Props {
  api: ExcalidrawImperativeAPI;
  onClose(): void;
  onToast(text: string, error?: boolean): void;
}

const STORE = "mydraw.find";

export function FindReplace({ api, onClose, onToast }: Props) {
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) ?? "{}") as { matchCase?: boolean; wholeWord?: boolean };
    } catch {
      return {};
    }
  }, []);
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(!!saved.matchCase);
  const [wholeWord, setWholeWord] = useState(!!saved.wholeWord);
  const [scope, setScope] = useState<FindScope>(() => (selectedIds(api).length ? "selection" : "all"));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const findInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    findInput.current?.focus();
    findInput.current?.select();
  }, []);
  // The counts follow edits and selection changes made while the bar is open.
  useEffect(() => api.onChange(() => refresh()), [api]);
  useEffect(() => localStorage.setItem(STORE, JSON.stringify({ matchCase, wholeWord })), [matchCase, wholeWord]);

  const opts = { matchCase, wholeWord };
  const summary = find ? findMatches(api, find, opts, scope) : null;
  const hasSelection = selectedIds(api).length > 0;

  const doReplace = () => {
    if (!find) return;
    const r = replaceAll(api, find, replacement, opts, scope);
    onToast(r.replacements ? `Replaced ${r.replacements} in ${r.elements} text${r.elements === 1 ? "" : "s"}` : "No matches", !r.replacements);
  };
  const doSelect = () => {
    if (!find) return;
    const n = selectMatches(api, find, opts, "all");
    if (!n) onToast("No matches", true);
    else setScope("selection");
  };

  return (
    <div
      className="md-find"
      role="dialog"
      aria-label="Find and replace"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (e.target === findInput.current && !e.shiftKey && !e.metaKey && !e.ctrlKey) doSelect();
          else doReplace();
        }
      }}
    >
      <div className="md-find-row">
        <input ref={findInput} className="md-find-input" placeholder="Find" spellCheck={false} value={find} onChange={(e) => setFind(e.target.value)} />
        <span className="md-find-count">{summary ? `${summary.matches} in ${summary.elements.length}` : ""}</span>
        <button className="md-find-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="md-find-row">
        <input className="md-find-input" placeholder="Replace with" spellCheck={false} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <button className="md-find-btn primary" disabled={!summary?.matches} onClick={doReplace}>
          Replace all
        </button>
      </div>
      <div className="md-find-row md-find-opts">
        <label>
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
        </label>
        <label>
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole word
        </label>
        <span className="md-find-spacer" />
        <div className="md-seg md-seg-compact" role="radiogroup" aria-label="Search in">
          <button role="radio" aria-checked={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            Drawing
          </button>
          <button
            role="radio"
            aria-checked={scope === "selection"}
            className={scope === "selection" ? "on" : ""}
            disabled={!hasSelection}
            onClick={() => setScope("selection")}
          >
            Selection
          </button>
        </div>
        <button className="md-find-btn" disabled={!summary?.matches} onClick={doSelect} title="Select every shape with a match and zoom to them">
          Select matches
        </button>
      </div>
    </div>
  );
}
