# Notifications and interface text

## Notifications (HB-24)

Murmur sends macOS notifications from main, using Electron's `Notification`.

| Type                                                   | Default | Clicking opens |
| ------------------------------------------------------ | ------- | -------------- |
| A dictation did not go in (at most once a minute)      | on      | Dictation page |
| The speech model downloaded, or failed to              | on      | Home           |
| Focus Mode ended on its timer                          | on      | Home           |
| A milestone was reached                                | off     | Insights       |
| Weekly summary: last week's words and the daily streak | off     | Insights       |

**No dictated text, ever:**

- The notifier (`main/notifications/notifier.ts`) only takes counts or a milestone's name; every other text is fixed.
- No method accepts a transcript, and a test checks the texts.

**The weekly summary:**

- It is checked at start and every hour.
- It covers the finished Monday-to-Sunday week before this one, and is sent once per week (remembered in `insights_meta`).
- It is not sent if that week had no words.

**Settings:** the switches are on Settings, General (`notifications.settings`).

**Permission:** macOS asks for it the first time a notification is shown. Electron has no way to ask earlier, so the permission is not requested when a switch is turned on.

## Interface text (HB-23)

The tray menu and the notifications take their text from `packages/shared/src/catalogue.ts`.

- **Catalogues:** one per language. English is complete; the catalogue's type is built from it.
- **`translate(language, key, values)`:** fills `{name}` marks with values. A missing language or key falls back to English, so a raw key is never shown.
- **The setting:** Settings, General, App language (`ui.language`). It lists only English for now.
- **Switching language:** the tray is rebuilt when settings change, so it switches without a restart.
- **Still to do:** the Hub's own text is not in the catalogue yet; it moves there when a second language is added.
