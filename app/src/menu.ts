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

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
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
        { label: "Export Image…", accelerator: "CmdOrCtrl+Shift+E", click: cmd({ type: "export" }) },
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
        { label: "Save Selection as Stencil…", click: cmd({ type: "saveStencil" }) },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Stencils Panel", accelerator: "CmdOrCtrl+Shift+Y", click: cmd({ type: "toggleStencils" }) },
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
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
