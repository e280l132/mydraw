# Upgrading Excalidraw

mydraw pins `@excalidraw/excalidraw` to an exact version (currently **0.18.1**, see `package.json`).
Several features depend on Excalidraw **internals**: DOM class names, test ids, renderer behaviour
and undocumented API quirks. None of that is covered by semver, so treat every upgrade, even a
patch release, as a planned job and follow this checklist.

## Procedure

1. Create a branch, then bump the exact version: `npm install @excalidraw/excalidraw@<version> --save-exact`.
2. Read Excalidraw's changelog for the range you are jumping. Look especially for: renderer /
   `staticScene`, grid, `updateScene` / `captureUpdate`, elbow arrows, `convertToExcalidrawElements`,
   restore, export, the main menu, context menu and properties panel.
3. Run `npm run typecheck && npm test && npm run smoke`. The smoke test exercises most of the list
   below; a failure there usually points straight at the broken assumption.
4. Go through the table below and re-verify each item. The ones marked **(smoke)** are covered
   automatically; check the others by hand in `npm run dev`.
5. Update this file: the version number at the top, and any assumption that changed (with the new
   source location). Update the "Excalidraw internals" notes in `CLAUDE.md` if behaviour changed.

Tip: the readable build is `node_modules/@excalidraw/excalidraw/dist/dev/` (`index.js`,
`chunk-*.js`, `index.css`); grep it for the names below. Source locations given here are from
Excalidraw's own repo (`packages/excalidraw/...`).

## Static canvas hook: layout grid and dark-mode colours (highest risk: hooks the renderer)

Code: `web/src/canvasHook.ts` (all assumptions listed in its header), `web/src/useCanvasHook.ts`,
`web/src/darkImages.ts`, `shared/grid.ts`. mydraw wraps the 2D context of Excalidraw's static canvas
(background + shapes) to:
- paint the layout grid between the background and the shapes, and use Excalidraw's grid mode only
  for live snapping while hiding Excalidraw's own grid lines;
- apply the **dark theme inside the canvas**, per draw call, the way Excalidraw's own dark exports do,
  instead of Excalidraw's CSS filter on the whole canvas. Images are then drawn unfiltered, so icons
  keep their exact colours (Excalidraw's live pre-correction is approximate: `#cc092f` showed as
  `#993f69`). Two global canvas patches in `darkImages.ts` handle the images: Excalidraw's
  pre-correction on detached element canvases is skipped and remembered, and such canvases are drawn
  unfiltered onto a themed render, or with Excalidraw's correction anywhere else (identical to before).

| Assumption | Where in Excalidraw | If it breaks |
|---|---|---|
| The static canvas is one long-lived `<canvas class="excalidraw__canvas static">` | `components/canvases/StaticCanvas.tsx` | Hook can't attach → automatic fallback (overlay, no live snap) **(smoke)** |
| Every render starts with `fillRect(0, 0, width, height)` of the background, in CSS px at `scale(devicePixelRatio)`, inside a `save()`/`restore()` pair, before the grid and the shapes; nothing on the live canvas resets `context.filter` afterwards | `bootstrapCanvas` in `renderer/helpers.ts`, `_renderStaticScene` in `renderer/staticScene.ts` | Hook never fires → automatic fallback **(smoke)**; filter reset mid-render → `themeLost`, in-canvas dark theme switched off **(smoke)** |
| Excalidraw's grid lines are separate `beginPath/moveTo/lineTo/stroke` calls in exactly `#dddddd` / `#e5e5e5` | `strokeGrid` + `GridLineColor` in `renderer/staticScene.ts` | Grey grid lines not recognised → live snapping switched off automatically so they never show **(smoke)** |
| Grid drawing and snapping are both switched by `gridModeEnabled` (prop or app state); snapping uses `gridSize`; holding ⌘/Ctrl while dragging skips snapping | `isGridModeEnabled`, `getEffectiveGridSize` in `components/App.tsx` | Live snapping stops working **(smoke: drag test)** |
| `gridStep` is one of the props that re-render the static canvas (used to force a repaint after a colour/opacity change) | `getRelevantAppStateProps` in `StaticCanvas.tsx` | Grid colour/strength changes show only after the next scroll |
| `gridSize`/`gridStep` are clamped to 1..100 on restore | `getNormalizedGridSize/Step` | Spacing over 100 lost on reload (mydraw caps at 100) |
| Render throttling is off unless `window.EXCALIDRAW_THROTTLE_RENDER === true`, so `getAppState()` during a render is the rendered state | `isRenderThrottlingEnabled` | Grid lags the shapes by a frame while scrolling |
| ⌘' is Excalidraw's grid shortcut; the canvas context menu has "Toggle grid" (flips `gridModeEnabled`) | `actionToggleGridMode` | mydraw's capture listener blocks ⌘'; a `gridModeEnabled` flip we didn't make is treated as "toggle our grid" |
| Dark theme = `filter: invert(93%) hue-rotate(180deg)` on canvases (`THEME_FILTER`, CSS `.excalidraw.theme--dark canvas { filter: var(--theme-filter) }`); an inline `style.filter` on the canvas overrides it | `constants.ts`, `index.css` | Wrong dark colours: update `THEME_FILTER` in `web/src/darkImages.ts` and `EXCALIDRAW_DARK_INVERT` / `HUE_180` in `shared/grid.ts` **(smoke: background and shape colours)** |
| Images are pre-corrected for the dark theme by setting exactly `invert(100%) hue-rotate(180deg) saturate(1.25)` (`IMAGE_INVERT_FILTER`) on a **detached** per-element canvas, which is then drawn onto the static canvas with `drawImage`; not for files whose mimeType is exactly `image/svg+xml` | `generateElementCanvas` / `shouldResetImageFilter` in `renderer/renderElement.ts` | String changed → images look as before (Excalidraw's approximate correction), no breakage; draw path changed → check icon colours by hand **(smoke: exact icon colour)** |
| Excalidraw's own dark exports apply `THEME_FILTER` in the canvas and draw images with `filter = "none"` (exact colours) | `renderElement` (`isExporting` branch) | Dark exports would lose exact icon colours **(smoke: dark PNG export)** |

How the fallback works: after each grid or theme change (dark mode or grid on) `useCanvasHook`
forces a static re-render and checks the hook's counters (`CanvasHook.settle()`):
- no render seen twice in a row → `mode: "overlay"`: overlay grid (`web/src/GridOverlay.tsx`, drawn
  over the shapes), no live snapping, Excalidraw's own CSS dark filter (approximate image colours), a
  warning in the grid panel and a `console.warn`;
- grid-mode renders without any hidden Excalidraw grid stroke → `snapOk: false`;
- an element drawn without the theme filter during an in-canvas themed render → `themeOk: false`:
  Excalidraw's own CSS dark filter again.
The smoke test forces the fallback with `window.__mydrawNoGridHook = true`; `__mydrawTest.canvasStatus()`
and `__mydrawTest.darkImageStats()` show the counters.

To check by hand: turn on the grid with a bright colour at 100%, put a filled shape on it (lines
must not cross the fill), drag the shape (it jumps in grid steps, ⌘-drag moves freely), switch to
dark mode (same colour as in light mode), and confirm no light-grey dashed lines appear anywhere.
For dark mode: place a saturated logo (e.g. Dashboard Icons › Cloud › Broadcom, `#cc092f`) and a
filled shape, switch to dark: the logo must keep its exact colour, the shape and background must look
as in Excalidraw (background `#121212`/`#111111`), and switching back to light must restore everything.

## Everything else that depends on internals

| What mydraw relies on | Used by | Covered |
|---|---|---|
| `[data-testid="button-undo"]` / `button-redo` exist in each tab's UI | `web/src/agent/executor.ts` (MCP undo/redo) | smoke |
| `li[data-testid="addToLibrary"]`, `.sidebar-trigger`, `.default-sidebar-trigger` (hidden by CSS) | `web/src/styles.css` | by hand: no Library button, no "Add to library" |
| `li[data-testid="duplicateSelection"]` in the context menu (our stencil items are inserted before it); closing the menu with a body `pointerdown` | `web/src/App.tsx` (context menu augment) | smoke |
| `.App-menu__left .panelColumn` and `.color-picker__top-picks` (our Colors/Properties sections are portaled there; Excalidraw's Stroke/Background rows are hidden) | `web/src/App.tsx`, `StyleSection` | smoke (`.md-style`) |
| Excalidraw's Align section: a direct `fieldset` child of `.panelColumn` (a flex column) containing buttons with the English aria-labels "Align left" … "Distribute vertically"; shown for 2+ selected items, distribute for 3+ | `web/src/arrange.ts` (tagged `.md-arrange`; placed just above Edges by `nativeOrder` in `shared/panelOrder.ts`; palette "Arrange" commands click these buttons) | smoke |
| Panel sections = direct children of `.panelColumn` (a flex column). Keys: radio group `name` (`stroke-width`, `sloppiness`, `strokeStyle`, `edges`, `fill`, …), the Opacity `label.control-label` with a range `data-testid`, English aria-labels "Align left" / "Send to back" / "Duplicate" / "Delete" (align, layers, actions), else the `legend` text. Ordered with inline CSS `order`, never by moving nodes | `web/src/panelOrder.ts` (drag by `legend` / Opacity label; `Settings.panelOrder`) | smoke |
| Stroke width / Sloppiness / Edges rows: `ButtonIconSelect` = `.buttonList` with radios `name="stroke-width" \| "sloppiness" \| "edges"`; a foreign `span.md-ft-host` appended to the list survives re-renders (re-appended by the panel observer when not last) | `web/src/FineTune.tsx` | smoke |
| Renderer accepts any numeric `strokeWidth` and `roughness` (`adjustRoughness` caps shapes under ~20x50 px at 2.5); `roundness: {type: 3, value}` = custom radius only for rectangle/image/embeddable/iframe (`isUsingAdaptiveRadius`), capped at 25% of the shorter side (`getCornerRadius`); `restoreElement` keeps `roundness.value` | `shared/fineTune.ts` | unit + smoke |
| `.dropdown-menu-item-custom` styling for our menu rows | `web/src/AppMenu.tsx`, `styles.css` | by hand |
| Excalidraw's layers share the page's stacking context: static canvas `--zIndex-canvas` 1, interactive canvas 2, UI layer `--zIndex-layerUI` 4. The fallback grid overlay (`.md-grid-canvas`, z-index 1, after Excalidraw in the DOM) relies on this to sit under handles, toolbars and menus. Never raise Excalidraw's own elements (e.g. `.Island`) to fix stacking: its menus live inside Islands and end up behind the style panel | `styles.css` | smoke (menu above style panel), by hand for the fallback |
| Keyboard shortcuts work only while `.excalidraw` has focus (we focus it after closing our dialogs) | `App.tsx`, `QuickConnect.tsx` | smoke |
| `CaptureUpdateAction`: `IMMEDIATELY` = own undo step; `NEVER` = not in history; `EVENTUALLY` merges into the *previous* committed change | executor, zone follow, icon recolor | smoke |
| Selection changes are recorded in undo history; `customData` changes are not | properties, executor | smoke |
| `updateScene` before `addFiles` when swapping an image's `fileId` (images load only for files added while referenced) | `web/src/library/iconColor.ts` | smoke (recolor) |
| Dark mode pre-corrects images except files whose mimeType is exactly `image/svg+xml` (hence `image/svg+xml;mydraw=truecolor`, so icons count as images; see the static canvas hook above for how they become exact) | `web/src/library/trueColor.ts` | smoke (exact icon colour) |
| SVG files need numeric width/height or raster export crops them | `ensureSvgSize` | smoke (exports) |
| Elbow arrows: Excalidraw re-routes them on drag only with `fixedPoint` bindings; `fixedSegments` survive drags; `restoreElements` drops such bindings | `web/src/agent/sceneOps.ts`, `shared/avoidRoute.ts` | smoke |
| `convertToExcalidrawElements`: binds only within its own batch, shifts multi-point arrows, needs `children: []` on frames, `regenerateIds: false` keeps ids | `sceneOps.ts`, `drawioImport.ts` | smoke + unit |
| Arrow label position (middle point / middle of middle segment) | `labelPoint` in `sceneOps.ts` | smoke |
| `normalizeLink` leaves relative paths alone | drill-down links | smoke |
| `getAppState()` doesn't see an `updateScene` from the same tick | `web/src/headless.tsx` (CLI) | smoke (CLI) |
| Excalidraw's `CommandPalette` isn't public; its own palette is never rendered | `CommandPalette.tsx` | by hand: ⌘K / ⇧⌘P open ours |
| `UIOptions.canvasActions` keys (`loadScene`, `saveToActiveFile`, `export`, `saveAsImage`, `toggleTheme`) | `App.tsx` `UI_OPTIONS` | typecheck |
| Fonts are copied from the package into `web/public/fonts`; the CDN fallback is blocked by CSP (console `font-src` errors are expected) | `scripts/build-app.mjs` | by hand: text renders in all fonts |
| `process.env.IS_PREACT` must be defined as `"false"` | `vite.config.ts` | build |
| `serializeAsJSON` / `loadFromBlob` / `exportToCanvas` / `exportToSvg` / `exportToBlob` signatures and the saved `appState` keys | `web/src/scene.ts`, `exportImage.ts` | typecheck + smoke |
| Saved files get Excalidraw's default grid state, not the app's (`FILE_GRID_STATE`) | `web/src/scene.ts` | smoke |

If you find a new dependency on Excalidraw internals while working on mydraw, add it to this file.
