import type { FocusContext } from "@murmur/shared";

/**
 * Whether the app in front says nothing at all has the focus (DC-01). Some apps report this
 * wrongly, so the text is still pasted; it is only also left on the clipboard.
 */
export function nothingFocused(context: FocusContext | null): boolean {
  return context !== null && context.role === null && !context.editable;
}

export const NO_FIELD_MESSAGE = "No text field found. The text is also on the clipboard.";
