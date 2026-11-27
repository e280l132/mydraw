# mydraw

A local desktop diagramming app built on [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT). Adds network and cloud stencils, diagram generation from text, a data layer (properties, inventory, import), orthogonal arrows that route around shapes, and full control from Claude Code over MCP. Runs offline. The roadmap and phase status are in `plan.md`; agent notes are in `CLAUDE.md`.

## Install

mydraw is one macOS app (Apple Silicon): the editor, the `mydraw` command and the Claude Code server are all inside `mydraw.app`.

1. Download `mydraw-<version>-arm64.dmg` from [GitHub Releases](https://github.com/e280l132/mydraw/releases) and open it. Its window shows these same steps.
2. Drag mydraw onto Applications.
3. The first time only: right-click mydraw in Applications, choose **Open**, then **Open** again (the app is not signed by Apple, so a plain double-click is blocked once).
4. mydraw opens a **Set up mydraw** window: **Install the command** (`mydraw` in Terminal, a link at `~/.local/bin/mydraw`) and **Connect Claude Code** (registers the built-in MCP server with Claude Code for all projects; asks before replacing another "mydraw" entry). Nothing happens until you click, every step has an undo button, and the window is in Preferences → Command line & Claude Code… later. If mydraw runs from the disk image or Downloads, the window first offers **Move to Applications** (needed for updates).

From this checkout: `npm install`, `npm run package` (builds `release/mydraw-<version>-arm64.dmg` and `release/mac-arm64/mydraw.app`), then either open the DMG as above or `npm run install-app` (quit mydraw first; copies the app to `/Applications` and links the command). `npm run verify-package` checks a built package end to end. The DMG window's background is `packaging/dmg-background.html`; after editing it, `npm run dmg-background` re-renders the committed `dmg-background.tiff`.

By hand, without the window: `ln -sf /Applications/mydraw.app/Contents/Resources/bin/mydraw ~/.local/bin/mydraw` and `claude mcp add --scope user mydraw -- /Applications/mydraw.app/Contents/Resources/bin/mydraw mcp`.

The version is shown at the bottom of the main menu (☰), in Help → mydraw features and shortcuts, in About mydraw, and by `mydraw --version`. Settings, the stencil library and drawings live outside the app, so replacing it never touches them.

## Updates

Versions are major.minor (0.1, 0.2, …; a third number for bug-fix builds). The installed app checks GitHub once a day (Preferences → "Check for updates automatically"; Help → Check for Updates… any time). When a newer version is out, a banner offers **Update** (downloads the DMG, checks its SHA-256, prepares the new app next to the old one), **What's new** and **Skip this version**; **Restart now** swaps in the new version, or it is swapped when you next quit. The checksum proves the download is complete, not who made it: the app trusts the GitHub repository (there is no Apple signature).

Publishing a release (maintainer): see [RELEASING.md](RELEASING.md). In short: add a `## <version>` section to `CHANGELOG.md`, commit, then `npm run release -- minor`.

## Run from source

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
- **Drawings are portable.** Everything a drawing needs travels in its `.excalidraw` file: shapes, embedded icons and images, properties, relative links, the custom colors picked in it, and an id for its version history. Another person opens the file in mydraw (or plain Excalidraw: the extra data is ignored) and sees the same thing. Your app preferences (grid, theme, shortcuts, style presets) and the version history itself stay on your machine.
- **Version history** (⌥⌘V): a snapshot is kept on each save (autosaves at most every 2 minutes, 60 kept). Preview a version and restore it as one undo step. The history is tied to an id stored in the file, so renaming or moving the file keeps it. Save As starts a fresh history for the copy; a file you duplicate in Finder shares the original's until it is saved with Save As.

**Export** (⇧⌘E, and Copy as in the menu)
- PNG, JPG, WebP, SVG, HTML viewer, PDF (vector; fit, A4/Letter, or actual size over sheets), PowerPoint (one picture per slide), draw.io, Mermaid flowchart, CSV and Markdown inventory, and an Excalidraw library (`.excalidrawlib`: the drawing, selection or a frame as one library item for Excalidraw users; icons and images are left out because libraries cannot hold them).
- Scope: whole drawing, selection, one frame, or every frame (one file each, or one page or slide per frame in PDF, PowerPoint and draw.io). Scale, padding, background, dark mode, quality, embedded editable scene.
- **Keep an image up to date**: per drawing, every save also rewrites e.g. `network.png` next to `network.excalidraw`.

**Stencils** (⇧⌘Y)
- One library in `~/Documents/mydraw/Library/`. Search, favorites, recent, collections and groups. Click to insert, or drag onto the canvas.
- Icon packs download from the Stencils panel: AWS, Azure, Google Cloud, Kubernetes, network devices (Carbon), 2,300 product logos, ~2,700 self-hosted app icons (Dashboard Icons: Proxmox, Portainer, Pi-hole…), and infrastructure picks from Material Design Icons, Tabler and Lucide, Devicon dev logos and Simple Icons brand marks. Use the **Icon packs…** button next to the panel title to search and sort packs, download the ones you tick (none are ticked by default) and remove installed ones.
- Save a selection as a stencil (⌥⌘S saves it to My Stencils without asking for a name); import SVG, PNG and `.excalidrawlib` files.
- Stencils is the only library: Excalidraw's own Library button is hidden.
- Hand-drawn icons: any icon or stencil can be drawn by hand in eight looks: **Pen** (sketchy outlines, colours kept), **Marker** (bold ink, fill a little off the lines), **Pencil** (graphite hatching), **Crayon** (scribbled fill on grainy paper), **Ink** (black pen, cross-hatching), **Line art** (outlines only), **Hatch** and **Wobble** (shaky; for detailed and PNG icons). In the Stencils panel, the small button beside the search box shows a sample icon exactly as a click would insert it; its popover has a live preview, every look as a tile (Original + the eight), **Follow drawing style** (Clean → original, Sketch → the look), and the names settings. The style panel's **Icon style** row switches selected icons (Original / Pen / Pencil, previews of the real icon); its window shows every look as a tile and adjusts fill (solid, hatch, cross-hatch, scribble, dashed, none), outline (shade, ink, same, none), sketchiness, pen weight, fill offset, hatch spacing and angle, texture (pencil, paper), single/double lines, and **Redraw**. With nothing selected it sets the look for new icons. Switching back is exact, recolors keep the sketch, one undo step each. Palette: "Icons: marker look", "Make all icons hand-drawn", "Make all icons original".
- Names under icons (same popover): **Off · Match · ✎ Hand · Aa Plain** and **Hand font** (Excalifont, Virgil, Caveat, Kalam, Patrick Hand, … each shown in its own face). **Match** (default) writes the name in the hand font under hand-drawn icons and in the drawing's font under original ones (and follows when you switch an icon's style later). The Icon style window has the same **Names** row and **Hand font** for the selected icons. Palette: "Icon names: handwritten / drawing font / match the icon".
- Recolor icons (with undo), an eyedropper that copies the real color of any shape, icon or text (a label's own color, bold and large text, thick lines), and icons that keep their real colors in dark mode.

**Fonts** (Preferences → Fonts…)
- 21 extra fonts on top of Excalidraw's own, in Excalidraw's font list (searchable, each shown in its own font, with a pen icon for fun fonts and "Aa" for professional ones). Each weight is its own entry ("Inter Bold"), so labels can be bold.
  - **Fun** (hand-drawn, cartoon, whiteboard): Caveat, Kalam, Patrick Hand, Architects Daughter, Gochi Hand, Permanent Marker, Indie Flower, Comic Neue, Bangers, Luckiest Guy, Fredoka.
  - **Professional**: Inter, Roboto, Open Sans, Lato, IBM Plex Sans, Montserrat, Merriweather, Source Serif. **Mono**: IBM Plex Mono, JetBrains Mono.
- **Download more** from the Google Fonts catalog (free, open licences): search, pick weights, install, remove.
- A drawing **carries the fonts it uses** inside its file (only the letters' subsets it needs), so it looks the same on another machine, in exports and on the command line. Fonts that came with a drawing can be installed for all drawings from the Fonts dialog.
- The Clean drawing style writes new text in Inter; Sketch keeps Excalifont. Themes and style presets can name any of these fonts.

**Colors and styles**
- **Font size slider**: the sliders button after S / M / L / XL sets any size from 4 to 300 px. Labels in shapes and on arrows follow and the shape grows to fit; free text grows from the same point as with the S/M/L/XL buttons; one drag is one undo step. With nothing selected it sets the size of the next text you write.
- **Bold and italic**: B and I buttons under the Font family picker, or ⌘B / ⌘I, for the selected text and the labels of selected shapes and arrows (also while you are typing in a text). They switch the whole text to the bold or italic face of the same typeface (Inter → Inter Bold → Inter Bold Italic), so labels re-fit their shapes and one click is one undo step. Italic faces ship for the Professional and Mono fonts; a button is greyed out (with a hint) when the font has no such face, e.g. the hand-drawn fonts have no italic and Excalidraw's own fonts have neither.
- **Text outline**: with text (or a shape or arrow with a label) selected, the **Outline** target in the Colors tab puts a colored outline around the letters, so light text stays readable on any fill. Pick its color from the swatches, shades, Any color… or the eyedropper; the **Width** slider (or the number box) sets its thickness, live while you drag, None (or the crossed swatch) removes it. Shows on screen and in PNG, SVG, PDF, HTML and PowerPoint exports (not in draw.io). Claude sets it with `textOutline: {color, width}`.
- **Shadows**: the **Shadow** section of the style panel puts a shadow under (or inside) shapes, text, lines, arrows, freehand and icons. Its row has None, Soft and Drop like Excalidraw's own rows; the sliders button next to them opens every shadow: presets (Soft, Drop, Lifted, Hard, Glow, Long, Inner, Elevated, Neon, 3D, Float), the **kind** (Drop, Inner = inset, Layered = tight + wide shadow, 3D = a solid block along the angle, Ground = a soft ellipse under the shape), **Amount** (blur and distance together), color (swatches, the element's own stroke color, or any color), and opacity, blur, distance and angle. Slider drags preview live and are one undo step. "Labels and captions too" also shadows labels and icon captions. With nothing selected (pinned panel, or a drawing tool active) it sets the shadow for the shapes you draw next. Shows on screen (light and dark) and in PNG, JPG, WebP, SVG, HTML, PDF and PowerPoint exports (export padding grows to fit it); draw.io gets its own on/off shadow (Drop and Layered only). Style presets can carry a shadow (built-ins: Card, Floating, Glow, No shadow); command palette "Shadow: …", "Stronger / Weaker shadow", "Remove shadow". Claude sets it with `shadow: "soft"` (any preset name) or `{preset, kind, color, opacity, blur, distance, angle, amount}`, also per node or for a whole `build_diagram`.
- **More fills**: the **…** button at the end of the Fill row adds Scribble, Zigzag, Dots and Dashes patterns (drawn by the same sketch engine as Hatch, so they also open on excalidraw.com) and **gradients**: eight presets, start and end color, linear or radial, and a direction dial. A gradient works on rectangles, diamonds and ellipses; other apps see its start color. Excalidraw's own Fill buttons, or **Flat**, turn it back into a plain fill. Shows on screen and in every export; draw.io gets its gradient (four directions or radial). Palette "Fill: …", "Gradient: …". Style presets "Sky gradient", "Sunset gradient", "Flat fill". Claude: `fillStyle: "dots"`, `gradient: "sky"` or `{from, to, kind, angle}`, on elements, `build_diagram` nodes and style presets.
- **Floating style windows**: the windows that open from the panel (Fill …, Stroke style …, Shadow, and the stroke width / sloppiness / corner / font size sliders) can be dragged by their title bar anywhere on screen. A moved window stays open while you work on the canvas and opens in the same place next time; the dock button puts it back next to the panel, × closes it.
- **More stroke styles**: the **…** button at the end of the Stroke style row adds Short dash, Long dash, Dash dot, Dash dot dot, Dense dots and Sparse dots. Other apps see a plain dashed or dotted line; draw.io gets the real dash pattern. Excalidraw's own Solid / Dashed / Dotted switch back. With nothing selected they set the stroke for what you draw next. Palette "Stroke: …". Claude: `strokeStyle: "dash-dot"` (any of `short-dash long-dash dash-dot dash-dot-dot fine-dot sparse-dot`), also as `build_diagram` edge / zone `style` and in style presets.
- **Pin the style panel**: the pin in the Colors & styles header (or View → Pin style panel) keeps the panel on screen with nothing selected, so Stroke and Fill set the colors of the next shapes and stencil labels. A color picked for a selection also becomes the default for the next shapes and labels.
- Colors tab with two palettes and an any-color picker. Colors you pick (picker or eyedropper) are remembered **in the drawing** (up to 12, shown as "In this drawing") and saved in its file. Opacity: Excalidraw's own Opacity row, and presets and themes can carry an opacity. Theme and style presets (built in, and yours, saved globally) apply to the selection or the whole drawing.

**Generated diagrams** (Claude's `build_diagram`, Mermaid, templates)
- Two looks: **professional** (default: crisp lines, bold Montserrat title, Inter labels, IBM Plex Mono for IPs) and **sketch** (hand-drawn lines and handwriting fonts), chosen by asking for it.
- Arrows by meaning: thick primary flows, thin faded secondary ones, dashed or dotted kinds, arrowheads such as triangle, dot, diamond and crow's foot; one style per kind of relationship, shown in the legend.
- Shapes beyond boxes: database cylinder, cloud, queue, document, person, server, hexagon, folder; important nodes in bold, external ones greyed out; a second line under a label for an IP or a role.
- Every build tries several layouts and keeps the cleanest (no arrow through a node, labels on free stretches, arrows apart) and reports what could be simpler.

**Diagrams from text** (MCP, and ⌥⌘U)
- `build_diagram`: nodes, edges and nested zones, laid out automatically (ELK), with icons from the library.
- **Zones by hand**: zones are locked so clicks inside them reach their contents; click a zone's **title** to select it (move with its contents, resize, recolour, double-click the title to rename). It locks again once you click elsewhere.
- Mermaid (flowcharts become zones; other Mermaid diagram types go through Mermaid), starter templates (3-tier web, AWS VPC, GCP project, home network, Kubernetes, homelab), legends, `auto_layout`.
- **Import from text** (⌥⌘U): paste or open CSV (a host list with zones, connections and properties, or a from/to list), YAML (the diagram spec with `a -> b: label` edges), or Mermaid.

**Properties and inventory**
- Hostname, IP, VLAN, role, owner, URL and notes on any shape or icon (the properties section in the right panel). Rest the pointer on a shape for a moment and a tip lists its properties, without selecting it. Property edits are not in the undo history.
- **Inventory table** (⌥⌘T): every node in one grid. Sort, filter, edit names and properties in place, select a node in the drawing, export CSV.

**Links, pages and presentation**
- **Drill-down links**: a shape can link to a web address (opens in the browser) or a `.excalidraw` drawing (opens in a tab). Relative paths resolve from the saved drawing.
- **Pages** (⌥⌘P): frames are pages, each with a small preview that updates as you edit. Click to zoom, double-click to rename, arrows to reorder. Exports follow the order.
- **Presentation** (⌥⌘↵): frames as full-screen slides. Arrows, space or click to move, Esc to leave.

**Quick connect** (hover or select a shape, icon or group, or select several; four "+" handles appear)
- **Click**: add a copy beside it (no arrow). Hovering a handle shows where it will go (with Option held, the arrow too).
- **Option-click**: add a connected copy. The arrow uses the last link style (below), so copies can be joined by plain lines too.
- **Drag a handle**: drop a connected copy where you let go, or onto another shape to connect to it. Esc cancels.
- **⌘-click or ⌘-drag**: draw an arrow to another shape. The arrow routes around shapes in between, keeps a clear distance from them, and previews live as you move. Point at a side of the target to choose it. Click empty canvas to add a bend point (Backspace removes it). Double-click or Enter ends the arrow on empty canvas. Shift-click keeps linking from the same shape. While linking: the bar at the bottom (or R, A, D) picks the style (around shapes, elbow, straight, curved), the arrowheads (one end, both, none = a line) and dashed. Esc or right-click cancels.
- **Right-click** (Control-click on a Mac): the quick connect menu. Connect with an arrow around shapes, an elbow, straight or curved arrow, or a plain straight or curved line (Dashed and Both ends toggles), or add a connected copy, a copy, a shape or an icon.
- **Shift-click**: pick a basic shape (rectangle, rounded, ellipse, diamond, database, cloud, document, hexagon) or a stencil for a new connected node. A new plain shape opens its label for typing.
- **Labels count up**: a copy of "web-1" is "web-2", of "Server" is "Server 2" (skipping names the drawing already has).
- **Several selected**: the handles act on all of them: each gets its own copy, or each is connected to the shape you pick. One undo step.
- **Keyboard**: ⌥⌘+arrow adds a connected copy on that side and selects it (press again to build a chain); ⇧⌥⌘+arrow adds a plain copy. Tab / ⇧Tab moves to the next / previous connected shape.
- Preferences → Quick connect shortcuts… rebinds the clicks, and can open the label for typing after every add.

**Checks and layout**
- **Diagram lint** (⌥⌘L): overlaps, unconnected arrows, unlabeled nodes, missing IPs, off-palette colors, arrows on top of each other or through nodes, labels in the way, crowded nodes, very long arrows. Safe one-click fixes; "Fix all" is one undo step.
- **Layout grid** (⌘', or Grid settings… in the menu): lines or dots, spacing 4–100 px, a stronger line every N cells, any color, adjustable strength. Drawn behind the shapes. **Snap to grid** while moving, drawing and resizing (hold ⌘ to move freely); "Snap selection to grid" lines up existing shapes in one undo step. The grid is an app preference: it is never saved into drawings or exports.
- **Align and distribute**: select 2+ shapes or icons and the Align section is in the left panel just above Edges (distribute needs 3+). Also in the command palette ("Arrange") and on Excalidraw's keys: ⇧⌘←/→/↑/↓ align, ⌥H / ⌥V distribute.
- **Tidy** (Diagram menu, command palette): keeps your arrangement and makes small moves: rows and columns that nearly line up are lined up, nearly even spacing is evened, overlapping shapes are pushed apart, zones grow to fit, arrows follow. Works on the selection, or the whole drawing. Says so when there is nothing to tidy.
- **Re-layout** (Diagram menu, command palette): a fresh automatic layout that follows your drawing (the direction your arrows flow, the order things are in, notes stay next to their shape), tries several layouts and is applied only if it is clearly cleaner than what is there. A re-laid-out selection pushes the shapes around it out of the way. One undo step each.
- **Ask Claude** (the **Ask Claude** button at the top right of the tab bar, ⌥⌘J, Diagram menu, command palette; the box drops down under the button): type what should change ("put the web servers in a row", "add a Redis cache between app and db") and Claude Code does it with mydraw's tools while you watch; each step shows in the box and is one undo step, Cancel stops it. Works on the selection, or the whole drawing. Needs Claude Code installed and logged in; each request uses your Claude usage. Model (Sonnet by default, Opus, Haiku) in the box or Preferences.
- **Polish with Claude** (button in the Ask Claude box, Diagram menu, command palette; or `/mcp__mydraw__polish_diagram` in Claude Code): Claude restyles the drawing to mydraw's design guide: each kind of part gets its own colour (users blue, network violet, compute teal, data stores green, queues orange, security red, monitoring slate, external grey dashed), pale fills with firmer outlines, soft shadows, the main path's arrows thicker, one colour and dash per kind of arrow, a legend. Nothing is moved or renamed. Every Ask follows the same guide when Claude builds something.
- **Polished diagrams**: diagrams Claude builds (and imports from text, templates) are coloured by role with soft shadows and 2 px outlines by default; ask for a "plain" (professional) or "hand-drawn" (sketch) look instead.
- **Tidy with Claude** (button in the Ask Claude box, Diagram menu, command palette; or `/mcp__mydraw__tidy_diagram` in Claude Code): Claude looks at the drawing (scene and screenshot), works out what each part is (entry points, services, data stores, peers) and tidies it with judgment: peers in rows, the main path in one direction, nodes into the right zones, then lint and a screenshot to check.
- **Route arrows around shapes** (command palette): re-routes the selected arrows (or all of them) around shapes.
- **Find and replace** (⌥⌘F): match case, whole word, selection or whole drawing. ↑ / ↓ (Enter, Shift+Enter in the Find box) step through the matches and select each one; **Replace** changes the current match and moves on (Enter in the Replace box), **Replace all** changes every match in one undo step (⌘Enter).
- **Command palette** (⇧⌘P; ⌘K when nothing is selected): fuzzy search over every command, stencil, theme, preset, template, frame, element and file action.

**Appearance**
- App theme (System, Light, Dark), drawing style (Clean or Sketch; always shown and switchable with the **Clean | Sketch** switch at the right of the tab bar). Icons and images keep their exact colours in dark mode, on screen and in dark exports.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| ⇧⌘P, or ⌘K with nothing selected | Command palette |
| ⌘' | Show / hide the layout grid |
| ⌥⌘F | Find and replace |
| ⌥⌘J | Ask Claude (Claude Code edits the drawing; Tidy with Claude) |
| ⌥⌘T | Inventory table |
| ⌥⌘L | Diagram lint |
| ⌥⌘P | Pages panel |
| ⌥⌘U | Import diagram from text |
| ⌥⌘V | Version history |
| ⌥⌘C | Copy look: style brush that paints the selected shape's fill (gradient, pattern), and on request its stroke, shadow and text, onto other shapes |
| ⌥⌘↵ | Presentation |
| ⇧⌘E | Export |
| ⇧⌘Y | Stencils panel |
| ⌘B, ⌘I | Bold, italic for the selected text and labels (fonts with a bold / italic face) |
| ⌥⌘←/→/↑/↓ | Quick connect: add a connected copy of the selection on that side (⇧⌥⌘←/→/↑/↓: a plain copy) |
| ⇥ (Tab), ⇧Tab | Select the next / previous shape connected to the selected one |
| ⌘F, Alt+S, ? | Excalidraw's own find, object snapping, help |

The main menu groups everything into File, View, Diagram and Preferences (collapsible; the menu bar follows the same grouping). Two helps are there: **mydraw features and shortcuts…** (also in the command palette) and Excalidraw's own Help (`?`, or the corner button: drawing-tool and editing keys). Each dialog has a button that opens the other.

On a quick-connect handle: click, Option-click, ⌘-click, Shift-click, right-click, drag (see above). On Windows and Linux, Ctrl replaces ⌘.

## Command line

`mydraw` exports and converts drawings without opening the app (it renders in a hidden window). The installed app provides it (see Install); from a checkout use `npm run build && npm link` instead.

```bash
mydraw export net.excalidraw --format jpg --scale 2 --frame "Prod"   # -> net.jpg
mydraw export net.excalidraw --format pdf --scope frames --page a4   # one page per frame
mydraw export net.excalidraw --scope frames -o shots/                # one PNG per frame
mydraw export net.excalidraw -o slides.pptx --slides 4:3 --dark
mydraw convert x.drawio --to excalidraw                              # best effort; skipped parts are listed
mydraw convert net.excalidraw --to drawio
mydraw --version
mydraw help                                                          # all options
```

Formats: png, jpg, webp, svg, html, pdf, pptx, drawio, mermaid, csv, markdown, excalidrawlib, excalidraw. Options: `--scope all|frame|frames`, `--frame`, `--padding`, `--scale`, `--dark`, `--no-background`, `--background #hex`, `--quality`, `--embed-scene`, `--page fit|a4|letter`, `--actual-size`, `--slides 16:9|4:3`, `-o`, `-q`. Inputs: `.excalidraw` and `.drawio`.

## Claude Code (MCP)

The MCP server talks to the running app (it starts the app if needed). The installed app ships it (`mydraw mcp`, see Install). To work on mydraw itself, register the checkout's server instead; it drives the checkout's own build, never the installed app (set `MYDRAW_APP=/Applications/mydraw.app` to change that):

```bash
claude mcp add --scope user mydraw -- node ~/Projects/mydraw/mcp/dist/index.js
```

Both share the app data folder, so only one mydraw runs at a time: quit the installed app before `npm start`, and the other way round.

56 tools cover: drawings (`list_drawings`, `new_drawing`, `open_drawing`, `activate_drawing`, `save`, `export`, `screenshot`, `copy_to_clipboard`), reading (`get_scene`, `get_element`, `get_selection`, `get_inventory`, `get_color`), building (`build_diagram`, `import_diagram`, `mermaid_to_scene`, `list_templates` / `apply_template`, `add_elements`, `connect` with `avoid: true` for arrows around shapes, `place_stencil`, `create_zone`, `add_legend`), editing (`update_elements`, `move`, `recolor`, `set_properties`, `tidy`, `align`, `distribute`, `route_around`, `auto_layout`, `delete_elements`, `group` / `ungroup`, `select`, `zoom_to_fit`), stencils (`search_stencils`, `list_collections`, `save_as_stencil`, `add_stencil_file`, `delete_stencil`), styles (`list_palettes`, `list_themes`, `apply_theme`, `apply_style_preset`, save/delete presets and themes), `list_fonts`, checks (`lint_diagram`), `undo` / `redo`, and the raw `set_scene` / `raw_update`. Effects (shadows, gradients, fills, dash styles, text outlines, hand-drawn icons via `iconStyle`, fonts by name) work in `add_elements`, `update_elements` and `build_diagram`. Each tool call is one undo step.

After `npm run build`, restart the app and the Claude Code session: both keep running the old code (tool results carry a `WARNING:` when they notice).

## Layout

```
app/src/      Electron main process + preload (bundled by esbuild to app/dist)
web/src/      React renderer with Excalidraw (Vite)
shared/       Types and pure helpers used by both (routing, lint, import, export formats)
mcp/          the MCP server for Claude Code
scripts/      dev, build, smoke-test, package, install and release scripts
packaging/    the shell wrapper of the installed `mydraw` command
bin/          the mydraw command (headless CLI, app/src/cli.ts)
tests/        vitest unit tests
```

Excalidraw is pinned to an exact version and some features rely on its internals: read [EXCALIDRAW-UPGRADE.md](EXCALIDRAW-UPGRADE.md) before upgrading it.

App data (settings, recovery, version history) lives in `~/Library/Application Support/mydraw/`; the stencil library in `~/Documents/mydraw/Library/`.

## App name and icon

`assets/icon.svg` is the source icon; `npm run icon` regenerates `assets/icon.png` and `assets/icon.icns`. On macOS, dev, start and smoke run a copy of Electron renamed to `mydraw.app` (built in `.electron/` by `scripts/electron-app.mjs`), so the menu bar, Dock and ⌘-Tab show "mydraw". The packaged app gets name, icon and file types from `electron-builder.yml`.
