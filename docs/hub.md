# The Hub

The Hub is Murmur's main window (HB-01). Closing it keeps Murmur running in the tray; open it again from the tray or the Dock.

## Sidebar

Pages, in order: Home, Dictation, Notetaker, Connectors, Dictionary, Snippets, Styles, Rewrites, Instruct, Scratchpad, History, My Voice, Memory, Insights, Settings, Help. The list lives in `apps/desktop/src/renderer/hub/pages.ts`.

- A page with a `feature` is hidden while that feature is off, and asking for it shows Home instead. Only Scratchpad has one.
- My Voice and Memory are never hidden, because their on/off switches are on those pages.
- Notetaker came with M5 (#184, see `docs/notetaker.md`); Tasks follows (#189). Connectors came with M6 (#215, see `docs/connectors.md`).

## Routes and what is remembered

- Each page has a hash route, for example `#/history`. Main can also ask for a page with `hub:open-page` (after a Bar prompt, for example).
- Every page change is sent to main with `hub:set-page`.
- Main keeps the last page, the window size and the window position in `hub-window.json` in the profile folder. Writes wait half a second, so a drag writes once.
- On the next start the Hub opens at that size, on that page.
- A saved position is used only if a connected display still shows the window's top edge. Otherwise the window opens centred.

## Home (HB-02)

- **Greeting:** a greeting for the time of day. The display name (Settings, General, "Your name") is added when "Show my name on Home" is on. The name is optional, local, and never sent anywhere.
- **Today:** words, dictations and estimated time saved, from Insights' daily counts (`home:view`).
- **Shortcut and last dictation:** the push-to-talk shortcut, and the last dictation with its app.
- **Speech model:** while the model is missing or failed, a banner offers the download. While it downloads, the progress shows.
- **Setup checklist:** permissions, the speech model and a first dictation. It looks again every 1.5 seconds while something is left, and is hidden once everything is done.
- **Tip of the day:** from a bundled list, the same tip all day.

## Dictation (HB-03)

- **Status cards:** the live state (Ready, Listening, Working on it, or needs a look on the Bar), the microphone, the language mode and the speech model.
  - Main pushes the state when the Bar changes it (`dictation:state-changed`). The list reads again when the state goes back to idle.
- **Cleanup:** the same setting as in Settings, System.
- **Recent dictations:** the 50 most recent. Each has copy, copy raw and delete; delete needs a confirming click.
- **Retry:** a failed or interrupted dictation whose recording is still kept can be retried (`history:retry`).
  - The recording is transcribed and cleaned again, and the text goes into the same row, so there is no duplicate.
  - The row is then marked as left on the clipboard, and the text is copied there: the Hub has no app to insert into.
  - The retry is counted in Insights on the day of the original dictation.

## Themes (HB-22)

Settings, General, Appearance offers System (the default), Light or Dark. The setting is stored as `ui.theme`.

- **How it applies:** main sets Electron's `nativeTheme.themeSource` to the choice, at start and whenever it changes. Every window follows `prefers-color-scheme` (the Hub and Scratchpad through Astryx's "system" mode; the Rewrite and Instruct panels and the diff colours through their own CSS), so all open windows switch at once with no reload. On System they also follow macOS as it changes.
- **The Bar and the Focus overlay** stay dark in every theme, so they read the same over any app.
- **Contrast:** `renderer/contrast.test.ts` checks our own colours outside the Astryx tokens for WCAG AA (4.5:1): the Bar's text and state colours, and the Focus overlay. `rewrite/diff-colors.test.ts` checks the diff colours and the Rewrite card in both themes.

## Help (HB-08)

**Guided tours:** five of them, defined in `packages/shared/src/help.ts`:

- your first dictation;
- shortcuts;
- cleanup levels;
- Dictionary and Snippets;
- Rewrites and Command Mode. The Command Mode step is shown only while that experiment is on.

**How a tour runs:**

- Each step opens a Hub route and highlights one part of it: a page heading, or a Settings row by its `data-setting` id.
- A card in the corner explains the step, with Back, Next and Stop.
- The step is saved in `help.tours`, so Stop and then Resume returns to the same step. A finished tour is marked done and can be run again.

**The rest of the page:**

- **Restart tutorial** runs first-run setup again.
- **Report a problem** writes a diagnostics folder where you choose. It holds versions, masked settings and counts, never dictated text, and nothing is uploaded.
- The page also shows the app version.
- The bundled Markdown guides are not built.

## Referrals (HB-43)

Settings, General has a Referrals card:

- an eight-character code, made once on this Mac from letters and digits that cannot be confused (no I, O, 0 or 1), and kept in `referral.settings`;
- an invitation count you keep by hand, with + and − buttons;
- a note that referral rewards are not available in Murmur.

Nothing is sent, and no one is told.
