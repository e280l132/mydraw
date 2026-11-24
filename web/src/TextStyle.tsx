// Bold / Italic buttons in Excalidraw's Font family section (portaled into a host that App's
// panel observer appends to that fieldset, like the fine-tune buttons). Logic: textStyleOps.ts.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { NO_TEXT_STYLE, textStyleState, textStyleTargets, toggleTextStyle } from "./textStyleOps";
import { onFontsChanged } from "./fontRegistry";
import { sc } from "../../shared/shortcuts";

/** The host element inside Excalidraw's Font family fieldset (null when that section isn't shown). */
export function attachTextStyleHost(column: HTMLElement): HTMLElement | null {
  const picker = column.querySelector<HTMLElement>('[data-testid="font-family-show-fonts"]');
  const fieldset = picker?.closest("fieldset");
  if (!fieldset) return null;
  let host = fieldset.querySelector<HTMLElement>(":scope > .md-ts-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "md-ts-host";
  }
  if (fieldset.lastElementChild !== host) fieldset.append(host);
  return host;
}

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** Bumps whenever the selection or a selected element changes. */
  tick: number;
  host: HTMLElement | null;
  onToast(text: string, error?: boolean): void;
}

export function TextStyle({ api, tick, host, onToast }: Props) {
  // Re-read when fonts are installed or removed (a typeface can gain or lose its bold face).
  const [fontsTick, setFontsTick] = useState(0);
  const bump = useCallback(() => setFontsTick((n) => n + 1), []);
  useEffect(() => onFontsChanged(bump), [bump]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const state = useMemo(() => (api ? textStyleState(textStyleTargets(api)) : NO_TEXT_STYLE), [api, tick, fontsTick]);
  if (!host || !api) return null;

  const run = (kind: "bold" | "italic") => {
    const r = toggleTextStyle(api, kind);
    if (typeof r === "string") onToast(r, true);
  };
  const missing = (kind: "bold" | "italic") =>
    state.count === 0
      ? "Select text first"
      : kind === "bold"
        ? "This font has no bold face"
        : "This font has no italic face (Professional and Mono fonts have one)";

  return createPortal(
    <div className="md-ts" role="group" aria-label="Text style">
      <button
        type="button"
        className={`md-ts-btn${state.bold ? " active" : ""}`}
        aria-pressed={state.bold}
        aria-label="Bold"
        disabled={!state.canBold}
        title={state.canBold ? `Bold (${sc("bold")})` : missing("bold")}
        onClick={() => run("bold")}
      >
        <b>B</b>
      </button>
      <button
        type="button"
        className={`md-ts-btn${state.italic ? " active" : ""}`}
        aria-pressed={state.italic}
        aria-label="Italic"
        disabled={!state.canItalic}
        title={state.canItalic ? `Italic (${sc("italic")})` : missing("italic")}
        onClick={() => run("italic")}
      >
        <i>I</i>
      </button>
    </div>,
    host,
  );
}

