import type { ReplacementRule } from "../dictionary/apply";

// Variable recognition (PZ-25): identifiers visible in the editor, matched against spoken
// words for one dictation. Nothing here is kept after it.

export const MAX_IDENTIFIERS = 500;

/** The words of an identifier: fetchUserProfile, fetch_user_profile, FetchUserProfile, fetch-user-profile. */
export function identifierWords(token: string): string[] | null {
  let words: string[];
  if (
    /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(token) ||
    /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(token)
  ) {
    words = token.split(/(?=[A-Z])/);
  } else if (/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/.test(token)) {
    words = token.split("_");
  } else if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(token)) {
    words = token.split("-");
  } else {
    return null;
  }
  const lower = words.map((word) => word.toLowerCase()).filter(Boolean);
  // Only words that can be said: letters, with digits after them at most.
  if (lower.length < 2 || !lower.every((word) => /^[a-z]+[0-9]*$/.test(word))) return null;
  return lower;
}

/** Identifier-like tokens in the visible text, each once, at most `max`. */
export function identifiersIn(text: string, max: number = MAX_IDENTIFIERS): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_-]*[A-Za-z0-9]/g)) {
    const token = match[0];
    if (identifierWords(token)) found.add(token);
    if (found.size >= max) break;
  }
  return [...found];
}

/**
 * Spoken forms to identifiers: "fetch user profile" becomes fetchUserProfile. Where two
 * identifiers sound the same, the first on screen wins. Longer forms first.
 */
export function variableReplacements(identifiers: readonly string[]): ReplacementRule[] {
  const bySpoken = new Map<string, string>();
  for (const token of identifiers) {
    const words = identifierWords(token);
    if (!words) continue;
    const spoken = words.join(" ");
    if (!bySpoken.has(spoken)) bySpoken.set(spoken, token);
  }
  return [...bySpoken.entries()]
    .map(([spoken, token]) => ({
      id: `variable:${token}`,
      term: spoken,
      replacement: token,
      caseSensitive: false,
    }))
    .sort((a, b) => b.term.length - a.term.length);
}
