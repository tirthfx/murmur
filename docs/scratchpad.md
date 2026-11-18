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

## Versions (HB-28)

Versions are kept in `note_versions` (migration 0021): the title, body, word count and an optional label. They are deleted with their note.

**When a version is saved:**

- after a save, once the newest version is more than 5 minutes old;
- when the note's tab is closed;
- with "Save version", which takes an optional label of up to 60 characters.

A version that would match the newest one is not saved. The one exception is "Save version" with a label.

**Limit:** the newest 50 versions per note are kept, so the 51st removes the oldest.

**Versions panel:** opened with "Versions". It lists each version's date, label and word count.

- **Compare** shows that version against the text on screen now, word by word, with the same diff colours as View changes.
- **Restore** first keeps the current text as a version, then puts the old text back and saves it as a new version labelled "Restored from …". No history is lost.

## Pins (HB-29)

- **Pinning:** "Pin" puts a note at the top of the list. At most 20 notes can be pinned; the 21st is refused with a message.
- **Order:** pinned notes keep their order (`pin_order`), which survives a restart. Up and Down buttons move a pinned note. There is no drag, so reordering also works from the keyboard.
- **Unpinning:** the note goes back to date order.

## Images (HB-30)

**Adding an image:** paste or drop one into a note, or use the editor's Image button (it works from the keyboard).

**Accepted types:** PNG, JPEG, HEIC, HEIF and GIF (the first frame only). The limits are 10 MB per image and 200 MB for all Scratchpad images together. Going over says how much is already used.

**How main stores it:**

1. HEIC, HEIF and GIF are first converted to PNG with `/usr/bin/sips`, behind `platform/mac-image.ts`. Electron's image reader cannot open those types; it returns an empty image.
2. The image is read, scaled so its long side is at most 2,048 px, and encoded again: PNG and GIF become PNG, everything else becomes JPEG at quality 85. Only the pixels are kept, so location and every other piece of metadata is gone.
3. The file is saved as `notes/<noteId>/<imageId>.png|jpg` in the data folder, with a row in `note_images` (migration 0022).

**In the note:** the body holds an image block with the image's id only. The editor loads the picture as a data URL over IPC (`notes:image-data`). The Hub's CSP already allows `data:` images, so there is no new protocol and no file path in the page.

**Deleting:** images are deleted with their note: the rows by cascade, then the note's folder. Images are never sent to a model; Rewrites work on text only.

**Checked by hand:**

- A 4000×3000 JPEG carrying a GPS EXIF block came out at 2048×1536 with no EXIF block.
- HEIC and GIF files of the same size came out at 2048×1536 through the same path.

## Headings

Notes have Heading and Text buttons. Headings are kept in the note's document (levels 1 to 3) and survive Markdown both ways. Snippets do not get headings.

## Rewrites in notes (HB-32)

**The Rewrite bar** sits above the editor and says what a Rewrite will work on:

- the selection, when text in the note is selected;
- otherwise, the whole note.

It shows Clarify, Tighten and Structure first, and More shows every enabled Rewrite.

**Running one:**

- The Rewrite runs through the same engine as a Rewrite of selected text (`notes:rewrite-run`). Only the Rewrite's instruction and example are used: a note is not an app, so no style, Memory or samples go in.
- The limit is 8,000 characters. A longer note asks you to select a part.

**The result** shows in the bar, with:

- **Replace:** puts the text in place as one edit (Command+Z undoes it), saves the note, and saves a version labelled "<Rewrite> applied";
- **Copy**;
- **View changes:** a word diff;
- **Regenerate:** changes the result in the bar, not the note;
- **Discard.**

**Records:** `note_rewrites` (migration 0023) stores the Rewrite and what became of it (replaced, copied or discarded), with no text. A replaced or copied result counts toward the "First Rewrite" milestone.

## Markdown and HTML (HB-27, HB-33)

There is no sync and no share link. Instead:

- **Copy as Markdown** puts the note on the clipboard as Markdown: headings, lists, bold, italic and links. Underline has no Markdown form and stays plain text. Images are left out.
- **Export Markdown** writes `<title>.md` where you pick, starting with the title as a heading. Images are copied to a `<title> images` folder beside it and referenced relatively.
- **Export HTML** writes one self-contained page with the images inside it.
- **Import** turns one `.md` file of up to 2 MB into a new note. The title is the first heading, or else the file name. Headings, lists, bold, italic and safe links (http, https, mailto) come through; images in the file are left out.
- An exported note imports back with its text and headings (tested).

## Storage

`notes`: id, title, body_json (the snippet editor's document), body_plain, created_at, updated_at, pinned, pin_order, archived, deleted_at. Pins use `pinned` and `pin_order`; versions are in `note_versions`.
