# Data and privacy

Settings, Data and Privacy (HB-21, HB-48 to HB-50, HB-52).

## What leaves this Mac

**The statement:** the page says "Nothing leaves this Mac." It is built from the settings (`privacyStatement`). The one exception it lists is a model download you start. With strict local mode on, it says there is no network connection at all.

**Network use:** the only network use in Murmur is the two model downloads: the speech model, and the Quality model for Instruct. Both go through `privacy/network-guard.ts`.

## Privacy mode (HB-48)

The presets are not stored. The page works out which preset the switches match, and shows Custom when they match none.

|                                     | Balanced (default) | Minimal    | Full          |
| ----------------------------------- | ------------------ | ---------- | ------------- |
| Keep dictations in History          | on                 | on         | on            |
| Keep dictation text                 | forever            | 7 days     | forever       |
| Recordings of successful dictations | a day              | not at all | until deleted |
| Read the text around the cursor     | on                 | on         | on            |
| Learn from my corrections           | on                 | off        | on            |
| Voice Profile                       | on                 | off        | on            |

**The switches:**

- **Keep dictations in History** (`privacy.settings.storeHistory`): off writes no History row. Insights still count words and time, but with no app.
- **Recordings** (`audio`):
  - "Not at all" deletes a successful dictation's recording as soon as its row is written.
  - "Until I delete them" moves the recording to the kept folder with no expiry.
  - Failed recordings are always kept 7 days, for retry.
- **The other three** switches are the existing settings (`contextAwareness`, `learnCorrections`, `voiceProfile.enabled`), shown here too.

## Retention (HB-50)

A daily job (`privacy/retention.ts`) runs at start when a day has passed since its last run, and the app checks every hour whether it is due. "Run now" runs it at once.

**What the job removes:**

- dictations older than the "Keep dictation text" choice, with their recordings;
- recordings past their time (a day; 7 days for failed ones);
- the text of Instruct threads after 30 days;
- learned word suggestions not seen for 90 days;
- voice samples after 30 days.

Dictionary, Snippets, Styles, Memory and Scratchpad notes have no rule; retention never touches them.

**The record:** each run's counts and time go into `retention_jobs` (migration 0024). The page shows the last run, the next run and what was removed. A rule that fails is shown as -1, and the others still run.

## Local storage (HB-49)

The page shows the data folder (`Application Support/Murmur`) and the size of each part, worked out on demand: the database with its WAL files, recordings, Scratchpad images and models. "Show in Finder" opens the folder.

## Strict local mode (HB-52)

Turning strict local mode on or off needs a second, confirming click. While it is on:

- **Downloads:** model downloads are refused with a message. Download models before turning it on.
- **Page requests:** every page request to anything but the local development server is cancelled (`webRequest.onBeforeRequest`).
- **Recordings:** a successful dictation's recording is deleted at once.
- **Learning:** learning from corrections and the Voice Profile are turned off, and kept off while it stays on.

It is a local behaviour setting, not a certification.
