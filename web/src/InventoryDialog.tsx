// Inventory table (⌥⌘T): every node of the drawing in an editable grid. Sort by clicking a header,
// filter with the search box; edits go straight to the diagram (name -> label, the rest -> the
// node's properties). "Export CSV…" hands over to the export dialog.
import { useEffect, useMemo, useReducer, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { PropertyKey } from "../../shared/properties";
import { filterRows, sortRows, type SortDir, type SortKey } from "../../shared/inventoryTable";
import { readInventory, renameNode, revealNode, setNodeProperty } from "./inventoryOps";

interface Props {
  api: ExcalidrawImperativeAPI;
  onExportCsv(): void;
  onClose(): void;
}

const EDITABLE: Array<{ key: "name" | PropertyKey; label: string; wide?: boolean }> = [
  { key: "name", label: "Name" },
  { key: "ip", label: "IP" },
  { key: "hostname", label: "Hostname" },
  { key: "vlan", label: "VLAN" },
  { key: "role", label: "Role" },
  { key: "owner", label: "Owner" },
  { key: "url", label: "URL" },
  { key: "notes", label: "Notes", wide: true },
];

export function InventoryDialog({ api, onExportCsv, onClose }: Props) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  // Follow edits made in the drawing while the table is open (at most every 250 ms).
  useEffect(() => {
    let timer: number | undefined;
    const off = api.onChange(() => {
      if (timer === undefined) timer = window.setTimeout(() => ((timer = undefined), refresh()), 250);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [api]);

  const all = readInventory(api);
  const rows = useMemo(() => {
    const filtered = filterRows(all, filter);
    return sort ? sortRows(filtered, sort.key, sort.dir) : filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(all), filter, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (!s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  const arrow = (key: SortKey) => (sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  const commit = (id: string, key: "name" | PropertyKey, before: string, el: HTMLInputElement) => {
    const value = el.value.trim();
    if (value === before) return;
    if (key === "name") renameNode(api, id, value);
    else setNodeProperty(api, id, key, value);
    refresh();
  };

  return (
    <div className="md-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="md-modal md-inv"
        role="dialog"
        aria-label="Inventory"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose();
        }}
      >
        <div className="md-inv-head">
          <h2>Inventory</h2>
          <input className="md-inv-filter" placeholder="Filter…" spellCheck={false} value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
          <span className="md-inv-count">{rows.length === all.length ? `${all.length} nodes` : `${rows.length} of ${all.length}`}</span>
        </div>
        <div className="md-inv-scroll">
          <table className="md-inv-table">
            <thead>
              <tr>
                <th />
                {EDITABLE.slice(0, 1).map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key as SortKey)}>
                    {c.label}
                    {arrow(c.key as SortKey)}
                  </th>
                ))}
                <th onClick={() => toggleSort("kind")}>Kind{arrow("kind")}</th>
                <th onClick={() => toggleSort("zone")}>Zone{arrow("zone")}</th>
                {EDITABLE.slice(1).map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key as SortKey)}>
                    {c.label}
                    {arrow(c.key as SortKey)}
                  </th>
                ))}
                <th>Other</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cell = (key: "name" | PropertyKey, wide?: boolean) => (
                  <td key={key}>
                    <input
                      className={`md-inv-cell${wide ? " wide" : ""}`}
                      data-row={r.id}
                      data-col={key}
                      aria-label={`${key} of ${r.name || "node"}`}
                      defaultValue={r[key]}
                      key={`${r.id}:${key}:${r[key]}`}
                      spellCheck={false}
                      onBlur={(e) => commit(r.id, key, r[key], e.currentTarget)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") {
                          e.currentTarget.value = r[key];
                          e.currentTarget.blur();
                        }
                      }}
                    />
                  </td>
                );
                return (
                  <tr key={r.id}>
                    <td>
                      <button className="md-inv-show" title="Select in the drawing" aria-label={`Show ${r.name || "node"}`} onClick={() => (revealNode(api, r.id), onClose())}>
                        ◎
                      </button>
                    </td>
                    {cell("name")}
                    <td className="md-inv-ro">{r.kind}</td>
                    <td className="md-inv-ro">{r.zone}</td>
                    {EDITABLE.slice(1).map((c) => cell(c.key, c.wide))}
                    <td className="md-inv-ro">{Object.entries(r.extra).map(([k, v]) => `${k}: ${v}`).join("; ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <div className="md-inv-empty">{all.length ? "No rows match the filter." : "No nodes yet: labelled shapes and icon nodes appear here."}</div>}
        </div>
        <div className="md-modal-actions">
          <button onClick={onExportCsv} disabled={!all.length}>
            Export CSV…
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
