# mydraw: local Excalidraw desktop app, stencils, full Claude Code control

## Context
Brian wants a standalone draw.io-style desktop app built on the latest Excalidraw, with network/cloud stencils (AWS, GCP, Azure, network gear), full color choice, broad export formats (JPG and more), and full control by Claude Code over MCP so Claude can build diagrams on request. Plus features that make it easy to use and powerful. Plan lives at `~/Projects/mydraw/plan.md` (committed `a5eef1b`); this revision adds export formats and power/usability features.

## Decisions
- **Canvas:** `@excalidraw/excalidraw@0.18.1` (npm `latest`) + `@excalidraw/mermaid-to-excalidraw@3.6.0`. MIT package only; no ExcaliDash code (LGPL).
- **Shell:** Electron + Vite + React + TypeScript, single npm workspace. Node v26 installed.
- **Agent control:** stdio MCP server bridging to a local control server in the app (WordCraft pattern).
- **Stencils:** SVG icon packs in an app-owned catalog, inserted as image elements. draw.io stencils via later importer.
- **Colors:** custom color panel (Excalidraw's `palette` prop is internal, not public).
- **Default look:** "Clean" theme (roughness 0, sharp edges, Nunito/Helvetica-style font) for professional network diagrams; "Sketch" theme one click away.

## Architecture
```
Claude Code --MCP stdio--> mcp/ --HTTP 127.0.0.1:<port> + key--> app/ (Electron main) --IPC--> web/ (renderer, Excalidraw)
                                                        CLI (mydraw export ...) --^
```
- `web/` renderer: `<Excalidraw>`, `excalidrawAPI`, side panels (stencils, colors, properties, inventory), command palette, command executor (`updateScene` / `addFiles`). Single source of truth for the scene.
- `app/` main: window + tabs, menus, file dialogs, `.excalidraw` association, autosave, recent files, file watcher, export pipeline (offscreen window for PDF), control server. `{port, key}` in `~/Library/Application Support/mydraw/control.json` (chmod 600). Loopback only, key required, context isolation on, no remote content.
- `mcp/`: `@modelcontextprotocol/sdk` stdio server; reads `control.json`; launches app if not running.
- `cli/`: `mydraw` command (export/convert/open), reuses the app's export pipeline headless.
- `stencils/<set>/icons/*.svg` + `catalog.json` (id, name, tags, category, size, license); `stencils/LICENSES.md`.
- `tools/`: `build-catalog`, `import-excalidrawlib`, later `import-drawio`.
- `templates/`: 3-tier web app, AWS VPC, GCP project, home network, k8s cluster, homelab rack.
- `CLAUDE.md`: project notes + "how to drive mydraw" + diagram workflows (below).

## Features

### 1. Core editor
New/Open/Save/Save As, autosave + crash recovery, recent files, multiple open files as tabs, dark/light, file watcher (reload if the `.excalidraw` changes on disk).

### 2. Export (File → Export, Cmd+Shift+E)
| Format | How | Options |
|---|---|---|
| PNG | `exportToBlob` | scale 1–4x, transparent bg, embed scene (re-openable PNG) |
| JPG | `exportToCanvas` → `toBlob('image/jpeg')` | quality, background color (no transparency) |
| WebP | canvas `toBlob('image/webp')` | quality, transparent |
| SVG | `exportToSvg` | embed scene, embed fonts, dark mode |
| PDF | SVG → offscreen BrowserWindow `printToPDF` | vector; fit to page / A4 / Letter / actual size; one page per frame |
| PPTX | `pptxgenjs`, one slide per frame (image) | 16:9 / 4:3 |
| draw.io `.drawio` | own mxGraph XML writer (shapes, text, edges, embedded icons) | for draw.io / Confluence users |
| Mermaid | graph → `flowchart` text (nodes + edges) | for Markdown docs |
| CSV / Markdown table | inventory of nodes with properties (name, type, IP, hostname, notes) | |
| HTML | single file viewer (embedded SVG, pan/zoom, clickable links) | |
| `.excalidraw` / `.excalidrawlib` | native | |
| Clipboard | copy as PNG / SVG / Mermaid | |

Common options: whole canvas / selection / single frame / every frame (batch), padding, scale, dark mode, include background.
**Auto-export on save** (per file setting): also write `diagram.png`/`.svg` next to the file, handy for git repos and docs.
**CLI:** `mydraw export net.excalidraw --format jpg --scale 2 --frame "Prod"`, `mydraw convert x.drawio --to excalidraw`.

### 3. Stencils (network / cloud)
- Sources (downloaded by script; not redistributed): AWS Architecture Icons, Google Cloud icons, Azure Architecture Icons, Cisco/network icons, Kubernetes icons, `@iconify-json/logos` (vendor/product logos, e.g. Proxmox, Docker, Ubiquiti where available).
- Stencil panel: set filter, category tree, fuzzy search, drag-to-canvas, favorites, recently used.
- Insert: image element (fileId = SVG hash) + bound label, grouped. Same path for the agent.
- Community `.excalidrawlib` libraries (native shapes, recolorable) in Excalidraw's library panel.
- Custom stencils: drop any SVG/PNG into the panel → added to a "My stencils" set.

### 4. Colors
- Color panel: HSV/hex/RGB picker (`react-colorful`), eyedropper (`EyeDropper` API), opacity.
- Palettes: full ramp (~22 hues × 10 shades), AWS/GCP/Azure brand palettes, document palette, saved swatches.
- Applies to stroke/background/text of selection; sets `currentItem*Color`. Agent uses names (`aws.orange`, `blue-600`) or hex.

### 5. Ease of use
- **Command palette (Cmd+K):** fuzzy search every action, stencil, color, template, export.
- **Quick connect:** hover a shape → 4 "+" handles; click adds a connected copy or opens stencil search to pick the next node (draw.io style).
- **Themes:** Clean / Sketch / Blueprint / Dark; apply to whole diagram in one click (fonts, roughness, stroke widths, colors).
- **Style presets:** saved styles ("Prod zone", "DMZ", "Critical link"); format painter (Excalidraw copy/paste styles).
- **Snap, grid, alignment guides:** toggles in toolbar (Excalidraw built-ins); align/distribute buttons.
- **Zones:** draw a VPC/subnet/VLAN as a frame with title and tint; contents move with it; lock zones so they're not dragged by accident.
- **Find & replace** text; jump to element by name.
- **Pages:** frames act as pages, with a page navigator sidebar.
- **Drill-down links:** link a shape to another drawing or URL (e.g. click "Core switch" → opens rack diagram).
- **Keyboard shortcuts cheat sheet** (?).

### 6. Power features
- **Properties panel:** per-shape fields (hostname, IP, VLAN, role, owner, notes, URL) stored in `customData`; shown on hover.
- **Inventory table:** all nodes in an editable grid; sort/filter; edits update the diagram; export CSV.
- **CSV / YAML import → diagram:** list of hosts/links (or the YAML DSL) → laid-out diagram via `build_diagram`.
- **Diagram-as-code:** Mermaid or YAML paste box; round-trip to Mermaid export.
- **Auto layout:** ELK (layered, tree, radial, grid), respects zones; "tidy selection".
- **Diagram lint:** flags overlaps, unconnected arrows, unlabeled nodes, missing IPs, off-palette colors; one-click fix where possible.
- **Auto legend:** legend of stencils/line styles used.
- **Version snapshots:** timestamped on save; preview + restore.
- **Presentation mode:** frames as slides, full screen.
- **Import:** `.drawio` diagrams, Mermaid, CSV, images (paste/drop).
- **Ask Claude box (optional, later):** prompt field in app that runs `claude -p` with the mydraw MCP, so Brian can ask for edits without switching to the terminal.

### 7. MCP tools (full control)
- **App/files:** `list_drawings`, `new_drawing`, `open_drawing`, `save`, `export` (any format above + options), `screenshot` (PNG back to Claude), `import` (drawio/mermaid/csv/yaml).
- **Read:** `get_scene` (compact: id, type, label, geometry, colors, zone, bindings, properties), `get_selection`, `get_element`, `get_inventory`.
- **Stencils/colors/styles:** `search_stencils`, `list_palettes`, `list_themes`, `apply_theme`, `apply_style_preset`.
- **Build:** `place_stencil` (absolute or `right_of`/`below`/inside zone), `add_elements` (skeletons via `convertToExcalidrawElements`), `connect` (bound arrow, label, style, elbow/curved), `update_elements`, `set_properties`, `delete_elements`, `group`/`ungroup`, `create_zone`, `add_link`.
- **Generate:** `build_diagram` (nodes, edges, zones, direction → laid-out diagram; the main "draw me X" tool), `mermaid_to_scene`, `apply_template`, `add_legend`.
- **Layout/quality:** `auto_layout`, `align`, `distribute`, `lint_diagram`.
- **View/history:** `zoom_to_fit`, `select`, `undo`, `redo` (each agent call = one undo step).
- **Escape hatch:** `set_scene` / `raw_update` with full element JSON.
- Register: `claude mcp add mydraw -- node ~/Projects/mydraw/mcp/dist/index.js`; allow `mcp__mydraw__*`.

### 8. Claude workflows (documented in `CLAUDE.md`, no extra code)
- Diagram from a Terraform dir / `docker-compose.yml` / k8s manifests.
- Diagram of the homelab from live data (Proxmox, Portainer API) — read-only queries, no secrets written into the diagram.
- "Review my diagram": `screenshot` + `lint_diagram` → suggestions/fixes.
- Generate docs: `get_inventory` → Markdown table + exported PNG.

## Phases
1. **Core app:** scaffold, Excalidraw in Electron, file ops, autosave, tabs, Clean theme default, PNG/SVG/JPG export. `npm run dev`.
2. **MCP + control server:** read/build/connect/delete/screenshot/export. Claude can draw end to end early.
3. **Stencils:** download script, `build-catalog`, panel, `place_stencil`/`search_stencils`, `.excalidrawlib` loading, custom stencils. First verify image elements survive save/reopen/export.
4. **Colors + styles:** color panel, palettes, swatches, themes, style presets.
5. **Diagram generation:** `build_diagram`, ELK layout, zones, Mermaid, templates, legend.
6. **Full export + CLI:** WebP, PDF, PPTX, drawio, Mermaid, CSV, HTML, clipboard, batch per frame, auto-export on save, `mydraw` CLI.
7. **Ease of use:** command palette, quick connect, find & replace, page navigator, drill-down links, lint.
8. **Data features:** properties panel, inventory table, CSV/YAML import, snapshots, presentation mode, drawio import.
9. **Package:** `electron-builder` → unsigned macOS `.app`/DMG; `mydraw` CLI symlink. Later: Ask Claude box.

Tests: vitest for catalog builder, exporters (format headers/dimensions), drawio/Mermaid writers, `build_diagram` layout, control-server auth; Playwright-Electron smoke test.

## Risks
- Image elements + `files` must persist in saves and every export format (verify phase 3).
- PDF/PPTX fidelity of hand-drawn fonts; embed fonts in SVG before printing.
- drawio export is approximate (Excalidraw styles don't map 1:1); keep icons as embedded images.
- Vendor icon licenses; record in `stencils/LICENSES.md`, don't redistribute packs publicly.
- User + agent editing at once: agent commands applied serially by element id against the latest scene.
- Check Excalidraw 0.18 setup (CSS import, asset path, ESM) against its docs.

## Verification
1. `npm run dev`: draw, save, quit, reopen; file persists; two tabs open.
2. Export one diagram to every format; open each in its native viewer (Preview, browser, Keynote/PowerPoint, draw.io); JPG has solid bg; PNG with embedded scene re-opens editable.
3. `mydraw export test.excalidraw --format jpg` works with the app closed.
4. Stencil search "ec2", "cloud run", "router"; drag; save/reopen keeps icons.
5. Color panel: custom hex applied, swatch persists after restart; Clean ↔ Sketch theme switch.
6. `claude mcp list` shows `mydraw` connected.
7. Ask Claude: "Build an AWS 3-tier diagram: ALB, two EC2 in private subnets, RDS, in a VPC zone, AWS colors, add a legend, export JPG and PDF." Confirm live build, bound arrows, layout, files written.
8. Edit by hand while Claude adds shapes; no lost edits; undo removes Claude's last call as one step.
9. Import a CSV of hosts → diagram; inventory table edit updates labels.
10. Build DMG, install, launch outside dev.
