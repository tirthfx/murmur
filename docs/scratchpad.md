# Scratchpad

Notes for free writing, separate from dictation history (HB-26, HB-31, HB-34). Notes stay on this Mac: there is no sync and no sharing link.

## The window

- **Opening it:** the Scratchpad has its own window. Open it from the Hub's Scratchpad page, from a recent note on that page, or with its shortcut, Control+Option+S. The shortcut is not Option+S, because on a Mac that types "ß".
- **How it loads:** the window shows the Hub's page at `#/scratchpad-window`, so it shares the Hub's preload, content security policy and IPC sender check. Opening it again brings the window forward. Main can ask it to show a note with `scratchpad:open-note`.
- **Layout:** the notes list (pinned first, then newest) and a search box on the left. Open notes are in tabs on the right, at most 8; opening a ninth closes the oldest tab. With "Open notes in a new tab" off, a note replaces the one shown.
- **Editor:** the snippet editor (bold, italic, underline, lists, links), now in `RichEditor.tsx`, and a title. A note with no title shows its first line.
- **Saving:** a note saves 2 seconds after typing stops. It also saves when you switch or close a tab, and when the window closes, so at most 2 seconds of typing can be lost. Notes hold up to 500 KB of text.
- **New note:** an empty note, or one holding the last dictation's text ("From last dictation").
- **Deleting:** needs a second, confirming click.
- **Dictation:** works in a note like in any other app.

## Search

- `notes_fts` (migration 0020) is an FTS5 index over the title and plain text, kept in step by triggers.
- Each typed word is a quoted prefix; the search runs 150 ms after typing stops.
- Title matches come first, then body matches, each newest first, up to 200 results.
- The preview shows the matching words highlighted. FTS5's `snippet()` marks them with two control characters, which are removed from every saved note, so stored text cannot fake a highlight.

## On and off

Settings, System has two switches:

- **Scratchpad:** turning it off hides the sidebar item and stops the shortcut, and an open window closes. Notes are kept and come back when it is turned on.
- **Open notes in a new tab.**

The shortcut is on Settings, Shortcuts (`hotkey.scratchpad`) and can be turned off.

## Storage

`notes`: id, title, body_json (the snippet editor's document), body_plain, created_at, updated_at, pinned, pin_order, archived, deleted_at. Pins and versions come with #153.
