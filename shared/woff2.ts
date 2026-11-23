// Read the vertical metrics Excalidraw needs (head.unitsPerEm, hhea.ascender/descender) from a
// WOFF2 font file. Pure: the caller passes a brotli decompressor (node:zlib brotliDecompressSync in
// main and the build script), so this works without a font library.
// Format: https://www.w3.org/TR/WOFF2/ (header, table directory, one brotli stream of all tables).
// No imports, so scripts/build-app.mjs can load it with Node's type stripping.

export interface VerticalMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
}

const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length > 48 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32; // "wOF2"
}

export function woff2Metrics(bytes: Uint8Array, brotliDecompress: (data: Uint8Array) => Uint8Array): VerticalMetrics {
  if (!isWoff2(bytes)) throw new Error("not a woff2 font file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4) === 0x74746366) throw new Error("font collections are not supported"); // "ttcf"
  const numTables = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  let pos = 48;

  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[pos++];
      if (i === 0 && b === 0x80) throw new Error("bad woff2 number");
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error("bad woff2 number");
  };

  // Offsets of the tables inside the decompressed stream, in directory order.
  const tables = new Map<string, { offset: number; length: number }>();
  let offset = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[pos++];
    const index = flags & 0x3f;
    const version = flags >> 6;
    let tag: string;
    if (index === 63) {
      tag = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      pos += 4;
    } else {
      tag = KNOWN_TAGS[index];
    }
    const origLength = base128();
    // glyf/loca are transformed unless version 3; other tables only when version != 0.
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    tables.set(tag, { offset, length });
    offset += length;
  }

  const data = brotliDecompress(bytes.subarray(pos, pos + compressedSize));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const head = tables.get("head");
  const hhea = tables.get("hhea");
  if (!head || !hhea || head.offset + 20 > data.length || hhea.offset + 8 > data.length) throw new Error("font has no head/hhea table");
  const m = {
    unitsPerEm: dv.getUint16(head.offset + 18),
    ascender: dv.getInt16(hhea.offset + 4),
    descender: dv.getInt16(hhea.offset + 6),
  };
  if (!(m.unitsPerEm >= 16 && m.unitsPerEm <= 16384)) throw new Error("bad unitsPerEm");
  return m;
}
