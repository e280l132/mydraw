# Changelog

Versions are major.minor (0.1, 0.2, …); a third number marks a bug-fix build (0.1.1). Each
section below becomes the release notes of that version (`npm run release`), which the app shows
under "What's new" when it offers the update.

## 0.2

- Ask Claude (⌥⌘J): type a change and Claude Code makes it in the drawing while you watch, one undo step per action, with Cancel
- Tidy with Claude: Claude tidies the drawing or the selection by meaning (entry points first, peers in rows, clean arrows)
- Ask Claude button in the tab bar; the box drops down under it
- Polish with Claude: restyles a drawing (colour by role, fills, outlines, soft shadows, arrow kinds, legend) without moving anything
- Diagrams Claude builds are coloured by role with soft shadows by default (new "polished" look; "professional" is the plain one)
- Claude model (Sonnet, Opus, Haiku) in Preferences

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
