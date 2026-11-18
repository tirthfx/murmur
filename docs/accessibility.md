# Accessibility

Keyboard and screen-reader support (HB-25).

## What the tests check

`renderer/hub/a11y-audit.ts` is a small checker of our own; adding an accessibility library would have been a new download. `accessibility.test.tsx` runs it on every Hub page, every Settings page (Testing included) and the Scratchpad window with a note open. It fails on:

- a button, link, field, switch, checkbox, radio, tab or text box with no accessible name;
- an image with no alt text;
- a positive `tabindex`, which would change the tab order;
- an id used twice;
- a heading that skips a level going down (h1 straight to h3).

The test also checks that Tab moves into the page.

## The Bar

- **Announcements:** the Bar has a hidden live region that announces only state changes: "Listening", "Hands-free dictation on", "Transcribing", "Done, 12 words", warnings, errors and "Cancelled". The level meter, the elapsed time and Focus Mode's countdown are hidden from screen readers, so nothing repeats every second.
- **Reduced motion:** with Reduce motion on in macOS, the spinner stops (checked by a test on the CSS).
- **No pointer needed:** dictation starts from the push-to-talk key.

## By hand (VoiceOver)

The automated check does not replace a pass with VoiceOver. To do on the owner's Mac:

1. Turn on VoiceOver (Command+F5). In the Hub, Tab through every page. Each control should be read with a name, in the order it appears.
2. Dictate. VoiceOver should say "Listening", then "Transcribing", then "Done, N words", once each.
3. Turn on Reduce motion (System Settings, Accessibility, Display). The Bar's spinner should stand still.
4. In the Scratchpad, Tab from the notes list into a tab and the editor, and back out.
5. Press Escape in a dictation: "Cancelled" is read.
