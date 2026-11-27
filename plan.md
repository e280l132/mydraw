# mydraw: local Excalidraw desktop app, stencils, full Claude Code control

## Context
Brian wants a standalone draw.io-style desktop app built on the latest Excalidraw, with network/cloud stencils (AWS, GCP, Azure, network gear), full color choice, broad export formats (JPG and more), and full control by Claude Code over MCP so Claude can build diagrams on request. Plus features that make it easy to use and powerful. Stencil library must be one persistent global library that Brian builds over time and that every drawing can use. Phases 1–10 are done (see Phases); next is the first published release. Feature details live in `CLAUDE.md`, user docs in `README.md`.

## Decisions
- **Canvas:** `@excalidraw/excalidraw@0.18.1` (npm `latest`) + `@excalidraw/mermaid-to-excalidraw@3.6.0`. MIT package only; no ExcaliDash code (LGPL).
- **Shell:** Electron + Vite + React + TypeScript, single npm workspace. Node v26 installed.
- **Agent control:** stdio MCP server bridging to a local control server in the app (WordCraft pattern).
- **Stencils:** SVG icon packs in an app-owned catalog, inserted as image elements. draw.io drawings import (Phase 8).
- **Colors:** custom color panel (Excalidraw's `palette` prop is internal, not public).
- **Default look:** "Clean" drawing style (roughness 0, sharp edges, new text in Inter) for professional network diagrams; "Sketch" one click away (tab-bar switch). Generated diagrams have their own `look` (professional / sketch).

## Architecture
```
Claude Code --MCP stdio--> mcp/ --HTTP 127.0.0.1:<port> + key--> app/ (Electron main) --IPC--> web/ (renderer, Excalidraw)
                                                        CLI (mydraw export ...) --^
```
- `web/` renderer: `<Excalidraw>`, `excalidrawAPI`, side panels (stencils, colors, properties, inventory), command palette, command executor (`updateScene` / `addFiles`). Single source of truth for the scene.
- `app/` main: window, menus, file dialogs, `.excalidraw` association, autosave, recent files, file watcher, PDF printing (hidden window), version snapshots, fonts store, control server. Tabs live in the renderer. `{port, key}` in `~/Library/Application Support/mydraw/control.json` (chmod 600). Loopback only, key required, context isolation on, no remote content.
- `mcp/`: `@modelcontextprotocol/sdk` stdio server; reads `control.json`; launches app if not running. Shipped inside the app (`mydraw mcp`).
- Packaging: one `mydraw.app` holds the editor, the `mydraw` command and the MCP server; `electron-builder.yml`, GitHub Releases + in-app updates (Phase 9).
- `bin/mydraw.mjs` + `app/src/cli.ts`: `mydraw` command (export/convert), reuses the app's export pipeline headless. No `open` subcommand.
- Stencil library is stored outside the repo in `~/Documents/mydraw/Library/` (see §3). The repo holds only the downloader and index builder.
- `scripts/`: `fetch-packs.mjs` (icon pack downloader), `build-app.mjs`, `build-mcp.mjs`, `dev.mjs`, `smoke.mjs`. The library index, `.excalidrawlib` import and draw.io import live in the app (`app/src/library.ts`, `web/src/drawioImport.ts`), not in a tools folder.
- Templates are code, not files: `shared/templates.ts` (3-tier web app, AWS VPC, GCP project, home network, k8s cluster, homelab rack).
- Excalidraw internals mydraw depends on (renderer patches in `scripts/excalidrawPatch.mjs`, font registry, canvas hook): `EXCALIDRAW-UPGRADE.md`.
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
| SVG | `exportToSvg` | embed scene, dark mode (fonts always inlined) |
| PDF | SVG → offscreen BrowserWindow `printToPDF` | vector; fit to page / A4 / Letter / actual size; one page per frame |
| PPTX | `pptxgenjs`, one slide per frame (image) | 16:9 / 4:3 |
| draw.io `.drawio` | own mxGraph XML writer (shapes, text, edges, embedded icons) | for draw.io / Confluence users |
| Mermaid | graph → `flowchart` text (nodes + edges) | for Markdown docs |
| CSV / Markdown table | inventory of nodes with properties (name, type, IP, hostname, notes) | |
| HTML | single file viewer (embedded SVG, pan/zoom, clickable links) | |
| `.excalidraw` / `.excalidrawlib` | native (`.excalidrawlib` = one library item, images dropped) | |
| Clipboard | copy as PNG / SVG / Mermaid | |

Common options: whole canvas / selection / single frame / every frame (batch), padding, scale, dark mode, include background.
**Auto-export on save** (shown in the dialog as "Keep an image up to date", per file, default Off): also write `diagram.png`/`.svg` next to the file, handy for git repos and docs.
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
  - Select shapes → **Save selection as stencil…** (name, collection, tags) or ⌥⌘S for a quick save to My Stencils. (Excalidraw's built-in Library panel was hidden on 2026-11-22; Stencils is the only library. `.excalidrawlib` files import as collections; the Export dialog can also write one.)
  - Drag SVG/PNG files (or a folder) onto the panel → copied into the library.
  - Import `.excalidrawlib` (libraries.excalidraw.com) → becomes a collection.
  - Rename, delete, favorite.
- **Vendor packs:** the **Icon packs…** dialog (or `scripts/fetch-packs.mjs`) downloads AWS, GCP, Azure, Kubernetes, network (Carbon), logos, Dashboard Icons, MDI/Tabler/Lucide picks, Devicon and Simple Icons into the library folder (not redistributed; the downloader writes `Library/LICENSES.md`). Installed packs can be removed.
- **Panel:** collections tree, fuzzy search over names + tags, favorites, recently used, drag-to-canvas.
- **Live:** folder watcher, so files added outside the app (by Brian or by Claude) show up without restart; changes appear in every open tab.
- **Share/backup:** the library is a plain folder (sync or back it up as is).
- **Insert:** icon → image element (fileId = content hash, `addFiles`) + caption, grouped (the agent makes an icon node: container + image); shape group → its elements with fresh ids. Optional hand-drawn look and caption font.

### 4. Colors
- Colors tab in the style panel: own HSV/hex picker (`ColorPicker`, no library), canvas eyedropper (`web/src/library/pickColor.ts`, reads real icon colors), Excalidraw's own Opacity row.
- Palettes: Basic (~45 named) and ramp (22 hues × 10 shades); custom colors picked in a drawing are saved in that drawing (up to 12).
- Targets Stroke / Fill / Icon / Outline of the selection; also sets `currentItem*Color` for new shapes. Agent uses names (`navy`, `blue-600`) or hex.

### 5. Ease of use
- **Command palette (⇧⌘P, or ⌘K with nothing selected):** fuzzy search every action, stencil, theme, preset, template, frame, element, export.
- **Quick connect:** hover or select a shape → 4 "+" handles; click adds a copy (no arrow), Option-click a connected copy, Shift-click stencil search, ⌘-click draws an arrow routed around shapes. Done in Phase 7.
- **Themes:** 19 built-in (incl. Blueprint, dark ones) + user themes; apply to the whole diagram in one click (fonts, roughness, stroke widths, colors).
- **Style presets:** ~40 built-in ("Prod zone", "DMZ", "Critical link", shadows, gradients) + user presets; format painter = Excalidraw's copy/paste styles.
- **Grid and snapping:** mydraw layout grid (⌘', lines/dots, snap) drawn behind shapes; Excalidraw object snapping; align/distribute in the panel.
- **Zones:** a VPC/subnet/VLAN is a locked tinted rectangle with a title (not a frame); contents move with it.
- **Find & replace** text (step through, replace one/all); jump to element by text from the palette.
- **Pages:** frames act as pages, with a page navigator sidebar and previews.
- **Drill-down links:** link a shape to another drawing or URL (e.g. click "Core switch" → opens rack diagram).
- **Help:** "mydraw features and shortcuts" dialog, linked with Excalidraw's own help (?).

### 6. Power features
- **Properties panel:** per-shape fields (hostname, IP, VLAN, role, owner, notes, URL) stored in `customData`; shown on hover.
- **Inventory table:** all nodes in an editable grid; sort/filter; edits update the diagram; export CSV.
- **CSV / YAML import → diagram:** list of hosts/links (or the YAML DSL) → laid-out diagram via `build_diagram`.
- **Diagram-as-code:** Mermaid or YAML paste box; round-trip to Mermaid export.
- **Auto layout:** ELK (layered, tree, radial, force, grid), respects zones, picks the cleanest of several variants; **Tidy** keeps the arrangement (line up, even gaps, fix overlaps); **Re-layout** = fresh layout that follows the drawing, applied only if cleaner (Diagram menu, palette; agent `tidy`, `auto_layout {onlyIfBetter}`); judgment via the MCP prompt `tidy_diagram`.
- **Diagram lint:** flags overlaps, unconnected arrows, unlabeled nodes, missing IPs, off-palette colors; one-click fix where possible.
- **Auto legend:** legend of stencils/line styles used.
- **Version snapshots:** timestamped on save; preview + restore.
- **Presentation mode:** frames as slides, full screen.
- **Import:** `.drawio` diagrams, Mermaid, CSV, YAML, images (paste/drop, Excalidraw built-in).
- **Ask Claude box (Phase 10):** prompt field in app that runs `claude -p` with the mydraw MCP, so Brian can ask for edits without switching to the terminal.

### 7. MCP tools (full control)
56 tools and 1 prompt (all built; source of truth `mcp/src/index.ts`):
- **App/files:** `list_drawings`, `new_drawing`, `open_drawing` (also `.drawio`, imported as a new unsaved drawing), `activate_drawing`, `save`, `export` (any format above + options), `screenshot` (PNG back to Claude), `copy_to_clipboard` (PNG/SVG/Mermaid), `import_diagram` (csv/yaml/mermaid text or file).
- **Read:** `get_scene`, `get_selection`, `get_element`, `get_inventory`, `get_color`.
- **Library:** `search_stencils`, `list_collections`, `place_stencil` (absolute or relative, color, size, `iconStyle`), `save_as_stencil`, `add_stencil_file`, `delete_stencil`.
- **Colors/styles/fonts:** `recolor`, `list_palettes`, `list_themes`, `apply_theme`, `apply_style_preset`, `save_style_preset`, `delete_style_preset`, `save_theme`, `delete_theme`, `list_fonts`.
- **Build/edit:** `add_elements`, `connect` (bound arrow, label, elbow/curved, `avoid`), `update_elements` (incl. `link`, effects, `iconStyle`), `move`, `set_properties` (not undoable), `delete_elements`, `group`/`ungroup`, `create_zone`.
- **Generate:** `build_diagram`, `mermaid_to_scene`, `list_templates`, `apply_template`, `add_legend`.
- **Layout/quality:** `tidy` (keep arrangement), `auto_layout` (`onlyIfBetter`), `align` (left/center/right/top/middle/bottom, optional `to` reference), `distribute` (equal gaps or fixed `gap`), `route_around`, `lint_diagram` (`fix: true` = safe fixes in one undo step).
- **View/history:** `zoom_to_fit`, `select`, `undo`, `redo` (each agent call = one undo step).
- **Escape hatch:** `set_scene` / `raw_update` with full element JSON.
- Register: installed app = Set up window → Connect Claude Code (`claude mcp add --scope user mydraw -- /Applications/mydraw.app/Contents/Resources/bin/mydraw mcp`; checkout: `node ~/Projects/mydraw/mcp/dist/index.js`); allow `mcp__mydraw__*`.

### 8. Claude workflows (documented in `CLAUDE.md`, no extra code)
- Diagram from a Terraform dir / `docker-compose.yml` / k8s manifests.
- Diagram of the homelab from live data (Proxmox, Portainer API) — read-only queries, no secrets written into the diagram.
- "Review my diagram": `screenshot` + `lint_diagram` → suggestions/fixes.
- Generate docs: `get_inventory` → Markdown table + exported PNG.

## Phases
1. ✅ **Core app** (done 2026-11-19): scaffold, Excalidraw in Electron, file ops, autosave, crash recovery, file watcher, tabs, Clean theme default, PNG/SVG/JPG export. `npm run dev`. Smoke test: `npm run smoke`.
2. ✅ **MCP + control server** (done 2026-11-20): loopback control server (key in chmod-600 `control.json`, browser requests refused), main dispatcher + serial renderer executor (one MCP call = one undo step, merges by id with user edits), stdio MCP server that auto-launches the app. 31 tools: drawings (`list/new/open/activate_drawing`, `save`, `export` png/jpg/svg/excalidraw, `screenshot`), read (`get_scene`, `get_selection`, `get_element`), build (`add_elements` with bound `from`/`to` arrows, `connect`, `update_elements` incl. labels + custom data, `move`, `delete_elements`, `group`, `ungroup`, `select`, `zoom_to_fit`, `undo`, `redo`), stencils (`search_stencils`, `list_collections`, `place_stencil` with relative placement/color/size, `save_as_stencil`, `add_stencil_file`, `delete_stencil`), colors (`recolor`, `get_color`), escape hatches (`set_scene`, `raw_update`). Smoke test drives the app end to end over MCP. Not yet: elbow/curved connectors (Phase 5 with layout), palette color names and themes (Phase 4).
3. ✅ **Stencil library** (done 2026-11-20, before Phase 2 at Brian's request): library folder + index, pack downloader (AWS, Azure, GCP, Kubernetes, Network via IBM Carbon, Logos; more packs and the Icon packs dialog later), Stencils panel (search, favorites, recent, drag/click insert, rename/trash), save selection as stencil, file/folder drop import, folder watcher. (Excalidraw's own Library panel was later hidden: Stencils is the only library.) Verified: images persist in saved files; library survives restart. MCP stencil tools move to Phase 2.
4. ✅ **Colors + styles** (done 2026-11-21, reworked same day): two palettes (Basic ~45 swatches, Color ramp 22 hues x 10 shades) plus an any-color HSV picker; `resolveColor` accepts hex, names (`navy`, `blue-600`) and `transparent`. 19 built-in themes and ~37 built-in style presets (~40 after the effects round) in categories; users can add, edit, override and delete their own presets and themes (Manage mode, editors, "from selection"/"from drawing"). They are global: stored in `<userData>/styles.json`, same in every drawing and after restart. Properties-panel section with Colors/Presets/Themes tabs and collapsible groups. MCP: `list_palettes`, `list_themes`, `apply_theme`, `apply_style_preset`, `save_style_preset`, `delete_style_preset`, `save_theme`, `delete_theme`; color names work in `recolor`, `add_elements`, `update_elements`, `place_stencil`, `build_diagram`. Earlier (2026-11-20): SVG icon recolor in the properties panel. Not done at the time: opacity slider (Excalidraw's own panel has it) and swatches saved inside the drawing file (both resolved in the gap round below).
5. ✅ **Diagram generation** (done 2026-11-20): ELK layout (`elkjs`: layered, tree, radial, force, grid; nested zones as compound nodes), MCP `build_diagram` (nodes as shapes or library icons, edges, nested zones, title, legend; warnings for icons not found), `mermaid_to_scene` (own flowchart parser with subgraphs → zones and style/classDef colors; other Mermaid types via `@excalidraw/mermaid-to-excalidraw`), `list_templates`/`apply_template` (3-tier web, AWS VPC, GCP project, home network, k8s cluster, homelab; missing icon packs fall back to shapes), `create_zone`, `add_legend`, `auto_layout` (re-layout existing shapes/icon nodes/groups/zones). Connectors: elbow (Excalidraw elbow arrows with fixed-point bindings, so they re-route themselves when dragged), curved, straight; `routing` on `connect`, `add_elements` arrows and `update_elements`. Phase 2 example fixes: stencils are now icon nodes (caption is the bound text of a borderless container; arrows bind to the node and stop clear of the caption), and an icon placed across a zone border gets a canvas-colored backing so the border line doesn't cross it. Tests: layout/routing/Mermaid/spec/template unit tests; smoke test builds, edits, lays out and saves generated diagrams over MCP. Follow-up fixes (2026-11-21): zone contents follow a moved zone, `auto_layout` re-places an existing legend, and edges are kept out of zone title strips.
   - **Diagram quality** (done 2026-11-24): `layoutBest` runs up to 6 ELK option sets and keeps the layout with the fewest overlaps, crossings, label collisions and through-node arrows (`shared/diagramQuality.ts`, `shared/layoutBest.ts`); `tidyRoutes` separates parallel arrows and places labels on free stretches (`shared/edgeTidy.ts`); lint rules `edge-overlap`, `label-collision`, `edge-through-node` with safe fixes; `quality` summary returned by `build_diagram`/`auto_layout`. Fixtures pin the result (homelab 1257 → 447, aws 3286 → 958).
   - **Generated diagram looks** (done 2026-11-24): `look: "professional"` (default) or `"sketch"`; arrow weights, heads and kinds; drawn shapes (cylinder, cloud, document, queue, actor, server, hexagon, folder); node emphasis and subtitles; equal node widths per zone and type.
6. ✅ **Full export + CLI** (done 2026-11-21, in two parts):
   - **Part 1 (plumbing exports):** WebP (quality, transparent bg); scopes whole drawing / selection / one frame / every frame (batch, one file per frame into a chosen folder) with padding, scale, dark mode, background; Mermaid flowchart writer (zones → subgraphs, escaped labels, round-trips through `parseMermaidFlowchart`); CSV + Markdown inventory (name, kind, type, zone, ip, hostname, notes from customData); single-file HTML viewer (inline SVG, pan/zoom, links, strict CSP); clipboard copy as PNG/SVG/Mermaid (File → Copy As, in-app menu, `MenuCommand copyAs`); auto-export on save (dialog section "Keep an image up to date": per file, Off/PNG/SVG, stored in `settings.autoExport`); MCP `export` + `shared/agent.ts` cover all new formats and `scope`/`frame`/`padding`/`scale`/`darkMode`/`background`/`quality`. Pure logic in `shared/` (`sceneGraph`, `mermaidWriter`, `inventory`, `htmlExport`) with `tests/export.test.ts`; smoke test exports each format over MCP and checks the files.
   - **Part 2 (documents + CLI):** PDF (vector: SVG pages → hidden JS-off, network-blocked window → `printToPDF`; page size fit to content / A4 / Letter, plus actual size (100%, tiled over sheets); one page per frame for "every frame"); PPTX (`pptxgenjs`, one picture slide per frame, 16:9 or 4:3); draw.io `.drawio` writer (shapes, text, edges with waypoints/arrowheads, zones and frames as containers, icon nodes as embedded images, properties as `<object>` attributes) and reader (plain/compressed pages, containers → zones, groups, edge labels, placeholders; unknown stencils and URL images reported); `mydraw` CLI (`export`, `convert`; headless hidden Electron window reusing the renderer export code; temp userData, works with the app closed; `bin/mydraw.mjs`, `npm link`). Export dialog, MCP `export` (`pageSize`, `actualSize`, `slideSize`) and `AGENT_EXPORT_FORMATS` cover them. Pure logic in `shared/` (`xml`, `drawioWriter`, `drawioReader`, `pdfLayout`, `cli`) with `tests/drawio.test.ts` and `tests/pdfcli.test.ts`; smoke test exports PDF/PPTX/draw.io over MCP (magic bytes, page/slide counts, A4/Letter boxes, well-formed XML) and runs the CLI after closing the app (JPG of a frame, PDF/PPTX per frame, WebP batch, CSV default path, draw.io → excalidraw keeps node labels, zones, properties and bound edges).
   - Packaged CLI that uses the installed `.app`: done in Phase 9. (`.excalidrawlib` export and the MCP clipboard tool were added in the gap round below.) (Copy As in the command palette and opening `.drawio` files were done in Phases 7 and 8.)
7. ✅ **Ease of use** (done 2026-11-21):
   - **Command palette** (⌘K, or ⇧⌘P always; ⌘K with a selection stays Excalidraw's link editor): our own, because Excalidraw 0.18.1 neither exports `CommandPalette` nor renders it (so no custom items, and its ⌘/ does nothing). Fuzzy search (`shared/fuzzy.ts`) over file/tab/export (every format, Copy As) commands, stencils panel, preferences, themes, style presets, templates (`applyTemplate` IPC), stencils, frames, jump-to-element-by-text, find & replace, pages, lint, link authoring.
   - **Excalidraw built-ins verified** in the smoke test: ⌘F search, snap (Alt+S), help dialog (?).
   - **Style brush / Copy look** (⌥⌘C): pick up a shape's look and paint it onto others. Fill by default; chips add Stroke, Shadow and Text (remembered). Hover previews, click or drag paints (one undo step each), ⌥-click picks up again. Brush button sits beside the eyedropper on the Colors tab; right-click Copy look / Paste look replace Excalidraw's Copy styles / Paste styles (hidden). MCP `copy_look`. Pure rules `shared/styleCopy.ts`; details in CLAUDE.md "Style brush (Copy look)".
   - **Find & replace** (⌥⌘F): literal text, match case, whole word, selection or whole drawing, labels and standalone text, one undo step, "Select matches". Pure logic `shared/findReplace.ts`.
   - **Pages panel** (⌥⌘P): frames as pages; click to zoom, double-click to rename, up/down to reorder, + adds a 16:9 page. Order is canvas position (reordering swaps two neighbours with their contents), because Excalidraw's undo does not track `customData`. Exports follow it.
   - **Drill-down links**: a shape's `link` opens an http(s) address in the browser or a `.excalidraw` drawing in a tab (relative to the saved drawing, absolute, `~/`, `file:`); validated in main (`shared/links.ts`), everything else refused; MCP `update_elements`/`add_elements`/`build_diagram` validate links. Palette: "Link selection to a drawing…", "Remove links from selection".
   - **Quick connect**: four "+" handles on the selected shape/stencil/group, or on one the pointer rests on for 0.6 s; click adds a copy (20px away, no arrow), Option-click a connected copy, ⌘-click / ⌘-drag draws an arrow to an existing shape routed AROUND the shapes in between (live preview, choose side and quarter point, bend points, R/A/D style keys, Shift to chain, free end, durable via Excalidraw fixed segments; palette "Route arrows around shapes", MCP `connect {avoid}` and `route_around`), Shift/right-click picks a stencil; works on shapes, icon nodes, stencils from the panel (bare image + caption) and groups; zones/frames grow to fit; one undo step. Built by an Opus subagent, reworked 2026-11-22 (units, dwell, Option-click).
   - **Diagram lint** (⌥⌘L, MCP `lint_diagram`): overlap, unconnected arrow, unlabeled node, missing IP, off-palette color; safe one-click fixes (bind a free arrow end, snap a color); `fix: true` is one undo step. Built by an Opus subagent.
   - Not done: Excalidraw's own palette items (⌘/) can't be extended. (Page previews and replace-one were added in the gap round below.)
8. ✅ **Data features** (done 2026-11-21):
   - **Properties panel**: hostname, IP, VLAN, role, owner, URL, notes for one selected shape or icon node, in Excalidraw's properties column under "Colors & styles"; stored in `customData` (`shared/properties.ts`, alias tolerant). Excalidraw's undo does not track `customData`, so property edits are not undoable. MCP: `get_inventory`, `set_properties`. Exports (CSV/Markdown) gained vlan, role, owner, url columns.
   - **Inventory table** (⌥⌘T): every node in an editable grid; click headers to sort (IPs by octet, natural text order, empty last), filter box, name edits the label, other cells edit properties, "◎" selects the node, "Export CSV…" opens the export dialog on CSV.
   - **Import from text** (⌥⌘U, MCP `import_diagram`): CSV (host list with `name`, `type`/`icon`, `zone` "Prod / DMZ", `connects_to`, any other column as a property; or `from`/`to`/`label` list), YAML (the DiagramSpec with shortcuts: node names, maps, `a -> b: label` edges), Mermaid (via `mermaid_to_scene`); paste box or file; same ELK layout and icons as `build_diagram`.
   - **Version history** (⌥⌘V): a snapshot per changed save in `<userData>/snapshots` (autosaves at most every 2 min, 60 kept); preview and restore (one undo step; the open state is snapshotted first).
   - **Presentation mode** (⌥⌘Return): frames as full-screen slides in page order, arrows/space/click, Esc; a drawing without frames is one slide.
   - **draw.io import**: Open (and MCP `open_drawing`) accept `.drawio`; it becomes a new unsaved drawing, never saved back into the .drawio.
   - Not done: Mermaid *export* round trip UI beyond the existing export. (Properties on hover and rename-proof history were added in the gap round below.)
   - **Menus** (done 2026-11-23): the in-app menu and the macOS menu bar share one grouping (File · View · Diagram · Preferences · Help, Reset canvas last). Excalidraw 0.18 has no submenus, so the in-app menu uses collapsible sections (one open at a time) and check-mark rows for panels and grid.
   - **Gap round** (done 2026-11-23, with portable drawings as the goal): custom colors and the version-history id now live in the `.excalidraw` file (`mydraw` key), so drawings carry them to other people and history survives a rename; `.excalidrawlib` export; MCP `copy_to_clipboard`; Find & replace Previous/Next/Replace (replace one); page previews in the Pages panel; properties tip on hover. Opacity needed no work (Excalidraw's own row; presets/themes carry it). Still open: a file duplicated outside the app shares its history id until Save As; page previews re-render on every edit settle (fine up to ~dozens of pages).
   - **Style panel polish** (done 2026-11-24): pin the style panel (patch of Excalidraw's `showSelectedShapeActions`, `scripts/excalidrawPatch.mjs`), a pin button in its header, picked colors become the defaults for new shapes and stencil labels, bold / italic buttons and ⌘B / ⌘I (italic faces for professional + mono fonts), colors and B / I work while a text is being edited. Details in CLAUDE.md "Pin style panel" and "Bold / italic".
   - **Effects round** (done 2026-11-25): text outlines and shadows (kinds drop, inner, layered, 3D extrude, ground contact; 11 presets), more fills (roughjs Scribble / Zigzag / Dots / Dashes, gradients linear or radial on rectangles, diamonds and ellipses), more stroke styles (short / long dash, dash-dot, dash-dot-dot, dense / sparse dots), "…" buttons on Excalidraw's Fill and Stroke style rows, a panel consistency pass (Shadow as one Excalidraw-style row + popover, after Edges; one "custom value" marker; "New shapes" badge; Presets/Themes toolbars), and floating sub-windows (drag a popover's title bar; it stays open and reopens there). All usable by Claude: add_elements / update_elements / build_diagram nodes, edges and zones / style presets; draw.io keeps dashes and gradients.
   - **Extra fonts** (done 2026-11-23): 21 built-in typefaces (11 fun: hand-drawn, cartoon, whiteboard; 10 professional/mono), each weight its own entry, registered in Excalidraw's own font registry so its picker, canvas and exports use them; Google Fonts catalog downloads (Fontsource) in Preferences → Fonts…; drawings embed the font files their text uses (`mydrawFonts` key), so they render the same anywhere, CLI included. MCP `list_fonts`, font names in agent input, themes and presets. Clean style writes new text in Inter. Details in CLAUDE.md "Fonts".
   - **Tidy and Re-layout** (done 2026-11-25, reworked same day): two commands. Tidy keeps the arrangement (rows/columns, even gaps, overlaps, zones grow; `shared/tidy.ts`), applied only if no worse. Re-layout follows the drawing (inferred direction, reading order, notes stay with their shape), tries every variant, applies only if clearly cleaner, makes room around a grown selection. MCP `tidy`, `auto_layout {onlyIfBetter, makeRoom}` and prompt `tidy_diagram` (Claude tidies by meaning). In-app "Tidy with Claude" button = Phase 10, reusing `TIDY_RECIPE` (now `shared/recipes.ts`).
   - **MCP `align` / `distribute`** (done 2026-11-25): the last unbuilt planned tools; units (groups, labels, icon nodes, zones) move as one, one undo step (`shared/arrange.ts`, `tests/arrange.test.ts`, smoke step).
   - **Hand-drawn icons** (done 2026-11-25): any icon or stencil drawn by hand in eight looks (pen, marker, pencil, crayon, ink, line art, hatch, wobble) plus original; per-icon style in the style panel (Original / Pen / Pencil row and a window with fill, outline, sketchiness, weight, offset, hatch, texture, double lines, Redraw), insert look in the Stencils panel (follows the drawing style or fixed). Hand-font names under icons (Match / Hand / Plain). Recolor and restyle keep each other; one undo step each. MCP: `iconStyle` on `place_stencil`, `update_elements`, `build_diagram` nodes. Details in CLAUDE.md "Hand-drawn icons" and "Caption fonts".
9. ✅ **Package** (done 2026-11-25): one unsigned (ad-hoc signed) arm64 `mydraw.app` + DMG via `electron-builder` (`npm run package`), with everything inside: the editor, the `mydraw` command (shell wrapper runs the app's own binary in Node mode; `~/.local/bin/mydraw` symlink from `npm run install-app`) and the MCP server (`mydraw mcp`). **Set up mydraw** window on first launch: Move to Applications, Install the command, Connect Claude Code (one click each, undoable, asks before replacing another registration; also Preferences → Command line & Claude Code…); a DMG background with the drag arrow and a note for the one step that can't be automated (right-click → Open of an unsigned app). Entry switch `app/src/boot.ts` (app or headless CLI). `.excalidraw`/`.drawio` file associations, Documents usage strings, no `node_modules` packed (all deps bundled). The checkout's MCP no longer drives an installed app. **Versions**: start at 0.1 (package.json 0.1.0), minor per release, shown in the in-app menu, Help, About, `mydraw --version`, MCP; `CHANGELOG.md` sections are the release notes. **Updates**: `npm run release -- minor` checks, builds, verifies and (after a y/N) tags, pushes and publishes a GitHub Release with the DMG + SHA-256; the installed app checks daily (or Help → Check for Updates), shows a banner (Update / What's new / Skip), downloads and verifies the DMG, stages the new app and swaps it on quit or **Restart now**. `npm run verify-package` checks a package end to end (signature, contents, DMG contents, bundled MCP + CLI, the Set up steps in a fake home, Move to Applications with relaunch, a real update swap against a fake release). Details in CLAUDE.md "Packaging, versions and updates".
10. ✅ **Ask Claude box** (done 2026-11-26): ⌥⌘J (Diagram menu, palette) opens a box where a typed request runs `claude -p` with the app's own MCP server (`--mcp-config` pointing at the bundled server run by the app's binary in Node mode, `--strict-mcp-config`, no built-in tools, only `mcp__mydraw` allowed, library/theme deletes refused); the drawing and the selection go in the system prompt. Steps stream into the box (stream-json), Cancel kills the run, one run at a time, 15 min cap; a run carries on when the box is closed (toast at the end). **Tidy with Claude** (button, Diagram menu, palette) runs `TIDY_RECIPE` on the drawing or the selection (selection = keep arrangement). Model Sonnet (default) / Opus / Haiku in the box and Preferences (`Settings.askClaude`). Missing `claude` → message with a Set up… button. Pure parts `shared/askClaude.ts` (`tests/askClaude.test.ts`); smoke runs a fake `claude` (`MYDRAW_CLAUDE`) that starts the MCP server from the config and edits the drawing through it. Checked by hand once with the real `claude` (Haiku, `list_drawings`).
   - **Prominence + better looks** (done 2026-11-26): **Ask Claude** button in the tab bar (left of Clean | Sketch; busy dot while a run works), the box drops down under it. **Design guide** (`DESIGN_GUIDE`, `shared/recipes.ts`: colour by role, strokes, fills, shadows, arrow kinds and weights, legend) in every Ask and the MCP instructions; **Polish with Claude** (button, menu, palette, MCP prompt `polish_diagram`) restyles without moving; **polished** is the new default `build_diagram` look (role colours from `shared/nodeRoles.ts`, 2 px strokes, soft shadows, role legend rows; `role` on nodes; `professional` = the old plain look).

Tests: vitest (`tests/`, 46 files: versions and updates, exporters, draw.io, Mermaid, layout/quality, tidy, align/distribute, routing, lint, styles/effects, fonts, sketch icons, agent input validation), the Playwright-Electron smoke test (`scripts/smoke.mjs`, drives the app and the MCP server end to end) and `scripts/verify-package.mjs` (the packaged app). Control-server auth has no dedicated test.

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
- **Ask Claude box (Phase 10):** runs `claude -p --model <model>`; default Sonnet 5.5, selectable in Preferences.

### Cost reference (API list price per 1M tokens, input / output)
Haiku 5.5 $0.10 / $0.50 · Sonnet 5.5 $2 / $10 · Opus 5.5 $4 / $20 · Fable 5.2 $8 / $40. On a Claude subscription these count against usage limits instead of dollars; Opus and Fable use those limits up faster.

## Risks
- Image elements + `files` must persist in saves and every export format (verify phase 3).
- PDF/PPTX fidelity of hand-drawn fonts: handled (SVG/PDF exports inline whole font files; PPTX is pictures).
- drawio export is approximate (Excalidraw styles don't map 1:1); keep icons as embedded images.
- Vendor icon licenses: packs download at runtime into the user's library and the downloader writes `Library/LICENSES.md`; never redistribute packs.
- User + agent editing at once: agent commands applied serially by element id against the latest scene.
- Excalidraw upgrades: mydraw patches and relies on internals; follow `EXCALIDRAW-UPGRADE.md`.

## Verification
Status checked against the code and the smoke test (`scripts/smoke.mjs`, run 2026-11-25) and `claude mcp list`.
1. ⚠️ `npm run dev`, draw, save, quit, reopen: smoke covers save (valid file, clean dirty flag), autosave, reload from disk and crash recovery. Manual quit/reopen not in smoke.
2. ⚠️ Export to every format: smoke checks PNG, JPG, SVG, WebP, Mermaid, CSV, Markdown, HTML, PDF, PPTX and draw.io (magic bytes, structure). Opening each in its native viewer (Preview, browser, Keynote, draw.io) not done.
3. ✅ `mydraw export … --format jpg` with the app closed (smoke "CLI: export and convert with the app closed").
4. ⚠️ Stencil search, drag, save/reopen: smoke inserts by click and drag and checks images persist in the saved file, using a fake pack and the query "testrouter". Real searches ("ec2", "cloud run") with the real packs not checked.
4b. ⚠️ Library persistence: "Add to library" / save selection as stencil and survival across restart are in smoke. Not checked: relaunch-then-New-tab, a second tab, reinstall, deleted stencil still rendering in old drawings.
5. ⚠️ Color panel: custom hex applied and Clean ↔ Sketch switch are in smoke. Swatch surviving restart not checked.
6. ⚠️ `claude mcp list`: `mydraw` is registered from the checkout (`node …/mcp/dist/index.js`). After installing the app, Set up → Connect Claude Code offers to replace it.
7. ⚠️ Ask Claude AWS 3-tier build: smoke drives the MCP tools end to end (build_diagram with zones, icons, elbow arrows, legend; export JPG and PDF). A live Claude Code conversation with that prompt not run.
8. ⚠️ Undo removes Claude's last call as one step: covered (smoke, `undo` after `update_elements`). Hand edits kept while Claude adds shapes: not in smoke.
9. ✅ CSV hosts → diagram; inventory table edits update labels (smoke Phase 8 steps).
10. ✅ Build DMG, launch outside dev: `npm run package && npm run verify-package` (bundled MCP + CLI, update swap) passed 2026-11-25. ⚠️ Not yet: install to /Applications by hand, Finder double-click, first published release and a real update from GitHub.
