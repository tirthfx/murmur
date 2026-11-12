// Cleaning a generated answer (RW-07): no preface, no wrapping quotes or tags, and a check
// that the model did not just repeat the instruction. No imports, so scripts can load it.

/** A first line that only announces the answer ("Sure! Here is the rewritten text:"). */
const PREFACE =
  /^\s*(?:(?:sure|certainly|of course|okay|ok|absolutely|great)[!,.]?\s*)?(?:here(?:'s| is| are)|below is|this is)\b[^\n]{0,120}?:[ \t]*(?:\n+|$)/i;
const BARE_ACK = /^\s*(?:sure|certainly|of course|okay|absolutely)[!.]\s*\n+/i;

/** Removes an announcing first line, a `<text>` wrapper, code fences and wrapping quotes. */
export function stripPreface(answer: string): string {
  let text = answer.replace(BARE_ACK, "").replace(PREFACE, "");
  text = text.replace(/^\s*<text>\s*\n?/i, "").replace(/\n?\s*<\/text>\s*$/i, "");
  const fenced = /^\s*```[a-z]*\n([\s\S]*?)\n```\s*$/i.exec(text);
  if (fenced) text = fenced[1]!;
  const quoted = /^\s*(["“])([\s\S]*)(["”])\s*$/.exec(text);
  if (quoted && !quoted[2]!.includes(quoted[1]!) && !quoted[2]!.includes(quoted[3]!)) {
    text = quoted[2]!;
  }
  return text.trim();
}

const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * True when the answer is mostly the instruction itself: it starts with the instruction's
 * words, or contains a run of 8 or more of them in order.
 */
export function repeatsInstruction(answer: string, instruction: string): boolean {
  const asked = words(instruction);
  if (asked.length < 4) return false;
  const said = words(answer);
  const head = asked.slice(0, Math.min(6, asked.length)).join(" ");
  if (said.slice(0, Math.min(6, asked.length)).join(" ") === head) return true;
  const run = Math.min(8, asked.length);
  const joined = ` ${said.join(" ")} `;
  for (let start = 0; start + run <= asked.length; start++) {
    if (joined.includes(` ${asked.slice(start, start + run).join(" ")} `)) return true;
  }
  return false;
}

/**
 * Holds back the start of a stream until a preface can be recognised (the first line break,
 * or 160 characters), then passes everything on with the preface removed.
 */
export function createPrefaceFilter(emit: (chunk: string) => void): {
  push(chunk: string): void;
  /** Sends what is still held; returns the whole cleaned answer so far. */
  end(): string;
} {
  let held = "";
  let open = true;
  let sent = "";
  const send = (chunk: string) => {
    if (chunk === "") return;
    sent += chunk;
    emit(chunk);
  };
  const release = () => {
    open = false;
    const stripped = held
      .replace(BARE_ACK, "")
      .replace(PREFACE, "")
      .replace(/^\s*<text>\s*\n?/i, "");
    held = "";
    send(stripped.replace(/^\s+/, ""));
  };
  return {
    push(chunk) {
      if (!open) return send(chunk);
      held += chunk;
      // Decide once a line with content has ended, or enough has arrived.
      if (held.length >= 160 || held.trimStart().includes("\n")) {
        // A bare "Sure!" line: wait for the next line, which may be the real preface.
        if (BARE_ACK.test(held) && held.replace(BARE_ACK, "").trim() === "") return;
        release();
      }
    },
    end() {
      if (open) release();
      return sent;
    },
  };
}
