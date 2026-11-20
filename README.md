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

## Stencil library (Phase 3)

- One library for every drawing, stored in `~/Documents/mydraw/Library/` (change it from the Stencils panel ⋯ menu). Each top-level folder is a collection; sub-folders are groups.
- **Stencils panel** (tab bar button or ⇧⌘Y): search, ★ favorites, recent, collapsible collections. Click to insert (repeated clicks lay icons out in a row), or drag onto the canvas. Right-click for favorite / rename / show in Finder / move to Trash.
- **Icon packs** (⋯ → Download icon packs…): AWS, Azure, Google Cloud, Kubernetes, network devices (IBM Carbon) and 2,300 product logos, downloaded from the vendors into the library folder. Command line: `node scripts/fetch-packs.mjs [aws azure gcp k8s network logos]`.
- **Your own stencils**: select shapes → ⋯ → Save selection as stencil (or Edit → Save Selection as Stencil…). Drop SVG/PNG/.excalidrawlib files or folders onto the panel to import them.
- **Recolor icons**: select one or more SVG icons; an **Icon color** section appears at the top of the left properties panel: 11 swatches + your last custom color as the 12th, **Original**, and **Custom…** (color square, hue, hex, eyedropper) that updates the icons live while you drag. A whole drag is one undo step. Colored parts take the new color, white details are kept; saved with the drawing. PNG icons can't be recolored.
- **Excalidraw's Library panel** is saved to `Library/Excalidraw Library/library.excalidrawlib` and shared by all tabs.
- Drawings embed the icons they use, so they still open if a stencil is later changed or deleted.

## Layout

```
app/src/      Electron main process + preload (bundled by esbuild to app/dist)
web/src/      React renderer with Excalidraw (Vite)
shared/       Types and pure helpers used by both
scripts/      dev, build and smoke-test scripts
tests/        vitest unit tests
```

App data (settings, recovery) lives in `~/Library/Application Support/mydraw/`; the stencil library in `~/Documents/mydraw/Library/`.

## App name and icon

`assets/icon.svg` is the source icon; `npm run icon` regenerates `assets/icon.png` and `assets/icon.icns`.
On macOS, dev/start/smoke run a copy of Electron renamed to `mydraw.app` (built automatically in `.electron/` by `scripts/electron-app.mjs`), so the menu bar, Dock and ⌘-Tab show "mydraw" with the mydraw icon.
