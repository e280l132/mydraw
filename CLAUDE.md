# mydraw — notes for agents

Roadmap and phase status: `plan.md`. Read it before starting a phase.

## Architecture
- `app/src/main.ts`: Electron main. Serves `web/dist` over the privileged `app://mydraw` scheme (prod) or loads `MYDRAW_DEV_URL` (dev). All file I/O, dialogs, menus, settings and the crash-recovery folder live here. The renderer may only write to paths the user opened or picked (`allowedPaths`).
- `app/src/preload.ts`: exposes `window.mydraw` (typed by `MydrawBridge` in `shared/types.ts`). Context isolation + sandbox on; add new IPC here and in `shared/types.ts` together.
- `web/src/App.tsx`: tabs, save/autosave, recovery, file-watch conflicts, close flow. One mounted `<Excalidraw>` per tab (hidden when inactive) so each keeps its own undo history. Latest state is read through refs (`tabsRef`, `settingsRef`, `apis`) because callbacks come from Excalidraw, IPC and timers.
- Dirty tracking: `sceneHash` (element versions + count + background) compared with a per-tab baseline set on first `onChange` after load, after save, and after reload.
- Drawing style (Clean/Sketch) sets `currentItem*` app state only; it never edits existing elements.

## Stencil library
- `app/src/library.ts` (`LibraryStore`): scans the library folder (collections = top-level folders; items = .svg/.png, `.stencil.json`, entries of `.excalidrawlib`), watches it, keeps favorites/recent in `library.json`. Item ids are root-relative paths (`#n` for .excalidrawlib entries). Files are served to the renderer via the `mdlib://library/<path>` protocol, confined to the root.
- `app/src/packs.ts`: icon-pack downloader (plain Node; also `scripts/fetch-packs.mjs`). Packs build in `.<Collection>.installing` and replace only folders whose `collection.json` has `managedBy: "mydraw-packs"`.
- `web/src/library/stencilContent.ts`: item → elements (+ image files, fileId = SHA-1 of the bytes), `cloneForInsert` (fresh ids, remapped bindings/groups), `insertStencil`. Reuse these for MCP `place_stencil` in Phase 2.
- Excalidraw's own Library panel: `initialData.libraryItems` + `onLibraryChange` → `Library/Excalidraw Library/library.excalidrawlib`, synced to all tabs via `updateLibrary` (hash check prevents loops).
- Panel → canvas drag uses the `application/x-mydraw-stencil` type and is handled in a capture-phase drop listener in `App.tsx`, before Excalidraw sees it.
- Icon recolor: `shared/recolor.ts` (`recolorSvg`, pure + unit-tested) rewrites fills/strokes/stops/currentColor, keeping near-white and transparent parts. `web/src/library/iconColor.ts` swaps the element's `fileId` to the recolored SVG and keeps the original SVG in `customData.mydrawOriginalSvg` (+ `mydrawIconColor`), so recolors never compound and "Original" restores. Reuse for an MCP `recolor` tool.
- Excalidraw 0.18 records selection changes in undo history.
- Dark mode: Excalidraw inverts the canvas with a CSS filter and pre-corrects raster images, but not files whose mimeType is exactly `image/svg+xml`. SVG icon files use `image/svg+xml;mydraw=truecolor` (`web/src/library/trueColor.ts`, applied on insert, recolor and file open) so icons keep their real colors in both themes and in dark exports. Detect SVGs by data URL, not mimeType.
- SVG files must have numeric width/height (`ensureSvgSize`), otherwise Excalidraw's raster-image export crops them.
- Eyedropper (`web/src/library/pickColor.ts`): `elementAt` hit-tests scene coords (topmost; bound text → container; unfilled shapes only near their outline; lines/arrows last) and `colorOfElement` reads the real color (`customData.mydrawIconColor`, `dominantSvgColor`, raster quantisation, or fill/stroke). Pick mode swallows the canvas click in a capture-phase listener so the selection is kept.
- The Icon color section is rendered with a React portal into a host `<div>` we prepend to Excalidraw's `.App-menu__left .panelColumn` (no API for custom panel sections); a MutationObserver in `App.tsx` re-attaches it.
- Live recolor previews use `CaptureUpdateAction.NEVER`; `IconRecolorSession` restores the pre-drag elements (NEVER) before the final IMMEDIATELY change, so a drag is one undo step. Don't use EVENTUALLY here: in 0.18 it merges into the *previous* committed change.
- When swapping an image's `fileId`, call `updateScene` first and `addFiles` after; Excalidraw only starts loading images for files added while an element references them (otherwise a grey placeholder shows until some later update).
- Excalidraw handles keyboard shortcuts only when its canvas has focus (tests click the canvas first).
- Console "font-src" CSP errors for `esm.sh` are expected: Excalidraw lists a CDN fallback after our local fonts; CSP blocks it so the app stays offline.

## Agent control (MCP, Phase 2)
- Path: Claude Code → `mcp/src/index.ts` (stdio MCP server, bundled to `mcp/dist/index.js` by `scripts/build-mcp.mjs`) → HTTP `POST 127.0.0.1:<port>/rpc` → `app/src/control.ts` → `app/src/agent.ts` (main) → IPC `agent:command` → `web/src/agent/executor.ts` (renderer) → reply on `agent:reply`.
- `control.ts`: loopback only, random port, 32-byte key as `Authorization: Bearer`. Refuses any request with an `Origin` header or a non-loopback `Host` (CSRF / DNS rebinding). `{port, key, pid}` in `<userData>/control.json`, chmod 600, removed on quit.
- `agent.ts` runs library and file-system methods in main (`search_stencils`, `add_stencil_file`, `delete_stencil`, `open_drawing`, writing exports, allowing `save` paths) and forwards the rest. `place_stencil` gets the full `LibraryItem` from main, so freshly added stencils work before the renderer's index refreshes.
- Executor: commands run strictly one at a time against the latest scene; every scene change is a single `updateScene(IMMEDIATELY)` that merges by element id, so one MCP call = one undo step and user edits made meanwhile are kept. Selection changes from `select` use `NEVER`.
- `web/src/agent/sceneOps.ts`: `buildElements` (skeletons via `convertToExcalidrawElements` with `regenerateIds: false`; arrows with `from`/`to` are drawn edge to edge with `shared/geometry.ts` and bound by hand, because the converter only binds within its own batch), `applyUpdates` (moves/resizes re-centre labels via `relabel` and `reroute` bound arrows), `deleteElements` (unbinds arrows), `describe` (compact `get_scene` output; bound labels folded into their container).
- Undo/redo click the tab's own `[data-testid="button-undo"]` (each `DrawingView` root has `data-md-tab`); Excalidraw's API has no undo call.
- Drawings are addressed by `drawing` = tab id, file path or title; default active tab.
- MCP finds the app via `MYDRAW_USER_DATA` (default `~/Library/Application Support/mydraw`). If it isn't running it launches `/Applications/mydraw.app` (or `MYDRAW_APP`), else the dev build with the branded Electron (`npm run build` first). `MYDRAW_NO_LAUNCH=1` disables launching (smoke test).
- Register: `claude mcp add --scope user mydraw -- node ~/Projects/mydraw/mcp/dist/index.js`.

## How to drive mydraw (for Claude)
1. `list_drawings` / `new_drawing` / `open_drawing`; `get_scene` for ids.
2. Shapes with labels in one `add_elements` call (give your own ids like `"web1"` so you can refer to them); arrows as `{type:"arrow", from, to, label}` in the same call or via `connect`.
3. Icons: `search_stencils "ec2"` → `place_stencil {id, right_of: "web1", label: "web-1"}`; connect to the returned `icon` id.
4. `screenshot` to check the layout; fix with `move` / `update_elements`; `zoom_to_fit` so the user sees it.
5. `save {path}` and `export {path: ".../x.png"}`.

## Conventions
- Excalidraw is pinned to `0.18.1`. Import types from `@excalidraw/excalidraw/types` and `@excalidraw/excalidraw/element/types`.
- `process.env.IS_PREACT` must stay defined as `"false"` in `vite.config.ts`.
- Fonts are copied from the package into `web/public/fonts` by `scripts/build-app.mjs` (gitignored).
- Edit menu: undo/redo/select-all use `registerAccelerator: false` so the keys reach Excalidraw.
- No browser `alert/confirm`; use the main-process dialogs (`askUnsaved`) or in-app banners/toasts.

## Checks before committing
`npm run typecheck && npm test && npm run smoke` (`npm run build` also builds the MCP server)

The smoke test runs the built app with `MYDRAW_TEST=1`, a temp `MYDRAW_USER_DATA` and a temp `MYDRAW_LIBRARY`, and uses the test-only `window.__mydrawTest` hook (`web/src/App.tsx`). Extend it when adding features.
