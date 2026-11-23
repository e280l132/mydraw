import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { exportFormatForPath, isPagedFormat } from "../shared/agent";
import { htmlToText, imageDataUrl, parseStyle, readDrawio } from "../shared/drawioReader";
import { drawioColor, drawioImageUri, htmlLabel, toDrawio, type DrawioEl } from "../shared/drawioWriter";
import { childElements, decodeEntities, escapeXml, findAll, parseXml, XmlError, type XmlElement } from "../shared/xml";

const SVG_URL = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>').toString("base64")}`;

/** zone "Prod" > zone "DMZ" (web inside), db in Prod, an icon node, a frame with a box, a text, edges. */
function scene(): DrawioEl[] {
  return [
    { id: "z1", type: "rectangle", x: 0, y: 0, width: 600, height: 400, roundness: { type: 3 }, customData: { mydrawZone: true }, backgroundColor: "#e7f5ff", strokeColor: "#1971c2", groupIds: ["gz1"] },
    { id: "z1.title", type: "text", x: 14, y: 10, width: 40, height: 20, text: "Prod", fontSize: 16, strokeColor: "#1971c2", customData: { mydrawZoneTitle: "z1" } },
    { id: "z2", type: "rectangle", x: 20, y: 40, width: 300, height: 200, customData: { mydrawZone: true, mydrawZoneId: "z1" }, backgroundColor: "#fff3bf", strokeColor: "#f08c00", strokeStyle: "dashed" },
    { id: "z2.title", type: "text", x: 34, y: 50, width: 40, height: 20, text: "DMZ & <edge>", customData: { mydrawZoneTitle: "z2" } },
    {
      id: "web",
      type: "rectangle",
      x: 60,
      y: 100,
      width: 120,
      height: 60,
      backgroundColor: "#ffffff",
      strokeColor: "#1e1e1e",
      strokeWidth: 2,
      roughness: 0,
      boundElements: [{ id: "web-t", type: "text" }],
      customData: { mydrawZoneId: "z2", ip: "10.0.0.5", "bad name": "x", mydrawKind: "Server" },
      link: "https://example.com/web",
    },
    { id: "web-t", type: "text", x: 70, y: 120, width: 100, height: 20, text: 'Web "1"\nfront', containerId: "web", fontSize: 16, fontFamily: 6, strokeColor: "#1e1e1e" },
    { id: "db", type: "ellipse", x: 60, y: 300, width: 100, height: 60, backgroundColor: "#ffc9c9", strokeColor: "#e03131", roughness: 1, fillStyle: "hachure", boundElements: [{ id: "db-t", type: "text" }], customData: { mydrawZoneId: "z1" } },
    { id: "db-t", type: "text", x: 70, y: 320, width: 80, height: 20, text: "Database", containerId: "db" },
    { id: "fw", type: "rectangle", x: 700, y: 0, width: 72, height: 90, strokeColor: "transparent", backgroundColor: "transparent", groupIds: ["g1"], boundElements: [{ id: "fw-t", type: "text" }], customData: { mydrawNode: "icon", mydrawStencil: { name: "Firewall" } } },
    { id: "fw-img", type: "image", x: 704, y: 4, width: 64, height: 64, fileId: "f1", groupIds: ["g1"] },
    { id: "fw-t", type: "text", x: 700, y: 70, width: 72, height: 18, text: "Edge FW", containerId: "fw", groupIds: ["g1"] },
    { id: "e1", type: "arrow", x: 700, y: 45, points: [[0, 0], [-100, 0], [-100, 85], [-520, 85]], startBinding: { elementId: "fw" }, endBinding: { elementId: "web" }, endArrowhead: "triangle", startArrowhead: null, elbowed: true, boundElements: [{ id: "e1-t", type: "text" }] },
    { id: "e1-t", type: "text", text: "https", containerId: "e1" },
    { id: "e2", type: "arrow", x: 120, y: 160, points: [[0, 0], [0, 140]], startBinding: { elementId: "web" }, endBinding: { elementId: "db" }, strokeStyle: "dashed", endArrowhead: "arrow", startArrowhead: "dot" },
    { id: "free", type: "line", x: 0, y: 500, points: [[0, 0], [50, 20], [100, 0]] },
    { id: "f", type: "frame", x: 900, y: 0, width: 300, height: 200, name: "Prod frame" },
    { id: "inframe", type: "diamond", x: 950, y: 50, width: 80, height: 80, frameId: "f", backgroundColor: "transparent", strokeColor: "#000" },
    { id: "note", type: "text", x: 0, y: 600, width: 100, height: 20, text: "a < b", fontSize: 20, textAlign: "left" },
    { id: "scribble", type: "freedraw", x: 0, y: 700 },
    { id: "gone", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: true },
  ];
}
const files = { f1: { dataURL: SVG_URL, mimeType: "image/svg+xml;mydraw=truecolor" } };

describe("xml", () => {
  it("parses elements, attributes, entities, CDATA and comments", () => {
    const doc = parseXml(`<?xml version="1.0"?><!DOCTYPE x><a k="1 &amp; 2" e='&#x41;&lt;'><!-- c --><b/>t&gt;<![CDATA[<raw>]]></a>`);
    expect(doc.name).toBe("a");
    expect(doc.attrs).toEqual({ k: "1 & 2", e: "A<" });
    expect(childElements(doc).map((c) => c.name)).toEqual(["b"]);
    expect(doc.children.filter((c) => typeof c === "string")).toEqual(["t>", "<raw>"]);
  });
  it("rejects malformed XML", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(XmlError);
    expect(() => parseXml("<a>")).toThrow(/unclosed/);
    expect(() => parseXml("<a/><b/>")).toThrow(/more than one root/);
    expect(() => parseXml('<a x=1/>')).toThrow(/unquoted/);
  });
  it("escapes and decodes round trip", () => {
    const s = `a & b < "c" > 'd'\nline`;
    const doc = parseXml(`<x v="${escapeXml(s)}"/>`);
    expect(doc.attrs.v).toBe(s);
    expect(decodeEntities("&unknown; &#9731;")).toBe("&unknown; ☃");
  });
});

describe("drawio writer", () => {
  const { xml, warnings } = toDrawio([{ name: "Main", elements: scene() }], files, { background: "#ffffff" });
  const doc = parseXml(xml);
  const cells = findAll(doc, "mxCell");
  const objects = findAll(doc, "object");
  const byId = (id: string) => {
    const o = objects.find((x) => x.attrs.id === id);
    if (o) {
      const inner = childElements(o, "mxCell")[0];
      const attrs: Record<string, string> = { ...inner.attrs, id, value: o.attrs.label };
      return { ...inner, attrs, obj: o };
    }
    const c = cells.find((x) => x.attrs.id === id);
    return c ? { ...c, obj: undefined as XmlElement | undefined } : undefined;
  };

  it("writes well-formed mxfile XML with one page", () => {
    expect(doc.name).toBe("mxfile");
    const d = childElements(doc, "diagram");
    expect(d).toHaveLength(1);
    expect(d[0].attrs.name).toBe("Main");
    expect(cells.slice(0, 2).map((c) => c.attrs.id)).toEqual(["0", "1"]);
  });
  it("maps shapes with labels, colors and styles", () => {
    const db = byId("db")!;
    const st = parseStyle(db.attrs.style);
    expect(st).toMatchObject({ ellipse: "", fillColor: "#ffc9c9", strokeColor: "#e03131", sketch: "1", fillStyle: "hachure" });
    expect(db.attrs.value).toBe("Database");
    expect(db.attrs.parent).toBe("z1");
    const web = byId("web")!;
    expect(htmlToText(web.attrs.value)).toBe('Web "1"\nfront');
    expect(parseStyle(web.attrs.style)).toMatchObject({ fontFamily: "Nunito", fontSize: "16", strokeWidth: "2", rounded: "0" });
    expect(parseStyle(byId("inframe")!.attrs.style)).toHaveProperty("rhombus");
  });
  it("keeps user properties and links as <object> attributes", () => {
    const web = byId("web")!;
    expect(web.obj?.attrs).toMatchObject({ ip: "10.0.0.5", link: "https://example.com/web" });
    expect(web.obj?.attrs).not.toHaveProperty("mydrawKind");
    expect(Object.keys(web.obj!.attrs)).not.toContain("bad name");
  });
  it("nests zones as containers with child coordinates relative to the parent", () => {
    const z2 = byId("z2")!;
    expect(z2.attrs.parent).toBe("z1");
    expect(parseStyle(z2.attrs.style)).toMatchObject({ container: "1", dashed: "1", mydrawZone: "1" });
    expect(htmlToText(z2.attrs.value)).toBe("DMZ & <edge>");
    const g = childElements(byId("web")!, "mxGeometry")[0].attrs;
    expect([g.x, g.y]).toEqual(["40", "60"]); // 60-20, 100-40
    // zones come before their members
    const order = cells.map((c) => c.attrs.id);
    const objOrder = [...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(objOrder.indexOf("z1")).toBeLessThan(objOrder.indexOf("z2"));
    expect(objOrder.indexOf("z2")).toBeLessThan(objOrder.indexOf("web"));
    expect(order).not.toContain("z1.title");
  });
  it("writes icon nodes as one embedded image with the caption below", () => {
    const fw = byId("fw")!;
    const st = parseStyle(fw.attrs.style);
    expect(st.shape).toBe("image");
    expect(st.image.startsWith("data:image/svg+xml,PHN2Zy")).toBe(true);
    expect(st.verticalLabelPosition).toBe("bottom");
    expect(fw.attrs.value).toBe("Edge FW");
    const g = childElements(fw, "mxGeometry")[0].attrs;
    expect([g.x, g.y, g.width]).toEqual(["704", "4", "64"]);
    expect(byId("fw-img")).toBeUndefined();
    expect(byId("fw-t")).toBeUndefined();
  });
  it("writes edges with ends, waypoints, arrowheads and labels", () => {
    const e1 = byId("e1")!;
    expect(e1.attrs).toMatchObject({ edge: "1", source: "fw", target: "web", value: "https" });
    expect(parseStyle(e1.attrs.style)).toMatchObject({ edgeStyle: "orthogonalEdgeStyle", endArrow: "block", endFill: "1", startArrow: "none" });
    const pts = findAll(e1, "Array")[0];
    expect(childElements(pts).map((p) => [p.attrs.x, p.attrs.y])).toEqual([["600", "45"], ["600", "130"]]);
    const e2 = byId("e2")!;
    expect(parseStyle(e2.attrs.style)).toMatchObject({ dashed: "1", endArrow: "open", startArrow: "oval" });
    const free = byId("free")!;
    expect(free.attrs.source).toBeUndefined();
    expect(parseStyle(free.attrs.style)).toMatchObject({ endArrow: "none", startArrow: "none" });
  });
  it("writes frames, text and reports what it skipped", () => {
    expect(parseStyle(byId("f")!.attrs.style)).toMatchObject({ container: "1", mydrawFrame: "1" });
    expect(byId("inframe")!.attrs.parent).toBe("f");
    expect(byId("note")!.attrs.value).toBe("a &lt; b");
    expect(byId("scribble")).toBeUndefined();
    expect(byId("gone")).toBeUndefined();
    expect(warnings).toContain("skipped 1 freehand drawings");
  });
  it("writes one diagram page per frame page", () => {
    const two = toDrawio(
      [
        { name: "A", elements: [{ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] },
        { name: "B & C", elements: [{ id: "b", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] },
      ],
      {},
    );
    expect(childElements(parseXml(two.xml), "diagram").map((d) => d.attrs.name)).toEqual(["A", "B & C"]);
  });
  it("helpers", () => {
    expect(drawioColor("transparent")).toBe("none");
    expect(drawioColor("#ABC")).toBe("#aabbcc");
    expect(drawioColor("#11223344")).toBe("#112233");
    expect(drawioColor("#11223300")).toBe("none");
    expect(htmlLabel("a<b>\nc&d")).toBe("a&lt;b&gt;<br>c&amp;d");
    expect(drawioImageUri("data:image/svg+xml,%3Csvg%2F%3E")).toBe(`data:image/svg+xml,${btoa("<svg/>")}`);
    expect(drawioImageUri("data:image/png;base64,AAAA")).toBe("data:image/png,AAAA");
  });
});

describe("drawio writer ids", () => {
  it("never reuses the root cell ids 0 and 1 for elements", async () => {
    const els: DrawioEl[] = [
      { id: "1", type: "rectangle", x: 0, y: 0, width: 300, height: 200, customData: { mydrawZone: true } },
      { id: "0", type: "rectangle", x: 20, y: 40, width: 80, height: 40, customData: { mydrawZoneId: "1" } },
      { id: "mydraw-0", type: "ellipse", x: 200, y: 40, width: 80, height: 40, customData: { mydrawZoneId: "1" } },
      { id: "e", type: "arrow", x: 100, y: 60, points: [[0, 0], [100, 0]], startBinding: { elementId: "0" }, endBinding: { elementId: "mydraw-0" } },
    ];
    const { xml } = toDrawio([{ name: "P", elements: els }], {});
    const ids = findAll(parseXml(xml), "mxCell").map((c) => c.attrs.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual(["0", "1"]);
    const p = (await readDrawio(xml)).pages[0];
    expect(p.shapes.find((s) => s.id === "mydraw-1")).toMatchObject({ kind: "zone" });
    expect(p.shapes.find((s) => s.id === "mydraw-0")).toMatchObject({ kind: "rectangle", zone: "mydraw-1" });
    expect(p.shapes.find((s) => s.id === "mydraw-mydraw-0")).toMatchObject({ kind: "ellipse", zone: "mydraw-1" });
    expect(p.edges[0]).toMatchObject({ from: "mydraw-0", to: "mydraw-mydraw-0" });
  });
});

describe("drawio writer corner radius", () => {
  it("writes a custom radius as an absolute arcSize (diameter), capped like Excalidraw", () => {
    const els: DrawioEl[] = [
      { id: "r1", type: "rectangle", x: 0, y: 0, width: 200, height: 100, roundness: { type: 3, value: 10 } },
      { id: "r2", type: "rectangle", x: 300, y: 0, width: 200, height: 100, roundness: { type: 3, value: 80 } },
      { id: "r3", type: "rectangle", x: 600, y: 0, width: 200, height: 100, roundness: { type: 3 } },
    ];
    const cells = findAll(parseXml(toDrawio([{ name: "P", elements: els }], {}).xml), "mxCell");
    const style = (id: string) => cells.find((c) => c.attrs.id === id)!.attrs.style;
    expect(style("r1")).toContain("absoluteArcSize=1;arcSize=20;");
    expect(style("r2")).toContain("arcSize=50;");
    expect(style("r3")).not.toContain("arcSize");
  });
});

describe("drawio reader", () => {
  it("reads back what the writer wrote (round trip)", async () => {
    const { xml } = toDrawio([{ name: "Main", elements: scene() }], files);
    const r = await readDrawio(xml);
    expect(r.pages).toHaveLength(1);
    const p = r.pages[0];
    const s = (id: string) => p.shapes.find((x) => x.id === id)!;
    expect(s("z1")).toMatchObject({ kind: "zone", label: "Prod", fill: "#e7f5ff" });
    expect(s("z2")).toMatchObject({ kind: "zone", zone: "z1", label: "DMZ & <edge>", dashed: true });
    expect(s("web")).toMatchObject({ kind: "rectangle", label: 'Web "1"\nfront', x: 60, y: 100, width: 120, zone: "z2", link: "https://example.com/web" });
    expect(s("web").data).toEqual({ ip: "10.0.0.5" });
    expect(s("db")).toMatchObject({ kind: "ellipse", zone: "z1", sketch: true });
    expect(s("fw")).toMatchObject({ kind: "image", label: "Edge FW", x: 704, y: 4 });
    expect(s("fw").image).toBe(SVG_URL);
    expect(s("f")).toMatchObject({ kind: "frame", label: "Prod frame" });
    expect(s("inframe")).toMatchObject({ kind: "diamond", frame: "f", x: 950, y: 50 });
    expect(s("note")).toMatchObject({ kind: "text", label: "a < b" });
    const e = (id: string) => p.edges.find((x) => x.id === id)!;
    expect(e("e1")).toMatchObject({ from: "fw", to: "web", label: "https", routing: "elbow", endArrow: "triangle", startArrow: null });
    expect(e("e2")).toMatchObject({ from: "web", to: "db", dashed: true, endArrow: "arrow", startArrow: "dot" });
    expect(e("free")).toMatchObject({ from: undefined, to: undefined, startArrow: null, endArrow: null });
    expect(e("free").points).toEqual([{ x: 0, y: 500 }, { x: 50, y: 520 }, { x: 100, y: 500 }]);
  });

  it("reads a typical draw.io file: layers, groups, swimlanes, stencils, edge labels, html", async () => {
    const xml = `<mxfile host="app.diagrams.net"><diagram name="Net" id="x"><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="lane" value="VPC" style="swimlane;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="300" height="200" as="geometry"/></mxCell>
      <mxCell id="a" value="&lt;b&gt;App&lt;/b&gt;&lt;br&gt;server" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="lane"><mxGeometry x="20" y="40" width="100" height="50" as="geometry"/></mxCell>
      <mxCell id="grp" style="group" vertex="1" parent="1" connectable="0"><mxGeometry x="500" y="100" width="100" height="100" as="geometry"/></mxCell>
      <mxCell id="r" value="Router" style="shape=mxgraph.cisco.routers.router;html=1;" vertex="1" parent="grp"><mxGeometry x="10" y="10" width="50" height="40" as="geometry"/></mxCell>
      <mxCell id="pic" value="" style="shape=image;image=https://example.com/x.png;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>
      <mxCell id="e" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="a" target="r"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="el" value="10 Gb" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e"><mxGeometry x="-0.1" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>
      <UserObject label="%name% (%ip%)" placeholders="1" name="db1" ip="10.1.1.1" id="u"><mxCell style="ellipse;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="0" y="400" width="80" height="80" as="geometry"/></mxCell></UserObject>
      <mxCell id="hidden" value="x" vertex="1" parent="1" visible="0"><mxGeometry width="1" height="1" as="geometry"/></mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const r = await readDrawio(xml);
    const p = r.pages[0];
    expect(p.name).toBe("Net");
    const s = (id: string) => p.shapes.find((x) => x.id === id);
    expect(s("lane")).toMatchObject({ kind: "zone", label: "VPC", fill: "#dae8fc" });
    expect(s("a")).toMatchObject({ kind: "rectangle", label: "App\nserver", x: 120, y: 140, zone: "lane", rounded: true, fill: "#ffffff" });
    expect(s("grp")).toBeUndefined();
    expect(s("r")).toMatchObject({ kind: "rectangle", label: "Router", x: 510, y: 110 });
    expect(s("pic")).toMatchObject({ kind: "rectangle" });
    expect(s("u")).toMatchObject({ kind: "ellipse", label: "db1 (10.1.1.1)", data: { name: "db1", ip: "10.1.1.1" } });
    expect(s("hidden")).toBeUndefined();
    expect(p.edges).toHaveLength(1);
    expect(p.edges[0]).toMatchObject({ from: "a", to: "r", label: "10 Gb", routing: "elbow", endArrow: "arrow" });
    expect(r.warnings.join("\n")).toMatch(/1 stencil shapes as rectangles: mxgraph\.cisco\.routers\.router \(1\)/);
    expect(r.warnings.join("\n")).toMatch(/link to a URL/);
  });

  it("inflates compressed pages and reads several pages", async () => {
    const model = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Hi" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></root></mxGraphModel>`;
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(model))).toString("base64");
    const xml = `<mxfile><diagram name="One">${packed}</diagram><diagram name="Two">${model}</diagram></mxfile>`;
    const r = await readDrawio(xml);
    expect(r.pages.map((p) => p.name)).toEqual(["One", "Two"]);
    expect(r.pages[0].shapes[0]).toMatchObject({ label: "Hi", x: 1, y: 2, width: 3, height: 4 });
  });

  it("accepts a bare mxGraphModel and rejects other XML", async () => {
    const r = await readDrawio(`<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>`);
    expect(r.pages[0].shapes).toEqual([]);
    await expect(readDrawio("<svg/>")).rejects.toThrow(/not a draw.io file/);
  });

  it("helpers", () => {
    expect(parseStyle("ellipse;whiteSpace=wrap;image=data:image/png,AA==;")).toEqual({ ellipse: "", whiteSpace: "wrap", image: "data:image/png,AA==" });
    expect(htmlToText("<div>a&amp;b</div><div>c&nbsp;d</div>")).toBe("a&b\nc d");
    expect(imageDataUrl("data:image/png,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(imageDataUrl("https://x/y.png")).toBeNull();
  });
});

describe("export formats", () => {
  it("knows the paged formats and their extensions", () => {
    expect(exportFormatForPath("/a/b.pdf")).toBe("pdf");
    expect(exportFormatForPath("/a/b.pptx")).toBe("pptx");
    expect(exportFormatForPath("/a/b.drawio")).toBe("drawio");
    expect(isPagedFormat("pdf") && isPagedFormat("pptx") && isPagedFormat("drawio")).toBe(true);
    expect(isPagedFormat("png")).toBe(false);
  });
});
