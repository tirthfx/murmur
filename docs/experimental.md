# Experimental options

Settings, **Experimental** (`experimental.flags`). All are off by default, and none asks
macOS for a new permission.

## Split into messages (DC-37)

For chat apps. When a dictation has pauses of two seconds or more (from the speech model's
segment times), each part is inserted and sent with Return, then the next part follows. A
part under five words joins the one before it. Return is pressed after every part except
the last; saying "press enter" at the end sends the last one too. History keeps one row,
with the parts on separate lines. If a part cannot be inserted, the rest are not sent, so
messages never arrive out of order. Turn it on only for apps where Return sends a message.

## Pause media while dictating (DC-42)

When dictation starts, the helper asks the system what is playing (`media.playback`); if
something is, it sends Pause (`media.pause`) and remembers that it did. When the recording
ends it sends Play (`media.resume`), but only if it paused something, so media you had
paused stays paused. It uses the system's now-playing service, loaded at run time; if macOS
does not tell Murmur what is playing, the option shows as not available. It can be on
together with "Mute other audio while dictating".

## Switch microphone when a headset is put on (DC-14)

Shown but disabled: no connected headset reports whether it is worn, and Murmur has no list
of supported headsets yet.

## Bluetooth ring microphone (DC-15)

Hidden until turned on. Then **Search for ring** runs for 30 seconds and reports that no
ring was found: no ring model is supported yet. The search does not use Bluetooth, so it
asks for no permission.

## Learn phrases (PZ-05)

From the final text of each inserted dictation, runs of two to four capitalised words that do
not start a sentence and do not start or end with a common word (such as "Harbour Lights
Migration") are counted in `phrase_counts`, once per dictation. A phrase seen three times in
14 days is added to the dictionary as a learned phrase (`kind = phrase`, source learned), shown
with "Learned" and "Phrase" for Keep or Delete. The longest form wins: once "Harbour Lights
Migration" is learned, "Harbour Lights" is not added. At most 100 learned phrases; counts older
than 14 days are dropped, and at most 2,000 phrases are counted. Nothing longer than four words
is stored.

## Detect the style from the text (PZ-14)

Needs context awareness. The text already in the field (memory only), or, in an empty field,
what was just said, is scored: "Dear …" (0.9) or "Hi Sam," with a capitalised name (0.8) and a
sign-off line (+0.3) count for Email; two or more emoji, or one in a short text (0.8), and short
lines (+0.4) for Personal. At 0.75 or more the style of that category is used for the
dictation; otherwise the app's category stands. Developer apps are never changed, and email
signature and translation still follow the app's own category.

## Pronunciation clips (PZ-06)

Each dictionary entry gets Record, Play and Delete clip. Recording uses the chosen microphone,
stops after 3 seconds (or earlier with Stop), and keeps at most 3 s as a WAV file in
`<appData>/Murmur/clips/<entry id>.wav` (path in `dictionary.sample_path`). Under 0.3 s is
refused. Deleting the entry deletes the clip. A clip is only played back; it never changes
recognition.

## Manual test

1. Turn on Split into messages, focus a chat box, dictate three sentences with a clear
   pause between them: three messages are sent.
2. Play music, turn on Pause media, dictate: the music pauses and resumes. Pause the music
   yourself, dictate again: it stays paused.
3. Turn on Learn phrases and dictate "the plan for Harbour Lights Migration" three times:
   it appears on the Dictionary page as a learned phrase.
4. Turn on Detect the style, open an empty chat box, dictate "Hi Sam, the report is ready":
   the log says `style detection: email`.
5. Turn on Pronunciation clips, record a word, play it back, delete the entry: the file in
   the clips folder is gone.
