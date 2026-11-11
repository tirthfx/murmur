# Styles and app categories

Styles per context (vault spec PZ-11 to PZ-13), set on the Hub's Styles page.

## Categories

Each dictation belongs to one category, found at the start from the app in front:

1. the owner's choice for that app (Styles page, stored in `app_categories`);
2. Murmur's default table of common Mac apps (`apps/desktop/src/main/styles/app-categories.ts`);
3. in a browser, words in the page title (Gmail or Outlook → Email; WhatsApp or Discord →
   Personal; Slack, Notion, Jira, GitHub, Google Docs → Work);
4. otherwise Other.

Categories are Personal, Work, Email and Other, plus Developer for code editors and
terminals (used by the developer features; until then Developer apps use the Other style).

## Presets

| Preset                    | What the rules do after cleanup                                | What the model is told                     |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| Caps and punctuation      | nothing                                                        | nothing                                    |
| No caps, less punctuation | lower-cases sentence starts; no full stop at the end of a line | nothing                                    |
| No caps, no full stops    | lower-cases sentence starts; no full stop after any word       | nothing                                    |
| More exclamations         | nothing                                                        | an exclamation may end an excited sentence |
| Formal                    | nothing                                                        | write formally, no slang                   |
| Custom                    | nothing                                                        | only the owner's own instructions          |

Defaults: Personal "No caps, less punctuation"; Work and Other "Caps and punctuation"; Email
"Formal". Each style also takes the owner's own instructions (up to 500 characters), told to
the model after the fixed prompt, so the model's cached prefix is unchanged.

The rules never lower-case "I", acronyms, words with capitals inside (GitHub) or names from
the dictionary and the screen. They are pure functions in `packages/shared/src/styles.ts`,
so the example line on the Styles page is produced by the same code as a dictation.

The model's output guard still applies: an instruction that makes the model add words is
refused, and the rules' text is used.

## What is read

The app's bundle id, name and window title are read at the start of every dictation, for
the category only, even when "Use the text around the cursor" is off. With that setting off
no text around the caret is asked for, and the title is not used for spelling. The style and
the app name are written to history (`style_id`, `app_name`).

## Storage

Migration `0005_styles.sql`: `styles` (one built-in row per category, as in the vault's data
model, plus a `preset` column) and `app_categories` (the owner's choices).

## Manual test

1. Dictate "sounds good see you at five" in Messages: "sounds good. see you at five".
2. Dictate the same in Mail: capitals and full stops.
3. On the Styles page, set Personal to "Caps and punctuation": Messages now gets capitals.
4. `npm run smoke -- --full` puts the test window's app in Personal and checks the result.
