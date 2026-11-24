import { Menu, app, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import type { MenuCommand, Settings } from "../../shared/types";

export interface MenuHandlers {
  send(cmd: MenuCommand): void;
  openRecent(filePath: string): void;
  clearRecent(): void;
  updateSettings(patch: Partial<Settings>): void;
}

export function buildMenu(settings: Settings, h: MenuHandlers): void {
  const isMac = process.platform === "darwin";
  const cmd = (c: MenuCommand) => () => h.send(c);

  const recent: MenuItemConstructorOptions[] = settings.recentFiles.length
    ? [
        ...settings.recentFiles.map((p) => ({ label: path.basename(p), sublabel: p, click: () => h.openRecent(p) })),
        { type: "separator" as const },
        { label: "Clear Recent", click: h.clearRecent },
      ]
    : [{ label: "No Recent Files", enabled: false }];

  // Keys the renderer already handles in its capture keydown (App.tsx): shown in the menu, but
  // not registered, so they keep reaching the page and never fire twice.
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });

  // Same grouping as the in-app menu (web/src/AppMenu.tsx): File, Edit, View, Diagram, Window, Help.
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { label: "Quick Connect Shortcuts…", click: cmd({ type: "quickConnectSettings" }) },
              { label: "Fonts…", click: cmd({ type: "fonts" }) },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "New Drawing", accelerator: "CmdOrCtrl+N", click: cmd({ type: "new" }) },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: cmd({ type: "open" }) },
        { label: "Open Recent", submenu: recent },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: cmd({ type: "save" }) },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: cmd({ type: "saveAs" }) },
        {
          label: "Autosave",
          type: "checkbox",
          checked: settings.autosave,
          click: (item) => h.updateSettings({ autosave: item.checked }),
        },
        { type: "separator" },
        { label: "Export…", accelerator: "CmdOrCtrl+Shift+E", click: cmd({ type: "export" }) },
        {
          label: "Copy As",
          submenu: [
            { label: "PNG Image", click: cmd({ type: "copyAs", format: "png" }) },
            { label: "SVG", click: cmd({ type: "copyAs", format: "svg" }) },
            { label: "Mermaid", click: cmd({ type: "copyAs", format: "mermaid" }) },
          ],
        },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: cmd({ type: "closeTab" }) },
        ...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
      ],
    },
    {
      label: "Edit",
      // Undo/redo/select-all must reach Excalidraw as key events, so their accelerators are
      // shown but not registered. Cut/copy/paste roles fire DOM clipboard events Excalidraw handles.
      submenu: [
        { role: "undo", registerAccelerator: false },
        { role: "redo", registerAccelerator: false },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll", registerAccelerator: false },
        { type: "separator" },
        { label: "Find and Replace…", ...shown("Alt+CmdOrCtrl+F"), click: cmd({ type: "findReplace" }) },
        { label: "Command Palette…", ...shown("CmdOrCtrl+Shift+P"), click: cmd({ type: "commandPalette" }) },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Stencils Panel", accelerator: "CmdOrCtrl+Shift+Y", click: cmd({ type: "toggleStencils" }) },
        { label: "Pages Panel", ...shown("Alt+CmdOrCtrl+P"), click: cmd({ type: "togglePages" }) },
        { label: "Diagram Lint", ...shown("Alt+CmdOrCtrl+L"), click: cmd({ type: "toggleLint" }) },
        { label: "Pin Style Panel", click: cmd({ type: "togglePinPanel" }) },
        { type: "separator" },
        {
          label: "Grid",
          type: "checkbox",
          checked: settings.grid.enabled,
          ...shown("CmdOrCtrl+'"),
          click: cmd({ type: "toggleGrid" }),
        },
        { label: "Grid Settings…", click: cmd({ type: "gridSettings" }) },
        { type: "separator" },
        { label: "Start Presentation", ...shown("Alt+CmdOrCtrl+Enter"), click: cmd({ type: "present" }) },
        { type: "separator" },
        {
          label: "Theme",
          submenu: (["system", "light", "dark"] as const).map((t) => ({
            label: t[0].toUpperCase() + t.slice(1),
            type: "radio" as const,
            checked: settings.theme === t,
            click: () => h.updateSettings({ theme: t }),
          })),
        },
        {
          label: "Drawing Style",
          submenu: [
            {
              label: "Clean (sharp, no roughness)",
              type: "radio",
              checked: settings.drawingStyle === "clean",
              click: () => h.updateSettings({ drawingStyle: "clean" }),
            },
            {
              label: "Sketch (hand-drawn)",
              type: "radio",
              checked: settings.drawingStyle === "sketch",
              click: () => h.updateSettings({ drawingStyle: "sketch" }),
            },
          ],
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "reload" as const }, { role: "toggleDevTools" as const }]),
      ],
    },
    {
      label: "Diagram",
      submenu: [
        { label: "Inventory Table…", ...shown("Alt+CmdOrCtrl+T"), click: cmd({ type: "inventory" }) },
        { label: "Import Diagram from Text…", ...shown("Alt+CmdOrCtrl+U"), click: cmd({ type: "importText" }) },
        { label: "Version History…", ...shown("Alt+CmdOrCtrl+V"), click: cmd({ type: "versionHistory" }) },
        { label: "Snap Selection to Grid", click: cmd({ type: "snapToGrid" }) },
        { type: "separator" },
        { label: "Save Selection as Stencil…", click: cmd({ type: "saveStencil" }) },
        { label: "Quick Save as Stencil", accelerator: "Alt+CmdOrCtrl+S", click: cmd({ type: "quickSaveStencil" }) },
        ...(isMac
          ? []
          : [
              { type: "separator" as const },
              { label: "Quick Connect Shortcuts…", click: cmd({ type: "quickConnectSettings" }) },
              { label: "Fonts…", click: cmd({ type: "fonts" }) },
            ]),
      ],
    },
    {
      label: "Window",
      submenu: [
        { label: "Next Tab", accelerator: "Ctrl+Tab", click: cmd({ type: "nextTab" }) },
        { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: cmd({ type: "prevTab" }) },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: cmd({ type: "selectTab", index: i }),
          visible: false,
        })),
        { type: "separator" },
        { role: "minimize" },
        ...(isMac ? [{ role: "front" as const }] : []),
      ],
    },
    {
      role: "help",
      submenu: [{ label: "mydraw Features and Shortcuts…", click: cmd({ type: "help" }) }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
