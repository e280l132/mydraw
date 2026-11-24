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

/** Vite plugin: patches the chunk Excalidraw's index imports (build, dev and the dev pre-bundle). */
export function excalidrawPanelPin(chunkPaths) {
  const isChunk = (id) => chunkPaths.includes(id.split("?")[0]);
  const patch = (code, id) => {
    const out = patchPanelPin(code);
    if (out === null) {
      throw new Error(`mydraw: showSelectedShapeActions not found in ${id}. Update scripts/excalidrawPatch.mjs (EXCALIDRAW-UPGRADE.md, "Pin style panel").`);
    }
    return out;
  };
  return {
    name: "mydraw-excalidraw-panel-pin",
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
