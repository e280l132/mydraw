import { useEffect, useState, type ReactNode } from "react";
import { MY_STENCILS, type LibraryIndex, type LibraryItem } from "../../../shared/library";
import { filterAndSortPacks, type PackSort } from "../../../shared/packList";
import type { PackStatus } from "../../../shared/types";
import type { StencilContent } from "./stencilContent";

const bridge = window.mydraw;

export function Modal({ title, onClose, children, width }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="md-modal" role="dialog" aria-label={title} style={width ? { width } : undefined}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------- save selection as stencil ----------

export function SaveStencilDialog({
  index,
  selection,
  onClose,
  onSaved,
}: {
  index: LibraryIndex | null;
  selection: StencilContent & { suggestedName: string };
  onClose(): void;
  onSaved(message: string): void;
}) {
  // Collections made only of imported .excalidrawlib packs are read-only: shapes can't be saved into them.
  const packOnly = (name: string) => {
    const items = (index?.items ?? []).filter((i) => i.collection === name);
    return items.length > 0 && items.every((i) => i.kind === "xlib");
  };
  const own = (index?.collections ?? []).filter((c) => !c.managed && !packOnly(c.name)).map((c) => c.name);
  const collections = own.includes(MY_STENCILS) ? own : [MY_STENCILS, ...own];
  const [name, setName] = useState(selection.suggestedName);
  const [collection, setCollection] = useState(MY_STENCILS);
  const [newCollection, setNewCollection] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const NEW = "__new__";

  async function save() {
    const target = collection === NEW ? newCollection.trim() : collection;
    if (!target) return setError("Enter a collection name");
    try {
      await bridge.librarySaveStencil({
        collection: target,
        name: name.trim() || "Stencil",
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        elements: selection.elements,
        files: Object.fromEntries(selection.files.map((f) => [f.id, f])),
      });
      onSaved(`Saved “${name.trim() || "Stencil"}” to ${target}`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal title="Save selection as stencil" onClose={onClose} width={420}>
      <form
        className="md-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Collection
          <select value={collection} onChange={(e) => setCollection(e.target.value)}>
            {collections.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={NEW}>New collection…</option>
          </select>
        </label>
        {collection === NEW && (
          <label>
            New collection name
            <input value={newCollection} onChange={(e) => setNewCollection(e.target.value)} placeholder="e.g. Homelab" />
          </label>
        )}
        <label>
          Tags <small>(comma separated, used by search)</small>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. firewall, ha pair" />
        </label>
        <p className="md-form-note">
          {selection.elements.length} element(s){selection.files.length ? `, ${selection.files.length} image(s)` : ""}. Saved to
          your library folder and available in every drawing.
        </p>
        {error && <div className="md-error">{error}</div>}
        <div className="md-modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save stencil
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- rename ----------

export function RenameDialog({ item, onClose, onDone }: { item: LibraryItem; onClose(): void; onDone(msg: string, error?: boolean): void }) {
  const [name, setName] = useState(item.name);
  return (
    <Modal title="Rename stencil" onClose={onClose} width={380}>
      <form
        className="md-form"
        onSubmit={(e) => {
          e.preventDefault();
          bridge.libraryRename(item.id, name).then(
            () => (onDone(`Renamed to “${name}”`), onClose()),
            (err: Error) => onDone(err.message, true),
          );
        }}
      >
        <label>
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        <div className="md-modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Rename
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- icon packs ----------

export function PacksDialog({ onClose, onDone }: { onClose(): void; onDone(msg: string, error?: boolean): void }) {
  const [packs, setPacks] = useState<PackStatus[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PackSort>("name");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    void bridge.libraryPacks().then(setPacks);
    return bridge.onPackProgress((m) => setLog((l) => [...l, m]));
  }, []);

  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const totalMB = (packs ?? []).filter((p) => chosen.has(p.id)).reduce((a, p) => a + p.approxMB, 0);
  const shown = filterAndSortPacks(packs ?? [], query, sort);

  async function install() {
    setBusy(true);
    setLog([]);
    try {
      const res = await bridge.libraryInstallPacks([...chosen]);
      const ok = res.filter((r) => r.ok);
      const failed = res.filter((r) => !r.ok);
      const icons = ok.reduce((a, r) => a + (r.count ?? 0), 0);
      onDone(
        failed.length
          ? `Installed ${ok.length} pack(s); ${failed.length} failed: ${failed.map((f) => `${f.pack} (${f.error})`).join("; ")}`
          : `Installed ${icons.toLocaleString()} icons`,
        failed.length > 0,
      );
      setPacks(await bridge.libraryPacks());
      setChosen(new Set());
      if (!failed.length) onClose();
    } catch (e) {
      onDone((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: PackStatus) {
    setBusy(true);
    try {
      await bridge.libraryUninstallPack(p.id);
      onDone(`Removed ${p.title}`);
      setPacks(await bridge.libraryPacks());
      setChosen((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    } catch (e) {
      onDone((e as Error).message, true);
    } finally {
      setConfirmRemove(null);
      setBusy(false);
    }
  }

  return (
    <Modal title="Icon packs" onClose={busy ? () => {} : onClose} width={560}>
      <p className="md-form-note">
        Icon sets are downloaded into your library folder (not bundled with the app) for use in your own diagrams; see
        LICENSES.md in the library folder. Tick the packs to download, or remove an installed one.
      </p>
      <div className="md-packs-tools">
        <input
          type="search"
          className="md-packs-search"
          placeholder="Search packs (e.g. proxmox, aws, logos)…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="md-packs-sort" value={sort} onChange={(e) => setSort(e.target.value as PackSort)} aria-label="Sort packs">
          <option value="name">Name</option>
          <option value="size-asc">Smallest first</option>
          <option value="size-desc">Largest first</option>
          <option value="installed">Installed first</option>
        </select>
      </div>
      <div className="md-packs">
        {shown.map((p) => (
          <div key={p.id} className="md-pack" data-pack={p.id}>
            <input
              type="checkbox"
              id={`md-pack-${p.id}`}
              checked={chosen.has(p.id)}
              disabled={busy}
              onChange={() => toggle(p.id)}
              aria-label={p.title}
            />
            <label htmlFor={`md-pack-${p.id}`} className="md-pack-body">
              <div className="md-pack-title">
                {p.title} {p.installed && <span className="md-badge">installed</span>}
              </div>
              <div className="md-pack-desc">{p.description}</div>
              <div className="md-pack-meta">
                ~{p.approxMB} MB · {p.license}
              </div>
            </label>
            {p.installed &&
              (confirmRemove === p.id ? (
                <span className="md-pack-confirm">
                  <button className="danger" disabled={busy} onClick={() => void remove(p)}>
                    Remove
                  </button>
                  <button disabled={busy} onClick={() => setConfirmRemove(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button className="md-pack-remove" disabled={busy} onClick={() => setConfirmRemove(p.id)} title="Delete this pack from your library folder">
                  Remove…
                </button>
              ))}
          </div>
        ))}
        {packs && !shown.length && <div className="md-panel-empty">No packs match “{query}”.</div>}
        {!packs && <div className="md-panel-empty">Loading…</div>}
      </div>
      {log.length > 0 && (
        <div className="md-pack-log">
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      <div className="md-modal-actions">
        <button onClick={onClose} disabled={busy}>
          Close
        </button>
        <button className="primary" disabled={busy || !chosen.size} onClick={() => void install()}>
          {busy ? "Working…" : chosen.size ? `Download ${chosen.size} pack(s) (~${totalMB} MB)` : "Download"}
        </button>
      </div>
    </Modal>
  );
}
