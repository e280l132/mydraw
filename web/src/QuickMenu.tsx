// The quick connect menu (right-click on a handle by default): connect to another shape with an
// arrow or a plain line in a chosen style, or add a copy / shape / icon on that side.
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import type { LinkStyle } from "./linkOps";

export type MenuAdd = "connectedCopy" | "copy" | "pick";

interface Connection {
  id: string;
  label: string;
  style: Omit<LinkStyle, "dashed">;
  icon: ReactNode;
}

const path = (d: string, dashed = false) => (
  <svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true">
    <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashed ? "3 2.5" : undefined} />
  </svg>
);

/** The ways to connect, in menu order. */
const CONNECTIONS: Connection[] = [
  { id: "around", label: "Arrow around shapes", style: { routing: "around", heads: "end" }, icon: path("M2 13h5V3h10v6h4M18 6l3 3-3 3") },
  { id: "elbow", label: "Elbow arrow", style: { routing: "elbow", heads: "end" }, icon: path("M2 4h9v8h10M18 9l3 3-3 3") },
  { id: "straight", label: "Straight arrow", style: { routing: "straight", heads: "end" }, icon: path("M2 8h19M18 5l3 3-3 3") },
  { id: "curved", label: "Curved arrow", style: { routing: "curved", heads: "end" }, icon: path("M2 12C8 1 14 1 21 6M17 3.5l4 2.5-3 3.5") },
  { id: "line", label: "Straight line", style: { routing: "straight", heads: "none" }, icon: path("M2 8h20") },
  { id: "curved-line", label: "Curved line", style: { routing: "curved", heads: "none" }, icon: path("M2 12C8 1 15 1 22 8") },
];

interface Props {
  at: { x: number; y: number };
  /** The saved link style (marks the matching row; Dashed / Both ends start from it). */
  current: LinkStyle;
  /** How many shapes the action applies to (several selected). */
  count: number;
  /** Key hints for the add rows ("Option-click", ...). */
  hints: Partial<Record<MenuAdd, string>>;
  onConnect(style: LinkStyle): void;
  onAdd(what: MenuAdd): void;
  onSettings(): void;
  onClose(): void;
  ref: Ref<HTMLDivElement>;
}

export function QuickMenu({ at, current, count, hints, onConnect, onAdd, onSettings, onClose, ref }: Props) {
  const [dashed, setDashed] = useState(current.dashed);
  const [both, setBoth] = useState(current.heads === "both");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => box.current?.focus(), []);

  const connect = (c: Connection) => onConnect({ routing: c.style.routing, heads: c.style.heads === "end" && both ? "both" : c.style.heads, dashed });
  const items: { key: string; run(): void }[] = [
    ...CONNECTIONS.map((c) => ({ key: c.id, run: () => connect(c) })),
    { key: "connectedCopy", run: () => onAdd("connectedCopy") },
    { key: "copy", run: () => onAdd("copy") },
    { key: "pick", run: () => onAdd("pick") },
    { key: "settings", run: onSettings },
  ];
  const index = (key: string) => items.findIndex((i) => i.key === key);
  const matches = (c: Connection) => c.style.routing === current.routing && (c.style.heads === "none") === (current.heads === "none");

  const width = 236;
  const left = Math.max(8, Math.min(at.x - width / 2, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(at.y + 14, window.innerHeight - 420));
  const many = count > 1 ? ` (${count} shapes)` : "";

  const row = (key: string, label: ReactNode, icon: ReactNode, hint?: string, extra?: string) => {
    const i = index(key);
    return (
      <button
        key={key}
        role="menuitem"
        className={`md-qc-menu-item${i === active ? " active" : ""}${extra ? ` ${extra}` : ""}`}
        data-item={key}
        onMouseEnter={() => setActive(i)}
        onClick={() => items[i].run()}
      >
        {icon}
        <span>{label}</span>
        {hint && <span className="md-qc-menu-key">{hint}</span>}
      </button>
    );
  };

  return (
    <div
      ref={(el) => {
        box.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
      }}
      className="md-qc-menu"
      role="menu"
      aria-label="Quick connect"
      tabIndex={-1}
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        let handled = true;
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown") setActive((a) => (a + 1) % items.length);
        else if (e.key === "ArrowUp") setActive((a) => (a - 1 + items.length) % items.length);
        else if (e.key === "Enter") items[active]?.run();
        else handled = false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="md-qc-menu-title">Connect to a shape{many}</div>
      {CONNECTIONS.map((c) => row(c.id, c.label, c.icon, matches(c) ? "last used" : undefined))}
      <div className="md-qc-menu-chips">
        <button className={`md-qc-menu-chip${dashed ? " on" : ""}`} data-chip="dashed" aria-pressed={dashed} onClick={() => setDashed(!dashed)}>
          Dashed
        </button>
        <button className={`md-qc-menu-chip${both ? " on" : ""}`} data-chip="both" aria-pressed={both} title="Arrowheads at both ends (arrows only)" onClick={() => setBoth(!both)}>
          ↔ Both ends
        </button>
      </div>
      <div className="md-qc-menu-sep" />
      <div className="md-qc-menu-title">Add on this side{many}</div>
      {row("connectedCopy", "Connected copy", path("M2 8h12M11 5l3 3-3 3M17 4h5v8h-5z"), hints.connectedCopy)}
      {row("copy", "Copy", path("M4 4h7v8H4zM13 4h7v8h-7z"), hints.copy)}
      {row("pick", "Shape or icon…", path("M3 3h7v7H3zM17 3.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM6.5 12l3.5 3h-7zM14 12h7v3h-7z"), hints.pick)}
      <div className="md-qc-menu-sep" />
      {row("settings", "Quick connect shortcuts…", path("M4 4h16v8H4zM7 8h2M11 8h2M15 8h2"))}
    </div>
  );
}
