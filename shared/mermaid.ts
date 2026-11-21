// Mermaid flowchart -> DiagramSpec, so Mermaid input gets the same ELK layout, zones (subgraphs)
// and styling as build_diagram. Covers the common flowchart syntax: node shapes, chained and
// labelled links (--> --- -.-> ==> <-->, |text| and -- text -->), `&`, subgraphs, style/classDef/class
// and :::class. Other diagram types (sequence, class, ...) aren't flowcharts: isFlowchart() says so.
import type { DiagramEdge, DiagramNode, DiagramSpec, DiagramZone, LineStyle, NodeShape } from "./diagram";
import type { LayoutDirection } from "./layout";

const DIRS: Record<string, LayoutDirection> = { LR: "right", RL: "left", TB: "down", TD: "down", BT: "up" };

export function isFlowchart(src: string): boolean {
  const first = stripComments(src)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("---") && !/^\w+:/.test(l));
  return !!first && /^(flowchart|graph)\b/i.test(first);
}

function stripComments(src: string): string {
  // Drop %% comments and a leading YAML front-matter block.
  let s = src.replace(/\r\n?/g, "\n");
  s = s.replace(/^\s*---\n[\s\S]*?\n---\n/, "");
  return s
    .split("\n")
    .map((l) => l.replace(/%%.*$/, ""))
    .join("\n");
}

// Opening bracket -> [closing bracket, shape]. Longest first.
const BRACKETS: [string, string, NodeShape][] = [
  ["(((", ")))", "ellipse"],
  ["((", "))", "ellipse"],
  ["([", "])", "rectangle"],
  ["[[", "]]", "rectangle"],
  ["[(", ")]", "ellipse"],
  ["{{", "}}", "diamond"],
  ["[/", "/]", "rectangle"],
  ["[\\", "\\]", "rectangle"],
  ["[/", "\\]", "rectangle"],
  ["[\\", "/]", "rectangle"],
  ["(", ")", "rectangle"],
  ["[", "]", "rectangle"],
  ["{", "}", "diamond"],
  [">", "]", "rectangle"],
];

const ID = /^[A-Za-z0-9_][\w.\-]*/;

interface NodeRef {
  id: string;
  label?: string;
  shape?: NodeShape;
  cls?: string;
}

interface Link {
  label?: string;
  style: LineStyle;
  width?: number;
  startHead: boolean;
  endHead: boolean;
}

class Cursor {
  constructor(
    public s: string,
    public i = 0,
  ) {}
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  rest() {
    return this.s.slice(this.i);
  }
  done() {
    this.ws();
    return this.i >= this.s.length;
  }
}

function unquote(t: string): string {
  t = t.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
  // Mermaid line breaks and markdown-string backticks.
  return t
    .replace(/^`|`$/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    // Mermaid entity codes: #quot; #amp; #lt; #gt; and numeric #124;
    .replace(/#(quot|amp|lt|gt|\d{1,6});/g, (_m, c: string) =>
      c === "quot" ? '"' : c === "amp" ? "&" : c === "lt" ? "<" : c === "gt" ? ">" : String.fromCodePoint(Number(c)),
    )
    .trim();
}

function readNode(c: Cursor): NodeRef | null {
  c.ws();
  const m = ID.exec(c.rest());
  if (!m) return null;
  // An id must not swallow the start of a link ("A-->B" or "A--text-->B").
  let id = m[0];
  const linkAt = id.search(/(--|==|-\.|\.-)/);
  if (linkAt > 0) id = id.slice(0, linkAt);
  if (id.endsWith("-")) id = id.replace(/-+$/, "");
  if (!id) return null;
  c.i += id.length;
  const ref: NodeRef = { id };
  const after = c.rest();
  for (const [open, close, shape] of BRACKETS) {
    if (!after.startsWith(open)) continue;
    let j = open.length;
    let text: string;
    if (after[j] === '"') {
      const end = after.indexOf('"', j + 1);
      if (end < 0) throw new Error(`unclosed quote after "${id}"`);
      const closeAt = after.indexOf(close, end + 1);
      if (closeAt < 0) throw new Error(`missing "${close}" after "${id}"`);
      text = after.slice(j, closeAt);
      j = closeAt;
    } else {
      const closeAt = after.indexOf(close, j);
      if (closeAt < 0) continue;
      text = after.slice(j, closeAt);
      j = closeAt;
    }
    ref.label = unquote(text);
    ref.shape = shape;
    c.i += j + close.length;
    break;
  }
  const cls = /^:::([\w-]+)/.exec(c.rest());
  if (cls) {
    ref.cls = cls[1];
    c.i += cls[0].length;
  }
  return ref;
}

function linkStyle(body: string): { style: LineStyle; width?: number } {
  if (body.includes("=")) return { style: "solid", width: 4 };
  if (body.includes(".")) return { style: "dashed" };
  return { style: "solid" };
}

function readLink(c: Cursor): Link | null {
  c.ws();
  const rest = c.rest();
  // Text in the middle: A -- text --> B, A == text ==> B, A -. text .-> B
  const mid = /^([<xo]?)(--|==|-\.)(?![->=.])\s*(.+?)\s*(-{2,}|={2,}|\.+-)([>xo]?)(?=\s|[\w"]|$)/.exec(rest);
  if (mid && !/^\|/.test(mid[3])) {
    c.i += mid[0].length;
    return {
      label: unquote(mid[3]),
      ...linkStyle(mid[2] + mid[4]),
      startHead: !!mid[1],
      endHead: !!mid[5],
    };
  }
  const m = /^([<xo]?)(-{2,}|={2,}|-?\.+-?)([>xo]?)/.exec(rest);
  if (!m || (m[2].length < 2 && !m[2].includes("."))) return null;
  c.i += m[0].length;
  const link: Link = { ...linkStyle(m[2]), startHead: !!m[1], endHead: !!m[3] };
  c.ws();
  const pipe = /^\|([^|]*)\|/.exec(c.rest());
  if (pipe) {
    link.label = unquote(pipe[1]) || undefined;
    c.i += pipe[0].length;
  }
  return link;
}

function readGroup(c: Cursor): NodeRef[] | null {
  const first = readNode(c);
  if (!first) return null;
  const out = [first];
  for (;;) {
    c.ws();
    if (c.s[c.i] !== "&") break;
    c.i++;
    const n = readNode(c);
    if (!n) throw new Error(`expected a node after "&"`);
    out.push(n);
  }
  return out;
}

function parseStyle(s: string): { fill?: string; color?: string; style?: LineStyle } {
  const out: { fill?: string; color?: string; style?: LineStyle } = {};
  for (const part of s.split(",")) {
    const [k, v] = part.split(":").map((x) => x?.trim());
    if (!k || !v) continue;
    const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : undefined;
    if (k === "fill" && hex) out.fill = hex;
    else if (k === "stroke" && hex) out.color = hex;
    else if (k === "stroke-dasharray") out.style = "dashed";
  }
  return out;
}

/** Split a line on ";" except inside quotes, brackets/parens/braces and |edge labels|. */
export function splitStatements(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let depth = 0;
  let pipe = false;
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    else if (!quote) {
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
      else if (ch === "|" && depth === 0) pipe = !pipe;
      else if (ch === ";" && depth === 0 && !pipe) {
        out.push(cur);
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a Mermaid flowchart into a diagram. Throws with the offending line on syntax errors. */
export function parseMermaidFlowchart(src: string): DiagramSpec {
  const lines = stripComments(src)
    .split("\n")
    .flatMap(splitStatements)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("empty Mermaid text");
  const head = /^(flowchart|graph)\s*(\w+)?/i.exec(lines[0]);
  if (!head) throw new Error('only Mermaid flowcharts can be laid out as a diagram (start with "flowchart LR" or "graph TD")');
  const direction = DIRS[(head[2] ?? "TD").toUpperCase()] ?? "down";

  const nodes = new Map<string, DiagramNode>();
  const zones = new Map<string, DiagramZone>();
  const edges: DiagramEdge[] = [];
  const classDefs = new Map<string, ReturnType<typeof parseStyle>>();
  const classOf = new Map<string, string[]>();
  const styles = new Map<string, ReturnType<typeof parseStyle>>();
  const stack: string[] = [];
  let anon = 0;

  const touch = (r: NodeRef) => {
    let n = nodes.get(r.id);
    if (!n) {
      if (zones.has(r.id)) return; // a link to a subgraph
      n = { id: r.id, label: r.id };
      nodes.set(r.id, n);
    }
    if (r.label !== undefined) n.label = r.label;
    if (r.shape) n.shape = r.shape;
    if (r.cls) classOf.set(r.id, [...(classOf.get(r.id) ?? []), r.cls]);
    const zone = stack[stack.length - 1];
    if (zone && !n.zone) n.zone = zone;
  };

  for (const line of lines.slice(1)) {
    let m: RegExpExecArray | null;
    if ((m = /^subgraph\s+(.+)$/i.exec(line))) {
      const body = m[1].trim();
      let id: string;
      let label: string;
      const withTitle = /^([\w.\-]+)\s*\[(.*)\]$/.exec(body);
      if (withTitle) {
        id = withTitle[1];
        label = unquote(withTitle[2]);
      } else if (/^"/.test(body)) {
        label = unquote(body);
        id = `subgraph${++anon}`;
      } else {
        id = /^[\w.\-]+$/.test(body) ? body : `subgraph${++anon}`;
        label = body;
      }
      if (zones.has(id)) throw new Error(`subgraph "${id}" is defined twice`);
      zones.set(id, { id, label, parent: stack[stack.length - 1] });
      stack.push(id);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (!stack.length) throw new Error('"end" without a subgraph');
      stack.pop();
      continue;
    }
    if (/^(direction|click|linkStyle|accTitle|accDescr|title)\b/i.test(line)) continue;
    if ((m = /^classDef\s+([\w,-]+)\s+(.+)$/i.exec(line))) {
      for (const name of m[1].split(",")) classDefs.set(name.trim(), parseStyle(m[2]));
      continue;
    }
    if ((m = /^class\s+([\w,.\- ]+?)\s+([\w-]+)$/i.exec(line))) {
      for (const id of m[1].split(",")) classOf.set(id.trim(), [...(classOf.get(id.trim()) ?? []), m[2]]);
      continue;
    }
    if ((m = /^style\s+([\w.\-]+)\s+(.+)$/i.exec(line))) {
      styles.set(m[1], parseStyle(m[2]));
      continue;
    }

    const c = new Cursor(line);
    let left = readGroup(c);
    if (!left) throw new Error(`can't read Mermaid line: ${line}`);
    left.forEach(touch);
    while (!c.done()) {
      const link = readLink(c);
      if (!link) throw new Error(`can't read Mermaid line: ${line}`);
      const right = readGroup(c);
      if (!right) throw new Error(`missing target in Mermaid line: ${line}`);
      right.forEach(touch);
      for (const a of left) {
        for (const b of right) {
          // A head only at the start ("A <-- B") is an arrow from B to A.
          const reversed = link.startHead && !link.endHead;
          edges.push({
            from: reversed ? b.id : a.id,
            to: reversed ? a.id : b.id,
            label: link.label,
            style: link.style === "solid" ? undefined : link.style,
            width: link.width,
            arrow: link.startHead && link.endHead ? "both" : link.startHead || link.endHead ? "end" : "none",
          });
        }
      }
      left = right;
    }
  }
  if (stack.length) throw new Error(`subgraph "${stack[stack.length - 1]}" has no "end"`);

  const apply = (id: string, st: ReturnType<typeof parseStyle>) => {
    const n = nodes.get(id);
    const z = zones.get(id);
    if (n) {
      if (st.fill) n.fill = st.fill;
      if (st.color) n.color = st.color;
    } else if (z) {
      if (st.fill) z.fill = st.fill;
      if (st.color) z.color = st.color;
      if (st.style) z.style = st.style;
    }
  };
  for (const [id, names] of classOf) for (const name of names) if (classDefs.has(name)) apply(id, classDefs.get(name)!);
  for (const [id, st] of styles) apply(id, st);

  let e = 1;
  return {
    direction,
    nodes: [...nodes.values()],
    zones: [...zones.values()],
    edges: edges.map((x) => ({ id: `e${e++}`, ...x })),
  };
}
