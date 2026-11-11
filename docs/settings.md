# Settings

The Hub's Settings page. Every change applies at once; nothing needs a restart.

## What can be set

| Setting      | Stored as             | Default                 | Applies                                      |
| ------------ | --------------------- | ----------------------- | -------------------------------------------- |
| Push to talk | `hotkey.dictate_hold` | Right Option            | sent to the helper at once                   |
| Hands-free   | `hotkey.hands_free`   | none (double tap, #14)  | sent to the helper at once (acted on in #14) |
| Microphone   | `audio.input_device`  | `auto` (system default) | from the next dictation                      |
| Language     | `speech.language`     | `auto` (detect)         | from the next transcription; fixed sends one |
| Cleanup      | `cleanup.level`       | `standard`              | from the next dictation                      |

Values live in the `settings` table as JSON. A stored value that no longer validates falls back to the default.

## Recording a shortcut

Press Change, then the new shortcut. A modifier pressed and released on its own (for example Right Option) becomes the shortcut by itself; otherwise the first non-modifier key is taken with the modifiers held. Escape cancels. While recording, the dictation key is paused so pressing it does not start a dictation.

Refused, with the reason shown:

- a shortcut the other slot uses ("Right Option is already used for Push to talk");
- shortcuts macOS keeps (Command+Space for Spotlight, Control+Space for input sources, Command+Tab, Command+Q, screenshots, Mission Control and others);
- a plain letter or number without a modifier (it would type into apps), Caps Lock, and keys Murmur cannot map.

Key codes and names are Mac specific and live in `apps/desktop/src/main/platform/mac-keymap.ts`.

## Microphone

The list comes from the helper (Core Audio, no permission needed). If the chosen microphone is not connected when a dictation starts, the system default is used and the log says so.

## Flag groups

A group of flags (for example `experimental.flags`) stored before a new flag was added keeps its
stored values; the new flag takes its default.
