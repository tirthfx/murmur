// Instruct Mode drafts text only (RW-11). A request to act outside the field (send an email,
// schedule a meeting, set a reminder) still gets a draft, with a line saying nothing was done.

const ACTION_START =
  /^(?:(?:ok|okay|so|please|now|just|can you|could you|would you)\s+)*(?:send|email|e-mail|text|message|dm|forward|post|tweet|publish|schedule|book|reserve|remind|call|ring|invite|cancel|set up|setup|create|add|set)\b/;
const ACTION_ANYWHERE =
  /\b(?:(?:and|then)\s+(?:send|post|forward|schedule|publish|email|book)|send (?:it|this|that|them)|remind me|(?:set|create|add|make)\s+(?:a\s+|an\s+)?(?:reminder|alarm|timer|calendar (?:event|invite)|meeting|event|appointment|task|to-?do))\b/;
/** Asking for words about an action is drafting, not acting. */
const DRAFTING =
  /^(?:(?:ok|okay|so|please|now|just|can you|could you|would you)\s+)*(?:draft|write|compose|prepare|reply|respond|answer|rewrite|summari[sz]e|translate|make|turn|give me|help me write)\b/;

/** True when the instruction asks Murmur to do something it cannot: send, schedule, remind. */
export function asksForAction(instruction: string): boolean {
  const text = instruction
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ACTION_ANYWHERE.test(text)) return true;
  if (DRAFTING.test(text)) return false;
  // "create" and "add" alone ("add a line about…") are edits; they need an action noun.
  if (/^(?:create|add|set)\b/.test(text.replace(/^(?:please|can you|could you)\s+/, ""))) {
    return false;
  }
  return ACTION_START.test(text);
}

/**
 * The instruction for an action request, so the model writes the text only: the message, with
 * a greeting to the person named, never a confirmation and never the request itself.
 */
export function actionInstruction(request: string): string {
  return [
    `The user said: "${request.trim()}". You cannot send, schedule or set anything.`,
    "Write only the message they would send for it, addressed to the person named (start with a short greeting to them), using the text below as its content if there is any.",
    "Do not repeat the request, do not write it as a confirmation, and never say it was sent, scheduled, booked or done.",
  ].join(" ");
}

/** How a follow-up is asked: change the current draft, which is sent as the text. */
export function followUpInstruction(request: string, older: string[]): string {
  const lines = [
    `Change the current draft as the user asks: "${request.trim()}".`,
    "Answer with the whole new draft only.",
  ];
  if (older.length > 0) {
    lines.push(`Earlier requests in this thread, still to respect: ${older.join("; ")}.`);
  }
  return lines.join(" ");
}

/** A dictation that starts like a request to write (RW-16): "draft a…", "write a reply…". */
const INSTRUCTION_START =
  /^(?:(?:ok|okay|so|please|can you|could you)\s+)*(?:draft (?:a|an|the|me)|write (?:a|an|the|me)|compose (?:a|an)|rewrite (?:this|that|it)|summari[sz]e (?:this|that|it)|make a list of|reply to|respond to|write back)\b/;

export function looksLikeInstruction(text: string): boolean {
  const start = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return INSTRUCTION_START.test(start);
}
