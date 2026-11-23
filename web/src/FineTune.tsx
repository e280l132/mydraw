// Fine-tune buttons at the end of Excalidraw's Stroke width, Sloppiness and Edges rows: each opens a
// popover with a slider (and a number box) for values beyond Excalidraw's three presets.
// Logic and ranges: shared/fineTune.ts. The buttons are portaled into hosts that App's panel
// observer appends to those rows (`attachFineTuneHosts`); Excalidraw owns the rows, so a host is
// re-appended whenever Excalidraw re-renders them.
//
// A slider drag previews with CaptureUpdateAction.NEVER, then restores the starting elements (NEVER)
// and commits once (IMMEDIATELY), so one drag = one undo step (same pattern as IconRecolorSession).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  canTune,
  cleanValue,
  FINE_TUNE,
  FINE_TUNE_GROUP,
  isCustom,
  patchFor,
  radiusMax,
  selectionValue,
  SLIDER_STEPS,
  sliderToValue,
  valueToSlider,
  type FineTuneKind,
  type TunableElement,
} from "../../shared/fineTune";
import type { El } from "./agent/sceneOps";
import { commitElements } from "./uiActions";

export type FineTuneHosts = Partial<Record<FineTuneKind, HTMLElement>>;

const KINDS = Object.keys(FINE_TUNE_GROUP) as FineTuneKind[];

/** Make sure each shown row (Stroke width / Sloppiness / Edges) ends with our host span. */
export function attachFineTuneHosts(column: HTMLElement): FineTuneHosts {
  const out: FineTuneHosts = {};
  for (const kind of KINDS) {
    const radio = column.querySelector<HTMLInputElement>(`input[type=radio][name="${FINE_TUNE_GROUP[kind]}"]`);
    const list = radio?.closest(".buttonList");
    if (!list) continue;
    let host = list.querySelector<HTMLElement>(":scope > .md-ft-host");
    if (!host) {
      host = document.createElement("span");
      host.className = "md-ft-host";
      host.dataset.ft = kind;
    }
    if (list.lastElementChild !== host) list.append(host);
    out[kind] = host;
  }
  return out;
}

export const sameHosts = (a: FineTuneHosts, b: FineTuneHosts) => KINDS.every((k) => a[k] === b[k]);

/** Selected elements a slider applies to. */
function targets(api: ExcalidrawImperativeAPI, kind: FineTuneKind): El[] {
  const sel = api.getAppState().selectedElementIds;
  return api.getSceneElements().filter((e) => sel[e.id] && !e.locked && canTune(kind, e as unknown as TunableElement));
}

const appStateFor = (kind: FineTuneKind, value: number): Partial<AppState> =>
  kind === "strokeWidth"
    ? { currentItemStrokeWidth: value }
    : kind === "roughness"
      ? { currentItemRoughness: value }
      : { currentItemRoundness: value > 0 ? "round" : "sharp" };

/**
 * With nothing to tune selected (e.g. the pen tool is active), stroke width and sloppiness set the
 * value for the next element drawn (`currentItem*`). Corner radius can't: `currentItemRoundness`
 * is only round/sharp.
 */
const defaultsOnly = (kind: FineTuneKind, els: readonly El[]) => !els.length && kind !== "radius";

/** The `currentItem*` value a slider changes when nothing is selected. */
function defaultValue(api: ExcalidrawImperativeAPI, kind: FineTuneKind): number {
  const s = api.getAppState();
  return kind === "roughness" ? s.currentItemRoughness : s.currentItemStrokeWidth;
}

/** Preview / commit / cancel of one slider drag. */
class TuneSession {
  private base: Map<string, El> | null = null;
  constructor(private api: ExcalidrawImperativeAPI) {}

  preview(kind: FineTuneKind, value: number): void {
    if (!this.base) this.base = new Map(targets(this.api, kind).map((e) => [e.id, e]));
    const base = this.base;
    const patch = patchFor(kind, value);
    this.api.updateScene({
      elements: this.api.getSceneElementsIncludingDeleted().map((e) => (base.has(e.id) ? newElementWith(base.get(e.id)!, patch as never) : e)),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  commit(kind: FineTuneKind, value: number): void {
    const ids = this.base ? [...this.base.keys()] : targets(this.api, kind).map((e) => e.id);
    this.restore();
    if (!ids.length) {
      // Only the default for new elements changes: not an undo step.
      this.api.updateScene({ appState: appStateFor(kind, value) as AppState, captureUpdate: CaptureUpdateAction.NEVER });
      return;
    }
    const live = new Map(this.api.getSceneElements().map((e) => [e.id, e]));
    const patch = patchFor(kind, value);
    const changed = ids.flatMap((id) => (live.has(id) ? [newElementWith(live.get(id)!, patch as never)] : []));
    commitElements(this.api, changed, [], appStateFor(kind, value));
  }

  /** Put the elements back as they were before the drag (not recorded in undo). */
  restore(): void {
    const base = this.base;
    this.base = null;
    if (!base) return;
    this.api.updateScene({
      elements: this.api.getSceneElementsIncludingDeleted().map((e) => base.get(e.id) ?? e),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  get active(): boolean {
    return !!this.base;
  }
}

const SlidersIcon = () => (
  <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <path d="M3 5h8M15 5h2M3 10h3M10 10h7M3 15h9M16 15h1" />
    <circle cx="13" cy="5" r="1.8" />
    <circle cx="8" cy="10" r="1.8" />
    <circle cx="14" cy="15" r="1.8" />
  </svg>
);

const fmt = (v: number) => String(Number(v.toFixed(2)));

interface Props {
  api: ExcalidrawImperativeAPI | undefined;
  /** Bumped by App when the selection or a selected element's stroke/roughness/roundness/size changes. */
  tick: number;
  hosts: FineTuneHosts;
}

export function FineTune({ api, tick, hosts }: Props) {
  const [open, setOpen] = useState<FineTuneKind | null>(null);
  const anchors = useRef<Partial<Record<FineTuneKind, HTMLButtonElement | null>>>({});

  // Close when the row goes away (selection without such elements) or the drawing changes.
  useEffect(() => {
    if (open && !hosts[open]) setOpen(null);
  }, [open, hosts]);
  useEffect(() => setOpen(null), [api]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const els = useMemo(() => {
    const out = {} as Record<FineTuneKind, El[]>;
    for (const k of KINDS) out[k] = api ? targets(api, k) : [];
    return out;
  }, [api, tick]);

  if (!api) return null;
  return (
    <>
      {KINDS.map((kind) => {
        const host = hosts[kind];
        if (!host) return null;
        const list = els[kind] as unknown as TunableElement[];
        const defaults = defaultsOnly(kind, els[kind]);
        const custom = defaults ? !FINE_TUNE[kind].presets.includes(defaultValue(api, kind)) : isCustom(kind, list);
        return createPortal(
          <button
            type="button"
            ref={(b) => {
              anchors.current[kind] = b;
            }}
            className={`md-ft-btn${custom ? " active" : ""}${open === kind ? " open" : ""}`}
            data-ft-kind={kind}
            title={`${FINE_TUNE[kind].title}: custom value…`}
            aria-label={`${FINE_TUNE[kind].title}: custom value`}
            aria-expanded={open === kind}
            disabled={!list.length && !defaults}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setOpen((o) => (o === kind ? null : kind))}
          >
            <SlidersIcon />
          </button>,
          host,
          kind,
        );
      })}
      {open && hosts[open] && (
        <FineTunePopover
          key={open}
          api={api}
          kind={open}
          els={els[open]}
          anchor={anchors.current[open] ?? null}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

interface PopoverProps {
  api: ExcalidrawImperativeAPI;
  kind: FineTuneKind;
  els: El[];
  anchor: HTMLElement | null;
  onClose(): void;
}

function FineTunePopover({ api, kind, els, anchor, onClose }: PopoverProps) {
  const spec = FINE_TUNE[kind];
  const list = els as unknown as TunableElement[];
  const max = kind === "radius" ? radiusMax(list) : spec.max;
  const defaults = defaultsOnly(kind, els);
  // Default mode: the popover doesn't re-render on appState changes, so it tracks what it set.
  const [defaultVal, setDefaultVal] = useState(() => defaultValue(api, kind));
  const current = defaults ? { value: defaultVal, mixed: false } : selectionValue(kind, list);
  const session = useRef(new TuneSession(api));
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Value being dragged / typed (null = show the selection's value).
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);

  const value = draft ?? Math.min(current?.value ?? spec.min, max);

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const island = anchor.closest(".App-menu__left")?.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 120;
    setPos({ left: (island?.right ?? r.right) + 8, top: Math.max(8, Math.min(r.top - 12, window.innerHeight - h - 8)) });
  }, [anchor]);

  const commit = useCallback(
    (v: number) => {
      session.current.commit(kind, v);
      if (defaults) setDefaultVal(v);
      setDraft(null);
      setText(null);
    },
    [kind, defaults],
  );

  const cancel = useCallback(() => {
    session.current.restore();
    setDraft(null);
    setText(null);
  }, []);

  // Outside click closes (committing nothing pending: a drag always ends with a commit); Esc reverts.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (box.current?.contains(t) || anchor?.contains(t)) return;
      if (session.current.active) cancel();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
      onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, cancel, onClose]);

  // Never leave a preview behind.
  useEffect(() => () => session.current.restore(), []);

  const onSlide = (pos: number) => {
    const v = sliderToValue(pos, spec.min, max, spec.step);
    setDraft(v);
    setText(null);
    session.current.preview(kind, v);
  };
  const endSlide = () => {
    if (draft !== null && session.current.active) commit(draft);
  };
  const submitText = () => {
    if (text === null) return;
    const v = cleanValue(Number(text), spec.min, kind === "radius" ? spec.max : max, spec.step);
    if (v === null) return setText(null);
    commit(v);
  };

  return createPortal(
    <div
      ref={box}
      className="md-ft-pop"
      data-ft-pop={kind}
      role="dialog"
      aria-label={spec.title}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="md-ft-head">
        <span>{spec.title}</span>
        <span className="md-ft-value">
          {current?.mixed && draft === null ? "mixed" : `${fmt(value)}${spec.unit ? ` ${spec.unit}` : ""}`}
        </span>
      </div>
      <input
        className="md-ft-range"
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={valueToSlider(value, spec.min, max)}
        aria-label={`${spec.title} slider`}
        onChange={(e) => onSlide(Number(e.target.value))}
        onPointerUp={endSlide}
        onKeyUp={endSlide}
        onBlur={endSlide}
      />
      <div className="md-ft-row">
        <span className="md-ft-scale">{fmt(spec.min)}</span>
        <input
          className="md-ft-num"
          type="number"
          min={spec.min}
          max={kind === "radius" ? undefined : max}
          step={spec.step}
          value={text ?? fmt(value)}
          aria-label={`${spec.title} value`}
          onChange={(e) => setText(e.target.value)}
          onBlur={submitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitText();
            }
          }}
        />
        <span className="md-ft-scale">{fmt(max)}</span>
      </div>
      {kind === "radius" && (
        <p className="md-ft-note">
          Up to {fmt(max)} px for this selection: corners never exceed a quarter of the shorter side. Rectangles and images only.
        </p>
      )}
      {defaults && <p className="md-ft-note">Nothing selected: sets the {spec.title.toLowerCase()} for what you draw next.</p>}
      {kind === "roughness" && <p className="md-ft-note">Very small shapes are drawn with at most 2.5.</p>}
    </div>,
    document.body,
  );
}
