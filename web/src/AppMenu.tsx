import { useState, type ReactElement, type ReactNode } from "react";
import { MainMenu } from "@excalidraw/excalidraw";
import type { MenuCommand, Settings } from "../../shared/types";
import { sc } from "../../shared/shortcuts";
import { APP_VERSION, APP_VERSION_LABEL } from "../../shared/appVersion";
import {
  CheckOffIcon,
  CheckOnIcon,
  ChevronIcon,
  CloseTabIcon,
  DiagramIcon,
  ExportIcon,
  HelpIcon,
  NewIcon,
  OpenIcon,
  RecentIcon,
  SaveAsIcon,
  SaveIcon,
  SettingsIcon,
  ViewIcon,
} from "./icons";

const MAX_RECENT_IN_MENU = 5;
/** Which collapsible section is open (one at a time); "" = none. */
const OPEN_SECTION_KEY = "mydraw.menuSection";

type SectionId = "recent" | "view" | "diagram" | "preferences";

interface SegProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
}

/** A labelled row of segmented buttons inside the menu (like Excalidraw's "Canvas background"). */
function SegmentRow<T extends string>({ label, value, options, onChange }: SegProps<T>) {
  return (
    <MainMenu.ItemCustom className="md-menu-row">
      <div className="md-menu-row-label">{label}</div>
      <div className="md-seg md-seg-compact" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "on" : ""}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </MainMenu.ItemCustom>
  );
}

/** A label with a row of action chips on one line ("Copy as  PNG  SVG  Mermaid"). */
function ChipRow({ label, actions }: { label: string; actions: { label: string; run(): void }[] }) {
  return (
    <MainMenu.ItemCustom className="md-menu-row md-menu-row-inline">
      <div className="md-menu-row-label">{label}</div>
      <div className="md-seg md-seg-compact" role="group" aria-label={label}>
        {actions.map((a) => (
          <button key={a.label} onClick={a.run}>
            {a.label}
          </button>
        ))}
      </div>
    </MainMenu.ItemCustom>
  );
}

/** A menu row with a check mark that keeps the menu open (so the change is visible). */
function CheckItem({
  checked,
  shortcut,
  onToggle,
  children,
}: {
  checked: boolean;
  shortcut?: string;
  onToggle(): void;
  children: string;
}) {
  return (
    <MainMenu.Item
      icon={checked ? <CheckOnIcon /> : <CheckOffIcon />}
      aria-checked={checked}
      role="menuitemcheckbox"
      shortcut={shortcut}
      onSelect={(e) => {
        e.preventDefault();
        onToggle();
      }}
    >
      {children}
    </MainMenu.Item>
  );
}

/**
 * A collapsible menu section: a header row with a chevron, its rows indented below it when open.
 * Excalidraw 0.18's MainMenu has no submenus, so this stands in for them. Only one section is
 * open at a time, which keeps the menu short.
 */
function Section({
  id,
  label,
  icon,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  label: string;
  icon: ReactElement;
  open: boolean;
  onToggle(id: SectionId): void;
  children: ReactNode;
}) {
  return (
    <>
      <MainMenu.Item
        icon={icon}
        className={`md-menu-section${open ? " open" : ""}`}
        data-section={id}
        aria-expanded={open}
        onSelect={(e) => {
          e.preventDefault(); // expand in place, keep the menu open
          onToggle(id);
        }}
      >
        <span className="md-menu-section-label">
          {label}
          <ChevronIcon />
        </span>
      </MainMenu.Item>
      {open && (
        <div className="md-menu-section-body" data-section-body={id}>
          {children}
        </div>
      )}
    </>
  );
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Which of mydraw's side panels are open (for the View check marks). */
export interface MenuPanels {
  stencils: boolean;
  pages: boolean;
  lint: boolean;
  pinned: boolean;
}

interface Props {
  settings: Settings | null;
  panels: MenuPanels;
  onCommand(cmd: MenuCommand): void;
  onSettings(patch: Partial<Settings>): void;
}

// Top level: file actions, export, then three collapsed sections (View, Diagram, Preferences)
// and help. The native menu bar (app/src/menu.ts) uses the same grouping.
export function AppMenu({ settings, panels, onCommand, onSettings }: Props) {
  const recent = settings?.recentFiles.slice(0, MAX_RECENT_IN_MENU) ?? [];
  const [openSection, setOpenSection] = useState<string>(() => localStorage.getItem(OPEN_SECTION_KEY) ?? "");
  const toggle = (id: SectionId) =>
    setOpenSection((cur) => {
      const next = cur === id ? "" : id;
      localStorage.setItem(OPEN_SECTION_KEY, next);
      return next;
    });
  const run = (cmd: MenuCommand) => () => onCommand(cmd);

  return (
    <MainMenu>
      <MainMenu.Item icon={<NewIcon />} onSelect={run({ type: "new" })} shortcut={sc("newDrawing")}>
        New drawing
      </MainMenu.Item>
      <MainMenu.Item icon={<OpenIcon />} onSelect={run({ type: "open" })} shortcut={sc("openFile")}>
        Open…
      </MainMenu.Item>
      {recent.length > 0 && (
        <Section id="recent" label="Open recent" icon={<RecentIcon />} open={openSection === "recent"} onToggle={toggle}>
          {recent.map((p) => (
            <MainMenu.Item key={p} title={p} onSelect={run({ type: "openRecent", path: p })}>
              {fileName(p).replace(/\.excalidraw$/i, "")}
            </MainMenu.Item>
          ))}
          <MainMenu.Item className="md-menu-muted" onSelect={run({ type: "clearRecent" })}>
            Clear recent
          </MainMenu.Item>
        </Section>
      )}
      <MainMenu.Item icon={<SaveIcon />} onSelect={run({ type: "save" })} shortcut={sc("save")}>
        Save
      </MainMenu.Item>
      <MainMenu.Item icon={<SaveAsIcon />} onSelect={run({ type: "saveAs" })} shortcut={sc("saveAs")}>
        Save as…
      </MainMenu.Item>
      <MainMenu.Item icon={<ExportIcon />} onSelect={run({ type: "export" })} shortcut={sc("export")}>
        Export…
      </MainMenu.Item>
      <ChipRow
        label="Copy as"
        actions={[
          { label: "PNG", run: run({ type: "copyAs", format: "png" }) },
          { label: "SVG", run: run({ type: "copyAs", format: "svg" }) },
          { label: "Mermaid", run: run({ type: "copyAs", format: "mermaid" }) },
        ]}
      />
      <MainMenu.Item icon={<CloseTabIcon />} onSelect={run({ type: "closeTab" })} shortcut={sc("closeTab")}>
        Close tab
      </MainMenu.Item>

      <MainMenu.Separator />
      <Section id="view" label="View" icon={<ViewIcon />} open={openSection === "view"} onToggle={toggle}>
        <CheckItem checked={panels.stencils} shortcut={sc("stencils")} onToggle={run({ type: "toggleStencils" })}>
          Stencils panel
        </CheckItem>
        <CheckItem checked={panels.pages} shortcut={sc("pages")} onToggle={run({ type: "togglePages" })}>
          Pages panel
        </CheckItem>
        <CheckItem checked={panels.lint} shortcut={sc("lint")} onToggle={run({ type: "toggleLint" })}>
          Diagram lint
        </CheckItem>
        <CheckItem checked={panels.pinned} onToggle={run({ type: "togglePinPanel" })}>
          Pin style panel
        </CheckItem>
        <CheckItem checked={!!settings?.grid.enabled} shortcut={sc("grid")} onToggle={run({ type: "toggleGrid" })}>
          Grid
        </CheckItem>
        <MainMenu.Item onSelect={run({ type: "gridSettings" })}>Grid settings…</MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "present" })} shortcut={sc("present")}>
          Start presentation
        </MainMenu.Item>
      </Section>
      <Section id="diagram" label="Diagram" icon={<DiagramIcon />} open={openSection === "diagram"} onToggle={toggle}>
        <MainMenu.Item onSelect={run({ type: "findReplace" })} shortcut={sc("findReplace")}>
          Find and replace…
        </MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "inventory" })} shortcut={sc("inventory")}>
          Inventory table…
        </MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "importText" })} shortcut={sc("importText")}>
          Import from text…
        </MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "versionHistory" })} shortcut={sc("versionHistory")}>
          Version history…
        </MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "tidyLayout" })}>Tidy</MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "relayout" })}>Re-layout</MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "snapToGrid" })}>Snap selection to grid</MainMenu.Item>
        <MainMenu.Item onSelect={run({ type: "saveStencil" })}>Save selection as stencil…</MainMenu.Item>
      </Section>
      {settings && (
        <Section
          id="preferences"
          label="Preferences"
          icon={<SettingsIcon />}
          open={openSection === "preferences"}
          onToggle={toggle}
        >
          <SegmentRow
            label="Theme"
            value={settings.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(theme) => onSettings({ theme })}
          />
          <SegmentRow
            label="Drawing style"
            value={settings.drawingStyle}
            options={[
              { value: "clean", label: "Clean" },
              { value: "sketch", label: "Sketch" },
            ]}
            onChange={(drawingStyle) => onSettings({ drawingStyle })}
          />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <CheckItem checked={settings.autosave} onToggle={() => onSettings({ autosave: !settings.autosave })}>
            Autosave saved files
          </CheckItem>
          <MainMenu.Item onSelect={run({ type: "quickConnectSettings" })}>Quick connect shortcuts…</MainMenu.Item>
          <MainMenu.Item onSelect={run({ type: "fonts" })}>Fonts…</MainMenu.Item>
          <MainMenu.Item onSelect={run({ type: "setup" })}>Command line & Claude Code…</MainMenu.Item>
          <CheckItem checked={settings.updates.check} onToggle={() => onSettings({ updates: { ...settings.updates, check: !settings.updates.check } })}>
            Check for updates automatically
          </CheckItem>
        </Section>
      )}

      <MainMenu.Separator />
      <MainMenu.Item onSelect={run({ type: "commandPalette" })} shortcut={sc("palette")}>
        Command palette…
      </MainMenu.Item>
      <MainMenu.Item icon={<HelpIcon />} onSelect={run({ type: "help" })}>
        mydraw features and shortcuts…
      </MainMenu.Item>
      <MainMenu.DefaultItems.Help />
      <MainMenu.Item onSelect={run({ type: "checkUpdates" })}>
        <span className="md-menu-version" data-md-version={APP_VERSION}>
          mydraw {APP_VERSION_LABEL} · Check for updates…
        </span>
      </MainMenu.Item>

      <MainMenu.Separator />
      <MainMenu.DefaultItems.ClearCanvas />
    </MainMenu>
  );
}
