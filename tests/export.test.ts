import { describe, expect, it } from "vitest";
import { AGENT_EXPORT_FORMATS, exportFormatForPath } from "../shared/agent";
import { buildHtml, sanitizeSvg } from "../shared/htmlExport";
import { csvCell, inventoryRows, toCsv, toMarkdownTable } from "../shared/inventory";
import { parseMermaidFlowchart } from "../shared/mermaid";
import { escapeLabel, toMermaid } from "../shared/mermaidWriter";
import { batchFileStems, siblingPath } from "../shared/names";
import { extractGraph, zonePath, type SceneEl } from "../shared/sceneGraph";
import { DEFAULT_SETTINGS, mergeSettings } from "../shared/settings";

const text = (id: string, container: string, t: string): SceneEl => ({ id, type: "text", text: t, containerId: container });
const shape = (id: string, label: string, extra: Partial<SceneEl> = {}): SceneEl[] => [
  { id, type: "rectangle", x: 0, y: 0, boundElements: [{ id: `${id}-t`, type: "text" }], backgroundColor: "transparent", strokeColor: "#1e1e1e", ...extra },
  text(`${id}-t`, id, label),
];
const arrow = (id: string, from: string, to: string, extra: Partial<SceneEl> = {}): SceneEl => ({
  id,
  type: "arrow",
  startBinding: { elementId: from },
  endBinding: { elementId: to },
  endArrowhead: "arrow",
  startArrowhead: null,
  ...extra,
});

/** zone "Prod" > zone "DMZ"; web in DMZ, db in Prod, icon node "fw" at the top level. */
function scene(): SceneEl[] {
  return [
    { id: "z1", type: "rectangle", x: 0, y: 0, customData: { mydrawZone: true }, backgroundColor: "#e7f5ff", strokeColor: "#1971c2" },
    { id: "z1t", type: "text", text: "Prod", customData: { mydrawZoneTitle: "z1" } },
    { id: "z2", type: "rectangle", x: 10, y: 10, customData: { mydrawZone: true, mydrawZoneId: "z1" } },
    { id: "z2t", type: "text", text: "DMZ", customData: { mydrawZoneTitle: "z2" } },
    ...shape("web", "Web \"server\" | 1", { x: 20, y: 20, customData: { mydrawZoneId: "z2", ip: "10.0.0.5", hostname: "web-1", notes: "line1\nline2", mydrawKind: "Server" } }),
    ...shape("db", "Database", { x: 20, y: 300, type: "ellipse", backgroundColor: "#ffc9c9", customData: { mydrawZoneId: "z1", ip: 12 } }),
    { id: "fw", type: "rectangle", x: 400, y: 0, boundElements: [{ id: "fw-t", type: "text" }], customData: { mydrawNode: "icon", mydrawStencil: { name: "Firewall" } } },
    text("fw-t", "fw", "Edge firewall"),
    { id: "img", type: "image", x: 400, y: 0 },
    arrow("e1", "fw", "web", { boundElements: [{ id: "e1-t", type: "text" }] }),
    text("e1-t", "e1", "https"),
    arrow("e2", "web", "db", { strokeStyle: "dashed", startArrowhead: "arrow", endArrowhead: null }),
    arrow("e3", "web", "nowhere"),
    { id: "deco", type: "rectangle", x: 0, y: 900 },
    { id: "gone", type: "rectangle", isDeleted: true, boundElements: [{ id: "gone-t", type: "text" }] },
    { id: "leg", type: "rectangle", customData: { mydrawLegend: true } },
  ];
}

describe("extractGraph", () => {
  const g = extractGraph(scene());
  it("finds nodes, skipping decoration, deleted, legend and images", () => {
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["db", "fw", "web"]);
  });
  it("reads labels, shapes, kinds and user data", () => {
    const web = g.nodes.find((n) => n.id === "web")!;
    expect(web).toMatchObject({ label: 'Web "server" | 1', shape: "rectangle", kind: "Server", zone: "z2" });
    expect(web.data).toEqual({ ip: "10.0.0.5", hostname: "web-1", notes: "line1\nline2" });
    expect(g.nodes.find((n) => n.id === "db")).toMatchObject({ shape: "ellipse", fill: "#ffc9c9" });
    expect(g.nodes.find((n) => n.id === "fw")).toMatchObject({ type: "icon", kind: "Firewall", label: "Edge firewall" });
  });
  it("reads a label as typed, not as wrapped to the shape's width", () => {
    const wrapped: SceneEl = { ...text("w-t", "w", "Customer\ns\n(Web)"), originalText: "Customers\n(Web)" };
    const g2 = extractGraph([{ id: "w", type: "rectangle", x: 0, y: 0, boundElements: [{ id: "w-t", type: "text" }] }, wrapped]);
    expect(g2.nodes[0].label).toBe("Customers\n(Web)");
  });
  it("nests zones", () => {
    expect(g.zones.map((z) => [z.label, z.parent])).toEqual([["Prod", null], ["DMZ", "z1"]]);
    expect(zonePath(g, "z2")).toBe("Prod / DMZ");
  });
  it("reads edges: labels, dashes, direction, ignores unbound", () => {
    expect(g.edges).toEqual([
      { from: "fw", to: "web", label: "https", dashed: false, arrow: "end" },
      // start head only -> reversed
      { from: "db", to: "web", label: undefined, dashed: true, arrow: "end" },
    ]);
  });
});

describe("toMermaid", () => {
  const g = extractGraph(scene());
  const src = toMermaid(g, { direction: "LR" });

  it("writes a flowchart with subgraphs, quoted labels and styles", () => {
    expect(src).toMatch(/^flowchart LR\n/);
    expect(src).toContain('subgraph Prod["Prod"]');
    expect(src).toContain('subgraph DMZ["DMZ"]');
    expect(src).toContain("#quot;server#quot; #124; 1");
    expect(src).toContain("-.->");
    expect(src).toContain("style Database fill:#ffc9c9");
    expect(src).not.toContain("style Edge_firewall"); // default ink + no fill: no style line
  });

  it("round-trips through parseMermaidFlowchart", () => {
    const spec = parseMermaidFlowchart(src);
    expect(spec.direction).toBe("right");
    expect(spec.nodes.map((n) => [n.label, n.shape, n.zone]).sort()).toEqual(
      [
        ['Web "server" | 1', "rectangle", "DMZ"],
        ["Database", "ellipse", "Prod"],
        ["Edge firewall", "rectangle", undefined],
      ].sort(),
    );
    expect(spec.zones!.map((z) => [z.id, z.label, z.parent])).toEqual([["Prod", "Prod", undefined], ["DMZ", "DMZ", "Prod"]]);
    expect(spec.edges!.map((e) => [e.label, e.style])).toEqual([["https", undefined], [undefined, "dashed"]]);
    expect(spec.nodes.find((n) => n.label === "Database")!.fill).toBe("#ffc9c9");
  });

  it("escapes hostile labels so they survive a round trip", () => {
    const nasty = 'a "q" <b> & #x; %% ; | [x] {y} (z)\nnext';
    const graph = extractGraph(shape("n", nasty));
    const spec = parseMermaidFlowchart(toMermaid(graph));
    expect(spec.nodes).toHaveLength(1);
    expect(spec.nodes[0].label).toBe(nasty.replace("\n", "\n"));
    expect(escapeLabel("x")).toBe("x");
  });

  it("avoids reserved and duplicate ids and keeps same-name nodes apart", () => {
    const els = [...shape("a", "end"), ...shape("b", "end"), ...shape("c", "1st")];
    const spec = parseMermaidFlowchart(toMermaid(extractGraph(els)));
    expect(spec.nodes.map((n) => n.label)).toEqual(["end", "end", "1st"]);
    expect(new Set(spec.nodes.map((n) => n.id)).size).toBe(3);
  });

  it("guesses a direction from the bounds", () => {
    expect(toMermaid(g, { bounds: { width: 900, height: 300 } })).toMatch(/^flowchart LR/);
    expect(toMermaid(g, { bounds: { width: 300, height: 900 } })).toMatch(/^flowchart TD/);
  });
});

describe("inventory", () => {
  const g = extractGraph(scene());
  const rows = inventoryRows(g);
  it("one row per node with aliases mapped", () => {
    expect(rows).toHaveLength(3);
    const web = rows.find((r) => r.name.startsWith("Web"))!;
    expect(web).toMatchObject({ kind: "Server", type: "rectangle", zone: "Prod / DMZ", ip: "10.0.0.5", hostname: "web-1", notes: "line1\nline2" });
    expect(rows.find((r) => r.name === "Database")!.ip).toBe("12");
  });
  it("CSV has a header and quotes cells", () => {
    const csv = toCsv(rows);
    expect(csv.split("\r\n")[0]).toBe("name,kind,type,zone,ip,hostname,vlan,role,owner,url,notes");
    expect(csv).toContain('"Web ""server"" | 1"');
    expect(csv).toContain('"line1\nline2"');
  });
  it("CSV neutralises spreadsheet formulas but keeps numbers", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("plain")).toBe("plain");
  });
  it("Markdown table escapes pipes and newlines", () => {
    const md = toMarkdownTable(rows).split("\n");
    expect(md[0]).toBe("| Name | Kind | Type | Zone | Ip | Hostname | Vlan | Role | Owner | Url | Notes |");
    expect(md[1]).toBe("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    expect(md.join("\n")).toContain('Web "server" \\| 1');
    expect(md.join("\n")).toContain("line1<br>line2");
  });
});

describe("buildHtml", () => {
  const svg = '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"><a href="https://x.test"><rect/></a></svg>';
  it("embeds the svg and the pan/zoom script, escapes the title", () => {
    const html = buildHtml({ title: "<b>&", svg });
    expect(html).toContain('<svg viewBox="0 0 10 10">');
    expect(html).not.toContain("<?xml");
    expect(html).toContain('href="https://x.test"');
    expect(html).toContain("addEventListener(\"wheel\"");
    expect(html).toContain("<title>&lt;b&gt;&amp;</title>");
    expect(html).toContain("Content-Security-Policy");
  });
  it("strips scripts, handlers and javascript: links", () => {
    const out = sanitizeSvg('<svg onload="x()"><script>alert(1)</script><a href="javascript:alert(1)"><rect onclick=\'y\'/></a></svg>');
    expect(out).not.toMatch(/script|onload|onclick|javascript/i);
  });
});

describe("file naming and formats", () => {
  it("siblingPath swaps the extension", () => {
    expect(siblingPath("/a/b/net.excalidraw", "png")).toBe("/a/b/net.png");
    expect(siblingPath("/a/b/net.excalidraw.json", "svg")).toBe("/a/b/net.svg");
    expect(siblingPath("/a/b/net", "svg")).toBe("/a/b/net.svg");
  });
  it("batchFileStems makes unique safe names", () => {
    expect(batchFileStems(["Prod", "prod", "a/b", "Prod"])).toEqual(["Prod", "prod (2)", "a-b", "Prod (3)"]);
  });
  it("exportFormatForPath knows the new formats", () => {
    expect(exportFormatForPath("x.webp")).toBe("webp");
    expect(exportFormatForPath("x.mmd")).toBe("mermaid");
    expect(exportFormatForPath("x.mermaid")).toBe("mermaid");
    expect(exportFormatForPath("x.md")).toBe("markdown");
    expect(exportFormatForPath("x.csv")).toBe("csv");
    expect(exportFormatForPath("x.html")).toBe("html");
    expect(exportFormatForPath("x.jpeg")).toBe("jpg");
    expect(exportFormatForPath("x.pdf")).toBe("pdf");
    expect(exportFormatForPath("x.dio")).toBe("drawio");
    expect(exportFormatForPath("x.gif")).toBeNull();
    expect(AGENT_EXPORT_FORMATS).toContain("markdown");
  });
});

describe("autoExport setting", () => {
  it("keeps valid absolute-path entries only", () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { autoExport: { "/a.excalidraw": "png", "rel.excalidraw": "png", "/b.excalidraw": "gif", "/c.excalidraw": "svg" } });
    expect(s.autoExport).toEqual({ "/a.excalidraw": "png", "/c.excalidraw": "svg" });
    expect(mergeSettings(s, { autoExport: {} }).autoExport).toEqual({});
    expect(mergeSettings(s, { theme: "dark" }).autoExport).toEqual(s.autoExport);
  });
});
