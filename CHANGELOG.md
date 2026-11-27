# Changelog

Versions are major.minor (0.1, 0.2, …); a third number marks a bug-fix build (0.1.1). Each
section below becomes the release notes of that version (`npm run release`), which the app shows
under "What's new" when it offers the update.

## 0.2.2

- Install without admin rights: when you can't add apps to /Applications, the Set up window offers "Just for me" and moves mydraw to your own Applications folder (~/Applications), no password needed. Updates work from there too
- The Set up window lets you choose All users (/Applications) or Just for me, and warns when another copy of mydraw is in the other folder

## 0.2.1

Quick connect (the "+" handles around a shape):

- Right-click a "+" for a menu: connect with an arrow (around shapes, elbow, straight, curved) or a plain straight or curved line, dashed or with arrowheads at both ends, or add a copy, a shape or an icon
- Connected copies use the same link style, so they can be joined by lines too; the style bar at the bottom of the screen changes it while drawing a link
- Drag a "+" to drop a connected copy where you let go, or onto another shape to connect to it; a tip shows the link style in use (can be turned off in Preferences → Quick connect shortcuts…)
- Hovering a "+" shows where the copy will go
- Shift-click a "+": basic shapes (rectangle, rounded, ellipse, diamond, database, cloud, document, hexagon) besides the stencils; a new shape opens its label for typing
- Copies count their labels up: web-1 → web-2, Server → Server 2
- With several shapes selected, the "+" handles act on all of them (one undo step)
- ⌥⌘+arrow adds a connected copy on that side (⇧⌥⌘+arrow: a plain copy); Tab / ⇧Tab move between connected shapes
- Option to open the new shape's label for typing after every add

## 0.2

- Ask Claude (⌥⌘J): type a change and Claude Code makes it in the drawing while you watch, one undo step per action, with Cancel
- Tidy with Claude: Claude tidies the drawing or the selection by meaning (entry points first, peers in rows, clean arrows)
- Ask Claude button in the tab bar; the box drops down under it
- Polish with Claude: restyles a drawing (colour by role, fills, outlines, soft shadows, arrow kinds, legend) without moving anything
- Diagrams Claude builds are coloured by role with soft shadows by default (new "polished" look; "professional" is the plain one)
- Claude model (Sonnet, Opus, Haiku) in Preferences
- Ask Claude follow-ups: keep talking about the same drawing, or "Outline first" to see the plan before Claude builds it
- Diagrams Claude builds can use grids (rows × availability zones), numbered steps along the arrows and several views of one diagram
- Style brush (⌥⌘C, or right-click → Copy look): paint one shape's fill, stroke, shadow or text style onto others
- Hatch and cross-hatch fills: the stroke width now changes only the outline; the hatch line width and spacing have their own sliders in the Fill popover

## 0.1

First installable version: one macOS app (Apple Silicon) with everything inside.

- Excalidraw editor with tabs, autosave, crash recovery, version history and a Clean (professional) or Sketch look
- Stencil library shared by every drawing, icon packs (AWS, Azure, Google Cloud, Kubernetes, network, logos, self-hosted apps), recoloring and hand-drawn icons
- Colors, themes, style presets, shadows, gradients, more fills and dash styles, text outlines, 21 extra fonts plus font downloads
- Diagrams from text (Mermaid, CSV, YAML), automatic layout, Tidy and Re-layout, zones, legends, lint with fixes
- Export to PNG, JPG, WebP, SVG, PDF, PowerPoint, draw.io, HTML, Mermaid, CSV and Markdown; draw.io import
- Claude Code control through the built-in MCP server (`mydraw mcp`)
- `mydraw` command for exports and conversions without opening the app
- "Set up mydraw" window on first launch: move to Applications, install the `mydraw` command, connect Claude Code (one click each)
- Version number in the menu and Help; updates offered in the app when a new version is released
