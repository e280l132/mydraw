// Find & replace bar (⌥⌘F). Excalidraw's own search (⌘F) finds text; this one also replaces, over
// the selection or the whole drawing. Previous / Next step through the matches (selecting and zooming to
// each), Replace changes the current one, Replace all changes every match as one undo step.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { countMatches } from "../../shared/findReplace";
import { findMatches, goToMatch, listMatches, replaceAll, replaceOne, selectMatches, type FindScope } from "./textSearch";
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
  // Index of the match last shown (-1: none yet) and, while stepping through a selection, the ids it
  // was frozen to (stepping selects each match's shape, which would otherwise shrink the scope).
  const [cur, setCur] = useState(-1);
  const [frozen, setFrozen] = useState<string[] | null>(null);
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
  const ids = scope === "selection" ? frozen ?? undefined : undefined;
  const summary = find ? findMatches(api, find, opts, scope, ids) : null;
  const hasSelection = selectedIds(api).length > 0;
  const total = summary?.matches ?? 0;

  const chooseScope = (next: FindScope) => {
    setScope(next);
    setFrozen(null);
    setCur(-1);
  };
  /** Freeze a selection scope before the first step, so stepping doesn't change what is searched. */
  const scopeIdsForStep = (): string[] | undefined => {
    if (scope !== "selection") return undefined;
    const keep = frozen ?? selectedIds(api);
    if (!frozen) setFrozen(keep);
    return keep;
  };
  const step = (dir: 1 | -1) => {
    if (!find) return;
    const list = listMatches(api, find, opts, scope, scopeIdsForStep());
    if (!list.length) return onToast("No matches", true);
    const next = cur < 0 ? (dir === 1 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
    setCur(next);
    goToMatch(api, list[next]);
  };
  const doReplaceOne = () => {
    if (!find) return;
    const keep = scopeIdsForStep();
    const list = listMatches(api, find, opts, scope, keep);
    if (!list.length) return onToast("No matches", true);
    const at = cur < 0 ? 0 : Math.min(cur, list.length - 1);
    if (!replaceOne(api, list[at], find, replacement, opts)) return onToast("That match has changed", true);
    // The next match now sits at the same index, unless the replacement itself contains the search text.
    const after = listMatches(api, find, opts, scope, keep);
    const next = at + countMatches(replacement, find, opts);
    if (next < after.length) {
      setCur(next);
      goToMatch(api, after[next]);
    } else {
      setCur(-1);
      onToast(after.length ? "Reached the end of the matches" : "No more matches");
    }
  };
  const doReplace = () => {
    if (!find) return;
    const r = replaceAll(api, find, replacement, opts, scope, ids);
    setCur(-1);
    onToast(r.replacements ? `Replaced ${r.replacements} in ${r.elements} text${r.elements === 1 ? "" : "s"}` : "No matches", !r.replacements);
  };
  const doSelect = () => {
    if (!find) return;
    const n = selectMatches(api, find, opts, "all");
    if (!n) onToast("No matches", true);
    else chooseScope("selection");
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
          // Find box: Enter = next match, Shift+Enter = previous. Replace box: Enter = replace this one,
          // ⌘/Ctrl+Enter = replace all.
          if (e.metaKey || e.ctrlKey) doReplace();
          else if (e.target === findInput.current) step(e.shiftKey ? -1 : 1);
          else doReplaceOne();
        }
      }}
    >
      <div className="md-find-row">
        <input
          ref={findInput}
          className="md-find-input"
          placeholder="Find"
          spellCheck={false}
          value={find}
          onChange={(e) => {
            setFind(e.target.value);
            setCur(-1);
          }}
        />
        <span className="md-find-count" data-testid="find-count">
          {summary ? (cur >= 0 && cur < total ? `${cur + 1} of ${total}` : `${total} in ${summary.elements.length}`) : ""}
        </span>
        <button className="md-find-btn md-find-step" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!total} onClick={() => step(-1)}>
          ↑
        </button>
        <button className="md-find-btn md-find-step" aria-label="Next match" title="Next match (Enter)" disabled={!total} onClick={() => step(1)}>
          ↓
        </button>
        <button className="md-find-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="md-find-row">
        <input className="md-find-input" placeholder="Replace with" spellCheck={false} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        <button className="md-find-btn" disabled={!total} onClick={doReplaceOne} title="Replace this match and go to the next (Enter)">
          Replace
        </button>
        <button className="md-find-btn primary" disabled={!total} onClick={doReplace} title="Replace every match, one undo step (⌘Enter)">
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
          <button role="radio" aria-checked={scope === "all"} className={scope === "all" ? "on" : ""} onClick={() => chooseScope("all")}>
            Drawing
          </button>
          <button
            role="radio"
            aria-checked={scope === "selection"}
            className={scope === "selection" ? "on" : ""}
            disabled={!hasSelection}
            onClick={() => chooseScope("selection")}
          >
            Selection
          </button>
        </div>
        <button className="md-find-btn" disabled={!total} onClick={doSelect} title="Select every shape with a match and zoom to them">
          Select matches
        </button>
      </div>
    </div>
  );
}
