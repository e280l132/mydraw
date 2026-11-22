// Import a diagram from text (⌥⌘U): paste CSV, YAML or Mermaid, or pick a file. The text is
// laid out and built like `build_diagram` (see shared/importers.ts), as one undo step.
import { useState } from "react";
import type { ImportSummary } from "../../shared/types";

type Format = "csv" | "yaml" | "mermaid";

const EXAMPLES: Record<Format, { label: string; hint: string; sample: string }> = {
  csv: {
    label: "CSV",
    hint: "One row per device. Columns: name, type (icon search text), zone (\"Prod / DMZ\" nests), connects_to (names separated by ;), and any other column as a property (ip, hostname, vlan, role, owner, url, notes). Or a list of connections with from, to, label columns.",
    sample: "name,type,zone,ip,connects_to\nfirewall,Firewall,Edge,10.0.0.1,core\ncore,Switch,Prod,10.0.1.1,web-1;web-2\nweb-1,Server,Prod,10.0.1.10,\nweb-2,Server,Prod,10.0.1.11,",
  },
  yaml: {
    label: "YAML",
    hint: "The build_diagram spec as YAML. Nodes can be a list or a map; an edge can be written \"web -> db: SQL\" (also <-> and --). Options: direction (right/down), zones, per-node icon, zone, data.",
    sample: "direction: right\nzones:\n  prod: Production\nnodes:\n  users: Users\n  lb: { label: Load balancer, icon: load balancer, zone: prod }\n  web: { label: Web server, zone: prod, data: { ip: 10.0.0.5 } }\n  db: Database\nedges:\n  - users -> lb: HTTPS\n  - lb -> web\n  - web -> db: SQL",
  },
  mermaid: {
    label: "Mermaid",
    hint: "Flowcharts (flowchart / graph, subgraphs become zones) get the same layout as the other formats; other Mermaid diagram types are converted by Mermaid itself.",
    sample: "flowchart LR\n  A[Users] --> B[Load balancer]\n  subgraph Prod\n    B --> C[Web]\n    C --> D[(Database)]\n  end",
  },
};

interface Props {
  onClose(): void;
  onDone(message: string, error?: boolean): void;
}

export function ImportDialog({ onClose, onDone }: Props) {
  const [format, setFormat] = useState<Format>("csv");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ex = EXAMPLES[format];

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r: ImportSummary = await window.mydraw.importDiagram({ format, text });
      const counts = [r.nodes !== undefined ? `${r.nodes} node${r.nodes === 1 ? "" : "s"}` : null, r.edges !== undefined ? `${r.edges} connection${r.edges === 1 ? "" : "s"}` : null].filter(Boolean).join(", ");
      onDone(`Imported ${counts || "the diagram"}${r.warnings.length ? `. ${r.warnings[0]}${r.warnings.length > 1 ? ` (+${r.warnings.length - 1} more)` : ""}` : ""}`, false);
      onClose();
    } catch (e) {
      // Electron wraps errors from main as "Error invoking remote method '...': Error: <message>".
      setError((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ""));
      setBusy(false);
    }
  };

  const pick = async () => {
    try {
      const f = await window.mydraw.pickImportFile();
      if (!f) return;
      setText(f.text);
      if (f.format) setFormat(f.format);
      setError(null);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ""));
    }
  };

  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="md-modal md-import"
        role="dialog"
        aria-label="Import diagram"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim() && !busy) void run();
        }}
      >
        <h2>Import diagram from text</h2>
        <div className="md-seg" role="tablist">
          {(Object.keys(EXAMPLES) as Format[]).map((f) => (
            <button key={f} role="tab" aria-selected={format === f} className={format === f ? "on" : ""} onClick={() => setFormat(f)}>
              {EXAMPLES[f].label}
            </button>
          ))}
        </div>
        <p className="md-import-hint">{ex.hint}</p>
        <textarea
          className="md-import-text"
          autoFocus
          spellCheck={false}
          placeholder={ex.sample}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {error && <div className="md-import-error">{error}</div>}
        <div className="md-modal-actions">
          <button onClick={pick}>Choose file…</button>
          <button onClick={() => setText(ex.sample)}>Insert example</button>
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!text.trim() || busy} onClick={() => void run()} title="⌘Enter">
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
