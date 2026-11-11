// Style detection (PZ-14, experimental): the field's content can set the category, from a few
// scored signals. No model call. Below the threshold the app's category stands.

export const DETECT_THRESHOLD = 0.75;

export interface Detected {
  category: "email" | "personal";
  confidence: number;
}

const DEAR = /^\s*dear\s+\S/i;
/** A greeting, then a capitalised name, then a comma: "Hi Sam," but not "hi sam,". */
const GREETING =
  /^\s*([Hh]i|[Hh]ello|[Hh]ey|[Gg]ood ([Mm]orning|[Aa]fternoon|[Ee]vening))\s+\p{Lu}[\p{L}'’-]*(\s+\p{Lu}[\p{L}'’-]*)?\s*,/u;
const SIGN_OFF =
  /(^|\n)\s*(best|best regards|kind regards|warm regards|regards|sincerely|yours sincerely|cheers|many thanks)\s*,?\s*(\n|$)/i;
const EMOJI = /\p{Extended_Pictographic}/gu;

/**
 * `field`: the text already in the field (memory only). `dictated`: what was just said. In an
 * empty field the dictated text is what counts, so "Hi Sam," starting a chat message is Email.
 */
export function detectCategory(field: string, dictated: string): Detected | null {
  const start = field.trim() === "" ? dictated : field;
  const all = `${field}\n${dictated}`;
  let email = 0;
  let personal = 0;
  if (DEAR.test(start)) email += 0.9;
  else if (GREETING.test(start)) email += 0.8;
  if (SIGN_OFF.test(all)) email += 0.3;
  const emoji = (all.match(EMOJI) ?? []).length;
  const words = all.split(/\s+/).filter(Boolean).length;
  if (emoji >= 2 || (emoji === 1 && words <= 15)) personal += 0.8;
  const lines = field.split("\n").filter((line) => line.trim() !== "");
  if (lines.length >= 3) {
    const average = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
    if (average < 30) personal += 0.4;
    else if (average > 120) email += 0.2;
  }
  email = Math.min(1, email);
  personal = Math.min(1, personal);
  if (email === personal) return null;
  const best: Detected =
    email > personal
      ? { category: "email", confidence: email }
      : { category: "personal", confidence: personal };
  return best.confidence >= DETECT_THRESHOLD ? best : null;
}
