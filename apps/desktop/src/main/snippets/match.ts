import { plainToHtml, richToHtml, type Snippet } from "@murmur/shared";
import { normaliseTrigger } from "./snippet-store";

export type Piece = { kind: "text"; text: string } | { kind: "snippet"; snippet: Snippet };

/**
 * Splits a dictation where a snippet trigger is said on its own (PZ-08): the whole dictation,
 * or one whole sentence of it. A trigger inside a longer sentence is ordinary text. Returns
 * null when nothing matched.
 */
export function findSnippets(text: string, snippets: readonly Snippet[]): Piece[] | null {
  if (snippets.length === 0 || text.trim() === "") return null;
  const byTrigger = new Map<string, Snippet>();
  for (const snippet of snippets) byTrigger.set(normaliseTrigger(snippet.trigger), snippet);
  const whole = byTrigger.get(normaliseTrigger(text));
  if (whole) return [{ kind: "snippet", snippet: whole }];

  const pieces: Piece[] = [];
  let found = false;
  // Sentences end at . ! ? (followed by a space or the end) or at a line break.
  for (const match of text.matchAll(/[^\n]*?(?:[.!?]+(?=\s|$)|\n|$)/g)) {
    const sentence = match[0];
    if (sentence === "") continue;
    const snippet = byTrigger.get(normaliseTrigger(sentence));
    if (snippet && normaliseTrigger(sentence) !== "") {
      found = true;
      pieces.push({ kind: "snippet", snippet });
      continue;
    }
    const last = pieces.at(-1);
    if (last?.kind === "text") last.text += sentence;
    else pieces.push({ kind: "text", text: sentence });
  }
  if (!found) return null;
  return pieces
    .map((piece) => (piece.kind === "text" ? { ...piece, text: piece.text.trim() } : piece))
    .filter((piece) => piece.kind === "snippet" || piece.text !== "");
}

export interface Assembled {
  /** Plain text: what is typed, recorded and pasted for plain-text apps. */
  text: string;
  /** HTML beside it when a rich snippet is in the dictation. */
  html: string | null;
}

/**
 * Puts the cleaned text pieces and the snippet bodies back together. A body with several
 * lines, or a rich one, starts on its own line; a one-line body joins the sentence flow.
 */
export function assemble(pieces: readonly Piece[]): Assembled {
  const rich = pieces.some((piece) => piece.kind === "snippet" && piece.snippet.rich !== null);
  let text = "";
  pieces.forEach((piece, index) => {
    const body = piece.kind === "text" ? piece.text : piece.snippet.plain;
    if (index > 0) {
      const multiline =
        rich ||
        body.includes("\n") ||
        text.includes("\n") ||
        (piece.kind === "snippet" && piece.snippet.plain.includes("\n"));
      text += multiline ? "\n" : " ";
    }
    text += body;
  });
  const html = rich
    ? pieces
        .map((piece) =>
          piece.kind === "text"
            ? `<p>${plainToHtml(piece.text)}</p>`
            : piece.snippet.rich
              ? richToHtml(piece.snippet.rich)
              : `<p>${plainToHtml(piece.snippet.plain)}</p>`,
        )
        .join("")
    : null;
  return { text, html };
}
