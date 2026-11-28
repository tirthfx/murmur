import type { HotkeyTrigger } from "@murmur/shared";

/** macOS virtual key code of Right Option. */
export const MAC_KEY_RIGHT_OPTION = 61;

/** macOS virtual key code of R. */
const MAC_KEY_R = 15;

/** Right Command, held on its own (RW-08). Pressed with another key it does nothing. */
export const MAC_DEFAULT_COMMAND_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: 54,
  modifiers: [],
};

/**
 * Control+Option+F turns Focus Mode on or off (RW-18). Not Option+F: on a Mac that types "ƒ".
 */
export const MAC_DEFAULT_FOCUS_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: 3,
  modifiers: ["control", "option"],
};

/**
 * Control+Option+S opens the Scratchpad (HB-26). Not Option+S: on a Mac that types "ß".
 */
export const MAC_DEFAULT_SCRATCHPAD_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: 1,
  modifiers: ["control", "option"],
};

/** Control+Option+I, held while speaking (RW-11). */
export const MAC_DEFAULT_INSTRUCT_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: 34,
  modifiers: ["control", "option"],
};

/** Control+Option+C and Control+Option+V: copy and paste the last transcript (DC-39). */
export const MAC_DEFAULT_COPY_LAST_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: 8,
  modifiers: ["control", "option"],
};
export const MAC_DEFAULT_PASTE_LAST_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: 9,
  modifiers: ["control", "option"],
};

/** Control+Option+R opens the Rewrite panel (RW-01). */
export const MAC_DEFAULT_REWRITE_TRIGGER: HotkeyTrigger = {
  type: "key",
  keyCode: MAC_KEY_R,
  modifiers: ["control", "option"],
};
