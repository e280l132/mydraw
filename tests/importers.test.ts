import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "../shared/csv";
import { csvToSpec, importFormatForPath, yamlToSpec } from "../shared/importers";
import { normalizeSpec } from "../shared/diagram";

describe("parseCsv", () => {
  it("parses quotes, escaped quotes and line breaks inside cells", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n"line1\nline2",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["line1\nline2", "z"],
    ]);
  });
  it("handles CRLF, a BOM, blank lines and a missing final newline", () => {
    expect(parseCsv("﻿a,b\r\n\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("detects semicolons and tabs", () => {
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb")).toBe("\t");
    expect(detectDelimiter('"a,b";c')).toBe(";");
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("keeps empty cells", () => {
    expect(parseCsv("a,b,c\n1,,3")[1]).toEqual(["1", "", "3"]);
  });
});

describe("csvToSpec: host list", () => {
  const csv = [
    "name,type,zone,ip,hostname,owner,connects_to",
    'core,Switch,Prod / DMZ,10.0.0.1,core-1,net,"web-1; web-2"',
    "web-1,Server,Prod / DMZ,10.0.0.10,,app,",
    "web-2,Server,Prod,10.0.0.11,,app,core",
  ].join("\n");

  it("builds nodes with icons, properties and nested zones", () => {
    const { spec, warnings } = csvToSpec(csv);
    const nodes = spec.nodes as Array<Record<string, unknown>>;
    expect(nodes.map((n) => n.id)).toEqual(["core", "web-1", "web-2"]);
    expect(nodes[0]).toMatchObject({ label: "core", icon: "Switch", data: { ip: "10.0.0.1", hostname: "core-1", owner: "net" } });
    expect(nodes[1].data).toEqual({ ip: "10.0.0.10", owner: "app" });
    const zones = spec.zones as Array<Record<string, unknown>>;
    expect(zones.map((z) => [z.label, z.parent])).toEqual([
      ["Prod", undefined],
      ["DMZ", "z-prod"],
    ]);
    expect(nodes[0].zone).toBe("z-prod-dmz");
    expect(nodes[2].zone).toBe("z-prod");
    expect(warnings).toEqual([]);
  });

  it("links by name and merges links listed from both ends", () => {
    const edges = csvToSpec(csv).spec.edges as Array<Record<string, unknown>>;
    expect(edges).toEqual([
      { from: "core", to: "web-1" },
      { from: "core", to: "web-2", arrow: "both" },
    ]);
  });

  it("adds unknown link targets as nodes with a warning", () => {
    const { spec, warnings } = csvToSpec("name,connects_to\na,Internet");
    expect((spec.nodes as unknown[]).length).toBe(2);
    expect(warnings[0]).toMatch(/Internet.*not listed/);
  });

  it("uses a hostname column as the name and as the hostname property", () => {
    const nodes = csvToSpec("hostname,ip\nrouter-1,10.0.0.1").spec.nodes as Array<Record<string, unknown>>;
    expect(nodes[0]).toMatchObject({ label: "router-1", data: { hostname: "router-1", ip: "10.0.0.1" } });
  });

  it("makes ids unique and the result passes normalizeSpec", () => {
    const { spec } = csvToSpec("name\nWeb\nweb\nWeb");
    expect((spec.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual(["web", "web-2", "web-3"]);
    expect(() => normalizeSpec(csvToSpec(csv).spec)).not.toThrow();
  });
});

describe("csvToSpec: edge list and errors", () => {
  it("builds nodes from a from/to list with labels", () => {
    const { spec } = csvToSpec("from,to,label\nUsers,Load balancer,HTTPS\nLoad balancer,Web 1,\nUsers,Load balancer,dup");
    expect((spec.nodes as Array<{ label: string }>).map((n) => n.label)).toEqual(["Users", "Load balancer", "Web 1"]);
    expect(spec.edges).toEqual([
      { from: "users", to: "load-balancer", label: "HTTPS" },
      { from: "load-balancer", to: "web-1" },
    ]);
  });
  it("explains what is missing", () => {
    expect(() => csvToSpec("a,b\n1,2")).toThrow(/name column/);
    expect(() => csvToSpec("name")).toThrow(/header row/);
    expect(() => csvToSpec("name,ip\n,")).toThrow(/no rows with a name/);
  });
});

describe("yamlToSpec", () => {
  it("reads nodes, zones and edge shortcuts", () => {
    const { spec, warnings } = yamlToSpec(`
direction: right
zones:
  prod: Production
nodes:
  web: { label: Web server, icon: server, zone: prod, data: { ip: 10.0.0.5 } }
  db: Database
edges:
  - web -> db: SQL
  - db <- web
  - web -- web
`);
    expect(spec.direction).toBe("right");
    expect(spec.zones).toEqual([{ id: "prod", label: "Production" }]);
    expect(spec.nodes).toEqual([
      { id: "web", label: "Web server", icon: "server", zone: "prod", data: { ip: "10.0.0.5" } },
      { id: "db", label: "Database" },
    ]);
    expect(spec.edges).toEqual([
      { from: "web", to: "db", label: "SQL" },
      { from: "web", to: "db" },
      { from: "web", to: "web", arrow: "none" },
    ]);
    expect(warnings).toEqual([]);
    expect(() => normalizeSpec(spec)).not.toThrow();
  });

  it("accepts a list of node names and creates nodes used only in edges", () => {
    const { spec, warnings } = yamlToSpec("nodes: [a, b]\nedges:\n  - a -> c");
    expect((spec.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(warnings[0]).toMatch(/"c"/);
  });

  it("accepts object edges and resolves names to ids", () => {
    const { spec } = yamlToSpec("nodes:\n  - id: w1\n    label: Web\n  - id: d1\n    label: DB\nedges:\n  - { from: Web, to: DB, style: dashed }");
    expect(spec.edges).toEqual([{ from: "w1", to: "d1", style: "dashed" }]);
  });

  it("rejects bad input with a readable message", () => {
    expect(() => yamlToSpec("nodes: [a\n")).toThrow(/invalid YAML/);
    expect(() => yamlToSpec("just text")).toThrow(/mapping/);
    expect(() => yamlToSpec("edges: []")).toThrow(/nodes/);
    expect(() => yamlToSpec("nodes: [a]\nedges:\n  - nonsense")).toThrow(/can't read the edge/);
  });
});

describe("review fixes", () => {
  it("resolves YAML edges by the id as written, even when it is slugged", () => {
    const { spec, warnings } = yamlToSpec("nodes:\n  web_1: { label: Web }\n  db: DB\nedges:\n  - web_1 -> db");
    expect(spec.edges).toEqual([{ from: "web-1", to: "db" }]);
    expect(warnings).toEqual([]);
  });
  it("reads Mermaid-style arrows", () => {
    const { spec } = yamlToSpec("nodes: [a, b, c]\nedges:\n  - a --> b\n  - c <-- b\n  - a <--> c");
    expect(spec.edges).toEqual([{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c", arrow: "both" }]);
  });
  it("gives zones that slug alike different ids", () => {
    const zones = csvToSpec("name,zone\na,Prod-DMZ\nb,Prod / DMZ").spec.zones as Array<{ id: string }>;
    expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
  });
});

describe("importFormatForPath", () => {
  it("maps extensions", () => {
    expect(importFormatForPath("/x/hosts.CSV")).toBe("csv");
    expect(importFormatForPath("a.yml")).toBe("yaml");
    expect(importFormatForPath("a.mmd")).toBe("mermaid");
    expect(importFormatForPath("a.txt")).toBeNull();
  });
});
