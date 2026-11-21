// PDF page layout: one or more SVG pictures -> an HTML document whose CSS named pages give each PDF
// page its own size. The main process prints it with printToPDF (preferCSSPageSize), so the PDF is
// vector. Units are CSS px (96 per inch); 1 drawing px prints as 1 CSS px at actual size.
//   fit    page = the picture's size (no margins; padding comes from the export)
//   a4     A4 paper, orientation per page from the picture, scaled to fit inside 10 mm margins
//   letter US Letter, same
//   actualSize (a4/letter only): 100% scale, split across as many sheets as needed

export type PdfPageSize = "fit" | "a4" | "letter";
export const PDF_PAGE_SIZES: readonly PdfPageSize[] = ["fit", "a4", "letter"];

export interface PdfSource {
  svg: string;
  width: number;
  height: number;
}

export interface PdfOptions {
  pageSize: PdfPageSize;
  actualSize?: boolean;
  /** Color of the paper around the picture (e.g. the dark canvas color); default white. */
  pageColor?: string;
}

export interface PdfPagePlan {
  /** Page size in CSS px. */
  width: number;
  height: number;
  source: number;
  /** Top-left of the (scaled) picture relative to the clip box. */
  x: number;
  y: number;
  scale: number;
  /** Visible area of the page (inside the margins). */
  clip: { x: number; y: number; width: number; height: number };
}

const MM = 96 / 25.4;
export const PAPER: Record<"a4" | "letter", { width: number; height: number }> = {
  a4: { width: 210 * MM, height: 297 * MM },
  letter: { width: 8.5 * 96, height: 11 * 96 },
};
export const PDF_MARGIN = 10 * MM;
/** PDF pages can't be larger than 200 in. */
const MAX_PAGE = 200 * 96;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function planPdfPages(sources: readonly PdfSource[], opts: PdfOptions): PdfPagePlan[] {
  const out: PdfPagePlan[] = [];
  sources.forEach((src, i) => {
    const w = Math.max(src.width, 1);
    const h = Math.max(src.height, 1);
    if (opts.pageSize === "fit") {
      const s = Math.min(1, MAX_PAGE / w, MAX_PAGE / h);
      out.push({ width: w * s, height: h * s, source: i, x: 0, y: 0, scale: s, clip: { x: 0, y: 0, width: w * s, height: h * s } });
      return;
    }
    const paper = PAPER[opts.pageSize];
    const orient = (landscape: boolean) =>
      landscape ? { width: paper.height, height: paper.width } : { width: paper.width, height: paper.height };
    if (!opts.actualSize) {
      const page = orient(w > h);
      const aw = page.width - 2 * PDF_MARGIN;
      const ah = page.height - 2 * PDF_MARGIN;
      const s = Math.min(aw / w, ah / h);
      out.push({
        ...page,
        source: i,
        scale: s,
        x: (aw - w * s) / 2,
        y: (ah - h * s) / 2,
        clip: { x: PDF_MARGIN, y: PDF_MARGIN, width: aw, height: ah },
      });
      return;
    }
    // Actual size: the orientation that needs fewer sheets (landscape for wide pictures on a tie).
    const tiles = (landscape: boolean) => {
      const p = orient(landscape);
      const aw = p.width - 2 * PDF_MARGIN;
      const ah = p.height - 2 * PDF_MARGIN;
      return { p, aw, ah, cols: Math.ceil(w / aw - 1e-6), rows: Math.ceil(h / ah - 1e-6) };
    };
    const land = tiles(true);
    const port = tiles(false);
    const n = (t: typeof land) => t.cols * t.rows;
    const t = n(land) < n(port) || (n(land) === n(port) && w > h) ? land : port;
    for (let r = 0; r < t.rows; r++) {
      for (let c = 0; c < t.cols; c++) {
        const single = t.cols === 1 && t.rows === 1;
        out.push({
          ...t.p,
          source: i,
          scale: 1,
          // One sheet: centred. Several: tiles of the picture, edge to edge.
          x: single ? (t.aw - w) / 2 : c ? -c * t.aw : 0,
          y: single ? (t.ah - h) / 2 : r ? -r * t.ah : 0,
          clip: { x: PDF_MARGIN, y: PDF_MARGIN, width: t.aw, height: t.ah },
        });
      }
    }
  });
  return out;
}

/** Size of an SVG from its root width/height (or viewBox). */
export function svgSize(svg: string): { width: number; height: number } {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const attr = (n: string) => new RegExp(`\\s${n}="([^"]*)"`, "i").exec(tag)?.[1];
  const w = parseFloat(attr("width") ?? "");
  const h = parseFloat(attr("height") ?? "");
  if (w > 0 && h > 0) return { width: w, height: h };
  const vb = (attr("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  return { width: 0, height: 0 };
}

/** Make the root <svg> fill its box (width/height 100%), keeping a viewBox for scaling. */
export function fillSvg(svg: string): string {
  const { width, height } = svgSize(svg);
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    let t = tag.replace(/\s(width|height)="[^"]*"/gi, "");
    if (!/\sviewBox=/i.test(t)) t = t.replace(/^<svg/i, `<svg viewBox="0 0 ${width} ${height}"`);
    return t.replace(/^<svg/i, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"');
  });
}

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:";

/** The HTML document printed to PDF: one block per page, each on its own named @page. */
export function buildPdfHtml(sources: readonly PdfSource[], opts: PdfOptions): string {
  const plans = planPdfPages(sources, opts);
  if (!plans.length) throw new Error("nothing to export");
  const paper = opts.pageColor && /^#[0-9a-f]{3,8}$/i.test(opts.pageColor) ? opts.pageColor : "#ffffff";
  const svgs = sources.map((s) => fillSvg(s.svg.replace(/^<\?xml[^>]*\?>\s*/, "")));
  const pageRules = plans.map((p, i) => `@page p${i} { size: ${r3(p.width)}px ${r3(p.height)}px; margin: 0 }`).join("\n");
  const body = plans
    .map((p, i) => {
      const src = sources[p.source];
      return (
        `<div class="pg" style="page:p${i};width:${r3(p.width)}px;height:${r3(p.height)}px">` +
        `<div class="clip" style="left:${r3(p.clip.x)}px;top:${r3(p.clip.y)}px;width:${r3(p.clip.width)}px;height:${r3(p.clip.height)}px">` +
        `<div class="pic" style="left:${r3(p.x)}px;top:${r3(p.y)}px;width:${r3(src.width * p.scale)}px;height:${r3(src.height * p.scale)}px">` +
        svgs[p.source] +
        `</div></div></div>`
      );
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
${pageRules}
html, body { margin: 0; padding: 0; background: ${paper}; }
.pg { position: relative; overflow: hidden; break-after: page; background: ${paper}; }
.pg:last-child { break-after: auto; }
.clip, .pic { position: absolute; overflow: hidden; }
.pic svg { display: block; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
${body}
</body></html>
`;
}

/** Slide layout for PPTX: picture (px) fitted and centred in a slide (inches) with a margin. */
export const SLIDE_SIZES = { "16:9": { width: 10, height: 5.625 }, "4:3": { width: 10, height: 7.5 } } as const;
export type SlideSize = keyof typeof SLIDE_SIZES;

export function fitOnSlide(w: number, h: number, slide: SlideSize, margin = 0.25): { x: number; y: number; w: number; h: number } {
  const s = SLIDE_SIZES[slide];
  const aw = s.width - 2 * margin;
  const ah = s.height - 2 * margin;
  const k = Math.min(aw / Math.max(w, 1), ah / Math.max(h, 1));
  const iw = w * k;
  const ih = h * k;
  return { x: r3((s.width - iw) / 2), y: r3((s.height - ih) / 2), w: r3(iw), h: r3(ih) };
}
