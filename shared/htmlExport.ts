// Single-file HTML viewer: the exported SVG inline, pan (drag) / zoom (wheel, pinch buttons,
// double-click to fit) and working links (Excalidraw wraps linked elements in <a>).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Drop the XML prolog and any script/event-handler/javascript: content from SVG text. */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/^\s*<\?xml[^>]*\?>\s*/i, "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*/gi, "$1#");
}

export interface HtmlOptions {
  title: string;
  svg: string;
  dark?: boolean;
  /** Page background (the drawing's own background when exported with one). */
  background?: string;
}

const SCRIPT = `
(() => {
  const stage = document.getElementById("stage");
  const svg = stage.querySelector("svg");
  const view = document.getElementById("view");
  let k = 1, x = 0, y = 0, moved = 0;
  const apply = () => { view.style.transform = "translate(" + x + "px," + y + "px) scale(" + k + ")"; };
  const fit = () => {
    const w = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width;
    const h = svg.viewBox.baseVal.height || svg.getBoundingClientRect().height;
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    k = Math.min(stage.clientWidth / w, stage.clientHeight / h, 1) * 0.95 || 1;
    x = (stage.clientWidth - w * k) / 2; y = (stage.clientHeight - h * k) / 2; apply();
  };
  const zoomAt = (f, cx, cy) => {
    const nk = Math.min(Math.max(k * f, 0.05), 40);
    x = cx - (cx - x) * (nk / k); y = cy - (cy - y) * (nk / k); k = nk; apply();
  };
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  stage.addEventListener("pointerdown", (e) => { drag = { px: e.clientX, py: e.clientY, x, y }; moved = 0; });
  window.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    if (moved > 4) { x = drag.x + dx; y = drag.y + dy; apply(); }
  });
  window.addEventListener("pointerup", () => { drag = null; });
  // A drag that starts on a link must not follow it.
  stage.addEventListener("click", (e) => { if (moved > 4) { e.preventDefault(); e.stopPropagation(); } }, true);
  stage.addEventListener("dblclick", fit);
  const c = () => [stage.clientWidth / 2, stage.clientHeight / 2];
  document.getElementById("in").onclick = () => zoomAt(1.25, ...c());
  document.getElementById("out").onclick = () => zoomAt(0.8, ...c());
  document.getElementById("fit").onclick = fit;
  window.addEventListener("resize", fit);
  fit();
})();`;

export function buildHtml(o: HtmlOptions): string {
  const bg = o.background && /^#[0-9a-f]{3,8}$/i.test(o.background) ? o.background : o.dark ? "#121212" : "#ffffff";
  const fg = o.dark ? "#e9ecef" : "#1e1e1e";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${esc(o.title)}</title>
<style>
html, body { margin: 0; height: 100%; background: ${bg}; color: ${fg}; font: 14px system-ui, sans-serif; }
#stage { position: fixed; inset: 0; overflow: hidden; cursor: grab; touch-action: none; }
#stage:active { cursor: grabbing; }
#view { transform-origin: 0 0; position: absolute; left: 0; top: 0; }
#view svg { display: block; max-width: none; }
#bar { position: fixed; right: 12px; top: 12px; display: flex; gap: 6px; z-index: 1; }
#bar button { width: 32px; height: 32px; border: 1px solid #8884; border-radius: 6px; background: ${o.dark ? "#2b2b2b" : "#f1f3f5"}; color: ${fg}; font-size: 16px; cursor: pointer; }
#title { position: fixed; left: 12px; top: 12px; opacity: .6; z-index: 1; pointer-events: none; }
</style>
</head>
<body>
<div id="title">${esc(o.title)}</div>
<div id="bar"><button id="in" title="Zoom in">+</button><button id="out" title="Zoom out">−</button><button id="fit" title="Fit (or double-click)">⤢</button></div>
<div id="stage"><div id="view">${sanitizeSvg(o.svg)}</div></div>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
