/**
 * The speech model sometimes writes noises instead of words: "*thud*", "[BLANK_AUDIO]",
 * "[Music]", "(laughs)". None of that was said, so it never reaches the text. Brackets and
 * asterisks are always noise labels in this model's output; parentheses only when the whole
 * text is one, since a person can dictate a word in parentheses.
 */
export function dropSoundTags(text: string): string {
  let out = text.replace(/\*[^*\n]{1,40}\*/g, " ").replace(/\[[^\]\n]{1,40}\]/g, " ");
  if (/^\s*\([^)\n]{1,40}\)\s*[.!?]?\s*$/.test(out)) out = "";
  return out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}
