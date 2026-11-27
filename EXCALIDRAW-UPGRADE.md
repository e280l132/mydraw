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

## Extra fonts: Excalidraw's font registry (high risk: not public API)

Code: `web/src/excalidrawFonts.ts` (assumptions in its header), `web/src/fontRegistry.tsx`,
`vite.config.ts` (`EXCALIDRAW_FONT_CHUNK`, `resolve.alias`, `optimizeDeps.include`). mydraw adds
fonts (built-in set, catalog downloads, fonts carried inside drawings) by registering them in
Excalidraw's own `Fonts` registry, so its font picker, canvas, text editor and SVG/PDF exports use them.
If the registry can't be found, extra fonts switch off with a `console.warn`: text that uses them
renders in a fallback font, and saved files keep the fonts they carry.

| Assumption | Where in Excalidraw | If it breaks |
|---|---|---|
| `Fonts` (class) lives in the chunk named in `vite.config.ts` `EXCALIDRAW_FONT_CHUNK` (`dist/dev/chunk-4FTI6OG3.js`, `dist/prod/chunk-K2UTITRG.js` in 0.18.1). **The names change with every release**: grep the new `dist/*/chunk-*.js` for `Lilita One` / `loadElementsFonts` and update both paths | `fonts/Fonts.ts` | build error (missing file) or fonts off **(smoke)** |
| That chunk also exports the public `FONT_FAMILY` object (same module instance check) and `Fonts` with static `registered` (Map id -> {metadata, fontFaces}), `register(family, metadata, ...{uri, descriptors})`, `loadElementsFonts` | `fonts/Fonts.ts`, `constants.ts` | fonts off **(smoke)** |
| Each `Fonts.registered` entry's `fontFaces[].fontFace` is a real `FontFace` (loaded lazily); `ensureFontsLoaded` adds it to `document.fonts` and calls `load()` before agent commands measure text (`convertToExcalidrawElements` measures with whatever font is loaded, so an unloaded font gives a box too narrow and the canvas clips the text) | `fonts/Fonts.ts`, `fonts/ExcalidrawFontFace.ts` | generated titles / zone titles / legend labels cut off at the end **(smoke: Diagram quality)** |
| `FONT_FAMILY` (name -> id) is a plain mutable object; `getFontFamilyString` looks ids up in it and writes the name **unquoted** into the CSS font string (hence `cssSafeFamily`) | `constants.ts`, `utils.ts` | text drawn in a fallback font **(smoke)** |
| `restoreElement` keeps unknown numeric `fontFamily` values | `data/restore.ts` | opened drawings lose their fonts **(smoke)** |
| The Font family section is a `fieldset` containing the picker trigger `[data-testid="font-family-show-fonts"]`; mydraw appends a `.md-ts-host` (Bold / Italic buttons) to that fieldset, and reads `appState.editingTextElement` (set while a text is edited, when the selection can be empty) | `web/src/TextStyle.tsx` (`attachTextStyleHost`), `web/src/textStyleOps.ts` | smoke ("Bold / italic") |
| `FontPickerList` lists `Fonts.registered` (skipping `serverSide`/`fallback` metadata) each time it opens, with `metadata.icon` and the text `fontFaces[0].fontFace.family` (mydraw strips Chromium's quotes with an own `family` getter: `unquotePickerNames`); picker list class `.dropdown-menu.fonts`, trigger `[data-testid="font-family-show-fonts"]` | `components/FontPicker/*` | fonts missing from the picker, or quoted names **(smoke)** |
| `getLineHeight` / `getVerticalOffset` read `metadata.metrics` from the registry | `fonts/Fonts.ts` | text sits a pixel or two off |
| `ExcalidrawFontFace.createUrls`: `data:` URIs are used as they are; absolute `app:`/`mdfont:`/`http(s):` URLs survive `new URL(uri, base)`; SVG export fetches them to subset (`generateFontFaceDeclarations`) | `fonts/ExcalidrawFontFace.ts` | SVG/PDF exports without the font **(smoke)** |
| Dev only: Vite must pre-bundle the alias together with `@excalidraw/excalidraw` (`optimizeDeps.include`), or there are two registries; excluding Excalidraw from pre-bundling breaks its CommonJS deps | `vite.config.ts` | by hand: `npm run dev`, fonts status in the console |

## Everything else that depends on internals

| What mydraw relies on | Used by | Covered |
|---|---|---|
| Excalidraw's help is `appState.openDialog = {name: "help"}` (set by `?`, the corner `.help-icon` button and the menu's Help item); its dialog is `.HelpDialog` with a `.HelpDialog__header` of `.HelpDialog__btn` links | `web/src/App.tsx` (`openExcalidrawHelp`, the observer that adds the "mydraw features and shortcuts" button to the header), `web/src/HelpDialog.tsx` | smoke ("?" opens it, both buttons switch dialogs) |
| `[data-testid="button-undo"]` / `button-redo` exist in each tab's UI | `web/src/agent/executor.ts` (MCP undo/redo) | smoke |
| `li[data-testid="addToLibrary"]`, `.sidebar-trigger`, `.default-sidebar-trigger` (hidden by CSS) | `web/src/styles.css` | by hand: no Library button, no "Add to library" |
| `li[data-testid="duplicateSelection"]` in the context menu (our stencil items are inserted before it); closing the menu with a body `pointerdown` | `web/src/App.tsx` (context menu augment) | smoke |
| `li[data-testid="copyStyles"]` / `"pasteStyles"` in the context menu: our Copy look / Paste look go before them and CSS hides them; Excalidraw's copyStyles key ⌥⌘C is taken in App's capture keydown (stopPropagation) | `web/src/App.tsx`, `web/src/styles.css` | smoke "Style brush" |
| `.App-menu__left .panelColumn` and `.color-picker__top-picks` (our Colors/Properties sections are portaled there; Excalidraw's Stroke/Background rows are hidden) | `web/src/App.tsx`, `StyleSection` | smoke (`.md-style`) |
| Excalidraw's Align section: a direct `fieldset` child of `.panelColumn` (a flex column) containing buttons with the English aria-labels "Align left" … "Distribute vertically"; shown for 2+ selected items, distribute for 3+ | `web/src/arrange.ts` (tagged `.md-arrange`; placed just above Edges by `nativeOrder` in `shared/panelOrder.ts`; palette "Arrange" commands click these buttons) | smoke |
| Text renderers (both in the font chunk): canvas `drawElementOnCanvas` text branch = `ctx.fillStyle = el.strokeColor; ctx.textAlign = el.textAlign;` … `for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, i * lineHeightPx + verticalOffset)`; SVG `renderElementToSvg` text branch = `text.setAttribute("fill", el.strokeColor)` followed by `"text-anchor"`. mydraw inserts calls to `globalThis.__mydrawTextOutline` (before the fill loop) and `__mydrawSvgTextOutline` (after the fill attribute). Text element canvases are padded by `fontSize / 2` (`getCanvasPadding`), so outlines are capped at `fontSize / 4` | `scripts/excalidrawPatch.mjs` (`patchTextOutline`; the build throws when either pattern stops matching), `web/src/textOutline.ts`, `shared/textOutline.ts` | `tests/textOutline.test.ts` (patches the real dev + prod chunks), smoke ("text outline") |
| Per-element renderers (both in the font chunk): canvas `renderElement(element, elementsMap, allElementsMap, rc, context, renderConfig, appState)` whose body starts with `const reduceAlphaForSelection = appState.openDialog?.name === "elementLinkSelector" && !appState.selectedElementIds[element.id]` (prod: `Fn=(e,t,n,r,o,i,a)=>{let s=a.openDialog?.name==="elementLinkSelector"…`); SVG `renderElementToSvg(element, elementsMap, rsvg, svgRoot, files, offsetX, offsetY, renderConfig)` whose body starts with `const offset = { x: offsetX, y: offsetY }`. mydraw inserts a delegation to `globalThis.__mydrawShadowRender` / `__mydrawSvgShadow` at the start of each body. The shadow code relies on: on screen an element is ONE `drawImage` of its cached element canvas (`drawElementFromCanvas`), so a context shadow is drawn once; exports (`renderConfig.isExporting`) draw with `drawElementOnCanvas` through `rc` (a RoughCanvas, re-created for the layer with `new rc.constructor(layer)`); renderElement sets `context.globalAlpha` itself; `shouldResetImageFilter` sets `context.filter = "none"` for images in dark exports; image `<symbol>`s are put into the `root` passed to `renderElementToSvg`; `renderConfig.exportWithDarkMode` = the SVG gets `filter: THEME_FILTER` | `scripts/excalidrawPatch.mjs` (`patchShadow`; the build throws unless each renderer is found exactly once), `web/src/shadowRender.ts`, `shared/shadow.ts` | `tests/shadow.test.ts` (patches the real dev + prod chunks), smoke ("shadows": pixels on screen, PNG export without shadow on the fill, SVG filter, dark screenshots) |
| `showSelectedShapeActions(appState, elements)` (`element/showSelectedShapeActions.ts`) decides whether the style column renders (selection or a drawing tool; not select/eraser/hand/laser with nothing selected). mydraw rewrites it in the bundled chunk (dev: `var showSelectedShapeActions = (appState, elements) => Boolean(`; prod: minified `=(e,t)=>!!(!e.viewModeEnabled&&e.openDialog?.name!=="elementLinkSelector"&&(e.activeTool.type!=="custom"`) to start with `(globalThis.__mydrawPinPanel && !viewMode && no link dialog) ||`. The plugin throws when a pattern stops matching, so the build fails loudly. Also applied to the dev pre-bundle through `optimizeDeps.rolldownOptions` (clear `node_modules/.vite` after changing it) | `scripts/excalidrawPatch.mjs`, `vite.config.ts`, `web/src/panelPin.ts` (flag + `api.refresh()`) | smoke ("pin style panel") |
| Panel sections = direct children of `.panelColumn` (a flex column). Keys: radio group `name` (`stroke-width`, `sloppiness`, `strokeStyle`, `edges`, `fill`, …), the Opacity `label.control-label` with a range `data-testid`, English aria-labels "Align left" / "Send to back" / "Duplicate" / "Delete" (align, layers, actions), else the `legend` text. Ordered with inline CSS `order`, never by moving nodes | `web/src/panelOrder.ts` (drag by `legend` / Opacity label; `Settings.panelOrder`) | smoke |
| Stroke width / Sloppiness / Edges / Font size rows: `ButtonIconSelect` = `.buttonList` with radios `name="stroke-width" \| "sloppiness" \| "edges" \| "font-size"`; a foreign `span.md-ft-host` appended to the list survives re-renders (re-appended by the panel observer when not last) | `web/src/FineTune.tsx` | smoke |
| Font size slider reproduces Excalidraw's `changeFontSize`: text + bound text change, the container re-fits, free text keeps its anchor (`offsetElementAfterFontResize`: left edge / middle / right edge by `textAlign`, vertical middle; none for bound or `autoResize: false` text) | `actions/actionProperties.tsx` | by hand: S/M/L/XL vs the slider on centred and right-aligned text; `tests/fineTune.test.ts` `anchorAfterResize` |
| Renderer accepts any numeric `strokeWidth` and `roughness` (`adjustRoughness` caps shapes under ~20x50 px at 2.5); `roundness: {type: 3, value}` = custom radius only for rectangle/image/embeddable/iframe (`isUsingAdaptiveRadius`), capped at 25% of the shorter side (`getCornerRadius`); `restoreElement` keeps `roundness.value` | `shared/fineTune.ts` | unit + smoke |
| Generator options (`_generateElementShape` options helper, `rt` in the prod chunk): `strokeLineDash: el.strokeStyle === "dashed" ? … : el.strokeStyle === "dotted" ? … : undefined`; mydraw prefixes `globalThis.__mydrawDash?.(el) ? globalThis.__mydrawDash(el) :` (`patchDash`, build throws if not found exactly once). Also: `fillStyle` is passed to roughjs unchanged and `restoreElements` keeps any `fillStyle` string, so roughjs's `dots`, `dashed`, `zigzag-line` fills need no patch | `scripts/excalidrawPatch.mjs`, `web/src/dashRender.ts`, `shared/dash.ts`, `shared/fills.ts` | unit (`tests/dash.test.ts`) + smoke ("More stroke styles", "More fills") |
| Generator options: `fillWeight: el.strokeWidth / 2, hachureGap: el.strokeWidth * 4` (Excalidraw ties the hatch to the stroke width); mydraw makes each `globalThis.__mydrawFillPattern?.(el)?.fillWeight ?? …` / `?.hachureGap ?? …` (`patchFillPattern`, build throws if not found exactly once). A stroke-width change pins the old pattern into `customData.mydrawFillPattern` (fine-tune patch + App onChange `pinPatterns`) | `scripts/excalidrawPatch.mjs`, `web/src/fillPatternRender.ts`, `web/src/fillPatternOps.ts`, `shared/fillPattern.ts` | unit (`tests/fillPattern.test.ts`) + smoke ("More fills": pattern pinned, spacing, Match stroke) |
| Fill row = `ButtonIconSelect type="button"` with `data-testid="fill-hachure" / "fill-cross-hatch" / "fill-solid"`; Stroke style row = radios `name="strokeStyle"` WITHOUT a value attribute (order solid, dashed, dotted). Our "…" buttons (`span.md-more-host`) are appended to those `.buttonList`s; a capture click on Excalidraw's own buttons drops our dash style / gradient | `web/src/StyleMore.tsx` | smoke |
| Gradient fills: the element is rendered as a copy whose `backgroundColor` is a sentinel; roughjs sets `ctx.fillStyle = fill` (canvas, element-local coords 0..width / 0..height) and `fill="…"` (SVG). A `CanvasRenderingContext2D.prototype.fillStyle` setter wrap swaps the sentinel for a gradient; Excalidraw's shape and element-canvas caches are keyed by element object, so the copy is memoised per element | `web/src/shadowRender.ts` (element hook), `shared/gradient.ts` | smoke (pixels top vs bottom, SVG `<linearGradient>`) |
| `.dropdown-menu-item-custom` styling for our menu rows | `web/src/AppMenu.tsx`, `styles.css` | by hand |
| Excalidraw's layers share the page's stacking context: static canvas `--zIndex-canvas` 1, interactive canvas 2, UI layer `--zIndex-layerUI` 4. The fallback grid overlay (`.md-grid-canvas`, z-index 1, after Excalidraw in the DOM) relies on this to sit under handles, toolbars and menus. Never raise Excalidraw's own elements (e.g. `.Island`) to fix stacking: its menus live inside Islands and end up behind the style panel | `styles.css` | smoke (menu above style panel), by hand for the fallback |
| Keyboard shortcuts work only while `.excalidraw` has focus (we focus it after closing our dialogs) | `App.tsx`, `QuickConnect.tsx` | smoke |
| A synthetic `dblclick` on the interactive canvas over a selected plain shape starts editing its label (Excalidraw has no API to start text editing) | `editLabelOf` in `QuickConnect.tsx` | smoke "Quick connect: preview, right-click menu…" (diamond label typed) |
| ⌘+arrow is Excalidraw's flowchart key; our ⌥⌘+arrow is swallowed in a window capture listener before Excalidraw's document listener sees it | `QuickConnect.tsx` keyboard effect | smoke (keyboard chain) |
| `CaptureUpdateAction`: `IMMEDIATELY` = own undo step; `NEVER` = not in history; `EVENTUALLY` merges into the *previous* committed change | executor, zone follow, icon recolor | smoke |
| Selection changes are recorded in undo history; `customData` changes are not | properties, executor | smoke |
| `updateScene` before `addFiles` when swapping an image's `fileId` (images load only for files added while referenced) | `web/src/library/iconColor.ts` | smoke (recolor) |
| Dark mode pre-corrects images except files whose mimeType is exactly `image/svg+xml` (hence `image/svg+xml;mydraw=truecolor`, so icons count as images; see the static canvas hook above for how they become exact) | `web/src/library/trueColor.ts` | smoke (exact icon colour) |
| SVG files need numeric width/height or raster export crops them | `ensureSvgSize` | smoke (exports) |
| Elbow arrows: Excalidraw re-routes them on drag only with `fixedPoint` bindings; `fixedSegments` survive drags; `restoreElements` drops such bindings | `web/src/agent/sceneOps.ts`, `shared/avoidRoute.ts` | smoke |
| `convertToExcalidrawElements`: binds only within its own batch, shifts multi-point arrows, needs `children: []` on frames, `regenerateIds: false` keeps ids | `sceneOps.ts`, `drawioImport.ts` | smoke + unit |
| Arrow label position (middle point / middle of middle segment) | `labelPoint` in `sceneOps.ts` | smoke |
| Draw order: a bound text label is drawn right after its container, so a filled shape image must be pushed BEFORE the container or it covers the label | `shapeImage` / `makeIconNode` in `web/src/agent/diagram.ts` | smoke (generated shapes) |
| `normalizeLink` leaves relative paths alone | drill-down links | smoke |
| `getAppState()` doesn't see an `updateScene` from the same tick | `web/src/headless.tsx` (CLI) | smoke (CLI) |
| Excalidraw's `CommandPalette` isn't public; its own palette is never rendered | `CommandPalette.tsx` | by hand: ⌘K / ⇧⌘P open ours |
| `UIOptions.canvasActions` keys (`loadScene`, `saveToActiveFile`, `export`, `saveAsImage`, `toggleTheme`) | `App.tsx` `UI_OPTIONS` | typecheck |
| Fonts are copied from the package into `web/public/fonts`; the CDN fallback is blocked by CSP (console `font-src` errors are expected) | `scripts/build-app.mjs` | by hand: text renders in all fonts |
| `process.env.IS_PREACT` must be defined as `"false"` | `vite.config.ts` | build |
| `serializeAsJSON` / `loadFromBlob` / `exportToCanvas` / `exportToSvg` / `exportToBlob` signatures and the saved `appState` keys | `web/src/scene.ts`, `exportImage.ts` | typecheck + smoke |
| Saved files get Excalidraw's default grid state, not the app's (`FILE_GRID_STATE`) | `web/src/scene.ts` | smoke |
| Excalifont's Latin subset file name (`fonts/Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2`, the entry with `U+20-7e` in Excalidraw's font table) and `fonts/Virgil/Virgil-Regular.woff2`, used by the `md-preview-*` `@font-face` rules that show hand fonts in the Stencils panel / Icon style menus | `web/src/styles.css` (top), `web/src/library/captionFont.ts` `fontCss` | smoke screenshot `stencil-font-menu.png` (Excalifont row in its own face) |

If you find a new dependency on Excalidraw internals while working on mydraw, add it to this file.
