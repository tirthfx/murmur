# Settings

The Hub's Settings page. Every change applies at once; nothing needs a restart.

## Pages and search (HB-12)

Settings is split into pages, chosen from a list beside the content. Each page has its own route, for example `#/settings/microphone`.

| Page             | What is on it                                                                     |
| ---------------- | --------------------------------------------------------------------------------- |
| General          | launch at login, show the Hub at start, permissions, run setup again, the version |
| System           | cleanup, press enter, context, typing reminder, sounds, mute, Instruct Mode       |
| Shortcuts        | push to talk, hands-free, Rewrite, the mouse buttons                              |
| Languages        | dictation languages                                                               |
| Microphone       | the microphone, whisper mode, microphone check                                    |
| Experimental     | the experimental switches, and Command Mode and Focus Mode while they are on      |
| Plans            | the local plan tier                                                               |
| Data and Privacy | what leaves this Mac                                                              |

- Every setting is listed once in `SETTINGS_INDEX` (`apps/desktop/src/renderer/hub/settings-pages.ts`), with its page and a `data-setting` row id. A test checks that each indexed row is on its page.
- The search box matches labels and a few other words. Choosing a result opens the setting's page, scrolls to the setting and highlights it for two seconds.
- **Launch at login** uses the macOS login item, and works only in the packaged app. In a development run the switch is disabled and says why.
- **Show the Hub when Murmur starts** (`app.open_hub_on_launch`) is on by default. When it is off, Murmur starts in the menu bar only. First-run setup always shows the Hub.

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

## Plan (RW-22)

A local switch for testing what each plan unlocks, stored as `plan.tier`. There is no payment,
billing or subscription of any kind, and nothing is sent anywhere. The tiers are Free, Pro,
Team, Growth and Enterprise (TM-25). The owner's build defaults to Enterprise, so every feature
can be tried.

Free keeps:

- the five built-in Rewrites;
- 3 custom Rewrites;
- 3 Rewrite shortcuts;
- Instruct Mode with the Fast model.

Free locks:

- more custom Rewrites and Rewrite shortcuts;
- auto-apply;
- Command Mode;
- the Quality model;
- Focus Mode.

Pro and every tier above it have everything. Locked controls say "Available on Pro".

Main checks the gates on every action, not only at start (`apps/desktop/src/main/plans/gates.ts` and `planAllows` in `packages/shared/src/plans.ts`):

- **Rewrites:** a fourth custom Rewrite (new or duplicated) is refused. A Rewrite shortcut beyond the third is refused, and only the first three are bound. An auto-apply that is already on is skipped, but it can still be turned off.
- **Command Mode and Focus Mode:** their keys are not bound, and the key, the wake phrase, the tray and the Focus controller all do nothing.
- **Quality model:** Instruct Mode uses Fast, and the panel's switch says "Available on Pro". The download itself is still allowed.

A plan change rebinds the keys at once, so switching to Pro unlocks Command Mode without a restart. The full Plans page (trial, student label, Free's weekly word limit) comes in M4 (HB-19).
