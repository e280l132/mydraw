// mydraw help ("mydraw features & shortcuts…"): what the app does and its own shortcuts. Excalidraw's
// built-in Help (its tool and editing keys: `?`, the corner button, the menu) stays; the two dialogs
// open each other (App.tsx: `openExcalidrawHelp`, and a button added to its header). Keys come from
// shared/shortcuts.ts (shown for this platform); keep the text in step with the README sections
// "What it does" and "Keyboard shortcuts".
import { useEffect, useRef } from "react";
import { formatShortcut, keyNames, sc } from "../../shared/shortcuts";
import { APP_VERSION, APP_VERSION_LABEL } from "../../shared/appVersion";

interface Row {
  keys?: string;
  text: string;
}
interface Section {
  title: string;
  rows: Row[];
}

export function helpSections(): Section[] {
  const { cmd, option } = keyNames();
  return [
    {
      title: "Files and tabs",
      rows: [
        { keys: `${sc("switchTab")}, Ctrl+Tab`, text: "Switch between open drawings" },
        { keys: sc("versionHistory"), text: "Version history: preview a saved version and restore it (one undo step)" },
        { text: "Autosave for saved files, crash recovery for unsaved drawings, reload when a file changes on disk" },
        { text: "A .drawio file opens as a new unsaved drawing; it is never saved back into the .drawio" },
      ],
    },
    {
      title: "Export",
      rows: [
        { keys: sc("export"), text: "Export: PNG, JPG, WebP, SVG, HTML, PDF, PowerPoint, draw.io, Mermaid, CSV, Markdown, Excalidraw library" },
        { text: "Scope: whole drawing, selection, one frame, or every frame (one file each, or one page or slide per frame)" },
        { text: "Keep an image up to date: each save also rewrites e.g. network.png next to network.excalidraw" },
      ],
    },
    {
      title: "Stencils and icons",
      rows: [
        { keys: sc("stencils"), text: "Show / hide the stencils panel" },
        { keys: sc("quickSaveStencil"), text: "Save the selection as a stencil (no name prompt)" },
        { text: "Icon packs (AWS, Azure, Google Cloud, Kubernetes, network, logos, self-hosted apps…): Icon packs… next to the panel title" },
        { text: "Recolor icons (with undo) and use the eyedropper to copy any color; icons keep their colors in dark mode" },
        { text: "Hand-drawn icons in eight looks (Pen, Marker, Pencil, Crayon, Ink, Line art, Hatch, Wobble): the button beside the Stencils search box for inserts, the Icon style section and window for selected icons (fill, outline, pen, offset, texture, Redraw)" },
        { text: "Names under icons (Off · Match · Hand · Plain, hand font) in the same popover; Match writes them by hand under hand-drawn icons (Excalifont by default) and follows style changes" },
      ],
    },
    {
      title: "Colors and styles",
      rows: [
        { text: "Colors tab: two palettes and an any-color picker; Stroke, Fill and Icon targets. Custom colors you pick are kept in the drawing file, so they travel with it" },
        { text: "Outline target (text or a labelled shape selected): a colored outline around the letters; the Width slider sets its thickness, None removes it" },
        { text: "Shadow section: None, Soft, Drop, and the sliders button for every shadow: presets, kind (drop, inner, layered, 3D, ground), Amount, color, opacity, blur, distance and angle. Works on shapes, text, lines, arrows and icons; with nothing selected it sets the shadow for shapes you draw next. Command palette: \"Shadow\"" },
        { text: "The … button after the Fill buttons: Scribble, Zigzag, Dots and Dashes patterns, and gradients (presets, start and end color, linear or radial, direction). Excalidraw's own Fill buttons turn a gradient back into a plain fill" },
        { text: "Windows opened from the panel (Fill, Stroke style, Shadow, the slider buttons) can be dragged by their title bar; a moved window stays open and reopens there; the dock button puts it back" },
        { text: "The … button after the Stroke style buttons: short dash, long dash, dash dot, dash dot dot, dense and sparse dots" },
        { keys: sc("copyLook"), text: "Copy look (style brush, also the brush button in Colors & styles and the right-click menu): click shapes to paint the fill, gradient or pattern onto them, drag to paint many, ⌥-click picks up another look, Esc ends. Chips add Stroke, Shadow and Text. Right-click → Paste look paints the selection" },
        { text: "Presets and Themes tabs: built-in and your own, saved globally; apply to the selection or the whole drawing" },
        { text: "Slider buttons next to stroke width, sloppiness, edges and font size set values beyond the presets (with nothing selected they set the next shape or text you draw)" },
      ],
    },
    {
      title: "Fonts",
      rows: [
        { text: "Excalidraw's font list (left panel, with text selected) also has mydraw's fun fonts (Caveat, Kalam, Permanent Marker, Bangers…) and professional ones (Inter, Roboto, Lato, Merriweather, IBM Plex, JetBrains Mono…); each weight is its own entry, like Inter Bold" },
        { text: "Preferences → Fonts…: preview them, download more from Google Fonts, remove downloads, install fonts that came with a drawing" },
        { text: "A drawing carries the fonts it uses inside its file, so it looks the same anywhere" },
      ],
    },
    {
      title: "Diagrams from text",
      rows: [
        { keys: sc("importText"), text: "Import from text: CSV host list or from/to list, YAML spec, or Mermaid" },
        { text: "With Claude Code (MCP): build_diagram, apply_template, mermaid_to_scene, auto_layout" },
      ],
    },
    {
      title: "Properties, inventory and links",
      rows: [
        { text: "Hostname, IP, VLAN, role, owner, URL and notes on any shape or icon (right panel); rest the pointer on one to see them" },
        { keys: sc("inventory"), text: "Inventory table: sort, filter, edit names and properties, export CSV" },
        { text: "Drill-down links: a shape can open a web address or another .excalidraw drawing" },
      ],
    },
    {
      title: "Pages and presentation",
      rows: [
        { keys: sc("pages"), text: "Pages panel: frames are pages, each with a preview; click to zoom, double-click to rename, arrows to reorder" },
        { keys: sc("present"), text: "Presentation: frames as full-screen slides (arrows, space or click to move; Esc to leave)" },
      ],
    },
    {
      title: "Quick connect (hover or select a shape, icon or group)",
      rows: [
        { text: "Click a “+” handle: add a copy beside it (no arrow)" },
        { text: `${option}-click: add a connected copy, joined by an arrow` },
        { keys: `${cmd}-click or ${cmd}-drag`, text: "Draw an arrow to another shape; it routes around shapes in between" },
        { text: "While linking: R cycles the route style, A the arrowheads, D dashed; Backspace removes a bend point" },
        { text: "Shift-click or right-click: pick a stencil for a new connected node" },
        { text: "Rebind these in the main menu: Preferences → Quick connect shortcuts…" },
      ],
    },
    {
      title: "Checks and layout",
      rows: [
        { keys: sc("lint"), text: "Diagram lint: overlaps, unconnected arrows, unlabeled nodes, missing IPs, off-palette colors" },
        { keys: sc("grid"), text: "Show / hide the layout grid (Grid settings… in the menu); snap while moving and drawing" },
        { keys: sc("align"), text: `Align (Excalidraw); ${formatShortcut("⌥H")} / ${formatShortcut("⌥V")} distribute. The Align section sits above Edges in the panel` },
        { text: "Tidy: line up rows and columns, even gaps, fix overlaps, keeping your arrangement (Diagram menu, command palette)" },
        { text: "Re-layout: fresh automatic layout that follows your drawing, applied only if cleaner (Diagram menu, command palette)" },
        { text: "Route arrows around shapes (command palette)" },
        { keys: sc("askClaude"), text: "Ask Claude: type a change and Claude Code makes it with mydraw's tools, live; Tidy with Claude tidies by meaning (roles, flow, peers in rows); Polish restyles (colour by role, fills, strokes, shadows, arrow kinds) without moving anything. Also the Ask Claude button in the tab bar. Each step is one undo step; Cancel stops it" },
        { keys: sc("findReplace"), text: "Find and replace: step through matches (Enter, Shift+Enter), replace one or all, match case, whole word, selection or whole drawing" },
      ],
    },
    {
      title: "Command palette and panel",
      rows: [
        { keys: sc("paletteAlways"), text: `Command palette (${sc("palette")} when nothing is selected): every command, stencil, theme, preset, template and file` },
        { text: "Drag panel sections into your order: Rearrange panel sections (palette), then drag by the title" },
      ],
    },
    {
      title: "Appearance",
      rows: [
        { text: "Main menu → Preferences: app theme (System, Light, Dark), drawing style (Clean or Sketch), autosave" },
        { text: "Icons and images keep their exact colors in dark mode, on screen and in dark exports" },
      ],
    },
    {
      title: "Command line and Claude Code",
      rows: [
        { text: "mydraw export drawing.excalidraw --format pdf --scope frames: export without opening the app" },
        { text: "mydraw convert x.drawio --to excalidraw (or --to drawio); mydraw help lists all options" },
        { text: "Claude Code (MCP): list_drawings, get_scene, add_elements, build_diagram, connect, place_stencil, create_zone, lint_diagram, export, copy_to_clipboard, screenshot and more; each call is one undo step" },
      ],
    },
  ];
}

interface Props {
  onClose(): void;
  /** Close this and open Excalidraw's own help (tool and editing keys). */
  onOpenExcalidraw(): void;
}

export function HelpDialog({ onClose, onOpenExcalidraw }: Props) {
  const box = useRef<HTMLDivElement>(null);
  // Focus on open so Esc reaches the dialog.
  useEffect(() => box.current?.focus(), []);
  const sections = helpSections();
  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        tabIndex={-1}
        className="md-modal md-help"
        role="dialog"
        aria-modal="true"
        aria-label="mydraw features and shortcuts"
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          onClose();
        }}
      >
        <h2>
          mydraw features and shortcuts <span className="md-help-version" data-md-version={APP_VERSION}>version {APP_VERSION_LABEL}</span>
        </h2>
        <p className="md-help-hint">
          Full reference: the README in the project folder. The drawing-tool and editing keys are in Excalidraw’s own help (press <kbd>?</kbd> on the canvas).
        </p>
        <button type="button" className="md-help-link" onClick={onOpenExcalidraw}>
          Excalidraw’s keyboard shortcuts…
        </button>
        {sections.map((s) => (
          <section key={s.title} className="md-help-section" data-help={s.title}>
            <h3>{s.title}</h3>
            <ul>
              {s.rows.map((r, i) => (
                <li key={i}>
                  {r.keys && <kbd>{r.keys}</kbd>}
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="md-modal-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
