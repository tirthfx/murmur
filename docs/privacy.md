# Data and privacy

Settings, Data and Privacy (HB-21, HB-48 to HB-50, HB-52).

## What leaves this Mac

**The statement:** the page says "Nothing leaves this Mac." It is built from the settings (`privacyStatement`). The one exception it lists is a model download you start. With strict local mode on, it says there is no network connection at all.

**Files you write:** a shareable file of a meeting (NT-18) is written only where you save it, or in the place you chose for a folder; it holds no audio and no web links. What happens to it after that is up to the place it is in (a synced folder, for instance).

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

## Export (HB-46)

Tick categories and choose a folder. Murmur writes a new `Murmur export <date time>` folder inside it, through `privacy/data-export.ts`:

| Category                            | Files                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Dictations (archived ones too)      | `dictations.json`: date, app, status, language, length, words, raw and final text |
| Dictionary                          | `dictionary.csv`                                                                  |
| Snippets                            | `snippets.md`: one heading per trigger                                            |
| Styles and custom Rewrites          | `styles-and-rewrites.json`                                                        |
| Memory                              | `memory.json`                                                                     |
| Scratchpad notes                    | `notes/<title>.md`, each with its images in a folder beside it                    |
| Instruct threads                    | `instruct.md`                                                                     |
| Insights                            | `insights.csv`                                                                    |
| Kept recordings (off unless ticked) | `audio/`                                                                          |

**The index:** a generated `README.md` lists each category's files, its count and a format version (1), so a later import can read them.

**Never exported:** models, keys and settings.

## Delete by category (HB-47)

**What the page shows:** each category with its count and, for recordings, notes and the Dictionary's clips, its size on disk.

**How deleting works:**

- Each delete needs a second click that says it cannot be undone. Categories are deleted one at a time, in `privacy/data-delete.ts`.
- Each category is one transaction, and its files are removed after it commits. A file that cannot be removed is kept on a list, and the page offers Retry.

**What each category covers:**

- **Dictations:** their recordings, plus Rewrite and command runs. The Dictionary and Snippets stay.
- **Recordings:** the files only; dictations stay.
- **Styles:** goes back to the four default styles, and removes your app overrides and writing samples.
- **Insights and milestones:** also marks history as already counted, so Insights don't refill from it.
- **Meetings and their recordings:** every meeting, its chunk rows, transcript, summaries, notes and the `meetings` folder (NT-04), the tasks taken from meetings and the Ask conversations and index about them (NT-26, NT-14). Tasks written by hand stay.

**"Delete all data and reset"** deletes every category, plus custom Rewrites, Focus lists, retention records and every setting. With the box ticked, it also deletes downloaded models. Murmur then restarts at first-run setup.
