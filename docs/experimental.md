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

## Manual test

1. Turn on Split into messages, focus a chat box, dictate three sentences with a clear
   pause between them: three messages are sent.
2. Play music, turn on Pause media, dictate: the music pauses and resumes. Pause the music
   yourself, dictate again: it stays paused.
