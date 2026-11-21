// Minimal XML reader/escaper for the draw.io importer/exporter. Pure (no DOMParser), so it runs in
// the renderer, in the CLI and in vitest. Handles elements, attributes, text, CDATA, comments,
// processing instructions, DOCTYPE and the standard + numeric entities. Not a validating parser.

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | string;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

/** Escape text for an attribute value (double quotes) or element content. Newlines kept as &#xa;. */
export function escapeXml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#xa;")
    .replace(/\r/g, "");
}

export class XmlError extends Error {}

/** Parse a document; returns its root element. Throws XmlError on malformed input. */
export function parseXml(src: string): XmlElement {
  let i = 0;
  const n = src.length;
  const fail = (msg: string): never => {
    const line = src.slice(0, i).split("\n").length;
    throw new XmlError(`${msg} (line ${line})`);
  };
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));
    i = lt;
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) fail("unterminated comment");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end < 0) fail("unterminated CDATA");
      stack[stack.length - 1].children.push(src.slice(i + 9, end));
      i = end + 3;
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end < 0) fail("unterminated processing instruction");
      i = end + 2;
    } else if (src.startsWith("<!", i)) {
      // DOCTYPE (with an optional internal subset in [...]).
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        if (src[j] === "[") depth++;
        else if (src[j] === "]") depth--;
        else if (src[j] === ">" && depth <= 0) break;
      }
      if (j >= n) fail("unterminated declaration");
      i = j + 1;
    } else if (src[i + 1] === "/") {
      const end = src.indexOf(">", i);
      if (end < 0) fail("unterminated end tag");
      const name = src.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top === root || top.name !== name) fail(`unexpected </${name}>`);
      i = end + 1;
    } else {
      i++;
      const nameM = /^[^\s/>]+/.exec(src.slice(i, i + 200));
      if (!nameM) fail("bad tag name");
      const el: XmlElement = { name: nameM![0], attrs: {}, children: [] };
      i += nameM![0].length;
      for (;;) {
        while (i < n && /\s/.test(src[i])) i++;
        if (i >= n) fail(`unterminated <${el.name}>`);
        if (src[i] === ">") {
          i++;
          stack[stack.length - 1].children.push(el);
          stack.push(el);
          break;
        }
        if (src[i] === "/" && src[i + 1] === ">") {
          i += 2;
          stack[stack.length - 1].children.push(el);
          break;
        }
        const an = /^[^\s=/>]+/.exec(src.slice(i, i + 200));
        if (!an) fail(`bad attribute in <${el.name}>`);
        i += an![0].length;
        while (i < n && /\s/.test(src[i])) i++;
        if (src[i] !== "=") {
          el.attrs[an![0]] = ""; // HTML-style bare attribute; tolerated
          continue;
        }
        i++;
        while (i < n && /\s/.test(src[i])) i++;
        const q = src[i];
        if (q !== '"' && q !== "'") fail(`unquoted attribute ${an![0]}`);
        const end = src.indexOf(q, i + 1);
        if (end < 0) fail("unterminated attribute value");
        // Attribute value normalisation: literal whitespace becomes spaces, character refs stay.
        el.attrs[an![0]] = decodeEntities(src.slice(i + 1, end).replace(/[\t\n\r]/g, " "));
        i = end + 1;
      }
    }
  }
  if (stack.length > 1) throw new XmlError(`unclosed <${stack[stack.length - 1].name}>`);
  const top = root.children.filter((c): c is XmlElement => typeof c !== "string");
  if (top.length !== 1) throw new XmlError(top.length ? "more than one root element" : "no root element");
  return top[0];

  function pushText(t: string) {
    if (stack.length === 1) {
      if (t.trim()) fail("text outside the root element");
      return;
    }
    stack[stack.length - 1].children.push(decodeEntities(t));
  }
}

export function childElements(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== "string" && (!name || c.name === name));
}

export function textContent(el: XmlElement): string {
  return el.children.map((c) => (typeof c === "string" ? c : textContent(c))).join("");
}

/** Depth-first search for elements with a given name. */
export function findAll(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of childElements(el)) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
