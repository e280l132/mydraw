# mydraw

Local desktop diagramming app built on [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT), with network/cloud stencils and Claude Code control (planned). See `plan.md` for the roadmap.

## Run

```bash
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's binary download
npm run dev        # Vite dev server + Electron, restarts on main-process changes
npm start          # build and run the production bundle
```

## Test

```bash
npm test           # unit tests (vitest)
npm run typecheck
npm run smoke      # builds, then drives the real app with Playwright (save, autosave, export, reload, crash recovery)
```

## What works (Phase 1)

- Tabs: several drawings open at once (⌘1–9, Ctrl+Tab), dot on unsaved tabs, middle-click to close.
- New / Open / Save / Save As (`.excalidraw`), Open Recent, opening files from Finder or the command line.
- Autosave for saved files (File → Autosave, on by default).
- Crash recovery: unsaved drawings are written to the app data folder and restored on next launch.
- File watching: if a drawing changes on disk, it reloads (or asks first when you have unsaved edits).
- Export image (⇧⌘E): PNG, JPG, SVG; whole drawing or selection; 1–4× scale; padding; background; dark mode; JPG quality; embed the editable drawing in PNG/SVG.
- View → Theme (System/Light/Dark) and Drawing Style (Clean = sharp edges, no roughness, Nunito; Sketch = hand-drawn).
- Works offline: Excalidraw fonts are served locally.

## Layout

```
app/src/      Electron main process + preload (bundled by esbuild to app/dist)
web/src/      React renderer with Excalidraw (Vite)
shared/       Types and pure helpers used by both
scripts/      dev, build and smoke-test scripts
tests/        vitest unit tests
```

App data (settings, recovery) lives in `~/Library/Application Support/mydraw/`.
