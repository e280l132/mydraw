# mydraw: local Excalidraw desktop app, stencils, full Claude Code control

## Context
Brian wants a standalone draw.io-style desktop app built on the latest Excalidraw, with network/cloud stencils (AWS, GCP, Azure, network gear), full color choice, broad export formats (JPG and more), and full control by Claude Code over MCP so Claude can build diagrams on request. Plus features that make it easy to use and powerful. Stencil library must be one persistent global library that Brian builds over time and that every drawing can use. Plan lives at `~/Projects/mydraw/plan.md` (committed `a5eef1b`); this revision adds export formats and power/usability features.

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
- Stencil library is stored outside the repo in `~/Documents/mydraw/Library/` (see §3). The repo holds only the downloader and index builder.
- `tools/`: `fetch-stencil-packs`, `build-library-index`, `import-excalidrawlib`, later `import-drawio`.
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

### 3. Stencils (network / cloud) — one persistent global library
**Rule:** the stencil library belongs to the app, not to a drawing. Every new or opened drawing sees the same library. Drawings embed copies of the icons they use, so a drawing still opens correctly if a stencil is later edited or deleted, or on another machine.

- **Library folder:** `~/Documents/mydraw/Library/` (changeable in Preferences; can be iCloud/Dropbox/git so it syncs and is backed up). Not inside the `.app` or the repo, so app updates never wipe it.
  ```
  Library/
    library.json            # index: id, name, tags, collection, favorite, last used
    AWS/  GCP/  Azure/  Network/  Kubernetes/  Logos/   # vendor packs (SVG)
    My Stencils/            # Brian's own items
      core-switch.svg
      edge-firewall-pair.stencil.json   # saved shape group: elements + embedded files
  ```
- **Two kinds of item, one panel:** single icons (SVG/PNG) and saved shape groups (any selection of shapes, icons, labels, arrows, saved as `.stencil.json` — recolorable when made of native shapes).
- **Building the library:**
  - Select shapes → right-click **"Add to library…"** (name, collection, tags). Same for Excalidraw's built-in library panel: `onLibraryChange` writes to this folder, `initialData.libraryItems` loads from it, so that panel is persistent too.
  - Drag SVG/PNG files (or a folder) onto the panel → copied into the library.
  - Import `.excalidrawlib` (libraries.excalidraw.com) or, later, draw.io stencil XML → becomes a collection.
  - Rename, retag, move between collections, delete, edit a saved group (opens it on its own canvas).
- **Vendor packs:** first-run script downloads AWS, GCP, Azure, Cisco/network, Kubernetes icons and `@iconify-json/logos` into the library folder and builds `library.json` (not redistributed; licenses in `Library/LICENSES.md`).
- **Panel:** collections tree, fuzzy search over names + tags, favorites, recently used, drag-to-canvas.
- **Live:** folder watcher, so files added outside the app (by Brian or by Claude) show up without restart; changes appear in every open tab.
- **Share/backup:** export a collection as `.zip` or `.excalidrawlib`; import the same.
- **Insert:** icon → image element (fileId = content hash, `addFiles`) + bound label, grouped; shape group → its elements with fresh ids. Same path for the agent.

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
- **Library:** `search_stencils`, `list_collections`, `save_as_stencil` (selection or element ids → library item), `add_stencil_file` (SVG/PNG path → library), `delete_stencil`.
- **Colors/styles:** `list_palettes`, `list_themes`, `apply_theme`, `apply_style_preset`.
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
1. ✅ **Core app** (done 2026-11-19): scaffold, Excalidraw in Electron, file ops, autosave, crash recovery, file watcher, tabs, Clean theme default, PNG/SVG/JPG export. `npm run dev`. Smoke test: `npm run smoke`.
2. ✅ **MCP + control server** (done 2026-11-20): loopback control server (key in chmod-600 `control.json`, browser requests refused), main dispatcher + serial renderer executor (one MCP call = one undo step, merges by id with user edits), stdio MCP server that auto-launches the app. 31 tools: drawings (`list/new/open/activate_drawing`, `save`, `export` png/jpg/svg/excalidraw, `screenshot`), read (`get_scene`, `get_selection`, `get_element`), build (`add_elements` with bound `from`/`to` arrows, `connect`, `update_elements` incl. labels + custom data, `move`, `delete_elements`, `group`, `ungroup`, `select`, `zoom_to_fit`, `undo`, `redo`), stencils (`search_stencils`, `list_collections`, `place_stencil` with relative placement/color/size, `save_as_stencil`, `add_stencil_file`, `delete_stencil`), colors (`recolor`, `get_color`), escape hatches (`set_scene`, `raw_update`). Smoke test drives the app end to end over MCP. Not yet: elbow/curved connectors (Phase 5 with layout), palette color names and themes (Phase 4).
3. ✅ **Stencil library** (done 2026-11-20, before Phase 2 at Brian's request): library folder + index, pack downloader (AWS, Azure, GCP, Kubernetes, Network via IBM Carbon, Logos), Stencils panel (search, favorites, recent, drag/click insert, rename/trash), save selection as stencil, file/folder drop import, Excalidraw Library panel persisted + shared across tabs, folder watcher. Verified: images persist in saved files; library survives restart. MCP stencil tools move to Phase 2.
4. ✅ **Colors + styles** (done 2026-11-21, reworked same day): two palettes (Basic ~45 swatches, Color ramp 22 hues x 10 shades) plus an any-color HSV picker; `resolveColor` accepts hex, names (`navy`, `blue-600`) and `transparent`. 19 built-in themes and ~37 built-in style presets in categories; users can add, edit, override and delete their own presets and themes (Manage mode, editors, "from selection"/"from drawing"). They are global: stored in `<userData>/styles.json`, same in every drawing and after restart. Properties-panel section with Colors/Presets/Themes tabs and collapsible groups. MCP: `list_palettes`, `list_themes`, `apply_theme`, `apply_style_preset`, `save_style_preset`, `delete_style_preset`, `save_theme`, `delete_theme`; color names work in `recolor`, `add_elements`, `update_elements`, `place_stencil`, `build_diagram`. Earlier (2026-11-20): SVG icon recolor in the properties panel. Not done: opacity slider (Excalidraw's own panel has it), swatches saved inside the drawing file.
5. ✅ **Diagram generation** (done 2026-11-20): ELK layout (`elkjs`: layered, tree, radial, force, grid; nested zones as compound nodes), MCP `build_diagram` (nodes as shapes or library icons, edges, nested zones, title, legend; warnings for icons not found), `mermaid_to_scene` (own flowchart parser with subgraphs → zones and style/classDef colors; other Mermaid types via `@excalidraw/mermaid-to-excalidraw`), `list_templates`/`apply_template` (3-tier web, AWS VPC, GCP project, home network, k8s cluster, homelab; missing icon packs fall back to shapes), `create_zone`, `add_legend`, `auto_layout` (re-layout existing shapes/icon nodes/groups/zones). Connectors: elbow (Excalidraw elbow arrows with fixed-point bindings, so they re-route themselves when dragged), curved, straight; `routing` on `connect`, `add_elements` arrows and `update_elements`. Phase 2 example fixes: stencils are now icon nodes (caption is the bound text of a borderless container; arrows bind to the node and stop clear of the caption), and an icon placed across a zone border gets a canvas-colored backing so the border line doesn't cross it. Tests: layout/routing/Mermaid/spec/template unit tests; smoke test builds, edits, lays out and saves generated diagrams over MCP. Follow-up fixes (2026-11-21): zone contents follow a moved zone, `auto_layout` re-places an existing legend, and edges are kept out of zone title strips.
6. **Full export + CLI:** WebP, PDF, PPTX, drawio, Mermaid, CSV, HTML, clipboard, batch per frame, auto-export on save, `mydraw` CLI.
7. **Ease of use:** command palette, quick connect, find & replace, page navigator, drill-down links, lint.
8. **Data features:** properties panel, inventory table, CSV/YAML import, snapshots, presentation mode, drawio import.
9. **Package:** `electron-builder` → unsigned macOS `.app`/DMG; `mydraw` CLI symlink. Later: Ask Claude box.

Tests: vitest for catalog builder, exporters (format headers/dimensions), drawio/Mermaid writers, `build_diagram` layout, control-server auth; Playwright-Electron smoke test.

## Models per phase

### Building the app (Claude Code session model)
Switch with `/model` in Claude Code (or `claude --model <name>`). Rule of thumb: Opus 5.5 for architecture, protocols and tricky algorithms; Sonnet 5.5 for UI and straightforward features; Fable 5.2 only when Opus gets stuck on a hard problem.

| Phase | Model | Effort | Why |
|---|---|---|---|
| 1. Core app | **Opus 5.5** | high | Sets the architecture everything else builds on; Electron + Vite + Excalidraw 0.18 setup has sharp edges (ESM, CSS, assets, IPC, security). |
| 2. MCP + control server | **Opus 5.5** | xhigh | Protocol design, auth, serial command queue, undo grouping, user + agent editing at once. Mistakes here are costly later. |
| 3. Stencil library | **Opus 5.5** for library format, persistence, image-file spike; **Sonnet 5.5** for downloader + index scripts and the panel UI | high / medium | Storage format and "drawings keep their own icon copies" must be right; the rest is routine. |
| 4. Colors + styles | **Sonnet 5.5** | medium | Mostly UI components and data (palettes, presets). |
| 5. Diagram generation | **Opus 5.5**; switch to **Fable 5.2** if layout quality is poor | xhigh | Hardest part: mapping ELK layout to Excalidraw elements, bound arrows, nested zones. Quality of Claude-built diagrams depends on it. |
| 6. Full export + CLI | **Opus 5.5** for drawio writer, PDF and headless CLI; **Sonnet 5.5** for JPG/WebP/CSV/HTML/clipboard | high / medium | drawio mapping and headless rendering are fiddly; the rest is plumbing. |
| 7. Ease of use | **Sonnet 5.5**; **Opus 5.5** for quick connect and lint | medium / high | Mostly UI; quick connect hooks into Excalidraw's pointer handling. |
| 8. Data features | **Sonnet 5.5** | medium | Forms, tables, CSV/YAML parsing, snapshots. |
| 9. Package | **Sonnet 5.5** | medium | electron-builder config, CLI symlink. |
| End of every phase | **Opus 5.5** running `/code-review` | high | Catch bugs before the next phase builds on them. |

Haiku 5.5: fine for small chores (renames, README/CHANGELOG updates, commit messages), not for feature work.

### Using the finished app
- **The app itself needs no model.** It runs fully offline. AI comes only from Claude Code calling the mydraw MCP tools.
- **Everyday diagrams** ("add a NAS next to the switch", "recolor the DMZ", "export JPG"): **Sonnet 5.5**, fast and cheap.
- **Big diagrams from scratch or from real data** (Terraform, docker-compose, homelab via Proxmox/Portainer): **Opus 5.5**.
- **Diagram review** (`screenshot` + `lint_diagram`, judging layout from the image): **Opus 5.5**.
- **Ask Claude box (later):** runs `claude -p --model <model>`; default Sonnet 5.5, selectable in Preferences.

### Cost reference (API list price per 1M tokens, input / output)
Haiku 5.5 $0.10 / $0.50 · Sonnet 5.5 $2 / $10 · Opus 5.5 $4 / $20 · Fable 5.2 $8 / $40. On a Claude subscription these count against usage limits instead of dollars; Opus and Fable use those limits up faster.

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
4b. Library persistence: select a firewall + label → "Add to library"; quit; relaunch; File → New → item is in "My Stencils". Also in a second tab and after reinstalling the app. Delete the stencil → older drawings that used it still render.
5. Color panel: custom hex applied, swatch persists after restart; Clean ↔ Sketch theme switch.
6. `claude mcp list` shows `mydraw` connected.
7. Ask Claude: "Build an AWS 3-tier diagram: ALB, two EC2 in private subnets, RDS, in a VPC zone, AWS colors, add a legend, export JPG and PDF." Confirm live build, bound arrows, layout, files written.
8. Edit by hand while Claude adds shapes; no lost edits; undo removes Claude's last call as one step.
9. Import a CSV of hosts → diagram; inventory table edit updates labels.
10. Build DMG, install, launch outside dev.
