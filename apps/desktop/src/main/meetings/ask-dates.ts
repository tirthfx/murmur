/**
 * Dates in a question ("last Tuesday", "yesterday", "last week") become a range before the
 * search, worked out from the local clock (NT-14). English only; a question with no such words
 * gives null. `from` is the start of the first day and `to` the start of the day after the last.
 */
export interface DayRange {
  from: number;
  to: number;
  /** The words of the question that gave the range ("last Tuesday"). */
  phrase?: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const day = (base: Date, offset = 0) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);

/** "17 Nov 2026" or "9 Nov 2026 to 15 Nov 2026", for the prompt. */
export function describeRange(range: DayRange): string {
  const fmt = (at: number) =>
    new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const first = fmt(range.from);
  const last = fmt(range.to - 1);
  return first === last ? first : `${first} to ${last}`;
}

export function questionRange(question: string, nowMs: number): DayRange | null {
  const text = question.toLowerCase();
  const today = day(new Date(nowMs));
  const range = (from: Date, to: Date, match: RegExpExecArray | null): DayRange => ({
    from: from.getTime(),
    to: to.getTime(),
    ...(match ? { phrase: match[0] } : {}),
  });
  // Weeks start on Monday.
  const sinceMonday = (today.getDay() + 6) % 7;
  const monday = day(today, -sinceMonday);

  const lastDays = /\b(?:in the )?(?:last|past)\s+(\d{1,3})\s+(day|week)s?\b/.exec(text);
  if (lastDays) {
    const n = Number(lastDays[1]) * (lastDays[2] === "week" ? 7 : 1);
    return n > 0 ? range(day(today, -n + 1), day(today, 1), lastDays) : null;
  }
  const simple: [RegExp, () => [Date, Date]][] = [
    [/\byesterday\b/, () => [day(today, -1), today]],
    [/\btoday\b/, () => [today, day(today, 1)]],
    [/\blast week\b/, () => [day(monday, -7), monday]],
    [/\bthis week\b/, () => [monday, day(monday, 7)]],
    [
      /\blast month\b/,
      () => [
        new Date(today.getFullYear(), today.getMonth() - 1, 1),
        new Date(today.getFullYear(), today.getMonth(), 1),
      ],
    ],
    [
      /\bthis month\b/,
      () => [
        new Date(today.getFullYear(), today.getMonth(), 1),
        new Date(today.getFullYear(), today.getMonth() + 1, 1),
      ],
    ],
  ];
  for (const [pattern, dates] of simple) {
    const match = pattern.exec(text);
    if (match) return range(...dates(), match);
  }
  // "last Tuesday": the most recent one before today.
  for (const [weekday, name] of WEEKDAYS.entries()) {
    const match = new RegExp(`\\blast\\s+${name}\\b`).exec(text);
    if (match) {
      const back = ((today.getDay() - weekday + 6) % 7) + 1;
      return range(day(today, -back), day(today, -back + 1), match);
    }
  }
  return null;
}

/**
 * The question without the words that gave its dates. The search was already limited to those
 * days, and a small model that reads "last Tuesday" looks for it in the text and refuses.
 */
export function withoutDates(question: string, range: DayRange | null): string {
  if (!range?.phrase) return question;
  const at = question.toLowerCase().indexOf(range.phrase);
  if (at < 0) return question;
  const cut = (question.slice(0, at) + question.slice(at + range.phrase.length))
    .replace(/\s+(in|on|from|during|of|at)\s*([?.!]*)\s*$/i, "$2")
    .replace(/\s+([?.!,])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:]+/, "")
    .trim();
  const tidy = cut.charAt(0).toUpperCase() + cut.slice(1);
  return tidy.length >= 3 ? tidy : question;
}
