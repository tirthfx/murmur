# The Hub

The Hub is Murmur's main window (HB-01). Closing it keeps Murmur running in the tray; open it again from the tray or the Dock.

## Sidebar

Pages, in order: Home, Dictation, Dictionary, Snippets, Styles, Rewrites, Instruct, Scratchpad, History, My Voice, Memory, Insights, Settings, Help. The list lives in `apps/desktop/src/renderer/hub/pages.ts`.

- A page with a `feature` is hidden while that feature is off, and asking for it shows Home instead. Only Scratchpad has one.
- My Voice and Memory are never hidden, because their on/off switches are on those pages.
- Notetaker and Tasks are added with M5.

## Routes and what is remembered

- Each page has a hash route, for example `#/history`. Main can also ask for a page with `hub:open-page` (after a Bar prompt, for example).
- Every page change is sent to main with `hub:set-page`.
- Main keeps the last page, the window size and the window position in `hub-window.json` in the profile folder. Writes wait half a second, so a drag writes once.
- On the next start the Hub opens at that size, on that page.
- A saved position is used only if a connected display still shows the window's top edge. Otherwise the window opens centred.
