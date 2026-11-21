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
- Export (⇧⌘E): PNG, JPG, WebP, SVG, PDF (vector; page = drawing size, A4 or Letter, or actual size over several sheets), PowerPoint (one picture per slide, 16:9 or 4:3), draw.io (`.drawio`: editable shapes, text, arrows, zones as containers, icons as images, properties), a single-file HTML viewer (pan/zoom, links), Mermaid flowchart, and a CSV / Markdown inventory (name, kind, type, zone, IP, hostname, notes). Whole drawing, selection, one frame or every frame (one file each; PDF/PowerPoint/draw.io: one page or slide per frame in a single file); 1–4× scale; padding; background (off = transparent); dark mode; JPG/WebP quality; embed the editable drawing in PNG/SVG. **Keep an image up to date** (export dialog, per drawing, default Off): choose PNG or SVG and every save also rewrites e.g. `network.png` next to `network.excalidraw`, so README/docs images never go stale. File → Copy As: PNG, SVG or Mermaid.
- View → Theme (System/Light/Dark) and Drawing Style (Clean = sharp edges, no roughness, Nunito; Sketch = hand-drawn).
- Works offline: Excalidraw fonts are served locally.

## Command line

`mydraw` exports and converts drawings without opening the app (it renders in a hidden window; the app does not need to be running). Set it up once with `npm run build && npm link` (or `ln -s ~/Projects/mydraw/bin/mydraw.mjs /usr/local/bin/mydraw`).

```bash
mydraw export net.excalidraw --format jpg --scale 2 --frame "Prod"   # -> net.jpg
mydraw export net.excalidraw --format pdf --scope frames --page a4   # one page per frame
mydraw export net.excalidraw --scope frames -o shots/                # one PNG per frame
mydraw export net.excalidraw -o slides.pptx --slides 4:3 --dark
mydraw convert x.drawio --to excalidraw                              # best effort; skipped parts are listed
mydraw convert net.excalidraw --to drawio
mydraw help                                                          # all options
```

Formats: png, jpg, webp, svg, html, pdf, pptx, drawio, mermaid, csv, markdown, excalidraw. Options: `--scope all|frame|frames`, `--frame`, `--padding`, `--scale`, `--dark`, `--no-background`, `--background #hex`, `--quality`, `--embed-scene`, `--page fit|a4|letter`, `--actual-size`, `--slides 16:9|4:3`, `-o`. Inputs: `.excalidraw` and `.drawio`.

## Stencil library (Phase 3)

- One library for every drawing, stored in `~/Documents/mydraw/Library/` (change it from the Stencils panel ⋯ menu). Each top-level folder is a collection; sub-folders are groups.
- **Stencils panel** (tab bar button or ⇧⌘Y): search, ★ favorites, recent, collapsible collections. Click to insert (repeated clicks lay icons out in a row), or drag onto the canvas. Right-click for favorite / rename / show in Finder / move to Trash.
- **Icon packs** (⋯ → Download icon packs…): AWS, Azure, Google Cloud, Kubernetes, network devices (IBM Carbon) and 2,300 product logos, downloaded from the vendors into the library folder. Command line: `node scripts/fetch-packs.mjs [aws azure gcp k8s network logos]`.
- **Your own stencils**: select shapes → ⋯ → Save selection as stencil (or Edit → Save Selection as Stencil…). Drop SVG/PNG/.excalidrawlib files or folders onto the panel to import them.
- **Recolor icons**: select one or more SVG icons; an **Icon color** section appears at the top of the left properties panel: 11 swatches + your last custom color as the 12th, **Original**, and **Custom** (color square, hue, hex, eyedropper) that updates the icons live while you drag. A whole drag is one undo step. Colored parts take the new color, white details are kept; saved with the drawing. PNG icons can't be recolored. Icons keep their real colors in dark mode (Excalidraw normally inverts SVG images there), including dark-mode exports.
- **Eyedropper** (the dropper button in Icon color, or in the Custom picker): click any icon or shape to copy its real color (exact for recolored icons, the main color for original icons, fill/outline for shapes; correct in dark mode too) into the custom swatch. Your selection is kept, so: select the icons to change → eyedropper → click the source → click the swatch. Esc cancels.
- **Excalidraw's Library panel** is saved to `Library/Excalidraw Library/library.excalidrawlib` and shared by all tabs.
- Drawings embed the icons they use, so they still open if a stencil is later changed or deleted.

## Layout

```
app/src/      Electron main process + preload (bundled by esbuild to app/dist)
web/src/      React renderer with Excalidraw (Vite)
shared/       Types and pure helpers used by both
scripts/      dev, build and smoke-test scripts
bin/          the mydraw command (starts the headless CLI, app/src/cli.ts)
tests/        vitest unit tests
```

App data (settings, recovery) lives in `~/Library/Application Support/mydraw/`; the stencil library in `~/Documents/mydraw/Library/`.

## App name and icon

`assets/icon.svg` is the source icon; `npm run icon` regenerates `assets/icon.png` and `assets/icon.icns`.
On macOS, dev/start/smoke run a copy of Electron renamed to `mydraw.app` (built automatically in `.electron/` by `scripts/electron-app.mjs`), so the menu bar, Dock and ⌘-Tab show "mydraw" with the mydraw icon.
