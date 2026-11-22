// Literal find & replace in a text (no regex syntax for the user). Pure.

export interface FindOptions {
  matchCase: boolean;
  /** Match whole words only ("sw" doesn't match inside "switch"). */
  wholeWord?: boolean;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcher(find: string, opts: FindOptions): RegExp | null {
  if (!find) return null;
  const body = escapeRegExp(find);
  // Whole word: not preceded/followed by a letter, digit or underscore.
  const src = opts.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return new RegExp(src, opts.matchCase ? "gu" : "giu");
}

/** Number of matches of `find` in `text`. */
export function countMatches(text: string, find: string, opts: FindOptions): number {
  const re = matcher(find, opts);
  if (!re) return 0;
  return (text.match(re) ?? []).length;
}

/** `text` with every match replaced by `replacement` (taken literally, `$` is not special). */
export function replaceInText(text: string, find: string, replacement: string, opts: FindOptions): { text: string; count: number } {
  const re = matcher(find, opts);
  if (!re) return { text, count: 0 };
  let count = 0;
  const out = text.replace(re, () => {
    count += 1;
    return replacement;
  });
  return { text: out, count };
}
