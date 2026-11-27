// "Quick connect shortcuts…": choose which held keys + click do what on the quick connect handles,
// and the keys that switch options while drawing a link. Saved to the settings file (persisted,
// applied straight away); defaults can be restored.
//
// Recording a combo: press Change, then hold the keys (any modifier on either side, F1-F24) and
// let go, or click the box while holding them (click it with no key for a plain click). Modifier
// chips cycle "either side" -> left -> right when clicked.
import { useState } from "react";
import {
  ACTION_LABEL,
  canonicalKeys,
  cloneQuickConnect,
  cycleSide,
  defaultQuickConnect,
  describeBinding,
  familyOf,
  findConflicts,
  keyName,
  LINK_KEY_LABEL,
  LINK_KEY_NAMES,
  QUICK_ACTIONS,
  tokenForCode,
  validLinkKey,
  type KeyToken,
  type LinkKeyName,
  type QuickAction,
  type QuickConnectSettings,
} from "../../shared/quickBindings";
import { heldKeys } from "./heldKeys";
import { IS_MAC } from "./QuickConnect";

interface Props {
  quick: QuickConnectSettings;
  onSave(q: QuickConnectSettings): void;
  onClose(): void;
}

export function QuickConnectSettingsDialog({ quick, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => cloneQuickConnect(quick));
  /** The action whose combo is being recorded. */
  const [capturing, setCapturing] = useState<QuickAction | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const conflicts = findConflicts(draft);
  const clashing = new Set(conflicts.flatMap((c) => c.items));
  const unchanged = JSON.stringify(draft) === JSON.stringify(quick);

  const setKeys = (a: QuickAction, keys: KeyToken[]) => {
    const next = cloneQuickConnect(draft);
    next.bindings[a].keys = canonicalKeys(keys) ?? [];
    setDraft(next);
  };
  /** Right-click can trigger one action only: turning it on elsewhere takes it from the other. */
  const setRightClick = (a: QuickAction, on: boolean) => {
    const next = cloneQuickConnect(draft);
    for (const x of QUICK_ACTIONS) delete next.bindings[x].rightClick;
    if (on) next.bindings[a].rightClick = true;
    setDraft(next);
  };
  const setLinkKey = (n: LinkKeyName, key: string) => {
    const next = cloneQuickConnect(draft);
    next.linkKeys[n] = key.toLowerCase();
    setDraft(next);
  };

  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="md-modal md-qcs"
        role="dialog"
        aria-label="Quick connect shortcuts"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (capturing) setCapturing(null);
          else onClose();
        }}
      >
        <h2>Quick connect shortcuts</h2>
        <p className="md-qcs-hint">
          What a click on a quick connect “+” handle does. Press <b>Change</b>, then hold the keys you want and let go. Any modifier works (⌘, Control, Option, Shift,
          left or right side), plus F1–F24. Click a modifier to switch between <i>either side</i>, <i>left</i> and <i>right</i>.
        </p>
        <div className="md-qcs-rows">
          {QUICK_ACTIONS.map((a) => {
            const b = draft.bindings[a];
            return (
              <div key={a} className={`md-qcs-row${clashing.has(a) ? " clash" : ""}`} data-action={a}>
                <span className="md-qcs-name">{ACTION_LABEL[a]}</span>
                {capturing === a ? (
                  <KeyRecorder
                    onDone={(keys) => {
                      setNote(null);
                      setKeys(a, keys);
                      setCapturing(null);
                    }}
                    onCancel={() => setCapturing(null)}
                    onNote={setNote}
                  />
                ) : (
                  <>
                    <span className="md-qcs-combo">
                      {b.keys.length === 0 && <span className="md-qcs-chip plain">Click</span>}
                      {b.keys.map((k) => (
                        <button
                          key={k}
                          className="md-qcs-chip"
                          disabled={!familyOf(k)}
                          title={familyOf(k) ? "Click: either side / left / right" : undefined}
                          onClick={() => setKeys(a, b.keys.map((x) => (x === k ? cycleSide(k) : x)))}
                        >
                          {keyName(k, IS_MAC)}
                        </button>
                      ))}
                    </span>
                    <button
                      className="md-qcs-change"
                      onClick={() => {
                        setNote(null);
                        setCapturing(a);
                      }}
                    >
                      Change
                    </button>
                  </>
                )}
                <label className="md-qcs-right" title="Also trigger this with a right-click">
                  <input type="checkbox" checked={!!b.rightClick} onChange={(e) => setRightClick(a, e.target.checked)} />
                  right-click
                </label>
              </div>
            );
          })}
        </div>

        <h3>While drawing a link</h3>
        <div className="md-qcs-rows">
          {LINK_KEY_NAMES.map((n) => (
            <div key={n} className={`md-qcs-row${clashing.has(n) ? " clash" : ""}`}>
              <span className="md-qcs-name">{LINK_KEY_LABEL[n]}</span>
              <input
                className="md-qcs-key"
                aria-label={LINK_KEY_LABEL[n]}
                readOnly
                value={draft.linkKeys[n].toUpperCase()}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || e.key === "Tab") return;
                  e.preventDefault();
                  if (e.metaKey || e.ctrlKey || e.altKey) return;
                  if (validLinkKey(e.key)) {
                    setNote(null);
                    setLinkKey(n, e.key);
                  } else setNote("Use a single letter or digit.");
                }}
              />
            </div>
          ))}
        </div>
        <p className="md-qcs-hint">Click a key box and press the key you want.</p>

        <h3>After adding</h3>
        <label className="md-qcs-check">
          <input
            type="checkbox"
            data-setting="editLabel"
            checked={draft.editLabel}
            onChange={(e) => {
              const next = cloneQuickConnect(draft);
              next.editLabel = e.target.checked;
              setDraft(next);
            }}
          />
          Open the new shape’s label for typing (copies of plain shapes)
        </label>

        {conflicts.length > 0 && (
          <div className="md-qcs-error">
            {conflicts.map((c) => (
              <div key={c.kind + c.items.join()}>
                {c.kind === "binding" && `${c.items.map((i) => ACTION_LABEL[i as QuickAction]).join(" and ")} share one shortcut.`}
                {c.kind === "rightClick" && "Only one action can use right-click."}
                {c.kind === "linkKey" && `${c.items.map((i) => LINK_KEY_LABEL[i as LinkKeyName]).join(" and ")} share one key.`}
              </div>
            ))}
          </div>
        )}
        {note && <div className="md-qcs-note">{note}</div>}

        <div className="md-qcs-summary">{QUICK_ACTIONS.map((a) => `${describeBinding(draft.bindings[a], IS_MAC)}: ${ACTION_LABEL[a].toLowerCase()}`).join(" · ")}</div>

        <div className="md-modal-actions">
          <button onClick={() => setDraft(defaultQuickConnect())}>Reset to defaults</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={conflicts.length > 0 || unchanged}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

interface RecorderProps {
  onDone(keys: KeyToken[]): void;
  onCancel(): void;
  onNote(text: string | null): void;
}

/**
 * Records a chord: every key held at some point while recording, committed when all are let go, or
 * at once by clicking the box (with no key held: a plain click). Uses the window-wide held-key
 * tracker, so sides and keys pressed before the box got focus are known.
 */
function KeyRecorder({ onDone, onCancel, onNote }: RecorderProps) {
  const [chord, setChord] = useState<KeyToken[]>([]);
  const add = (keys: Iterable<KeyToken>) => {
    const next = canonicalKeys([...chord, ...keys]) ?? chord;
    setChord(next);
    return next;
  };
  return (
    <div
      className="md-qcs-capture"
      role="button"
      tabIndex={0}
      aria-label="Hold the keys for this action"
      ref={(el) => el?.focus()}
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") return onCancel();
        const known = tokenForCode(e.code);
        if (!known && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) onNote(`“${e.key}” can't be held for a click: use modifiers (either side) or F1–F24.`);
        else onNote(null);
        add(heldKeys(e.nativeEvent));
      }}
      onKeyUp={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const stillHeld = heldKeys(e.nativeEvent);
        if (stillHeld.size === 0 && chord.length) onDone(chord);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        onDone(add(heldKeys(e.nativeEvent)));
      }}
      onContextMenu={(e) => e.preventDefault() /* Control-click on a Mac */}
    >
      {chord.length ? chord.map((k) => keyName(k, IS_MAC)).join(" + ") : "Hold the keys, then let go… (or click here)"}
    </div>
  );
}
