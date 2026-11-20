# mydraw: local Excalidraw desktop app, stencils, full Claude Code control

## Context
Brian wants a standalone draw.io-style desktop app built on the latest Excalidraw, with network/cloud stencils (AWS, GCP, Azure, network gear), full color choice beyond the 16-ish built-in swatches, and full control by Claude Code over MCP so Claude can build diagrams on request. This rewrite replaces the earlier `~/Projects/mydraw/plan.md` (folder + git already exist, no code yet).

## Decisions
- **Canvas:** `@excalidraw/excalidraw@0.18.1` (current npm `latest`), plus `@excalidraw/mermaid-to-excalidraw@3.6.0`. Do not copy ExcaliDash's prerelease pin or its code (LGPL); MIT package only.
- **Shell:** Electron + Vite + React + TypeScript, single npm workspace. Node v26 installed.
- **Agent control:** stdio MCP server bridging to a local control server inside the app (WordCraft pattern).
- **Stencils (easiest path):** SVG icon sets in an app-owned stencil catalog, inserted as Excalidraw image elements. draw.io stencils as an optional later importer.
- **Colors:** custom color panel in the app (Excalidraw's `palette` prop is internal, not public on `<Excalidraw>`).

## Architecture
```
Claude Code --MCP stdio--> mcp/ --HTTP 127.0.0.1:<port> + key--> app/ (Electron main) --IPC--> web/ (renderer, Excalidraw)
```
- `web/` renderer: mounts `<Excalidraw>`, holds `excalidrawAPI`, the stencil panel, the color panel, and a command executor that applies agent commands via `updateScene` / `addFiles`. Renderer is the single source of truth for the scene.
- `app/` main: window, menus, open/save dialogs, `.excalidraw` file association, autosave, recent files, control server. Writes `{port, key}` to `~/Library/Application Support/mydraw/control.json` (chmod 600). Loopback only, key required, context isolation on, no remote content.
- `mcp/`: `@modelcontextprotocol/sdk` stdio server. Reads `control.json`, forwards tool calls. If the app isn't running, it launches it (or returns a clear error).
- `stencils/`: `<set>/icons/*.svg` + `<set>/catalog.json` (id, name, tags, category, default size, license). Plus `stencils/LICENSES.md`.
- `tools/`: `build-catalog` (scan SVG folders → catalog.json), `import-excalidrawlib`, later `import-drawio`.
- `templates/`: starter diagrams (3-tier web app, VPC layout, home network, k8s cluster).
- `CLAUDE.md`: project notes, plus a section on how to drive mydraw via MCP.

## Features

### 1. Core editor
New/Open/Save/Save As `.excalidraw`, autosave + crash recovery, recent files, dark/light, export PNG/SVG (transparent bg, scale) and PDF (via Electron `printToPDF` of the SVG).

### 2. Stencils (network / cloud)
- **Sources (official SVG packs, downloaded by a script, not committed if license forbids):** AWS Architecture Icons, Google Cloud icons, Azure Architecture Icons, Cisco/network icons (or the network set from draw.io as SVG), Kubernetes icons, plus `@iconify-json/logos` for vendor/product logos.
- **Stencil panel:** sidebar with set filter, category tree, fuzzy search, drag-to-canvas, favorites, recently used.
- **Insert:** image element (fileId = SVG hash, `addFiles`) + optional label text bound under the icon, grouped. Same path used by the agent.
- **Community libraries:** also load `.excalidrawlib` files (libraries.excalidraw.com has AWS/GCP/network sets drawn as native shapes, which can be recolored) into Excalidraw's own library panel.
- **Later:** `import-drawio` (render draw.io stencil XML to SVG via the draw.io desktop CLI, feed into `build-catalog`), and `.drawio` diagram import.

### 3. Full color set
- Color panel (sidebar tab): full HSV/hex/RGB picker (`react-colorful`), eyedropper (`EyeDropper` API in Chromium), opacity.
- Palettes: Tailwind-style full ramp (≈22 hues × 10 shades), brand palettes (AWS, GCP, Azure), document palette (colors already used in the scene), saved custom swatches (persisted).
- Applies to stroke / background / text of selected elements, and sets `currentItem*Color` so new shapes use it. Agent gets the same palettes by name (`aws.orange`, `blue-600`).

### 4. MCP tools (full control)
- **App/files:** `list_drawings`, `new_drawing`, `open_drawing`, `save`, `export` (png/svg/pdf/excalidraw → path), `screenshot` (returns PNG so Claude can check the look).
- **Read:** `get_scene` (compact: id, type, label, x/y/w/h, colors, group/frame, bindings), `get_selection`, `get_element`.
- **Stencils/colors:** `search_stencils`, `list_palettes`.
- **Build:** `place_stencil` (absolute or relative: `right_of`, `below`, inside frame), `add_elements` (Excalidraw element skeletons via `convertToExcalidrawElements`: shapes, text, arrows, frames), `connect` (bound arrow, label, style, elbow/curved), `update_elements` (any property incl. colors), `delete_elements`, `group`/`ungroup`, `create_frame` (zones: VPC, subnet, region).
- **Generate:** `build_diagram` (one call: nodes, edges, groups/zones, layout direction → full laid-out diagram; main tool for "draw me X"), `mermaid_to_scene`, `apply_template`.
- **Layout:** `auto_layout` (ELK via `elkjs`, layered/tree/grid, respects frames), `align`, `distribute`.
- **View/history:** `zoom_to_fit`, `select`, `undo`, `redo`. Each agent call = one undo step.
- **Escape hatch:** `set_scene` / `raw_update` with full element JSON.
- Register: `claude mcp add mydraw -- node ~/Projects/mydraw/mcp/dist/index.js`; allow `mcp__mydraw__*`.

### 5. Other useful features
- **Templates** gallery (File → New from template).
- **Diagram-as-code:** paste Mermaid, or a simple YAML (nodes/edges/zones) that uses the same engine as `build_diagram`.
- **Version snapshots:** save keeps timestamped snapshots; restore from a menu.
- **Smart arrows:** keep arrows bound when the agent moves shapes; arrows route around frames.
- **Legend generator:** auto legend of stencils used.
- **Quick properties bar:** IP/hostname/notes fields stored in `customData`, shown on hover, returned by `get_scene` (so Claude can build docs from a diagram).
- **Presentation mode:** frames as slides.

## Phases
1. **Core app:** scaffold workspace, Excalidraw in Electron, file ops, autosave, export. `npm run dev` runs both.
2. **MCP + control server:** read/build/delete/connect/screenshot/export tools. Claude can draw basic shapes end to end early.
3. **Stencils:** download script, `build-catalog`, stencil panel, `place_stencil` / `search_stencils`, community `.excalidrawlib` loading. First check that image elements survive save/reopen/export with embedded files.
4. **Colors:** color panel, palettes, swatches, eyedropper, `list_palettes`.
5. **Diagram generation:** `build_diagram`, ELK `auto_layout`, frames/zones, `mermaid_to_scene`, templates.
6. **Extras:** snapshots, customData properties, legend, presentation mode, draw.io importer.
7. **Package:** `electron-builder` → unsigned macOS `.app`/DMG (fine for personal use).

Tests: vitest for catalog builder, `build_diagram` layout, control-server auth; one Playwright-Electron smoke test.

## Risks
- Image elements + `files` must persist in `.excalidraw` saves and exports (verify in phase 3; SVG icons can't be recolored, native-shape libraries can).
- Vendor icon licenses (AWS/GCP/Azure allow use in diagrams; record terms in `stencils/LICENSES.md`, don't redistribute packs publicly).
- Simultaneous user + agent edits: apply agent commands serially in the renderer against the latest scene, by element id.
- Check Excalidraw 0.18 setup steps against its docs (CSS import, asset path, ESM).

## Verification
1. `npm run dev` opens the app; draw, save, quit, reopen; file persists.
2. Stencil panel: search "ec2", "cloud run", "router"; drag onto canvas; save/reopen keeps icons.
3. Color panel: pick any hex, apply to selection, saved swatch persists after restart.
4. `claude mcp list` shows `mydraw` connected.
5. Ask Claude: "Build an AWS 3-tier diagram: ALB, two EC2 in private subnets, RDS, inside a VPC frame, AWS colors." Confirm live build, bound arrows, layout, `screenshot` returns image, `export` writes PNG.
6. Edit by hand while Claude adds shapes; no lost edits; undo removes Claude's last call as one step.
7. Build DMG, install, launch outside dev.
