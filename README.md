# mydraw

A local desktop diagramming app built on [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT). Adds network and cloud stencils, diagram generation from text, a data layer (properties, inventory, import), orthogonal arrows that route around shapes, and full control from Claude Code over MCP. Runs offline. The roadmap and phase status are in `plan.md`; agent notes are in `CLAUDE.md`.

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
npm run smoke      # builds, then drives the real app with Playwright and the MCP server
```

## What it does

**Files and tabs**
- Several drawings open at once (⌘1–9, Ctrl+Tab), a dot on unsaved tabs, middle-click to close.
- New / Open / Save / Save As (`.excalidraw`), Open Recent, opening from Finder or the command line. Opening a `.drawio` file makes a new unsaved drawing (never saved back into the `.drawio`).
- Autosave for saved files, crash recovery for unsaved drawings, reload when a file changes on disk.
- **Version history** (⌥⌘V): a snapshot is kept on each save (autosaves at most every 2 minutes, 60 kept). Preview a version and restore it as one undo step.

**Export** (⇧⌘E, and File → Copy As)
- PNG, JPG, WebP, SVG, HTML viewer, PDF (vector; fit, A4/Letter, or actual size over sheets), PowerPoint (one picture per slide), draw.io, Mermaid flowchart, CSV and Markdown inventory.
- Scope: whole drawing, selection, one frame, or every frame (one file each, or one page or slide per frame in PDF, PowerPoint and draw.io). Scale, padding, background, dark mode, quality, embedded editable scene.
- **Keep an image up to date**: per drawing, every save also rewrites e.g. `network.png` next to `network.excalidraw`.

**Stencils** (⇧⌘Y)
- One library in `~/Documents/mydraw/Library/`. Search, favorites, recent, collections and groups. Click to insert, or drag onto the canvas.
- Icon packs download from the Stencils panel menu: AWS, Azure, Google Cloud, Kubernetes, network devices (Carbon), 2,300 product logos, ~2,700 self-hosted app icons (Dashboard Icons: Proxmox, Portainer, Pi-hole…), and infrastructure picks from Material Design Icons, Tabler and Lucide, Devicon dev logos and Simple Icons brand marks. Use the **Icon packs…** button next to the panel title to search and sort packs, download the ones you tick (none are ticked by default) and remove installed ones.
- Save a selection as a stencil (⌥⌘S saves it to My Stencils without asking for a name); import SVG, PNG and `.excalidrawlib` files.
- Stencils is the only library: Excalidraw's own Library button is hidden.
- Recolor icons (with undo), an eyedropper that copies the real color of any shape or icon, and icons that keep their real colors in dark mode.

**Colors and styles**
- Colors tab with two palettes and an any-color picker. Theme and style presets (built in, and yours, saved globally) apply to the selection or the whole drawing.

**Diagrams from text** (MCP, and ⌥⌘U)
- `build_diagram`: nodes, edges and nested zones, laid out automatically (ELK), with icons from the library.
- Mermaid (flowcharts become zones; other Mermaid diagram types go through Mermaid), starter templates (3-tier web, AWS VPC, GCP project, home network, Kubernetes, homelab), legends, `auto_layout`.
- **Import from text** (⌥⌘U): paste or open CSV (a host list with zones, connections and properties, or a from/to list), YAML (the diagram spec with `a -> b: label` edges), or Mermaid.

**Properties and inventory**
- Hostname, IP, VLAN, role, owner, URL and notes on any shape or icon (the properties section in the right panel). Property edits are not in the undo history.
- **Inventory table** (⌥⌘T): every node in one grid. Sort, filter, edit names and properties in place, select a node in the drawing, export CSV.

**Links, pages and presentation**
- **Drill-down links**: a shape can link to a web address (opens in the browser) or a `.excalidraw` drawing (opens in a tab). Relative paths resolve from the saved drawing.
- **Pages** (⌥⌘P): frames are pages. Click to zoom, double-click to rename, arrows to reorder. Exports follow the order.
- **Presentation** (⌥⌘↵): frames as full-screen slides. Arrows, space or click to move, Esc to leave.

**Quick connect** (hover or select a shape, icon or group; four "+" handles appear)
- **Click**: add a copy beside it (no arrow).
- **Option-click**: add a connected copy, joined by an arrow.
- **⌘-click or ⌘-drag**: draw an arrow to another shape. The arrow routes around shapes in between, keeps a clear distance from them, and previews live as you move. Point at a side of the target to choose it. Click empty canvas to add a bend point (Backspace removes it). Double-click or Enter ends the arrow on empty canvas. Shift-click keeps linking from the same shape. While linking: R cycles the style (around shapes, elbow, straight, curved), A cycles arrowheads, D toggles dashed. Esc or right-click cancels.
- **Shift-click or right-click**: pick a stencil for a new connected node.

**Checks and layout**
- **Diagram lint** (⌥⌘L): overlaps, unconnected arrows, unlabeled nodes, missing IPs, off-palette colors. Safe one-click fixes; "Fix all" is one undo step.
- **Layout grid** (⌘', or Grid settings… in the menu): lines or dots, spacing 4–100 px, a stronger line every N cells, any color, adjustable strength. Drawn behind the shapes. **Snap to grid** while moving, drawing and resizing (hold ⌘ to move freely); "Snap selection to grid" lines up existing shapes in one undo step. The grid is an app preference: it is never saved into drawings or exports.
- **Align and distribute**: select 2+ shapes or icons and the Align section is in the left panel just above Edges (distribute needs 3+). Also in the command palette ("Arrange") and on Excalidraw's keys: ⇧⌘←/→/↑/↓ align, ⌥H / ⌥V distribute.
- **Route arrows around shapes** (command palette): re-routes the selected arrows (or all of them) around shapes.
- **Find and replace** (⌥⌘F): match case, whole word, selection or whole drawing, one undo step.
- **Command palette** (⇧⌘P; ⌘K when nothing is selected): fuzzy search over every command, stencil, theme, preset, template, frame, element and file action.

**Appearance**
- App theme (System, Light, Dark), drawing style (Clean or Sketch).

## Keyboard shortcuts

| Keys | Action |
|---|---|
| ⇧⌘P, or ⌘K with nothing selected | Command palette |
| ⌘' | Show / hide the layout grid |
| ⌥⌘F | Find and replace |
| ⌥⌘T | Inventory table |
| ⌥⌘L | Diagram lint |
| ⌥⌘P | Pages panel |
| ⌥⌘U | Import diagram from text |
| ⌥⌘V | Version history |
| ⌥⌘↵ | Presentation |
| ⇧⌘E | Export |
| ⇧⌘Y | Stencils panel |
| ⌘F, Alt+S, ? | Excalidraw's own find, object snapping, help |

On a quick-connect handle: click, Option-click, ⌘-click, Shift-click (see above). On Windows and Linux, Ctrl replaces ⌘.

## Command line

`mydraw` exports and converts drawings without opening the app (it renders in a hidden window). Set it up once with `npm run build && npm link` (or `ln -s ~/Projects/mydraw/bin/mydraw.mjs /usr/local/bin/mydraw`).

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

## Claude Code (MCP)

The `mcp/` server talks to the running app (it starts the app if needed). Register it once:

```bash
claude mcp add --scope user mydraw -- node ~/Projects/mydraw/mcp/dist/index.js
```

Tools cover: drawings (`list_drawings`, `new_drawing`, `open_drawing`, `save`, `export`, `screenshot`), reading (`get_scene`, `get_element`, `get_selection`, `get_inventory`), building (`build_diagram`, `import_diagram`, `mermaid_to_scene`, `apply_template`, `add_elements`, `connect` with `avoid: true` for arrows around shapes, `place_stencil`, `create_zone`, `add_legend`), editing (`update_elements`, `move`, `set_properties`, `route_around`, `auto_layout`, `delete_elements`, `group`), stencils, palettes and themes, checks (`lint_diagram`), and `undo`/`redo`. Each tool call is one undo step.

## Layout

```
app/src/      Electron main process + preload (bundled by esbuild to app/dist)
web/src/      React renderer with Excalidraw (Vite)
shared/       Types and pure helpers used by both (routing, lint, import, export formats)
mcp/          the MCP server for Claude Code
scripts/      dev, build and smoke-test scripts
bin/          the mydraw command (headless CLI, app/src/cli.ts)
tests/        vitest unit tests
```

Excalidraw is pinned to an exact version and some features rely on its internals: read [EXCALIDRAW-UPGRADE.md](EXCALIDRAW-UPGRADE.md) before upgrading it.

App data (settings, recovery, version history) lives in `~/Library/Application Support/mydraw/`; the stencil library in `~/Documents/mydraw/Library/`.

## App name and icon

`assets/icon.svg` is the source icon; `npm run icon` regenerates `assets/icon.png` and `assets/icon.icns`. On macOS, dev, start and smoke run a copy of Electron renamed to `mydraw.app` (built in `.electron/` by `scripts/electron-app.mjs`), so the menu bar, Dock and ⌘-Tab show "mydraw".
