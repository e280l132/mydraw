// A small round dial for a direction (degrees clockwise from +x; 90 = down). Drag to set; `onEnd`
// fires on release so callers can preview while dragging and commit once (one undo step).
import type { PointerEvent as ReactPointerEvent } from "react";

export function AngleDial({ angle, onDrag, onEnd, label = "Direction" }: { angle: number; onDrag(a: number): void; onEnd(): void; label?: string }) {
  const r = (angle * Math.PI) / 180;
  const down = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const at = (x: number, y: number) => {
      const b = el.getBoundingClientRect();
      const a = (Math.atan2(y - (b.top + b.height / 2), x - (b.left + b.width / 2)) * 180) / Math.PI;
      onDrag(Math.round((a + 360) % 360));
    };
    at(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => at(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onEnd();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <span className="md-shadow-dial" role="slider" aria-label={label} aria-valuenow={angle} aria-valuemin={0} aria-valuemax={359} onPointerDown={down} title="Drag to set the direction">
      <span className="md-shadow-dial-dot" style={{ left: `${50 + Math.cos(r) * 34}%`, top: `${50 + Math.sin(r) * 34}%` }} />
    </span>
  );
}
