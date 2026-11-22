// Tiny fuzzy matcher for the command palette. Pure, no dependencies.

/** Score of one query token against a text, or null if it doesn't match. Higher is better. */
function tokenScore(token: string, text: string): number | null {
  const at = text.indexOf(token);
  if (at >= 0) {
    // Substring: best when it starts the text or a word.
    const wordStart = at === 0 || /[^a-z0-9]/.test(text[at - 1]);
    return 100 + (at === 0 ? 60 : wordStart ? 40 : 0) - Math.min(at, 30) - Math.min(text.length - token.length, 30) / 3;
  }
  // Subsequence: every character in order, rewarding runs and word starts.
  let ti = 0;
  let score = 0;
  let run = 0;
  for (const ch of token) {
    const found = text.indexOf(ch, ti);
    if (found < 0) return null;
    run = found === ti ? run + 1 : 0;
    const wordStart = found === 0 || /[^a-z0-9]/.test(text[found - 1]);
    score += 4 + run * 3 + (wordStart ? 6 : 0) - Math.min(found - ti, 10) / 2;
    ti = found + 1;
  }
  return score;
}

/**
 * Score `text` against a whitespace-separated `query`. Every token must match (as a substring or an
 * in-order subsequence). Returns null when something doesn't match; an empty query matches everything.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hay = text.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    const s = tokenScore(t, hay);
    if (s === null) return null;
    total += s;
  }
  return total;
}

/** Items matching `query`, best first (stable for equal scores), at most `limit`. */
export function fuzzyRank<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit);
  const scored: Array<{ item: T; score: number; i: number }> = [];
  items.forEach((item, i) => {
    const score = fuzzyScore(query, text(item));
    if (score !== null) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}
