# Developer mode and the Testing page

## Developer mode (HB-20)

- **Turning it on:** click the version line on Settings, General five times. Developer mode is stored in `dev.settings.enabled`.
- **The Testing page:** while developer mode is on, Settings lists a Testing page. That page's switch turns developer mode off, which hides the page again; the `#/settings/testing` route then goes back to General.
- **Warning:** a banner at the top says the page is for testing and can change data.

## Feature flags (HB-54)

`FLAG_REGISTRY` (`packages/shared/src/testing.ts`) describes every experimental switch in `experimental.flags`: its label, what it does, the milestone that owns it, and its default (off for all).

The Testing page lists them all:

- A flag that differs from its default shows "overridden" and a Reset button.
- Values are settings, so an override survives a restart.
- No flag comes from a network address.

## Tools (HB-55)

| Tool                  | What it does                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restart onboarding    | Clears the setup flag and opens setup                                                                                                                |
| Reset personalisation | Deletes the Dictionary, Snippets, Styles overrides, Memory, Voice Profile and learned suggestions, after a confirmation that names how many items go |
| Test notification     | Sends one notification, whatever the switches say                                                                                                    |
| Cycle Bar states      | Shows listening, locked, processing, done, warning, error and cancelled on the Bar, two seconds each (not while dictating)                           |
| Diagnostics bundle    | Writes a `Murmur diagnostics <date>` folder where you choose, holding `diagnostics.json`: versions, OS, helper status, settings and counts           |

**What the diagnostics bundle leaves out:** the display name, the email signature and the wake phrase are replaced by "(set)", and no dictated or written text is ever in it. Nothing is sent.

The tools refuse to run while developer mode is off.

**Not built:** the sandbox demo database and the helper log level. Murmur writes no log files, so the bundle has no log file to include.

## Engine switches (HB-57)

These are in `dev.settings` and all off by default:

- **Turn off model cleanup:** only the deterministic rules clean a dictation.
- **Force typed insertion:** the text is typed instead of pasted.
- **Turn off context reading:** no text around the cursor is read, whatever Settings says.

The model path overrides are not built.

## Accessibility inspector (HB-56)

**Using it:** "Inspect" waits 3 seconds, so you can switch to the app to look at. It then asks the helper for `ax.inspect`.

**What the helper returns:** the focused window of the app in front as rows, depth first, at most 6 levels deep and 500 elements. A cut-short tree says so. Each row has the role, subrole, title, whether the field is editable, whether it is secure, and the selection.

**Values:**

- They are read only with "Show values" on, cut to 200 characters, and shown under a warning.
- A secure field never gives a value or a selection.

Nothing is saved. The request needs Accessibility access; without it, the page says so.

**Code:** `AXInspect.swift` holds the walker, over a small element protocol so tests use a fake tree, and the system source.
