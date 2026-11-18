# Insights

The Hub's Insights page (HB-11, HB-36 to HB-39, HB-45). Everything is worked out on this Mac from daily counts. No dictated text is read for Insights.

## Daily counts

`insights_daily` (migration 0018) has one row per local calendar day:

- words;
- dictations;
- recording time (`speech_ms`);
- the words and recording time of dictations at least 20 seconds long (for words per minute);
- `apps_json`: for each app's bundle id, its name, its word count and its dictation count.

How rows are written:

- A dictation is added to its day as soon as its history row is written. It counts only if it put words into an app (inserted, or left on the clipboard) and has at least one word.
- The day is the local date at that moment.
- At start, dictations from before Insights existed are counted once from `history`. `insights_meta` records that this has run.
- Deleting history text later does not change Insights.

Speaking time is the recording length. Murmur does not keep how much of a recording was speech.

## The page

- **Your usage:** choose a range (7 days, 30 days, 12 months, all time; 30 days by default). The cards show:
  - words, dictations, average words per dictation, speaking time;
  - estimated time saved: typing time for the words at the chosen typing speed (40 wpm by default, 10 to 150), less the speaking time;
  - words per minute, from dictations of 20 seconds or more, with the best day;
  - the daily and weekly streaks.
- **Top apps:** the 10 apps with the most words, then Other. The percentages add up to 100. An app with no saved name shows its bundle id.
- **Your voice:** the Voice Profile summary and top phrases, with a link to My Voice. If Voice Profile is off, the tab says how to turn it on.
- **Leaderboard:** says that there is none, since Murmur has no team.

## Streaks

- **Daily:** consecutive local days with at least one counted dictation. Today counts once it has one. Until midnight, yesterday's run still stands.
- **Weekly:** consecutive Monday-start weeks with at least 3 active days. This week counts once it reaches 3.
- There are no grace days.

## Export

Export CSV saves the range's days to a file you choose. Columns: `date, words, dictations, speech_seconds, session_seconds, apps_json`. `apps_json` holds word counts by bundle id. There is no text.
