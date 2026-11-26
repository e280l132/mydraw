import { describe, expect, it } from "vitest";
import { CliUsageError, defaultOutput, inputKind, parseCliArgs } from "../shared/cli";
import { buildPdfHtml, fillSvg, fitOnSlide, PAPER, PDF_MARGIN, planPdfPages, svgSize } from "../shared/pdfLayout";

const svg = (w: number, h: number) => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect/></svg>`;

describe("pdf layout", () => {
  it("fit: one page the size of the picture", () => {
    const [p] = planPdfPages([{ svg: "", width: 300, height: 200 }], { pageSize: "fit" });
    expect(p).toMatchObject({ width: 300, height: 200, scale: 1, x: 0, y: 0 });
  });
  it("fit: caps pages at 200 inches", () => {
    const [p] = planPdfPages([{ svg: "", width: 40000, height: 100 }], { pageSize: "fit" });
    expect(p.width).toBeCloseTo(19200);
    expect(p.scale).toBeCloseTo(0.48);
  });
  it("a4/letter: orientation from the picture, scaled to fit inside the margins, centred", () => {
    const [land] = planPdfPages([{ svg: "", width: 2000, height: 1000 }], { pageSize: "a4" });
    expect(land.width).toBeCloseTo(PAPER.a4.height);
    expect(land.height).toBeCloseTo(PAPER.a4.width);
    expect(2000 * land.scale).toBeCloseTo(land.clip.width);
    expect(land.y).toBeGreaterThan(0);
    const [port] = planPdfPages([{ svg: "", width: 100, height: 300 }], { pageSize: "letter" });
    expect(port.width).toBe(816);
    expect(port.height).toBe(1056);
    expect(port.scale).toBeGreaterThan(1); // small drawings are scaled up to the sheet
  });
  it("actual size: 100%, tiled over sheets, fewest sheets", () => {
    const aw = PAPER.a4.height - 2 * PDF_MARGIN; // landscape printable width
    const pages = planPdfPages([{ svg: "", width: aw * 2.5, height: 300 }], { pageSize: "a4", actualSize: true });
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.scale === 1 && p.width > p.height)).toBe(true);
    expect(pages.map((p) => Math.round(p.x))).toEqual([0, -Math.round(aw), -Math.round(2 * aw)]);
    const [one] = planPdfPages([{ svg: "", width: 100, height: 100 }], { pageSize: "a4", actualSize: true });
    expect(one.scale).toBe(1);
    expect(one.x).toBeGreaterThan(0); // centred
  });
  it("one page per source (frames)", () => {
    const pages = planPdfPages(
      [
        { svg: "", width: 100, height: 50 },
        { svg: "", width: 50, height: 100 },
      ],
      { pageSize: "fit" },
    );
    expect(pages.map((p) => [p.source, p.width, p.height])).toEqual([
      [0, 100, 50],
      [1, 50, 100],
    ]);
  });
  it("builds HTML with a named @page per page, CSP and the SVGs", () => {
    const html = buildPdfHtml([{ svg: svg(300, 200), width: 300, height: 200 }, { svg: svg(10, 10), width: 10, height: 10 }], { pageSize: "fit", pageColor: "#121212" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page p0 { size: 300px 200px; margin: 0 }");
    expect(html).toContain("@page p1 { size: 10px 10px; margin: 0 }");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("background: #121212");
    expect(html).not.toContain("<?xml");
    expect((html.match(/<svg /g) ?? []).length).toBe(2);
    expect(() => buildPdfHtml([], { pageSize: "fit" })).toThrow();
  });
  it("svg helpers", () => {
    expect(svgSize(svg(30, 40))).toEqual({ width: 30, height: 40 });
    expect(svgSize('<svg viewBox="0 0 5 6">')).toEqual({ width: 5, height: 6 });
    const filled = fillSvg('<svg xmlns="x" width="30" height="40"><g/></svg>');
    expect(filled).toContain('viewBox="0 0 30 40"');
    expect(filled).toContain('width="100%"');
    expect(filled).not.toContain('width="30"');
  });
  it("fits pictures on slides", () => {
    expect(fitOnSlide(1600, 900, "16:9")).toEqual({ x: 0.444, y: 0.25, w: 9.111, h: 5.125 });
    expect(fitOnSlide(3200, 900, "16:9")).toMatchObject({ x: 0.25, w: 9.5 });
    const b = fitOnSlide(100, 1000, "4:3");
    expect(b.h).toBe(7);
    expect(b.x).toBeGreaterThan(4);
  });
});

describe("cli args", () => {
  it("parses export with options", () => {
    expect(parseCliArgs(["export", "net.excalidraw", "--format", "jpg", "--scale", "2", "--frame", "Prod", "--dark", "--quality=0.8"])).toMatchObject({
      command: "export",
      input: "net.excalidraw",
      format: "jpg",
      scale: 2,
      scope: "frame",
      frame: "Prod",
      darkMode: true,
      background: true,
      quality: 0.8,
      output: null,
    });
  });
  it("takes the format from --to, -o or defaults to png", () => {
    expect(parseCliArgs(["convert", "x.drawio", "--to", "excalidraw"])).toMatchObject({ format: "excalidraw", scope: "all" });
    expect(parseCliArgs(["export", "x.excalidraw", "-o", "out/x.pdf", "--page", "a4", "--actual-size"])).toMatchObject({ format: "pdf", pageSize: "a4", actualSize: true, output: "out/x.pdf" });
    expect(parseCliArgs(["export", "x.excalidraw"]).command === "export" && (parseCliArgs(["export", "x.excalidraw"]) as { format: string }).format).toBe("png");
    expect(parseCliArgs(["export", "x.excalidraw", "-f", "jpeg", "--no-background", "--slides", "4:3"])).toMatchObject({ format: "jpg", background: false, slideSize: "4:3" });
    expect(parseCliArgs(["export", "x.excalidraw", "--to", "md"])).toMatchObject({ format: "markdown" });
  });
  it("help", () => {
    expect(parseCliArgs([])).toEqual({ command: "help" });
    expect(parseCliArgs(["export", "--help"])).toEqual({ command: "help" });
  });
  it("rejects bad input", () => {
    const bad = (a: string[], re: RegExp) => expect(() => parseCliArgs(a)).toThrow(re);
    bad(["draw", "x"], /unknown command/);
    expect(parseCliArgs(["--version"])).toEqual({ command: "version" });
    expect(parseCliArgs(["version"])).toEqual({ command: "version" });
    bad(["export"], /no input file/);
    bad(["export", "a", "b"], /one input file/);
    bad(["convert", "x.drawio"], /--to/);
    bad(["export", "x", "--format", "gif"], /unknown format/);
    bad(["export", "x", "--scale", "5"], /--scale/);
    bad(["export", "x", "--scale", "1.5"], /--scale/);
    bad(["export", "x", "--scope", "frame"], /--frame/);
    bad(["export", "x", "--scope", "frames", "--frame", "A"], /--frame only/);
    bad(["export", "x", "--page", "a3"], /--page/);
    bad(["export", "x", "--actual-size"], /a4 or letter/);
    bad(["export", "x", "--bogus"], /unknown option/);
    bad(["export", "x", "--format"], /needs a value/);
    bad(["export", "x", "--to", "excalidraw", "--scope", "frames"], /whole drawing/);
    bad(["export", "x", "--background", "red"], /hex/);
    expect(() => parseCliArgs(["export"])).toThrow(CliUsageError);
  });
  it("default output paths and input kinds", () => {
    expect(defaultOutput("/a/net.excalidraw", "jpg", false)).toBe("/a/net.jpg");
    expect(defaultOutput("/a/net.excalidraw", "png", true)).toBe("/a/net-frames");
    expect(defaultOutput("/a/x.drawio", "excalidraw", false)).toBe("/a/x.excalidraw");
    expect(inputKind("a.excalidraw")).toBe("excalidraw");
    expect(inputKind("a.DRAWIO")).toBe("drawio");
    expect(inputKind("a.png")).toBeNull();
  });
});

describe("cli args: rejected values", () => {
  it("rejects --slides values that are only Object.prototype keys", () => {
    for (const v of ["constructor", "toString", "__proto__"]) {
      expect(() => parseCliArgs(["export", "a.excalidraw", "-f", "pptx", "--slides", v])).toThrow(CliUsageError);
    }
    expect(parseCliArgs(["export", "a.excalidraw", "-f", "pptx", "--slides", "4:3"])).toMatchObject({ slideSize: "4:3" });
  });
  it("rejects an output extension it cannot write instead of writing PNG", () => {
    expect(() => parseCliArgs(["export", "a.excalidraw", "-o", "out.gif"])).toThrow(/format/);
    expect(parseCliArgs(["export", "a.excalidraw", "-o", "out.gif", "-f", "png"])).toMatchObject({ format: "png" });
    expect(parseCliArgs(["export", "a.excalidraw", "-o", "out"])).toMatchObject({ format: "png" });
    expect(parseCliArgs(["export", "a.excalidraw", "-o", "out.v2", "--scope", "frames"])).toMatchObject({ format: "png" });
  });
});
