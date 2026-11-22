// Diagram lint panel (⌥⌘L): problems in the drawing (overlaps, free arrow ends, unlabeled nodes,
// missing IPs, off-palette colors), re-checked as the drawing changes. Click a row to select and
// show the element; "Fix" applies a safe fix (one undo step), "Fix all safe issues" all of them.
import { useEffect, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { LintIssue, LintResult } from "../../shared/lint";
import { applyLintFixes, lintDrawing, revealIssue, sceneKey } from "./lintOps";

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  onClose(): void;
}

const EMPTY: LintResult = { issues: [], summary: { overlap: 0, "unconnected-arrow": 0, "unlabeled-node": 0, "missing-ip": 0, "off-palette-color": 0 } };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function LintPanel({ api, onClose }: Props) {
  const [result, setResult] = useState<LintResult>(EMPTY);

  useEffect(() => {
    if (!api) {
      setResult(EMPTY);
      return;
    }
    let key = "";
    let timer: number | undefined;
    const run = () => {
      timer = undefined;
      const k = sceneKey(api);
      if (k === key) return;
      key = k;
      setResult(lintDrawing(api));
    };
    run();
    // Re-lint at most every 300 ms while the drawing changes (selection/scroll changes are skipped by the key).
    const off = api.onChange(() => {
      if (timer === undefined) timer = window.setTimeout(run, 300);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [api]);

  const { issues } = result;
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");
  const fixable = issues.filter((i) => i.fix);

  const fix = (list: readonly LintIssue[]) => {
    if (!api || !list.length) return;
    applyLintFixes(api, list);
    setResult(lintDrawing(api));
  };

  const row = (i: LintIssue, n: number) => (
    <div
      key={`${i.rule}:${i.id}:${n}`}
      className={`md-lint-row ${i.severity}`}
      data-rule={i.rule}
      data-id={i.id}
      title={`${i.message} (${i.rule})`}
      onClick={() => api && revealIssue(api, i)}
    >
      <span className="md-lint-icon" aria-label={i.severity}>
        {i.severity === "warning" ? "▲" : "i"}
      </span>
      <span className="md-lint-text">
        <span className="md-lint-msg">{i.message}</span>
        <span className="md-lint-label">{i.label}</span>
      </span>
      {i.fix && (
        <button
          className="md-lint-fix"
          title="Apply the suggested fix"
          onClick={(e) => {
            e.stopPropagation();
            fix([i]);
          }}
        >
          Fix
        </button>
      )}
    </div>
  );

  return (
    <aside className="md-lint" aria-label="Diagram lint">
      <div className="md-panel-head">
        <span className="md-panel-title">Diagram lint</span>
        <div className="md-panel-actions">
          <button className="md-icon-btn" title="Close" aria-label="Close diagram lint" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="md-lint-bar">
        <span className="md-lint-counts">
          {issues.length ? `${plural(warnings.length, "warning")} · ${infos.length} info` : ""}
        </span>
        <button className="md-lint-fixall" disabled={!fixable.length} onClick={() => fix(fixable)}>
          Fix all safe issues{fixable.length ? ` (${fixable.length})` : ""}
        </button>
      </div>
      <div className="md-lint-list">
        {!issues.length && <div className="md-lint-empty">No problems found</div>}
        {!!warnings.length && <div className="md-lint-group">Warnings</div>}
        {warnings.map(row)}
        {!!infos.length && <div className="md-lint-group">Info</div>}
        {infos.map(row)}
      </div>
    </aside>
  );
}
