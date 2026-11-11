/** The spoken command that asks for Return after the text (DC-36). */
const PRESS_ENTER = /(?:^|[\s,;:\-–—]+|(?<=[.!?…]))\s*press enter[\s.!?…]*$/i;

export interface PressEnterSplit {
  /** The text without the command. */
  text: string;
  pressEnter: boolean;
}

/**
 * Takes "press enter" off the end of a dictation. Only the last words count: the phrase in
 * the middle of a sentence is ordinary text. What is left ends like a sentence, so "Send the
 * file, press enter." becomes "Send the file.".
 */
export function splitPressEnter(text: string): PressEnterSplit {
  const match = PRESS_ENTER.exec(text);
  if (!match) return { text, pressEnter: false };
  let rest = text.slice(0, match.index).replace(/[\s,;:\-–—]+$/, "");
  if (rest !== "" && !/[.!?…]$/.test(rest)) rest += ".";
  return { text: rest, pressEnter: true };
}
