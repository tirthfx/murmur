import type { EmailStyle } from "@murmur/shared";

const GREETING = /^(hi|hello|hey|dear|good (?:morning|afternoon|evening)|greetings)\b/i;
const SIGN_OFF =
  /^(thanks(?: (?:so much|a lot|again))?|thank you|best(?: regards| wishes)?|kind regards|warm regards|regards|cheers|sincerely|all the best|talk soon|yours(?: truly| sincerely)?)[,!.]?$/i;
/** Where the earlier message starts in a reply or a forward. */
const QUOTE_START = /^(>|on .+ wrote:$|-{2,} ?(original|forwarded) message|-- ?$|from: .+)/i;
/** A habit is something at least this share of messages do. */
const HABIT = 0.25;

/** The words the owner wrote themselves: without the quoted earlier mail and the signature. */
export function ownLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const end = lines.findIndex((line) => QUOTE_START.test(line));
  return (end < 0 ? lines : lines.slice(0, end)).filter(Boolean);
}

/** "Hi Priya," as "Hi {name},", so openings to different people are the same habit. */
function greetingOf(line: string): string | null {
  const match = GREETING.exec(line);
  if (!match || line.length > 60) return null;
  const word = match[1]!;
  const rest = line.slice(word.length).trim();
  const mark = /[,!:.]$/.exec(rest)?.[0] ?? "";
  const name = rest.slice(0, rest.length - mark.length).trim();
  const opening = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  if (!name) return `${opening}${mark}`;
  const group = /^(all|team|everyone|there|both|folks)$/i.test(name);
  return `${opening} ${group ? name.toLowerCase() : "{name}"}${mark}`;
}

function signOffOf(lines: readonly string[]): string | null {
  // The sign-off is near the end, with perhaps the name under it.
  const found = lines.slice(-3).find((line) => SIGN_OFF.test(line));
  return found ? found.charAt(0).toUpperCase() + found.slice(1) : null;
}

/** The commonest value, when it is common enough to be a habit. */
function habit(values: readonly (string | null)[], total: number): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= Math.max(2, total * HABIT) ? best[0].slice(0, 80) : null;
}

/**
 * How the owner usually writes email (PZ-23), by plain counting on this Mac: the opening, the
 * sign-off and the usual length. Null with fewer than three messages that say anything.
 */
export function learnEmailStyle(texts: readonly string[], now: number): EmailStyle | null {
  const messages = texts.map(ownLines).filter((lines) => lines.length > 0);
  if (messages.length < 3) return null;
  const lengths = messages
    .map((lines) => lines.join(" ").split(/\s+/).length)
    .sort((a, b) => a - b);
  return {
    greeting: habit(
      messages.map((lines) => greetingOf(lines[0]!)),
      messages.length,
    ),
    signOff: habit(messages.map(signOffOf), messages.length),
    words: lengths[Math.floor(lengths.length / 2)]!,
    messages: messages.length,
    learnedAt: now,
  };
}
