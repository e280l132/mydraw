import { useEffect, useState, type ReactNode } from "react";
import { EXCALIDRAW_LIBRARY_COLLECTION, MY_STENCILS, type LibraryIndex, type LibraryItem } from "../../../shared/library";
import type { PackStatus } from "../../../shared/types";
import type { StencilContent } from "./stencilContent";

const bridge = window.mydraw;

function Modal({ title, onClose, children, width }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
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
  const own = (index?.collections ?? []).filter((c) => !c.managed && c.name !== EXCALIDRAW_LIBRARY_COLLECTION).map((c) => c.name);
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

  useEffect(() => {
    void bridge.libraryPacks().then((p) => {
      setPacks(p);
      setChosen(new Set(p.filter((x) => !x.installed).map((x) => x.id)));
    });
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
      if (!failed.length) onClose();
    } catch (e) {
      onDone((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Download icon packs" onClose={busy ? () => {} : onClose} width={560}>
      <p className="md-form-note">
        Official icon sets are downloaded from each vendor into your library folder (not bundled with the app). They are
        for use in your own diagrams; see LICENSES.md in the library folder.
      </p>
      <div className="md-packs">
        {(packs ?? []).map((p) => (
          <label key={p.id} className="md-pack">
            <input type="checkbox" checked={chosen.has(p.id)} disabled={busy} onChange={() => toggle(p.id)} />
            <div>
              <div className="md-pack-title">
                {p.title} {p.installed && <span className="md-badge">installed</span>}
              </div>
              <div className="md-pack-desc">{p.description}</div>
              <div className="md-pack-meta">
                ~{p.approxMB} MB · {p.license}
              </div>
            </div>
          </label>
        ))}
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
          {busy ? "Downloading…" : `Download ${chosen.size} pack(s) (~${totalMB} MB)`}
        </button>
      </div>
    </Modal>
  );
}
