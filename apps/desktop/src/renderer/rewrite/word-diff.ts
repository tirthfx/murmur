// Word-level diff for "View changes" (RW-06): Myers' method over words and punctuation, each
// token carrying the spaces after it so the text reads as written.

export type DiffKind = "same" | "added" | "removed";

export interface DiffPart {
  kind: DiffKind;
  /** The token as written, with the spaces that followed it. */
  text: string;
}

export interface WordDiff {
  /** Null when the texts are too long or too different to show word by word. */
  parts: DiffPart[] | null;
  added: number;
  removed: number;
}

/** Longer than this (both texts together), only the counts are shown. */
export const DIFF_MAX_CHARS = 20_000;
/** More edits than this and the word view would not help; counts only. */
const MAX_EDITS = 1_500;

interface Token {
  /** Compared value: the token without its trailing spaces. */
  key: string;
  text: string;
}

const TOKEN = /(?:[\p{L}\p{N}][\p{L}\p{N}'’_-]*|[^\s\p{L}\p{N}])\s*|\s+/gu;

export function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((match) => ({ key: match[0].trim(), text: match[0] }));
}

const isWord = (token: Token) => /[\p{L}\p{N}]/u.test(token.key);

/**
 * The shortest edit script between two token lists (Myers, O((N+M)·D)), as parts in order.
 * Returns null when it would need more than MAX_EDITS edits.
 */
function myers(a: Token[], b: Token[]): DiffPart[] | null {
  const n = a.length;
  const m = b.length;
  const offset = n + m;
  let v = new Int32Array(2 * offset + 2);
  // Each step keeps only the band of `v` its walk-back reads: diagonals -(d+1) to d+1.
  const trace: { start: number; data: Int32Array }[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(offset, MAX_EDITS); d++) {
    const start = Math.max(0, offset - d - 1);
    trace.push({ start, data: v.slice(start, offset + d + 2) });
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x]!.key === b[y]!.key) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // Walk back through the saved rows to recover the path.
  const parts: DiffPart[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const { start, data } = trace[d]!;
    const at = (diagonal: number) => data[offset + diagonal - start]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      parts.push({ kind: "same", text: b[--y]!.text });
      x--;
    }
    if (down) parts.push({ kind: "added", text: b[--y]!.text });
    else parts.push({ kind: "removed", text: a[--x]!.text });
  }
  while (x > 0 && y > 0) {
    parts.push({ kind: "same", text: b[--y]!.text });
    x--;
  }
  return parts.reverse();
}

/** Joins neighbouring parts of the same kind, so the view has fewer pieces. */
function merge(parts: DiffPart[]): DiffPart[] {
  const merged: DiffPart[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last && last.kind === part.kind) last.text += part.text;
    else merged.push({ ...part });
  }
  return merged;
}

/** Words removed from `source` and added in `result`, and the parts to show. */
export function wordDiff(source: string, result: string): WordDiff {
  const a = tokenize(source);
  const b = tokenize(result);
  // The shared start and end need no search.
  let start = 0;
  while (start < a.length && start < b.length && a[start]!.key === b[start]!.key) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1]!.key === b[endB - 1]!.key) {
    endA--;
    endB--;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const tooLong = source.length + result.length > DIFF_MAX_CHARS;
  const middle = tooLong ? null : myers(middleA, middleB);
  if (middle) {
    const parts = merge([
      ...b.slice(0, start).map((token) => ({ kind: "same" as const, text: token.text })),
      ...middle,
      ...b.slice(endB).map((token) => ({ kind: "same" as const, text: token.text })),
    ]);
    let added = 0;
    let removed = 0;
    for (const part of middle) {
      const words = tokenize(part.text).filter(isWord).length;
      if (part.kind === "added") added += words;
      if (part.kind === "removed") removed += words;
    }
    return { parts, added, removed };
  }
  // Counts only: words that are not matched by count, a fair estimate without the search.
  const tally = (tokens: Token[]) => {
    const counts = new Map<string, number>();
    for (const token of tokens.filter(isWord)) {
      const key = token.key.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const before = tally(middleA);
  const after = tally(middleB);
  let added = 0;
  let removed = 0;
  for (const [word, count] of after) added += Math.max(0, count - (before.get(word) ?? 0));
  for (const [word, count] of before) removed += Math.max(0, count - (after.get(word) ?? 0));
  return { parts: null, added, removed };
}
