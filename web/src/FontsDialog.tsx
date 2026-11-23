// Fonts dialog (menu Preferences → Fonts…, palette "Fonts…"): browse mydraw's extra fonts by
// category with a live preview, download more from the Google Fonts catalog, remove downloads, and
// keep fonts that came inside the open drawing. Picking a font for text stays in Excalidraw's own
// font picker, which lists all of these.
import { useEffect, useMemo, useState } from "react";
import { cssSafeFamily, type FontCategory, type FontEntry } from "../../shared/fonts";
import type { CatalogFont } from "../../shared/types";
import { customFonts, installCatalogFont, installEmbeddedFonts, onFontsChanged, removeInstalledFont } from "./fontRegistry";
import { Modal } from "./library/dialogs";

type Tab = FontCategory | "drawing" | "catalog";

const TABS: [Tab, string][] = [
  ["fun", "Fun"],
  ["professional", "Professional"],
  ["mono", "Mono"],
  ["catalog", "Download more"],
];

const SAMPLE = "Web tier → DB 10.0.1.5";
const CATALOG_LIMIT = 60;

interface Typeface {
  typeface: string;
  category: FontCategory;
  faces: (FontEntry & { removed?: boolean })[];
  source: FontEntry["source"];
}

function typefaces(): Typeface[] {
  const map = new Map<string, Typeface>();
  for (const f of customFonts()) {
    const key = `${f.source}:${f.typeface}`;
    let t = map.get(key);
    if (!t) map.set(key, (t = { typeface: f.typeface, category: f.category, faces: [], source: f.source }));
    t.faces.push(f);
  }
  for (const t of map.values()) t.faces.sort((a, b) => a.weight - b.weight);
  return [...map.values()].sort((a, b) => a.typeface.localeCompare(b.typeface));
}

const SOURCE_BADGE: Record<FontEntry["source"], string> = { builtin: "built in", catalog: "downloaded", embedded: "in this drawing" };

/** Weights ticked by default for a catalog font: regular and bold where it has them. */
function defaultWeights(weights: number[]): number[] {
  const pick = weights.filter((w) => w === 400 || w === 700);
  return pick.length ? pick : weights.slice(0, 1);
}

export function FontsDialog({
  drawingFamilies,
  onClose,
  onDone,
}: {
  /** Families the active drawing's text uses (to list the fonts that came with it). */
  drawingFamilies: string[];
  onClose(): void;
  onDone(msg: string, error?: boolean): void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => onFontsChanged(() => setTick((n) => n + 1)), []);
  const all = typefaces();
  const fromDrawing = all.filter((t) => t.source === "embedded" && t.faces.some((f) => drawingFamilies.includes(f.family)));
  const tabs: [Tab, string][] = fromDrawing.length ? [...TABS.slice(0, 3), ["drawing", "In this drawing"], TABS[3]] : TABS;

  const [chosenTab, setTab] = useState<Tab>(fromDrawing.length ? "drawing" : "fun");
  // Once the drawing's fonts are installed its tab goes away.
  const tab: Tab = chosenTab === "drawing" && !fromDrawing.length ? "fun" : chosenTab;
  const [sample, setSample] = useState(SAMPLE);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // catalog
  const [catalog, setCatalog] = useState<CatalogFont[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | FontCategory>("all");
  const [weights, setWeights] = useState<Record<string, number[]>>({});

  useEffect(() => {
    if (tab !== "catalog" || catalog) return;
    window.mydraw
      .fontCatalog()
      .then(setCatalog)
      .catch((e: Error) => setCatalogError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")));
  }, [tab, catalog]);

  const installedTypefaces = useMemo(() => new Map(all.filter((t) => t.source !== "embedded").map((t) => [t.typeface, t.source])), [all]);

  const catalogShown = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog
      .filter((f) => (kind === "all" || f.category === kind) && (!q || f.family.toLowerCase().includes(q) || f.style.includes(q)))
      .sort((a, b) => {
        // exact and prefix matches first
        if (q) {
          const ra = a.family.toLowerCase() === q ? 0 : a.family.toLowerCase().startsWith(q) ? 1 : 2;
          const rb = b.family.toLowerCase() === q ? 0 : b.family.toLowerCase().startsWith(q) ? 1 : 2;
          if (ra !== rb) return ra - rb;
        }
        return a.family.localeCompare(b.family);
      });
  }, [catalog, query, kind]);

  async function run(key: string, job: () => Promise<string>) {
    setBusy(key);
    try {
      onDone(await job());
    } catch (e) {
      onDone((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), true);
    } finally {
      setBusy(null);
      setConfirmRemove(null);
    }
  }

  const install = (f: CatalogFont) =>
    run(f.id, async () => {
      const names = await installCatalogFont(f.id, weights[f.id] ?? defaultWeights(f.weights));
      return names.length ? `Installed ${names.join(", ")}: pick it in the font list of any text` : `${f.family} is already installed`;
    });

  const remove = (t: Typeface) =>
    run(`rm:${t.typeface}`, async () => {
      const names = await removeInstalledFont(t.typeface);
      return `Removed ${names.join(", ")}. Drawings that use it keep their own copy.`;
    });

  const keep = (t: Typeface) =>
    run(`keep:${t.typeface}`, async () => {
      const names = await installEmbeddedFonts(t.faces.map((f) => f.family));
      return names.length ? `Installed ${names.join(", ")} for all drawings` : "Nothing to install";
    });

  const rows = tab === "drawing" ? fromDrawing : all.filter((t) => t.category === tab && t.source !== "embedded");

  return (
    <Modal title="Fonts" onClose={busy ? () => {} : onClose} width={640}>
      <div className="md-fonts">
        <p className="md-form-note">
          Choose a font for text in the font list of the left panel (it lists all of these). A drawing carries the fonts it uses inside its file, so it
          looks the same on any machine.
        </p>
        <div className="md-seg md-fonts-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" className={`md-fonts-tab${tab === id ? " on" : ""}`} data-tab={id} aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab !== "catalog" && (
          <>
            <input className="md-fonts-sample" value={sample} onChange={(e) => setSample(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Preview text" placeholder="Preview text" />
            <div className="md-fonts-list">
              {rows.map((t) => (
                <div key={`${t.source}:${t.typeface}`} className="md-font-row" data-typeface={t.typeface} data-source={t.source}>
                  <div className="md-font-body">
                    <div className="md-font-title">
                      {t.typeface} <span className="md-badge">{SOURCE_BADGE[t.source]}</span>
                      {t.faces.every((f) => f.removed) && <span className="md-badge">removed (until restart)</span>}
                    </div>
                    <div className="md-font-preview" style={{ fontFamily: `"${t.faces[0].family}", sans-serif` }}>
                      {sample || SAMPLE}
                    </div>
                    <div className="md-font-weights">
                      {t.faces.map((f) => (
                        <span key={f.id} className="md-font-weight" style={{ fontFamily: `"${f.family}", sans-serif` }} title={f.family}>
                          {f.family}
                        </span>
                      ))}
                    </div>
                  </div>
                  {t.source === "catalog" &&
                    !t.faces.every((f) => f.removed) &&
                    (confirmRemove === t.typeface ? (
                      <span className="md-pack-confirm">
                        <button className="danger" disabled={!!busy} onClick={() => void remove(t)}>
                          Remove
                        </button>
                        <button disabled={!!busy} onClick={() => setConfirmRemove(null)}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button className="md-pack-remove md-font-remove" disabled={!!busy} onClick={() => setConfirmRemove(t.typeface)}>
                        Remove…
                      </button>
                    ))}
                  {t.source === "embedded" && (
                    <button className="md-font-keep" disabled={!!busy || !t.faces.some((f) => f.files.length)} onClick={() => void keep(t)} title="Install it so every drawing can use it">
                      {busy === `keep:${t.typeface}` ? "Installing…" : "Install"}
                    </button>
                  )}
                </div>
              ))}
              {!rows.length && <div className="md-panel-empty">{tab === "mono" || tab === "fun" || tab === "professional" ? "No fonts here yet: download some." : "None."}</div>}
            </div>
          </>
        )}

        {tab === "catalog" && (
          <>
            <div className="md-packs-tools">
              <input
                type="search"
                className="md-packs-search md-fonts-search"
                placeholder="Search Google Fonts (e.g. playfair, handwriting, mono)…"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <select className="md-packs-sort" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Kind of font">
                <option value="all">All</option>
                <option value="fun">Fun (handwriting, display)</option>
                <option value="professional">Professional (sans, serif)</option>
                <option value="mono">Mono</option>
              </select>
            </div>
            <div className="md-fonts-list">
              {catalogShown.slice(0, CATALOG_LIMIT).map((f) => {
                const have = installedTypefaces.get(cssSafeFamily(f.family));
                const chosen = weights[f.id] ?? defaultWeights(f.weights);
                return (
                  <div key={f.id} className="md-font-row" data-catalog={f.id}>
                    <div className="md-font-body">
                      <div className="md-font-title">
                        {f.family} {have && <span className="md-badge">{have === "builtin" ? "built in" : "installed"}</span>}
                      </div>
                      <div className="md-pack-meta">
                        {f.style} · {f.license}
                      </div>
                      {!have && (
                        <div className="md-font-weights">
                          {f.weights.map((w) => (
                            <label key={w} className="md-font-wcheck">
                              <input
                                type="checkbox"
                                checked={chosen.includes(w)}
                                disabled={!!busy}
                                onChange={() =>
                                  setWeights((s) => ({
                                    ...s,
                                    [f.id]: chosen.includes(w) ? chosen.filter((x) => x !== w) : [...chosen, w].sort((a, b) => a - b),
                                  }))
                                }
                              />
                              {w}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    {!have && (
                      <button className="primary md-font-install" disabled={!!busy || !chosen.length} onClick={() => void install(f)}>
                        {busy === f.id ? "Downloading…" : "Install"}
                      </button>
                    )}
                  </div>
                );
              })}
              {catalog && catalogShown.length > CATALOG_LIMIT && (
                <div className="md-panel-empty">
                  {catalogShown.length - CATALOG_LIMIT} more: type to narrow the list.
                </div>
              )}
              {catalog && !catalogShown.length && <div className="md-panel-empty">No fonts match “{query}”.</div>}
              {!catalog && !catalogError && <div className="md-panel-empty">Loading the catalog…</div>}
              {catalogError && <div className="md-panel-empty md-error">{catalogError}</div>}
            </div>
            <p className="md-form-note">Free fonts from Google Fonts (via Fontsource), open licences only. Weights are separate entries in the font list (“Lato Bold”).</p>
          </>
        )}

        <div className="md-modal-actions">
          <button onClick={onClose} disabled={!!busy}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
