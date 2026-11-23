// Downloaded fonts (main process): the Google Fonts catalog via Fontsource, installs into
// <userData>/fonts (woff2 files named by SHA-1 + fonts.json), and the mdfont:// protocol that serves
// them to the renderer. The renderer registers them with Excalidraw (web/src/fontRegistry.tsx).
//
// Catalog list:  https://api.fontsource.org/v1/fonts           (MYDRAW_FONT_API overrides the origin)
// Font detail:   https://api.fontsource.org/v1/fonts/<id>      (unicode ranges per subset)
// Files:         https://cdn.jsdelivr.net/fontsource/fonts/<id>@latest/<subset>-<weight>-normal.woff2
//                                                               (MYDRAW_FONT_CDN overrides the origin)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { app, ipcMain, net, protocol } from "electron";
import { pathToFileURL } from "node:url";
import {
  cssSafeFamily,
  faceFamilyName,
  fontIdFor,
  lineHeightFor,
  normalizeEmbeddedFonts,
  type FontCategory,
  type FontEntry,
  type FontMetrics,
} from "../../shared/fonts";
import type { CatalogFont } from "../../shared/types";
import { isWoff2, woff2Metrics } from "../../shared/woff2";

export const FONT_SCHEME = "mdfont";

const API = () => (process.env.MYDRAW_FONT_API || "https://api.fontsource.org").replace(/\/+$/, "");
const CDN = () => (process.env.MYDRAW_FONT_CDN || "https://cdn.jsdelivr.net").replace(/\/+$/, "");
const LICENSES = /^(OFL-1\.1|Apache-2\.0|UFL-1\.0|CC0-1\.0|MIT|Unlicense)$/i;
const SUBSETS = ["latin", "latin-ext"];
const MAX_FILE = 3 * 1024 * 1024;
const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;
const FILE_NAME = /^[0-9a-f]{40}\.woff2$/;

const dir = () => path.join(app.getPath("userData"), "fonts");
const manifestPath = () => path.join(dir(), "fonts.json");
const catalogCache = () => path.join(app.getPath("userData"), "font-catalog.json");

/** Fontsource category -> mydraw's grouping. */
export function categoryOf(sourceCategory: string): FontCategory {
  if (sourceCategory === "monospace") return "mono";
  if (sourceCategory === "handwriting" || sourceCategory === "display") return "fun";
  return "professional";
}

function readManifest(): FontEntry[] {
  try {
    const data = JSON.parse(fs.readFileSync(manifestPath(), "utf8")) as { faces?: FontEntry[] };
    return Array.isArray(data.faces) ? data.faces.filter((f) => f && typeof f.family === "string" && Array.isArray(f.files)) : [];
  } catch {
    return [];
  }
}

function writeManifest(faces: FontEntry[]): void {
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = `${manifestPath()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, faces }, null, 2));
  fs.renameSync(tmp, manifestPath());
}

/** Write a woff2 file under its SHA-1; returns its mdfont:// URL. */
function storeFile(bytes: Buffer): string {
  if (bytes.length > MAX_FILE) throw new Error("font file is too large");
  if (!isWoff2(bytes)) throw new Error("not a woff2 font file");
  const sha = crypto.createHash("sha1").update(bytes).digest("hex");
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), `${sha}.woff2`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return `${FONT_SCHEME}://font/${sha}.woff2`;
}

function metricsOf(bytes: Buffer): FontMetrics {
  const m = woff2Metrics(bytes, (b) => zlib.brotliDecompressSync(b));
  return { ...m, lineHeight: lineHeightFor(m) };
}

async function getJson(url: string): Promise<unknown> {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function getBytes(url: string): Promise<Buffer> {
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

interface RawCatalogFont {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  category: string;
  license: string;
  defSubset?: string;
}

function toCatalogFont(r: RawCatalogFont): CatalogFont | null {
  if (!r || typeof r.id !== "string" || !/^[a-z0-9-]+$/.test(r.id) || typeof r.family !== "string") return null;
  if (!LICENSES.test(String(r.license)) || r.category === "icons" || r.category === "other") return null;
  if (!Array.isArray(r.weights) || !Array.isArray(r.styles) || !r.styles.includes("normal")) return null;
  return {
    id: r.id,
    family: r.family,
    category: categoryOf(r.category),
    style: r.category,
    weights: r.weights.filter((w) => Number.isInteger(w)),
    license: r.license,
  };
}

let catalogMemo: CatalogFont[] | null = null;

/** The catalog (cached a week on disk; the stale copy is used when offline). */
export async function fontCatalog(refresh = false): Promise<CatalogFont[]> {
  if (catalogMemo && !refresh) return catalogMemo;
  let cached: { fetchedAt: number; fonts: CatalogFont[] } | null = null;
  try {
    cached = JSON.parse(fs.readFileSync(catalogCache(), "utf8"));
  } catch {
    cached = null;
  }
  if (cached && !refresh && Date.now() - cached.fetchedAt < CATALOG_MAX_AGE) return (catalogMemo = cached.fonts);
  try {
    const raw = await getJson(`${API()}/v1/fonts`);
    if (!Array.isArray(raw)) throw new Error("unexpected catalog format");
    const fonts = raw.map((r) => toCatalogFont(r as RawCatalogFont)).filter((f): f is CatalogFont => !!f);
    fs.writeFileSync(catalogCache(), JSON.stringify({ fetchedAt: Date.now(), fonts }));
    return (catalogMemo = fonts);
  } catch (e) {
    if (cached) return (catalogMemo = cached.fonts);
    throw new Error(`Could not load the font catalog: ${(e as Error).message}`);
  }
}

export function installedFonts(): FontEntry[] {
  return readManifest();
}

/** Download `weights` (normal style) of catalog font `id`. Returns the new entries. */
export async function installCatalogFont(id: string, weights: number[]): Promise<FontEntry[]> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad font id");
  const detail = (await getJson(`${API()}/v1/fonts/${id}`)) as RawCatalogFont & { unicodeRange?: Record<string, string> };
  const font = toCatalogFont(detail);
  if (!font) throw new Error(`${detail?.family ?? id} can't be installed (licence or format)`);
  const want = [...new Set(weights)].filter((w) => font.weights.includes(w));
  if (!want.length) throw new Error(`${font.family} has none of those weights (it has ${font.weights.join(", ")})`);
  const subsets = SUBSETS.filter((s) => detail.subsets.includes(s));
  if (!subsets.length) subsets.push(detail.defSubset && detail.subsets.includes(detail.defSubset) ? detail.defSubset : detail.subsets[0]);

  const faces = readManifest();
  const added: FontEntry[] = [];
  for (const weight of want) {
    const family = faceFamilyName(font.family, weight, "normal");
    if (faces.some((f) => f.family === family)) continue;
    const files: FontEntry["files"] = [];
    let metrics: FontMetrics | null = null;
    for (const subset of subsets) {
      const bytes = await getBytes(`${CDN()}/fontsource/fonts/${id}@latest/${subset}-${weight}-normal.woff2`);
      files.push({ url: storeFile(bytes), unicodeRange: detail.unicodeRange?.[subset] ?? "" });
      metrics ??= metricsOf(bytes);
    }
    added.push({
      id: fontIdFor(family),
      family,
      typeface: cssSafeFamily(font.family),
      weight,
      style: "normal",
      category: font.category,
      source: "catalog",
      metrics: metrics!,
      files,
      license: font.license,
      catalogId: id,
    });
  }
  writeManifest([...faces, ...added]);
  return added;
}

/** Install a font that came inside a drawing, so other drawings can use it. */
export function installEmbeddedFont(raw: unknown): FontEntry[] {
  const { faces: incoming } = normalizeEmbeddedFonts(raw);
  const faces = readManifest();
  const added: FontEntry[] = [];
  for (const face of incoming) {
    if (!face.files.length || faces.some((f) => f.family === face.family)) continue;
    added.push({
      id: fontIdFor(face.family),
      family: face.family,
      typeface: face.typeface,
      weight: face.weight,
      style: face.style,
      category: face.category,
      source: "catalog",
      metrics: face.metrics,
      files: face.files.map((f) => ({ url: storeFile(Buffer.from(f.data, "base64")), unicodeRange: f.unicodeRange })),
      license: "from a drawing",
    });
  }
  writeManifest([...faces, ...added]);
  return added;
}

/** Remove every installed weight of `typeface`. Files no other entry uses are deleted. */
export function removeFont(typeface: string): string[] {
  const faces = readManifest();
  const gone = faces.filter((f) => f.typeface === typeface);
  if (!gone.length) return [];
  const kept = faces.filter((f) => f.typeface !== typeface);
  writeManifest(kept);
  const keep = new Set(kept.flatMap((f) => f.files.map((x) => x.url)));
  for (const url of gone.flatMap((f) => f.files.map((x) => x.url))) {
    if (keep.has(url)) continue;
    const name = url.slice(`${FONT_SCHEME}://font/`.length);
    if (FILE_NAME.test(name)) fs.rmSync(path.join(dir(), name), { force: true });
  }
  return gone.map((f) => f.family);
}

/** mdfont://font/<sha1>.woff2 -> the file (CORS open: Excalidraw fetches it to subset SVG exports). */
export function serveFonts(): void {
  protocol.handle(FONT_SCHEME, async (req) => {
    const { hostname, pathname } = new URL(req.url);
    const name = decodeURIComponent(pathname.replace(/^\/+/, ""));
    if (hostname !== "font" || !FILE_NAME.test(name)) return new Response("not found", { status: 404 });
    const res = await net.fetch(pathToFileURL(path.join(dir(), name)).toString());
    if (!res.ok) return new Response("not found", { status: 404 });
    return new Response(res.body, {
      headers: { "Content-Type": "font/woff2", "Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=31536000, immutable" },
    });
  });
}

function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== "string" || !v) throw new Error(`${name} must be a non-empty string`);
}

export function setupFonts(): void {
  serveFonts();
  ipcMain.handle("fonts:installed", () => installedFonts());
  ipcMain.handle("fonts:catalog", (_e, refresh: unknown) => fontCatalog(refresh === true));
  ipcMain.handle("fonts:install", (_e, id: unknown, weights: unknown) => {
    assertString(id, "id");
    const w = Array.isArray(weights) ? weights.filter((x): x is number => Number.isInteger(x) && x >= 100 && x <= 1000) : [400];
    return installCatalogFont(id, w);
  });
  ipcMain.handle("fonts:install-embedded", (_e, fonts: unknown) => installEmbeddedFont(fonts));
  ipcMain.handle("fonts:remove", (_e, typeface: unknown) => {
    assertString(typeface, "typeface");
    return removeFont(typeface);
  });
}
