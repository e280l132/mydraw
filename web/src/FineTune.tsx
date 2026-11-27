// Fine-tune buttons at the end of Excalidraw's Stroke width, Sloppiness, Edges and Font size rows: each
// opens a popover with a slider (and a number box) for values beyond Excalidraw's presets.
// Logic and ranges: shared/fineTune.ts. The buttons are portaled into hosts that App's panel
// observer appends to those rows (`attachFineTuneHosts`); Excalidraw owns the rows, so a host is
// re-appended whenever Excalidraw re-renders them.
//
// A slider drag previews with CaptureUpdateAction.NEVER, then restores the starting elements (NEVER)
// and commits once (IMMEDIATELY), so one drag = one undo step (same pattern as IconRecolorSession).
// Font size is different: it also changes labels' shapes and arrows, so its session snapshots the whole
// scene and restores every element a preview touched (web/src/fontSizeOps.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { pinPatternPatch } from "../../shared/fillPattern";
import { fontSizeChanges, fontSizeTargets } from "./fontSizeOps";
import { commitElements } from "./uiActions";
import { FloatHead, useFloating } from "./MorePopover";

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
  if (kind === "fontSize") return fontSizeTargets(api);
  const sel = api.getAppState().selectedElementIds;
  return api.getSceneElements().filter((e) => sel[e.id] && !e.locked && canTune(kind, e as unknown as TunableElement));
}

const appStateFor = (kind: FineTuneKind, value: number): Partial<AppState> =>
  kind === "strokeWidth"
    ? { currentItemStrokeWidth: value }
    : kind === "roughness"
      ? { currentItemRoughness: value }
      : kind === "fontSize"
        ? { currentItemFontSize: value }
        : { currentItemRoundness: value > 0 ? "round" : "sharp" };

/**
 * With nothing to tune selected (e.g. the pen tool is active), stroke width, sloppiness and font size
 * set the value for the next element drawn (`currentItem*`). Corner radius can't: `currentItemRoundness`
 * is only round/sharp.
 */
const defaultsOnly = (kind: FineTuneKind, els: readonly El[]) => !els.length && kind !== "radius";

/** The `currentItem*` value a slider changes when nothing is selected. */
function defaultValue(api: ExcalidrawImperativeAPI, kind: FineTuneKind): number {
  const s = api.getAppState();
  return kind === "roughness" ? s.currentItemRoughness : kind === "fontSize" ? s.currentItemFontSize : s.currentItemStrokeWidth;
}

/** `patchFor` plus, for stroke width, the pinned hatch pattern (the stroke changes only the outline). */
function patchOf(kind: FineTuneKind, value: number, el: El): Record<string, unknown> {
  const patch = patchFor(kind, value) as Record<string, unknown>;
  return kind === "strokeWidth" ? { ...patch, ...pinPatternPatch(el as never, value) } : patch;
}

/** Preview / commit / cancel of one slider drag. */
class TuneSession {
  private base: Map<string, El> | null = null;
  /** Font size drags: the scene before the drag, the text it targets, and every id a preview changed. */
  private font: { byId: Map<string, El>; scene: El[]; texts: El[]; touched: Set<string> } | null = null;
  constructor(private api: ExcalidrawImperativeAPI) {}

  private state = () => this.api.getAppState() as unknown as AppState;

  private previewFont(value: number): void {
    if (!this.font) {
      const scene = this.api.getSceneElementsIncludingDeleted() as unknown as El[];
      this.font = { byId: new Map(scene.map((e) => [e.id, e])), scene, texts: fontSizeTargets(this.api), touched: new Set() };
    }
    const font = this.font;
    // Always from the scene at the start of the drag, so steps never compound.
    const changed = new Map(fontSizeChanges(font.scene, font.texts, value, this.state()).changed.map((e) => [e.id, e]));
    for (const id of changed.keys()) font.touched.add(id);
    this.api.updateScene({
      elements: this.api.getSceneElementsIncludingDeleted().map((e) => changed.get(e.id) ?? (font.touched.has(e.id) ? font.byId.get(e.id) ?? e : e)),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  private commitFont(value: number): void {
    const ids = (this.font?.texts ?? fontSizeTargets(this.api)).map((e) => e.id);
    this.restore();
    if (!ids.length) {
      // Only the default for new text changes: not an undo step.
      this.api.updateScene({ appState: appStateFor("fontSize", value) as AppState, captureUpdate: CaptureUpdateAction.NEVER });
      return;
    }
    const scene = this.api.getSceneElementsIncludingDeleted() as unknown as El[];
    const live = new Map(scene.map((e) => [e.id, e]));
    const texts = ids.flatMap((id) => (live.has(id) ? [live.get(id)!] : []));
    const r = fontSizeChanges(scene, texts, value, this.state());
    commitElements(this.api, r.changed, r.added, appStateFor("fontSize", value));
  }

  preview(kind: FineTuneKind, value: number): void {
    if (kind === "fontSize") return this.previewFont(value);
    if (!this.base) this.base = new Map(targets(this.api, kind).map((e) => [e.id, e]));
    const base = this.base;
    this.api.updateScene({
      elements: this.api.getSceneElementsIncludingDeleted().map((e) => (base.has(e.id) ? newElementWith(base.get(e.id)!, patchOf(kind, value, base.get(e.id)!) as never) : e)),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  commit(kind: FineTuneKind, value: number): void {
    if (kind === "fontSize") return this.commitFont(value);
    const ids = this.base ? [...this.base.keys()] : targets(this.api, kind).map((e) => e.id);
    this.restore();
    if (!ids.length) {
      // Only the default for new elements changes: not an undo step.
      this.api.updateScene({ appState: appStateFor(kind, value) as AppState, captureUpdate: CaptureUpdateAction.NEVER });
      return;
    }
    const live = new Map(this.api.getSceneElements().map((e) => [e.id, e]));
    const changed = ids.flatMap((id) => (live.has(id) ? [newElementWith(live.get(id)!, patchOf(kind, value, live.get(id)! as unknown as El) as never)] : []));
    commitElements(this.api, changed, [], appStateFor(kind, value));
  }

  /** Put the elements back as they were before the drag (not recorded in undo). */
  restore(): void {
    const font = this.font;
    this.font = null;
    if (font) {
      this.api.updateScene({
        elements: this.api.getSceneElementsIncludingDeleted().map((e) => (font.touched.has(e.id) ? font.byId.get(e.id) ?? e : e)),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
    const base = this.base;
    this.base = null;
    if (!base) return;
    this.api.updateScene({
      elements: this.api.getSceneElementsIncludingDeleted().map((e) => base.get(e.id) ?? e),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }

  get active(): boolean {
    return !!this.base || !!this.font;
  }
}

export const SlidersIcon = () => (
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
  // Value being dragged / typed (null = show the selection's value).
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);

  const value = draft ?? Math.min(current?.value ?? spec.min, max);

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

  // Outside click (docked only) or Esc closes; a pending preview is reverted (a drag always ends with a commit).
  const onOutside = useCallback(() => {
    if (session.current.active) cancel();
  }, [cancel]);
  const f = useFloating(`ft-${kind}`, anchor, box, onClose, onOutside);

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
      className={`md-ft-pop${f.floating ? " md-floating" : ""}`}
      data-ft-pop={kind}
      role="dialog"
      aria-label={spec.title}
      style={f.pos ? { left: f.pos.left, top: f.pos.top } : { visibility: "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <FloatHead title={spec.title} f={f} onClose={onClose}>
        <span className="md-ft-value">
          {current?.mixed && draft === null ? "mixed" : `${fmt(value)}${spec.unit ? ` ${spec.unit}` : ""}`}
        </span>
      </FloatHead>
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
      {kind === "fontSize" && !defaults && <p className="md-ft-note">Text in shapes and on arrows follows; a shape grows to fit its text.</p>}
    </div>,
    // Inside the drawing's Excalidraw root, so the app's and Excalidraw's theme variables (dark mode) apply.
    anchor?.closest<HTMLElement>(".excalidraw") ?? document.body,
  );
}
