// Patches Excalidraw's `showSelectedShapeActions(appState, elements)`: the style panel column
// (.App-menu__left .panelColumn) is only rendered while something is selected or a drawing tool is
// active. With the "Pin style panel" setting on (`globalThis.__mydrawPinPanel`, set by
// web/src/panelPin.ts) the function also returns true for the select tool with nothing selected.
//
// Excalidraw exposes no option for this, so we rewrite its bundled code: the function gets a
// prefix `(pinned && !viewMode && no link dialog) || <original expression>`. Dev (readable) and
// prod (minified) differ only in spelling. If the pattern stops matching after an Excalidraw
// upgrade the plugin throws, so a build never silently loses the pin.
// See EXCALIDRAW-UPGRADE.md ("Pin style panel").

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PATCH_HASH = createHash("sha1").update(readFileSync(new URL(import.meta.url))).digest("hex").slice(0, 10);

const FLAG = "globalThis.__mydrawPinPanel";

// dev:  var showSelectedShapeActions = (appState, elements) => Boolean(
const DEV = /var showSelectedShapeActions = \(appState, elements\) => (?=Boolean\(\s*!appState\.viewModeEnabled)/;
// prod: =(e,t)=>!!(!e.viewModeEnabled&&e.openDialog?.name!=="elementLinkSelector"&&(e.activeTool.type!=="custom"
const PROD = /=\((\w+),(\w+)\)=>(?=!!\(!\1\.viewModeEnabled&&\1\.openDialog\?\.name!=="elementLinkSelector"&&\(\1\.activeTool\.type!=="custom")/;

const pinned = (state) => `(${FLAG}&&!${state}.viewModeEnabled&&${state}.openDialog?.name!=="elementLinkSelector")||`;

/** Returns the patched source, or null when `code` has no such function. */
export function patchPanelPin(code) {
  if (DEV.test(code)) return code.replace(DEV, (m) => m + pinned("appState"));
  if (PROD.test(code)) return code.replace(PROD, (m, state) => m + pinned(state));
  return null;
}

// ---------- text outline ----------
// Excalidraw draws text with `fillText` only (canvas) or a filled <text> (SVG). The text outline
// (customData.mydrawTextOutline, web/src/textOutline.ts) needs a stroke behind the fill:
// - canvas (`drawElementOnCanvas`, text branch): a call to `globalThis.__mydrawTextOutline(ctx,
//   element, lines, x, lineHeightPx, verticalOffset)` right before the line loop that fills, so every
//   line's outline sits under every line's fill.
// - SVG (`renderElementToSvg`, text branch): `globalThis.__mydrawSvgTextOutline(textNode, element)`
//   after the <text> gets its fill.
// The regexes accept both the readable dev build and the minified prod build. See EXCALIDRAW-UPGRADE.md
// ("Text outline").

// ctx.fillStyle = el.strokeColor; ctx.textAlign = el.textAlign; ... for (let i = 0; i < lines.length; i++) { ctx.fillText(lines[i], x, i * lh + vo)
const CANVAS_TEXT =
  /(\w+)\.fillStyle\s*=\s*(\w+)\.strokeColor[,;]\s*\1\.textAlign\s*=\s*\2\.textAlign;[\s\S]{0,900}?(for\s*\(let (\w+)\s*=\s*0;\s*\4\s*<\s*(\w+)\.length;\s*\4\+\+\)\s*\{?\s*\1\.fillText\(\s*\5\[\4\],\s*(\w+),\s*\4\s*\*\s*(\w+)\s*\+\s*(\w+)\s*\))/;
// text.setAttribute("fill", el.strokeColor), text.setAttribute("text-anchor", ...)
const SVG_TEXT = /(\w+)\.setAttribute\(\s*"fill",\s*(\w+)\.strokeColor\s*\)(?=[,;]\s*\1\.setAttribute\(\s*"text-anchor")/;

/** Returns the patched source, or null when either text renderer is not found. */
export function patchTextOutline(code) {
  const c = CANVAS_TEXT.exec(code);
  const s = SVG_TEXT.exec(code);
  if (!c || !s) return null;
  const [, ctx, el, loop, , lines, x, lh, vo] = c;
  const at = c.index + c[0].length - loop.length;
  let out = `${code.slice(0, at)}globalThis.__mydrawTextOutline?.(${ctx},${el},${lines},${x},${lh},${vo});${code.slice(at)}`;
  out = out.replace(SVG_TEXT, (m, node, elem) => `${m},globalThis.__mydrawSvgTextOutline?.(${node},${elem})`);
  return out;
}

// ---------- shadows ----------
// A shadow (customData.mydrawShadow, web/src/shadowRender.ts) has to wrap the drawing of a whole
// element, so both per-element renderers delegate to a hook when one is installed and wants the element:
// - canvas `renderElement(element, elementsMap, allElementsMap, rc, context, renderConfig, appState)`
//   (static scene AND exportToCanvas): `globalThis.__mydrawShadowRender.run(renderElement, args)`.
// - SVG `renderElementToSvg(element, elementsMap, rsvg, svgRoot, files, offsetX, offsetY, renderConfig)`
//   (exportToSvg: SVG, HTML, PDF): `globalThis.__mydrawSvgShadow.run(renderElementToSvg, args)`.
// The hook calls the function again (its `wants` is false while it runs), so the original body still
// does all the drawing. Anchored on the first statement of each body. See EXCALIDRAW-UPGRADE.md ("Shadows").

// dev:  var renderElement = (element, ..., appState) => {\n const reduceAlphaForSelection = appState.openDialog?.name === "elementLinkSelector" && !appState.selectedElementIds[element.id]
// prod: Fn=(e,t,n,r,o,i,a)=>{let s=a.openDialog?.name==="elementLinkSelector"&&!a.selectedElementIds[e.id]
const RENDER_ELEMENT =
  /(\w+)\s*=\s*\((\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)\)\s*=>\s*\{(?=\s*(?:let|const)\s+\w+\s*=\s*\8\.openDialog\?\.name\s*===\s*"elementLinkSelector"\s*&&\s*!\8\.selectedElementIds\[\2\.id\])/g;
// dev:  var renderElementToSvg = (element, elementsMap, rsvg, svgRoot, files, offsetX, offsetY, renderConfig) => {\n const offset = { x: offsetX, y: offsetY };
// prod: wi=(e,t,n,r,o,i,a,s)=>{let d={x:i,y:a}
const RENDER_SVG =
  /(\w+)\s*=\s*\((\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)\)\s*=>\s*\{(?=\s*(?:let|const)\s+\w+\s*=\s*\{\s*x:\s*\7,\s*y:\s*\8\s*\})/g;

const delegate = (hook, name, params) =>
  `if(globalThis.${hook}?.wants(${params[0]}))return globalThis.${hook}.run(${name},[${params.join(",")}]);`;

/** Returns the patched source, or null unless each renderer is found exactly once. */
export function patchShadow(code) {
  const canvas = [...code.matchAll(RENDER_ELEMENT)];
  const svg = [...code.matchAll(RENDER_SVG)];
  if (canvas.length !== 1 || svg.length !== 1) return null;
  const edits = [
    { at: canvas[0].index + canvas[0][0].length, text: delegate("__mydrawShadowRender", canvas[0][1], canvas[0].slice(2, 9)) },
    { at: svg[0].index + svg[0][0].length, text: delegate("__mydrawSvgShadow", svg[0][1], svg[0].slice(2, 10)) },
  ].sort((a, b) => b.at - a.at);
  let out = code;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return out;
}

// ---------- dash patterns ----------
// Excalidraw's roughjs options set `strokeLineDash` from strokeStyle (dashed / dotted / none). Extra dash
// styles (customData.mydrawDash, shared/dash.ts) ask `globalThis.__mydrawDash(element)` first; it returns
// undefined for everything else, so Excalidraw's own value is kept. One spot covers canvas, SVG and all
// exports (roughjs writes stroke-dasharray). See EXCALIDRAW-UPGRADE.md ("Dash patterns").
// dev:  strokeLineDash: element.strokeStyle === "dashed" ? getDashArrayDashed(...)
// prod: strokeLineDash:e.strokeStyle==="dashed"?Cm(...)
const DASH = /strokeLineDash:\s*(?=(\w+)\.strokeStyle\s*===\s*"dashed")/g;

/** Returns the patched source, or null unless the expression is found exactly once. */
export function patchDash(code) {
  const m = [...code.matchAll(DASH)];
  if (m.length !== 1) return null;
  const at = m[0].index + m[0][0].length;
  // A conditional prefix (right-associative) leaves the original `a ? b : c ? d : e` intact.
  const el = m[0][1];
  return `${code.slice(0, at)}globalThis.__mydrawDash?.(${el})?globalThis.__mydrawDash(${el}):${code.slice(at)}`;
}

// ---------- fill pattern ----------
// Excalidraw derives the hatch line width and spacing from the stroke width (`fillWeight:
// strokeWidth / 2, hachureGap: strokeWidth * 4`). A stored pattern (customData.mydrawFillPattern,
// shared/fillPattern.ts) comes from `globalThis.__mydrawFillPattern(element)` first; it returns
// undefined for everything else, so Excalidraw's own values are kept. Same options object as the dash
// patch, so canvas, SVG and every export follow. See EXCALIDRAW-UPGRADE.md ("Fill pattern").
// dev:  fillWeight: element.strokeWidth / 2,\n    hachureGap: element.strokeWidth * 4,
// prod: fillWeight:e.strokeWidth/2,hachureGap:e.strokeWidth*4,
const FILL_PATTERN = /fillWeight:\s*(\w+)\.strokeWidth\s*\/\s*2,\s*hachureGap:\s*\1\.strokeWidth\s*\*\s*4/g;

/** Returns the patched source, or null unless the options are found exactly once. */
export function patchFillPattern(code) {
  const m = [...code.matchAll(FILL_PATTERN)];
  if (m.length !== 1) return null;
  const el = m[0][1];
  const hook = `globalThis.__mydrawFillPattern?.(${el})`;
  const text = `fillWeight:${hook}?.fillWeight??${el}.strokeWidth/2,hachureGap:${hook}?.hachureGap??${el}.strokeWidth*4`;
  return code.slice(0, m[0].index) + text + code.slice(m[0].index + m[0][0].length);
}

/** Vite plugin: patches the chunk Excalidraw's index imports (build, dev and the dev pre-bundle). */
export function excalidrawPanelPin(chunkPaths) {
  const isChunk = (id) => chunkPaths.includes(id.split("?")[0]);
  const patch = (code, id) => {
    const pinned = patchPanelPin(code);
    if (pinned === null) {
      throw new Error(`mydraw: showSelectedShapeActions not found in ${id}. Update scripts/excalidrawPatch.mjs (EXCALIDRAW-UPGRADE.md, "Pin style panel").`);
    }
    const outlined = patchTextOutline(pinned);
    if (outlined === null) {
      throw new Error(`mydraw: Excalidraw's text renderers not found in ${id}. Update scripts/excalidrawPatch.mjs (EXCALIDRAW-UPGRADE.md, "Text outline").`);
    }
    const shadowed = patchShadow(outlined);
    if (shadowed === null) {
      throw new Error(`mydraw: Excalidraw's renderElement / renderElementToSvg not found (exactly once) in ${id}. Update scripts/excalidrawPatch.mjs (EXCALIDRAW-UPGRADE.md, "Shadows").`);
    }
    const dashed = patchDash(shadowed);
    if (dashed === null) {
      throw new Error(`mydraw: Excalidraw's strokeLineDash option not found (exactly once) in ${id}. Update scripts/excalidrawPatch.mjs (EXCALIDRAW-UPGRADE.md, "Dash patterns").`);
    }
    const out = patchFillPattern(dashed);
    if (out === null) {
      throw new Error(`mydraw: Excalidraw's fillWeight / hachureGap options not found (exactly once) in ${id}. Update scripts/excalidrawPatch.mjs (EXCALIDRAW-UPGRADE.md, "Fill pattern").`);
    }
    return out;
  };
  return {
    // Dev pre-bundles Excalidraw once and caches it in node_modules/.vite; the cache key includes plugin
    // names but not plugin code, so the name carries a hash of this file: editing a patch re-bundles.
    name: `mydraw-excalidraw-panel-pin-${PATCH_HASH}`,
    enforce: "pre",
    // Build and dev (unbundled) go through `transform`.
    transform(code, id) {
      return isChunk(id) ? { code: patch(code, id), map: null } : null;
    },
    // Dev pre-bundles Excalidraw (with rolldown); the same hook runs inside that bundle.
    config() {
      return {
        optimizeDeps: {
          rolldownOptions: {
            plugins: [
              {
                name: "mydraw-excalidraw-panel-pin-deps",
                transform(code, id) {
                  return isChunk(id) ? { code: patch(code, id), map: null } : null;
                },
              },
            ],
          },
        },
      };
    },
  };
}
