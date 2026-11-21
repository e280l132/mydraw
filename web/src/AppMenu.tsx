import { MainMenu } from "@excalidraw/excalidraw";
import type { MenuCommand, Settings } from "../../shared/types";
import {
  CheckOffIcon,
  CheckOnIcon,
  ClearIcon,
  CloseTabIcon,
  ExportIcon,
  NewIcon,
  OpenIcon,
  RecentIcon,
  SaveAsIcon,
  SaveIcon,
} from "./icons";

const MAX_RECENT_IN_MENU = 5;

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

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

interface Props {
  settings: Settings | null;
  onCommand(cmd: MenuCommand): void;
  onSettings(patch: Partial<Settings>): void;
}

export function AppMenu({ settings, onCommand, onSettings }: Props) {
  const recent = settings?.recentFiles.slice(0, MAX_RECENT_IN_MENU) ?? [];
  return (
    <MainMenu>
      <MainMenu.Item icon={<NewIcon />} onSelect={() => onCommand({ type: "new" })} shortcut="⌘N">
        New drawing
      </MainMenu.Item>
      <MainMenu.Item icon={<OpenIcon />} onSelect={() => onCommand({ type: "open" })} shortcut="⌘O">
        Open…
      </MainMenu.Item>
      <MainMenu.Item icon={<SaveIcon />} onSelect={() => onCommand({ type: "save" })} shortcut="⌘S">
        Save
      </MainMenu.Item>
      <MainMenu.Item icon={<SaveAsIcon />} onSelect={() => onCommand({ type: "saveAs" })} shortcut="⇧⌘S">
        Save as…
      </MainMenu.Item>
      <MainMenu.Item icon={<ExportIcon />} onSelect={() => onCommand({ type: "export" })} shortcut="⇧⌘E">
        Export…
      </MainMenu.Item>
      <MainMenu.Group title="Copy as">
        <MainMenu.Item onSelect={() => onCommand({ type: "copyAs", format: "png" })}>PNG image</MainMenu.Item>
        <MainMenu.Item onSelect={() => onCommand({ type: "copyAs", format: "svg" })}>SVG</MainMenu.Item>
        <MainMenu.Item onSelect={() => onCommand({ type: "copyAs", format: "mermaid" })}>Mermaid</MainMenu.Item>
      </MainMenu.Group>
      <MainMenu.Item icon={<CloseTabIcon />} onSelect={() => onCommand({ type: "closeTab" })} shortcut="⌘W">
        Close tab
      </MainMenu.Item>

      {recent.length > 0 && (
        <MainMenu.Group title="Open recent">
          {recent.map((p) => (
            <MainMenu.Item
              key={p}
              icon={<RecentIcon />}
              title={p}
              onSelect={() => onCommand({ type: "openRecent", path: p })}
            >
              {fileName(p).replace(/\.excalidraw$/i, "")}
            </MainMenu.Item>
          ))}
          <MainMenu.Item icon={<ClearIcon />} onSelect={() => onCommand({ type: "clearRecent" })}>
            Clear recent
          </MainMenu.Item>
        </MainMenu.Group>
      )}

      <MainMenu.Group title="Stencils">
        <MainMenu.Item onSelect={() => onCommand({ type: "toggleStencils" })} shortcut="⇧⌘Y">
          Show / hide stencils panel
        </MainMenu.Item>
        <MainMenu.Item onSelect={() => onCommand({ type: "saveStencil" })}>Save selection as stencil…</MainMenu.Item>
      </MainMenu.Group>

      <MainMenu.Separator />
      {settings && (
        <MainMenu.Group title="Preferences">
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
          <MainMenu.Item
            icon={settings.autosave ? <CheckOnIcon /> : <CheckOffIcon />}
            aria-checked={settings.autosave}
            role="menuitemcheckbox"
            onSelect={(e) => {
              e.preventDefault(); // keep the menu open so the change is visible
              onSettings({ autosave: !settings.autosave });
            }}
          >
            Autosave saved files
          </MainMenu.Item>
        </MainMenu.Group>
      )}

      <MainMenu.Separator />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.DefaultItems.ChangeCanvasBackground />
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Help />
    </MainMenu>
  );
}
